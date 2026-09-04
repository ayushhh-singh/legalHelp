import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import LibraryHubPage from './pages/LibraryHubPage'
import ReaderPage from './pages/ReaderPage'
import WorkPage from './pages/WorkPage'

import { db } from '@/db'
import { loadCorpus, loadWork, unitLabel } from '@/lib/library'
import { toUnitHref, unitIdFromPath } from './url'

/**
 * An edge-case pass over the Library's three screens, after the commit.
 *
 * Every test here was confirmed to FAIL against the committed code before its
 * fix was written. They are all the same shape, and it is the shape ADR-032's
 * addendum named for the drafting agent: the half that was obviously untrusted
 * got guarded, and the half that "cannot fail" did not. Here the untrusted half
 * was the dataset — validated twice, its pointers checked in both directions —
 * and the half written as though it cannot fail was the page: a Dexie read the
 * whole screen waits for, a fallback that only fires for the last-opened work,
 * a rail that is empty for eleven of the fifteen works, and a keyboard handler
 * that fires underneath an open dialog.
 */

const at = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        {/* The shelf is the Read SUB-TAB now, so its own masthead is an `<h2>`
            and `TabLayout` owns the `<h1>` — hence `level: 2` below (ADR-046). */}
        <Route path="/study/read" element={<LibraryHubPage />} />
        <Route path="/study/read/:workId" element={<WorkPage />} />
        <Route path="/study/read/:workId/:unitId" element={<ReaderPage />} />
        {/* Somewhere to land, so a redirect is observable. */}
        <Route path="/law" element={<h1>Law Converter</h1>} />
      </Routes>
    </MemoryRouter>,
  )

const read = (workId: string, unitId: string, at: string) =>
  db.libraryProgress.put({ id: `${workId}:${unitId}`, workId, unitId, at, secondsRead: 60 })

/**
 * The provision's own text, inside the `<article>`.
 *
 * Session 28 put a study aid in the rail, and CCS Conduct Rule 3's aid quotes
 * the phrase this file used as its "the rule rendered" probe — so a bare
 * `findByText(/absolute integrity/i)` now matches two elements and throws. The
 * probe is scoped to the article rather than made more specific, because what
 * these tests actually mean is "the RULE is on screen", and the article is
 * where the rule is.
 */
const ruleText = async () => within(await screen.findByRole('article')).findByText(/absolute integrity/i)

beforeEach(async () => {
  await db.libraryProgress.clear()
})

describe('a screen must not wait on a read it only decorates itself with', () => {
  /**
   * The hub, the work page and the reader each blocked their whole render on a
   * `useLiveQuery`. Progress ticks, the progress ring and the bookmark state
   * are conveniences; the CONTENTS and the RULE are what the reader came for.
   * On a device whose storage is refused — a private window, a managed device
   * with site data blocked — `useLiveQuery` never produces a value, and all
   * three screens sat on a skeleton for ever.
   *
   * The library the reader wanted to read is right there in a precached chunk.
   */
  it('renders the shelf even when progress never resolves', async () => {
    const spy = vi.spyOn(db.libraryProgress, 'toArray').mockReturnValue(new Promise(() => undefined) as never)
    try {
      at('/study/read')
      expect(await screen.findByRole('heading', { level: 2, name: 'Library' })).toBeInTheDocument()
      expect(await screen.findByText(/Central Civil Services \(Conduct\) Rules, 1964/)).toBeInTheDocument()
    } finally {
      spy.mockRestore()
    }
  })

  it('renders a work’s table of contents even when progress never resolves', async () => {
    const spy = vi.spyOn(db.libraryProgress, 'where').mockReturnValue({
      equals: () => ({ toArray: () => new Promise(() => undefined) }),
    } as never)
    try {
      at('/study/read/ccs-conduct')
      expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(/Conduct/)
      expect(await screen.findByRole('heading', { name: 'Contents' })).toBeInTheDocument()
    } finally {
      spy.mockRestore()
    }
  })

  it('renders the rule even when the bookmark table never resolves', async () => {
    const spy = vi.spyOn(db.libraryBookmarks, 'where').mockReturnValue({
      equals: () => ({ toArray: () => new Promise(() => undefined) }),
    } as never)
    try {
      at('/study/read/ccs-conduct/ccs-conduct-3')
      expect(await ruleText()).toBeInTheDocument()
    } finally {
      spy.mockRestore()
    }
  })
})

describe('continue reading', () => {
  /**
   * The brief asks for two separate things on a shelf card — a "continue
   * reading" link WHEN PROGRESS EXISTS, and the file tab on the work last
   * opened. The committed hub conflated them and offered the link only on the
   * one card that already had the tab, so a reader half way through the CCS
   * (Leave) Rules who then opened the BNS lost their place in the Leave Rules
   * entirely: the ring said 40% and there was nothing to press.
   */
  it('is offered on every work with progress, not only the last one opened', async () => {
    await read('ccs-conduct', 'ccs-conduct-3', '2026-09-01T10:00:00.000Z')
    await read('rti', 'rti-8', '2026-09-02T10:00:00.000Z')

    at('/study/read')
    await screen.findByRole('heading', { level: 2, name: 'Library' })

    const links = await screen.findAllByRole('link', { name: /Continue reading/ })
    expect(links).toHaveLength(2)
    expect(links.map((link) => link.getAttribute('href')).sort()).toEqual([
      '/study/read/ccs-conduct/ccs-conduct-3',
      '/study/read/rti/rti-8',
    ])
  })

  it('still marks only the last-opened work with the file tab', async () => {
    // One tab per screen is the whole rule for that signature.
    await read('ccs-conduct', 'ccs-conduct-3', '2026-09-01T10:00:00.000Z')
    await read('rti', 'rti-8', '2026-09-02T10:00:00.000Z')

    const { container } = at('/study/read')
    await screen.findAllByRole('link', { name: /Continue reading/ })

    expect(container.querySelectorAll('.bg-marigold')).toHaveLength(1)
  })
})

describe('the progress ring', () => {
  /**
   * 1 unit of the BNSS's 531 is 0.19%, which `Math.round` makes 0, which the
   * ring reported as "Not started" — to a reader who had demonstrably started.
   * The ARC being invisible at that width is honest; the WORDS were not.
   */
  it('does not tell a reader who has read something that they have not started', async () => {
    await read('bnss', '1', '2026-09-01T10:00:00.000Z')

    at('/study/read')
    await screen.findByRole('heading', { level: 2, name: 'Library' })

    const ring = await screen.findByRole('img', { name: /Reading progress in BNSS/ })
    const card = ring.closest('section')
    expect(card?.textContent).not.toContain('Not started')
  })

  it('still says so for a work with no progress at all', async () => {
    at('/study/read')
    await screen.findByRole('heading', { level: 2, name: 'Library' })

    const ring = await screen.findByRole('img', { name: /Reading progress in BNSS/ })
    expect(ring.closest('section')?.textContent).toContain('Not started')
  })
})

describe('a search hit in a work that publishes no headings', () => {
  /**
   * FR/SR and CSMOP print no heading this repository could extract, which is
   * exactly why `unitLabel()` exists and why the table of contents falls back
   * to a quotation of the unit's opening. The search results were built by
   * hand instead — `heading[language] || heading.en` — so every hit in those
   * two works rendered a section number beside an empty string.
   */
  it('is labelled by the same rule the table of contents uses', async () => {
    const user = userEvent.setup()
    const work = await loadWork('fr-sr')
    const corpus = await loadCorpus(work)

    at('/study/read/fr-sr')
    await screen.findByRole('heading', { level: 1 })

    await user.type(screen.getByLabelText('Search inside this work'), 'joining time')

    const hits = await screen.findAllByRole('link', { name: /F\.R\./ })
    expect(hits.length).toBeGreaterThan(0)

    // Asserted on the row's own two elements — the number chip and the label
    // beside it — not on `hit.textContent`. Every row also carries a snippet of
    // the body, so any containment check over the whole row passes against the
    // broken version: the heading was an empty string and the snippet was doing
    // all the talking.
    for (const hit of hits.slice(0, 3)) {
      const [number, label] = [...(hit.firstElementChild?.children ?? [])]
      const unit = [...corpus.units.values()].find((c) => c.number === number?.textContent)
      expect(unit, number?.textContent ?? '(no number rendered)').toBeDefined()

      const expected = unitLabel(unit!.heading, unit!.excerpt, 'en')
      // The fixture has to be a work that actually exercises the fallback, or
      // this test passes for the wrong reason on a rule that has a heading.
      expect(unit!.heading.en, 'FR/SR stopped being headingless').toBe('')
      expect(expected.isExcerpt).toBe(true)
      expect(label?.textContent).toBe(expected.text)
    }
  })
})

describe('the related rail', () => {
  /**
   * `tocPath` returns a single node for a flat table of contents, so
   * `path.at(-2) ?? path.at(-1)` resolved to the LEAF — whose `unitIds` is the
   * one unit the reader is already on. Siblings came out empty, and "Nearby in
   * this work" rendered nothing for eleven of the fifteen works: every rule
   * book except the three Sanhitas and CSMOP.
   */
  it('offers neighbours in a work whose table of contents is flat', async () => {
    at('/study/read/ccs-conduct/ccs-conduct-3')
    await ruleText()

    const rail = await screen.findByRole('region', { name: 'Around this' })
    const nearby = await within(rail).findByRole('region', { name: /Nearby in this work/ })
    expect(within(nearby).getAllByRole('link').length).toBeGreaterThan(1)
  })

  it('still groups by chapter in a work that has them', async () => {
    at('/study/read/bns/103')
    await screen.findByRole('heading', { level: 1 })

    const rail = await screen.findByRole('region', { name: 'Around this' })
    expect(within(rail).getByRole('region', { name: /Elsewhere in this chapter/ })).toBeInTheDocument()
  })
})

describe('an id in the address bar that names no work', () => {
  /**
   * `tests/route-coverage.test.ts` exempts `/study/read/:workId` on the stated
   * grounds that a literal ":workId" "renders the not-found redirect". It did
   * not: it rendered a red failure card, which is what a real load error should
   * look like and is the wrong thing to show for a URL that was simply never a
   * work. An exemption whose reason is not true is an exemption that excuses
   * nothing while looking like it does.
   */
  it('goes back to the shelf rather than reporting a failure', async () => {
    at('/study/read/not-a-work')
    expect(await screen.findByRole('heading', { level: 2, name: 'Library' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('goes back to the shelf from the reader too', async () => {
    at('/study/read/not-a-work/whatever')
    expect(await screen.findByRole('heading', { level: 2, name: 'Library' })).toBeInTheDocument()
  })

  it('still says so for a real work whose unit does not exist', async () => {
    // A different question with a different answer: the work is real, the URL
    // is nearly right, and telling the reader is more use than moving them.
    at('/study/read/ccs-conduct/ccs-conduct-999')
    expect(await screen.findByText('This work has no such unit.')).toBeInTheDocument()
  })
})

describe('unitIdFromPath', () => {
  /**
   * The reader's key handler resolves "where am I" from the URL at press time
   * rather than from a per-render snapshot, because no snapshot can be current
   * during the window between a navigation and the passive effect that would
   * refresh it. This is that parse.
   */
  it('reads the unit out of a reader path', () => {
    expect(unitIdFromPath('/study/read/ccs-conduct/ccs-conduct-3', 'ccs-conduct')).toBe('ccs-conduct-3')
    expect(unitIdFromPath('/study/read/bns/103', 'bns')).toBe('103')
  })

  it('decodes, so a unit id that needed escaping survives the round trip', () => {
    const href = toUnitHref('fr-sr', 'fr-sr-f-r-5d')
    expect(unitIdFromPath(new URL(href, 'https://x').pathname, 'fr-sr')).toBe('fr-sr-f-r-5d')
  })

  it('answers null for anything that is not this work’s reader', () => {
    expect(unitIdFromPath('/study/read/ccs-conduct', 'ccs-conduct')).toBeNull()
    expect(unitIdFromPath('/study/read/bns/103', 'bnss')).toBeNull()
    expect(unitIdFromPath('/law?q=302', 'bns')).toBeNull()
    // A deeper path is a different route, not a unit with a slash in it.
    expect(unitIdFromPath('/study/read/bns/103/notes', 'bns')).toBeNull()
  })

  it('does not throw on a malformed escape in the address bar', () => {
    expect(unitIdFromPath('/study/read/bns/%E0%A4', 'bns')).toBeNull()
  })
})

describe('the reader’s own keyboard shortcuts', () => {
  /**
   * ADR-029's addendum, defect six, in a new file: a bare-key shortcut fired
   * underneath an open sheet navigates away and leaves the sheet showing over a
   * page it was never opened on. `useGlobalShortcuts` learned it and guards on
   * a live `[role="dialog"]` query; `j`/`k`/Home shipped here without one.
   */
  it('does not move between units while a dialog is open over the page', async () => {
    const user = userEvent.setup()
    at('/study/read/ccs-conduct/ccs-conduct-3')
    await ruleText()

    // Stands in for the shortcuts-help sheet or the AI consent modal — neither
    // is reachable from this module, which is why the guard is a DOM query.
    const sheet = document.createElement('div')
    sheet.setAttribute('role', 'dialog')
    document.body.appendChild(sheet)
    try {
      await user.keyboard('j')
      await user.keyboard('{Home}')
      // Still on Rule 3: nothing navigated underneath.
      expect(await ruleText()).toBeInTheDocument()
    } finally {
      sheet.remove()
    }
  })

  it('still moves between units with nothing open', async () => {
    // The negative side. Without it the guard above passes against a version
    // that broke j/k entirely — and it also proves the reader survives a
    // navigation at all, which the first version did not: an unguarded
    // `scrollIntoView` in the unit-change effect threw and took the route down.
    const user = userEvent.setup()
    at('/study/read/ccs-conduct/ccs-conduct-3')
    await ruleText()

    await user.keyboard('j')
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).not.toHaveTextContent('General'))

    // A second press, because the defect this file records was in the second
    // one — from Rule 3, `k` went to Rule 1. But be clear about what this
    // assertion is and is not: it PASSES against the broken version. React
    // flushes passive effects between two `userEvent` interactions under
    // jsdom, so the stale-ref window this test would need simply does not open
    // here. It was confirmed against the committed code and went green.
    //
    // `tests/e2e/library.spec.ts` is what covers it, in a real browser. This
    // stays because the SEQUENCE is worth asserting — `j` then `k` returns to
    // where it started — and because a reader of this file should be told
    // which layer actually holds that guarantee rather than assuming it is
    // this one.
    await user.keyboard('k')
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('General'))
  })
})

describe('the 30-second dwell timer', () => {
  /**
   * `secondsRead` is a field Session 27 will surface. A unit left open in a
   * background tab overnight recorded eight hours of "reading" into it.
   */
  it('does not accumulate while the tab is in the background', async () => {
    // ONLY the interval is faked. `fake-indexeddb` schedules its own event loop
    // on `setTimeout`, so a blanket `vi.useFakeTimers()` stops Dexie answering
    // at all and the test fails on the arrival write rather than on the thing
    // it is about — which is how a test comes to fail with a message that
    // describes something other than what went wrong.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    try {
      at('/study/read/ccs-conduct/ccs-conduct-3')
      await vi.waitFor(async () => expect(await ruleText()).toBeInTheDocument())

      // Arrival is still recorded — that is what "continue reading" reads back.
      await vi.waitFor(async () =>
        expect(await db.libraryProgress.get('ccs-conduct:ccs-conduct-3')).toBeDefined(),
      )

      await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
      expect((await db.libraryProgress.get('ccs-conduct:ccs-conduct-3'))?.secondsRead).toBe(0)
    } finally {
      visibility.mockRestore()
      vi.useRealTimers()
    }
  })
})

describe('the table of contents on a work already being read', () => {
  /**
   * A reader who stopped at BNSS section 300 and comes back is shown chapter I,
   * because `defaultOpen` only ever consulted `currentUnitId` — which the work
   * page never passed. The prop existed; nothing used it.
   */
  it('opens the branch the reader was last in', async () => {
    await read('bns', '103', '2026-09-01T10:00:00.000Z')

    at('/study/read/bns')
    await screen.findByRole('heading', { name: 'Contents' })

    // BNS 103 is in "Of offences affecting the human body", not chapter I —
    // so its row is only in the DOM at all if the right branch opened. It is
    // also marked as the reader's place, which is the stronger claim: asserting
    // merely that a link named "Punishment for murder" exists would pass on
    // BNS 103A, a different offence in the same chapter.
    const here = await screen.findByRole('link', { current: 'page' })
    expect(here).toHaveAttribute('href', '/study/read/bns/103')
  })

  it('opens the first branch on a work with no progress, rather than none', async () => {
    at('/study/read/bns')
    await screen.findByRole('heading', { name: 'Contents' })

    expect(screen.queryByRole('link', { current: 'page' })).not.toBeInTheDocument()
    // Chapter I's first section, so the list is not fifteen closed rows.
    expect(await screen.findByRole('link', { name: /Short title, commencement/ })).toBeInTheDocument()
  })
})
