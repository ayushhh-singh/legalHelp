import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import ChapterQuizPage from './pages/ChapterQuizPage'
import ReaderPage from './pages/ReaderPage'
import { CoverageMap } from './components/CoverageMap'
import { SessionTimer } from './components/SessionTimer'
import RevisionSheetPage from './pages/RevisionSheetPage'

import { db } from '@/db'
import { expectRailTab, openRail } from '@/test/rail'
import { loadWork } from '@/lib/library'
import { QUIZ_LENGTH, chaptersOf } from '@/lib/study'
import type { Card } from '@/modules/trainer/schema'

/**
 * An edge-case pass over Session 28's surfaces, after the commit.
 *
 * Every test here was confirmed to FAIL against the committed code before its
 * fix was written.
 *
 * The pattern is ADR-039's second addendum rather than ADR-032's: the untrusted
 * halves WERE guarded — the aid dataset is pointer-tested in both directions,
 * the agent's citations are re-derived, a self-grade cannot rate a chapter it
 * does not belong to. What failed is state written as though the page it lives
 * on is the only page: three components in the reader's rail keep their state
 * across a unit change that never unmounts them, and one of the three then
 * writes the reader's own words against the wrong provision.
 */

const WORK = 'ccs-conduct'

beforeEach(async () => {
  await Promise.all([
    db.feynmanAttempts.clear(),
    db.chapterCards.clear(),
    db.chapterLog.clear(),
    db.libraryProgress.clear(),
    db.reviewLog.clear(),
    db.srsCards.clear(),
    db.settings.clear(),
  ])
})

describe('the reader’s rail must not carry one unit’s state onto the next', () => {
  /**
   * THE ONE THAT CORRUPTS DATA.
   *
   * `ReaderPage` renders `<FeynmanBox unit={unit} …/>` with no `key`, and `j`
   * navigates between units without unmounting anything. So a reader who
   * starts writing about Rule 3, moves to Rule 4 and presses Save has their
   * prose about Rule 3 stored against **Rule 4** — `saveAttempt` reads
   * `unit.id` from the props it has now, and the textarea still holds what was
   * typed for the unit before.
   *
   * Nothing throws, nothing logs, and a screenshot of either screen looks
   * correct. It is found only by moving between units mid-sentence.
   */
  /**
   * Navigation is through the reader's OWN "Next" link rather than a re-render
   * with different `initialEntries`: `MemoryRouter` reads `initialEntries` once,
   * at mount, so re-rendering it with another path navigates nothing and the
   * first version of this test passed against every variant of the bug.
   */
  const next = () => screen.getByRole('link', { name: /^Next/ })

  /**
   * THE ONE THAT CORRUPTS DATA.
   *
   * `ReaderPage` rendered `<FeynmanBox unit={unit} …/>` with no `key`, and
   * `j`/`k` and the prev/next links move between units without unmounting the
   * rail. So a reader who starts writing about Rule 3, moves to Rule 4 and
   * presses Save has their prose about Rule 3 stored against **Rule 4** —
   * `saveAttempt` reads `unit.id` from the props it has now, and the textarea
   * still holds what was typed for the unit before.
   *
   * Nothing throws, nothing logs, and a screenshot of either screen looks
   * correct. It is reachable by moving between units mid-sentence.
   */
  it('does not carry one unit’s own-words draft onto the next unit', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={[`/study/read/${WORK}/ccs-conduct-3`]}>
        <Routes>
          <Route path="/study/read/:workId/:unitId" element={<ReaderPage />} />
        </Routes>
      </MemoryRouter>,
    )

    await openRail(user, 'Practise')
    await user.click(await screen.findByRole('button', { name: /Write my own version/i }))
    await user.type(screen.getByRole('textbox', { name: /own words/i }), 'This is about Rule 3.')

    // The reader moves on WITHOUT saving.
    await user.click(next())
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument())

    /*
      The rail must still be on Practise, and this is asserted before anything
      else. The choice is remembered in IndexedDB, so it survives the
      navigation — but if it did not, the box would be off screen entirely and
      the "not in the document" check below would pass for the wrong reason,
      against the very bug this test exists for.
    */
    await expectRailTab('Practise')

    // The box on the next provision must be closed and empty.
    await waitFor(() => {
      expect(screen.queryByRole('textbox', { name: /own words/i })).not.toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: /Write my own version/i })).toBeInTheDocument()
  })

  /**
   * The confirmation, not the data: "Rated. Back on <date>." is component state
   * in `ChapterRevisionCard` and was not keyed on the chapter, so rating one
   * chapter and reading on into the NEXT one showed a confirmation for a
   * chapter the reader had never rated.
   *
   * A flat work is grouped into runs of twelve, so this walks far enough to
   * cross a chapter boundary rather than assuming the next unit is in one.
   */
  it('does not show a stale “Rated” confirmation after crossing into another chapter', async () => {
    const user = userEvent.setup()
    const work = await loadWork(WORK)
    const chapters = chaptersOf(work)
    expect(chapters.length, 'the test needs at least two chapters').toBeGreaterThan(1)
    const firstOfSecond = chapters[1]!.unitIds[0]!

    render(
      <MemoryRouter initialEntries={[`/study/read/${WORK}/${chapters[0]!.unitIds[0]!}`]}>
        <Routes>
          <Route path="/study/read/:workId/:unitId" element={<ReaderPage />} />
        </Routes>
      </MemoryRouter>,
    )

    await openRail(user, 'Practise')
    await user.click(await screen.findByRole('button', { name: /I could use it/i }))
    await screen.findByText(/^Rated\./)

    // Walk to the first unit of the SECOND chapter through the reader itself.
    for (let step = 0; step < chapters[0]!.unitIds.length; step += 1) {
      await user.click(next())
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument())
      if (screen.queryByRole('link', { name: /^Next/ }) === null) break
      if (window.location.pathname.endsWith(firstOfSecond)) break
    }

    // Same reason as above: the panel has to be the one on screen before its
    // absence means anything.
    await expectRailTab('Practise')
    await waitFor(() => expect(screen.queryByText(/^Rated\./)).not.toBeInTheDocument())
  })
})

describe('the coverage heat-map’s third dimension must be reachable', () => {
  /**
   * `WorkPage` mounted `<CoverageMap … cards={null} />`, so `cardUnits` was
   * always empty, so `quizzed` was false for every unit — the "Quizzed" badge
   * read 0 forever and `readNotQuizzed`, which is the figure the whole summary
   * exists to produce, was just `read` under another name.
   *
   * That is ADR-039's second addendum exactly: a feature the brief named, wired
   * up end to end, that could never fire. It has its i18n keys, its badge and
   * its legend, and it did nothing.
   */
  it('marks a unit quizzed when a card citing it has been reviewed', async () => {
    const card: Card = {
      id: 'ccs-conduct-mcq-3',
      act: WORK,
      rule: '3',
      kind: 'mcq',
      front: { en: 'F', hi: 'F' },
      back: { en: 'B', hi: 'B' },
      options: [
        { en: 'A', hi: 'A' },
        { en: 'B', hi: 'B' },
      ],
      answerIndex: 0,
      ruleRef: { textId: 'ccs-conduct-3', citation: { en: 'Rule 3', hi: 'नियम 3' } },
      reviewState: 'approved',
      reviewed: true,
      difficulty: 'medium',
      version: '1.0.0',
      source: { name: 'DoPT', url: 'https://dopt.gov.in/' },
      verify: true,
    }
    await db.reviewLog.put({
      id: `${card.id}#1#2026-09-02T06:00:00.000Z`,
      qId: card.id,
      grade: 'Good',
      at: '2026-09-02T06:00:00.000Z',
      stateBefore: 'new',
      retrievability: null,
      durationMs: 1000,
      elapsed: 0,
    })

    render(
      <MemoryRouter>
        <CoverageMap
          workId={WORK}
          unitIds={['ccs-conduct-3', 'ccs-conduct-4']}
          toc={[
            { id: 'n3', number: '3', heading: { en: 'General', hi: 'सामान्य' }, unitIds: ['ccs-conduct-3'] },
            { id: 'n4', number: '4', heading: { en: 'Other', hi: 'अन्य' }, unitIds: ['ccs-conduct-4'] },
          ]}
          cards={[card]}
        />
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.getByText(/^Quizzed: 1$/)).toBeInTheDocument())
  })

  /**
   * The component above proves the map CAN report a quizzed unit. This proves
   * the work page actually hands it something to report one from.
   *
   * It reads the source rather than the DOM on purpose: whether any unit is
   * quizzed depends on the reader's own review history, so a DOM assertion here
   * would either seed one (and be a second test of `coverageOf`, which
   * `analytics.test.ts` already covers) or assert a zero that is correct on a
   * fresh device. The defect was a literal `null` at the call site, and that is
   * the thing to catch.
   */
  it('is given the catalogue by the work page, not a hard-coded null', async () => {
    const { readFromRoot } = await import('@/test/paths')
    const source = readFromRoot('src/modules/library/pages/WorkPage.tsx')
    expect(source).toMatch(/<CoverageMap[^>]*cards=\{/s)
    expect(source, 'CoverageMap is mounted with cards={null}, so `quizzed` can never be true').not.toMatch(
      /<CoverageMap[^>]*cards=\{null\}/s,
    )
  })
})

describe('the chapter quiz must not grade one wrong answer twice', () => {
  /**
   * Every answer already goes through `reviewCard` as it is given — that is
   * deliberate, so a quiz abandoned half way has still taught the scheduler
   * what it learned. "Add the ones I got wrong to my review deck" then called
   * `reviewCard` a SECOND time with `Again` for each of them.
   *
   * The cost is not cosmetic. On a card the officer had matured into `review`,
   * the first `Again` is the lapse they earned; the second cut FSRS stability
   * from 4.72 days to 1.51 — a 68% penalty for one wrong answer — and wrote a
   * second `reviewLog` row for a review that never happened. `reviewLog` is
   * what `weeklyReview` counts and what retention is measured from, so the
   * damage outlives the schedule.
   *
   * The button was redundant as a grading action from the moment answers were
   * wired into the Trainer's own history: the wrong ones are already at the
   * front of the queue. It now says so and offers the deck instead.
   */
  it('records exactly one review per question, even after the results screen', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={[`/study/read/${WORK}/quiz/group-n-ccs-conduct-1`]}>
        <Routes>
          <Route path="/study/read/:workId/quiz/:nodeId" element={<ChapterQuizPage />} />
        </Routes>
      </MemoryRouter>,
    )

    // Skip every question — a skip is an unanswered question, graded `Again`.
    const skip = await screen.findByRole('button', { name: /^Skip$/ })
    expect(skip).toBeInTheDocument()
    for (let i = 0; i < QUIZ_LENGTH; i += 1) {
      const button = screen.queryByRole('button', { name: /^Skip$/ })
      if (!button) break
      await user.click(button)
    }

    await user.click(await screen.findByRole('button', { name: /^Finish$/ }))
    await screen.findByText(/of \d+ right/)

    const before = await db.reviewLog.count()
    expect(before).toBe(QUIZ_LENGTH)

    // Whatever the results screen offers for the wrong answers, pressing it
    // must not re-grade a card the quiz has already graded.
    const offer = screen.queryByRole('button', { name: /review deck/i })
    if (offer) await user.click(offer)
    await waitFor(async () => expect(await db.reviewLog.count()).toBe(before))
  })
})

describe('every library-scope tool has a plain-language label', () => {
  /**
   * `StudyAskPanel` used to build its progress labels by interpolating a tool
   * name into `t()` behind an `as` cast, so a seventh `library`-scope tool
   * would have rendered its own i18n key at the reader — with
   * `fallbackLng: false`, a missing key IS its own name.
   *
   * A tool name is a string, not a type, so no map can make that a compile
   * error on its own. This asserts the map against the REGISTRY, which is the
   * mechanism `src/ai/tools/registry.test.ts` already uses for the same
   * problem: adding a tool without a label fails here rather than in front of
   * somebody reading a rule book.
   */
  it('covers exactly the tools the registry exposes to the study agent', async () => {
    const [{ TOOL_LABELS }, registry, builtins] = await Promise.all([
      import('./askLabels'),
      import('@/ai/tools/registry'),
      import('@/ai/tools/index'),
    ])
    builtins.registerBuiltinTools()

    /*
      Scoped to `library` on purpose. `listTools('library')` also returns the
      two `common` tools every agent gets (`dataset_versions`, `today_in_india`),
      and those have no plain-language label here — they are not about the
      provision the reader is looking at. The test below is what makes that
      safe: an unlabelled tool falls back to the phase it is part of, which is
      always a true sentence, never a raw key.
    */
    const registered = registry
      .listTools('library')
      .filter((tool) => tool.def.scope === 'library')
      .map((tool) => tool.def.name)
      .sort()
    expect(registered.length).toBeGreaterThan(0)
    expect(Object.keys(TOOL_LABELS).sort()).toEqual(registered)
  })

  it('falls back to the phase rather than to a raw key', async () => {
    const { labelFor } = await import('./askLabels')
    expect(labelFor('get_unit')).toBe('library.study.ask.tool.get_unit')
    expect(labelFor('a_tool_nobody_labelled')).toBeNull()
    // `Object.hasOwn`, never `in` — ADR-038's `isWorkId` lesson.
    expect(labelFor('constructor')).toBeNull()
    expect(labelFor('toString')).toBeNull()
  })
})

describe('the surfaces the brief asked to be adjustable', () => {
  /**
   * "session timer (free or Pomodoro 25/5, configurable)" — the brief's own
   * words. `clampPomodoro` was written, tested and bounded (5-90 work, 1-30
   * break), and then `SessionTimer` held its config in
   * `const [config] = useState(DEFAULT_POMODORO)` with no setter, so the only
   * caller that could ever vary it was the test file.
   *
   * Reachability, not correctness: the code was right and could not run. That
   * is ADR-039's second addendum for the third time this session.
   */
  it('lets the reader change the Pomodoro lengths', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <SessionTimer workId={WORK} workLabel="CCS (Conduct) Rules" />
      </MemoryRouter>,
    )

    await user.click(screen.getByRole('radio', { name: /Pomodoro/i }))
    const work = screen.getByRole('spinbutton', { name: /minutes of work/i })
    await user.clear(work)
    await user.type(work, '50')
    expect(screen.getByText(/^50 minutes of work, /)).toBeInTheDocument()
  })

  /**
   * `clampPomodoro`'s bounds must be the ones a reader actually hits, or they
   * are bounds on nothing.
   */
  it('clamps a nonsense length rather than storing it', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <SessionTimer workId={WORK} workLabel="CCS (Conduct) Rules" />
      </MemoryRouter>,
    )
    await user.click(screen.getByRole('radio', { name: /Pomodoro/i }))
    const work = screen.getByRole('spinbutton', { name: /minutes of work/i })
    await user.clear(work)
    await user.type(work, '999')
    // Anchored: the bounds sentence under the hint also says "90 minutes of
    // work", and an unanchored match finds both.
    expect(screen.getByText(/^90 minutes of work, /)).toBeInTheDocument()
  })
})

describe('the revision sheet’s mode toggle', () => {
  /**
   * The link back to the full sheet was built as `` to={`?${''}`} `` — a bare
   * `"?"` — which is not obviously a valid destination. If it does not clear
   * `mode=24h`, a reader who switches to 24-hour mode can never switch back
   * without editing the address bar.
   */
  it('goes both ways', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={[`/study/read/${WORK}/sheet/group-n-ccs-conduct-1`]}>
        <Routes>
          <Route path="/study/read/:workId/sheet/:nodeId" element={<RevisionSheetPage />} />
        </Routes>
      </MemoryRouter>,
    )

    await screen.findByRole('heading', { level: 1, name: /Revision sheet/i })
    await user.click(screen.getByRole('link', { name: /24-hour mode/i }))
    expect(await screen.findByText(/Only the traps, the limits/i)).toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: /^Everything$/i }))
    await waitFor(() => {
      expect(screen.queryByText(/Only the traps, the limits/i)).not.toBeInTheDocument()
    })
  })
})

describe('the Ask panel must not be offered where its tools cannot reach', () => {
  /**
   * A PERSONAL work — a document the reader pasted in — has a `my-`-prefixed
   * id, and every tool in `src/ai/tools/library.ts` guards on `isWorkId`, which
   * that id fails by construction. So on such a document `get_unit`,
   * `get_study_aid`, `get_definitions`, `retrieve` and `get_related_cards` all
   * answer "unknown work", the run cites nothing, and `groundedRequired`
   * discards it.
   *
   * The panel rendered anyway: an input, six intent chips and a Send button
   * whose only possible outcome was "it could not answer" — a control that is
   * reachable, labelled, translated and cannot succeed. ADR-039's second
   * addendum, for the fourth time in this session.
   *
   * The second assertion is the one that stops this passing for the wrong
   * reason: with the SAME consent state, on a dataset work, the panel is there.
   */
  const consented = async () => {
    const [{ useAppStore }, { DEFAULT_AI_SETTINGS, CONSENT_VERSION }] = await Promise.all([
      import('@/app/store'),
      import('@/ai/flags'),
    ])
    // `isAiEnabled` needs BOTH: the current consent version and a tier that is
    // not `off`. Setting only the consent leaves the app in the state a reader
    // is in after reading the notice and choosing nothing — which is still off.
    useAppStore.setState({
      ai: {
        ...DEFAULT_AI_SETTINGS,
        tier: 'byok',
        consentVersion: CONSENT_VERSION,
        consentAt: '2026-09-03',
      },
    })
  }

  it('is absent on a document the reader added themselves', async () => {
    await consented()

    /*
      The dataset work is rendered FIRST, and that is not throat-clearing.

      `StudyAskPanel` is behind `React.lazy`, so on a fresh module registry it
      is absent from the DOM for a tick whatever the gate says — which made the
      first version of this test pass against the very bug it was written for.
      Rendering a work where the panel SHOULD appear resolves the lazy module
      and caches it, so from here on "not in the document" means the gate kept
      it out rather than the bundler not having produced it yet.

      `network.sentinel`'s own story (ADR-031) in a second place: break the code
      and watch the assertion go red before believing it.
    */
    const warm = render(
      <MemoryRouter initialEntries={[`/study/read/${WORK}/ccs-conduct-3`]}>
        <Routes>
          <Route path="/study/read/:workId/:unitId" element={<ReaderPage />} />
        </Routes>
      </MemoryRouter>,
    )
    await openRail(userEvent.setup(), 'Ask')
    await screen.findByText('Ask about this')
    warm.unmount()

    const id = 'my-edge-probe'
    await db.libraryPersonalWorks.put({
      id,
      title: 'A circular I was sent',
      language: 'en',
      note: 'Pasted in for the edge pass.',
      unitWord: 'paragraph',
      units: [
        { id: `${id}-1`, number: '1', heading: 'First', text: 'The text of the first unit.', division: null },
      ],
      divisions: [],
      createdAt: '2026-09-03T00:00:00.000Z',
      updatedAt: '2026-09-03T00:00:00.000Z',
    })

    render(
      <MemoryRouter initialEntries={[`/study/read/${id}/${id}-1`]}>
        <Routes>
          <Route path="/study/read/:workId/:unitId" element={<ReaderPage />} />
        </Routes>
      </MemoryRouter>,
    )

    await screen.findByRole('heading', { level: 1 })
    /*
      The own-words box is there — it works on any document, and should. The
      rail's stored tab is `ask` from the warm-up above and Ask does not exist
      here, so the rail falls to the first tab that does: `understand` has no
      authored aid for a pasted document, which leaves Practise. That fall-back
      is what makes this assertion meaningful rather than incidental.
    */
    await expectRailTab('Practise')
    expect(screen.getByRole('button', { name: /Write my own version/i })).toBeInTheDocument()
    // The Ask panel is not — and neither is a tab offering it.
    expect(screen.queryByRole('tab', { name: 'Ask' })).not.toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByText('Ask about this')).not.toBeInTheDocument()
    })
  })

  it('is present on a dataset work with the same consent', async () => {
    await consented()
    render(
      <MemoryRouter initialEntries={[`/study/read/${WORK}/ccs-conduct-3`]}>
        <Routes>
          <Route path="/study/read/:workId/:unitId" element={<ReaderPage />} />
        </Routes>
      </MemoryRouter>,
    )
    await screen.findByRole('heading', { level: 1 })
    await openRail(userEvent.setup(), 'Ask')
    expect(await screen.findByText('Ask about this')).toBeInTheDocument()
  })
})
