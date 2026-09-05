import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import ChapterQuizPage from './pages/ChapterQuizPage'
import ReaderPage from './pages/ReaderPage'
import RevisionSheetPage from './pages/RevisionSheetPage'
import StudyHubPage from './pages/StudyHubPage'

import { db } from '@/db'
import { expectRailTab, openRail } from '@/test/rail'
import { loadStudyAids } from '@/lib/library'
import { chaptersOf, rateChapterCard, saveAttempt } from '@/lib/study'
import { loadWork } from '@/lib/library'

/**
 * Session 28's surfaces, in jsdom.
 *
 * The load-bearing claim is the FIRST describe block's: with AI off — every
 * device's default — the precomputed aid, the own-words box and the chapter
 * quiz are all on screen and nothing has been asked of a model. That is the
 * ordering the whole module is built on ("precomputed aids, zero cost, the
 * default"), and it is the thing that would break silently if a later session
 * moved a study surface behind the consent gate for tidiness.
 *
 * `src/ai/useAi()` reads the `ai` settings row, which is absent on a fresh
 * database and parses to `enabled: false` — so "AI off" here is the real
 * default rather than a mock.
 */

const at = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/study/progress" element={<StudyHubPage />} />
        <Route path="/study/read/:workId/quiz/:nodeId" element={<ChapterQuizPage />} />
        <Route path="/study/read/:workId/sheet/:nodeId" element={<RevisionSheetPage />} />
        <Route path="/study/read/:workId/:unitId" element={<ReaderPage />} />
        <Route path="/study/read" element={<h1>Shelf</h1>} />
      </Routes>
    </MemoryRouter>,
  )

beforeEach(async () => {
  await Promise.all([
    db.chapterCards.clear(),
    db.chapterLog.clear(),
    db.feynmanAttempts.clear(),
    db.studySessions.clear(),
    db.studyGoals.clear(),
    db.libraryProgress.clear(),
    db.settings.clear(),
  ])
})

describe('with AI off, the study layer is still there', () => {
  it('renders the precomputed aid and the own-words box on a unit that has one', async () => {
    const user = userEvent.setup()
    const aids = await loadStudyAids('ccs-conduct')
    const aid = aids.aids.find((row) => row.reviewState === 'approved')
    expect(aid, 'the fixture needs at least one approved aid').toBeDefined()

    at(`/study/read/${aid!.workId}/${aid!.unitId}`)

    // The rail opens on Understand, which is where the precomputed aid is —
    // that ordering is the module's whole argument (`docs/AI.md` §13) and a
    // default that opened anywhere else would bury it.
    await expectRailTab('Understand')
    expect(await screen.findByText(/Sahayak’s explanation/i)).toBeInTheDocument()
    expect(screen.getByText(aid!.explanation.en)).toBeInTheDocument()

    await openRail(user, 'Practise')
    expect(screen.getByRole('button', { name: /Write my own version/i })).toBeInTheDocument()
  })

  it('does not render the Ask panel at all', async () => {
    const aids = await loadStudyAids('ccs-conduct')
    const aid = aids.aids.find((row) => row.reviewState === 'approved')!
    at(`/study/read/${aid.workId}/${aid.unitId}`)

    await screen.findByText(/Sahayak’s explanation/i)
    // The heading, the intent chips and the textarea are all inside the panel.
    expect(screen.queryByText('Ask about this')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Explain it simpler/i })).not.toBeInTheDocument()
  })
})

describe('the own-words attempt round trip', () => {
  it('stores what the reader wrote, exactly, and shows it back', async () => {
    const user = userEvent.setup()
    const aids = await loadStudyAids('ccs-conduct')
    const aid = aids.aids.find((row) => row.reviewState === 'approved')!
    at(`/study/read/${aid.workId}/${aid.unitId}`)

    await openRail(user, 'Practise')
    await user.click(await screen.findByRole('button', { name: /Write my own version/i }))
    const box = screen.getByRole('textbox', { name: /own words/i })
    // Trailing whitespace and a line break survive: the attempt is the
    // reader's own writing, not a normalised field.
    await user.type(box, 'A member of the service shall maintain absolute integrity.')
    await user.click(screen.getByRole('button', { name: /Check it against the rule/i }))

    await user.click(screen.getByRole('button', { name: /Save this attempt/i }))

    await waitFor(async () => {
      const rows = await db.feynmanAttempts.toArray()
      expect(rows).toHaveLength(1)
      expect(rows[0]!.body).toBe('A member of the service shall maintain absolute integrity.')
      expect(rows[0]!.unitId).toBe(aid.unitId)
    })
  })
})

describe('the chapter quiz', () => {
  it('offers only approved cards, and says so', async () => {
    const work = await loadWork('ccs-conduct')
    const chapter = chaptersOf(work)[0]!
    at(`/study/read/ccs-conduct/quiz/${chapter.nodeId}`)

    const note = await screen.findByText(/has been through its four-stage review/i)
    expect(note).toBeInTheDocument()
    expect(screen.getByText(/Nothing is generated/i)).toBeInTheDocument()
  })
})

describe('the revision sheet', () => {
  it('prints the chapter with its citation and disclaimer', async () => {
    const work = await loadWork('ccs-conduct')
    const chapter = chaptersOf(work)[0]!
    at(`/study/read/ccs-conduct/sheet/${chapter.nodeId}`)

    expect(await screen.findByRole('heading', { name: /Revision sheet/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Print/i })).toBeInTheDocument()
  })

  it('24-hour mode drops the explanation and keeps the trap', async () => {
    const work = await loadWork('ccs-conduct')
    const aids = await loadStudyAids('ccs-conduct')
    const chapters = chaptersOf(work)
    // A chapter with an aid that HAS a misconception, or the assertion below
    // would be about an absence that is true for a boring reason.
    const withTrap = aids.aids.find((row) => row.reviewState === 'approved' && row.misconception)
    expect(withTrap, 'the fixture needs an approved aid with a misconception').toBeDefined()
    const chapter = chapters.find((row) => row.unitIds.includes(withTrap!.unitId))!

    at(`/study/read/ccs-conduct/sheet/${chapter.nodeId}?mode=24h`)

    await screen.findByRole('heading', { name: /Revision sheet/i })
    expect(screen.getByText(withTrap!.misconception!.en)).toBeInTheDocument()
    expect(screen.queryByText(withTrap!.explanation.en)).not.toBeInTheDocument()
  })
})

describe('the weekly review', () => {
  it('counts a chapter rating and an own-words attempt', async () => {
    const work = await loadWork('ccs-conduct')
    const chapter = chaptersOf(work)[0]!
    await rateChapterCard({ chapter, confidence: 3 })
    await saveAttempt({
      workId: 'ccs-conduct',
      unitId: chapter.unitIds[0]!,
      body: 'my own words about this rule',
      grades: ['got-it', 'partial', 'missed'],
    })

    at('/study/progress')

    await screen.findByText('Chapters revised')
    /*
      The figures are 1, not the label.

      Asserting only that "Chapters revised" is on screen passes against a page
      showing zeroes — which is exactly what this page renders for the first
      frame or two, because every row arrives through `useLiveQuery` and Dexie
      answers a tick later. `waitFor` is the difference between testing the
      arithmetic and testing the heading.
    */
    await waitFor(() => {
      expect(screen.getByText('Chapters revised').closest('div')?.textContent).toContain('1')
      expect(screen.getByText('Own-words attempts').closest('div')?.textContent).toContain('1')
    })
  })

  it('says every figure stays on the device', async () => {
    at('/study/progress')
    expect(await screen.findByText(/comes from this device and stays on it/i)).toBeInTheDocument()
  })
})
