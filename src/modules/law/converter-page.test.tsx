import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import ConverterPage from './ConverterPage'
import SavedPage from './SavedPage'
import { recordLookup, toggleFavourite } from './saved'
import type { LawCorpus, LawDataset, LawIndex, LawSection } from './types'
import { resetEngineCache } from './useLawEngine'

import { readFromRoot } from '@/test/paths'

/**
 * The converter's state machine, driven end to end through a real router.
 *
 * The component tests next door cover the chrome in isolation. This file exists
 * because every defect a reader actually reported lived BETWEEN those pieces —
 * a chip that filtered nothing, a list that emptied when a row was clicked, a
 * direction toggle that did nothing while browsing, a card with no way to shut
 * it, characters lost through the router round-trip. None of them could be seen
 * from one component.
 *
 * The corpus is the COMMITTED data read off disk, for the reason
 * `tests/law-search.test.ts` gives: a fixture copy would let the two drift, and
 * the row counts asserted below are the real Acts.
 */

const load = <T,>(file: string): T => JSON.parse(readFromRoot('data/law', file)) as T

const realCorpus = (): LawCorpus => ({
  index: load<LawIndex>('index.json'),
  datasets: {
    bns: load<LawDataset>('bns.json'),
    bnss: load<LawDataset>('bnss.json'),
    bsa: load<LawDataset>('bsa.json'),
  },
})

/** Held in a spy so one test can make the download fail. */
const loadCorpus = vi.fn(() => Promise.resolve(realCorpus()))

vi.mock('./data', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./data')>()),
  loadCorpus: () => loadCorpus(),
}))

/** Section counts of the real Acts — the numbers a reader can count on screen. */
const BNS = 358
const TOTAL = 1059

function renderAt(path = '/law') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/law" element={<ConverterPage />} />
        <Route path="/law/saved" element={<SavedPage />} />
        <Route path="*" element={<p>elsewhere</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

afterEach(() => {
  resetEngineCache()
  loadCorpus.mockImplementation(() => Promise.resolve(realCorpus()))
})

/**
 * Rows of the RESULT list specifically. Scoped, because an opened section card
 * is itself full of list items — its mappings and related-section chips — and
 * a bare `getAllByRole('listitem')` counts those too.
 */
const resultsList = () => screen.queryByRole('list', { name: 'Search results' })
const rows = () => {
  const ul = resultsList()
  return ul ? within(ul).queryAllByRole('listitem') : []
}
const list = () => screen.findByRole('list', { name: 'Search results' })
const searchBox = () => screen.getByLabelText('Search a section, an offence or a phrase')
const dateBox = () => document.getElementById('law-offence-date')

/**
 * Building the Fuse index over 1,059 records, and rendering a list that long,
 * costs more than the default budget when the whole suite runs in parallel.
 * Given per test rather than through `vi.setConfig`, which does not reach tests
 * that were already collected.
 */
const SLOW = 30_000

describe('browsing an Act', () => {
  it('shows the start state with nothing typed, and downloads nothing', () => {
    renderAt()
    expect(screen.getByText('Type a section number or a word')).toBeInTheDocument()
    expect(rows()).toHaveLength(0)
  })

  it('a code chip with an empty box reads that Act end to end', async () => {
    const user = userEvent.setup()
    renderAt()
    await user.click(screen.getByRole('radio', { name: 'BNS · IPC' }))

    await list()
    await waitFor(() => expect(rows()).toHaveLength(BNS), { timeout: SLOW })
    expect(screen.getByText(/Browsing the .*— 358 sections/)).toBeInTheDocument()
  }, SLOW)

  it('renders every row, not a window of them', async () => {
    const user = userEvent.setup()
    renderAt()
    await user.click(screen.getByRole('button', { name: 'Browse all sections' }))

    await list()
    await waitFor(() => expect(rows()).toHaveLength(TOTAL), { timeout: SLOW })
    // The regression that produced three separate bug reports: a list capped
    // at 20, then 30, then blank. The last row of the last Act must be there.
    expect(screen.getByText('BSA 170')).toBeInTheDocument()
  }, SLOW)

  it('the All chip returns to all three codes from a single Act', async () => {
    const user = userEvent.setup()
    renderAt('/law?browse=1&code=bns')
    await waitFor(() => expect(rows()).toHaveLength(BNS), { timeout: SLOW })

    await user.click(screen.getByRole('radio', { name: 'All' }))
    await waitFor(() => expect(rows()).toHaveLength(TOTAL), { timeout: SLOW })
  }, SLOW)

  it('opening a row keeps the list on screen', async () => {
    const user = userEvent.setup()
    renderAt('/law?browse=1&code=bns')
    await waitFor(() => expect(rows()).toHaveLength(BNS), { timeout: SLOW })

    await user.click(screen.getByText('BNS 103'))

    // The "list goes empty when I click something" report.
    expect(rows()).toHaveLength(BNS)
    expect(await screen.findByRole('button', { name: 'Close this section' })).toBeInTheDocument()
  }, SLOW)

  it('opens nothing on its own while browsing', async () => {
    renderAt('/law?browse=1&code=bns')
    await waitFor(() => expect(rows()).toHaveLength(BNS), { timeout: SLOW })
    expect(screen.queryByRole('button', { name: 'Close this section' })).not.toBeInTheDocument()
  }, SLOW)

  it('says why the direction toggle is inert while browsing', async () => {
    renderAt('/law?browse=1&code=bns')
    await waitFor(() => expect(rows()).toHaveLength(BNS), { timeout: SLOW })
    expect(screen.getByRole('radio', { name: 'Old → New' })).toBeDisabled()
    expect(screen.getByText('Applies to a search. You are reading the Act in order.')).toBeInTheDocument()
  }, SLOW)
})

describe('searching', () => {
  it('opens the best hit and can be closed and reopened', async () => {
    const user = userEvent.setup()
    renderAt()
    await user.type(searchBox(), '302')

    const card = await screen.findByRole('button', { name: 'Close this section' })
    // 302 IPC is 103 BNS — the answer, opened without a second action.
    expect(screen.getAllByText(/BNS 103/).length).toBeGreaterThan(0)

    await user.click(card)
    expect(screen.queryByRole('button', { name: 'Close this section' })).not.toBeInTheDocument()
    // Closing must not take the results with it.
    expect(rows().length).toBeGreaterThan(0)

    // A NEW query answers again rather than staying shut.
    await user.type(searchBox(), '{Backspace}{Backspace}{Backspace}420')
    expect(await screen.findByRole('button', { name: 'Close this section' })).toBeInTheDocument()
  })

  it('keeps every character typed through the router round-trip', async () => {
    const user = userEvent.setup()
    renderAt()
    await user.type(searchBox(), '420')
    // The bug this replaces left "2" in the box.
    expect(searchBox()).toHaveValue('420')
  })

  it('re-enables the direction toggle once there is a query', async () => {
    const user = userEvent.setup()
    renderAt('/law?browse=1&code=bns')
    await waitFor(() => expect(rows()).toHaveLength(BNS), { timeout: SLOW })
    expect(screen.getByRole('radio', { name: 'New → Old' })).toBeDisabled()

    await user.type(searchBox(), '302')
    await waitFor(() => expect(screen.getByRole('radio', { name: 'New → Old' })).toBeEnabled())
  }, SLOW)

  it('says so when nothing matches', async () => {
    const user = userEvent.setup()
    renderAt()
    await user.type(searchBox(), 'zzzzqqq')
    expect(await screen.findByText('Nothing matched that')).toBeInTheDocument()
  })
})

describe('deep links', () => {
  it('restores a query from the URL', async () => {
    renderAt('/law?q=302')
    await waitFor(() => expect(searchBox()).toHaveValue('302'))
    expect(await screen.findByRole('button', { name: 'Close this section' })).toBeInTheDocument()
  })

  it('restores a browsing session from the URL', async () => {
    renderAt('/law?browse=1&code=bnss')
    await waitFor(() => expect(rows()).toHaveLength(531), { timeout: SLOW })
    expect(screen.getByRole('radio', { name: 'BNSS · CrPC' })).toBeChecked()
  }, SLOW)

  it('a query beside browse=1 is a search, not a browse', async () => {
    renderAt('/law?browse=1&q=302')
    await waitFor(() => expect(searchBox()).toHaveValue('302'))
    // 1,059 rows would mean the browse flag had won.
    await waitFor(() => expect(rows().length).toBeGreaterThan(0))
    expect(rows().length).toBeLessThan(TOTAL)
  })

  it('an unknown code falls back to all three rather than an empty list', async () => {
    renderAt('/law?browse=1&code=nonsense')
    await waitFor(() => expect(rows()).toHaveLength(TOTAL), { timeout: SLOW })
  }, SLOW)

  it('carries the offence date into the field', async () => {
    renderAt('/law?q=302&date=2024-06-30')
    await waitFor(() => expect(dateBox()).toHaveValue('2024-06-30'))
  })
})

describe('keyboard', () => {
  it('ArrowDown from the field moves into the list and Enter opens a row', async () => {
    const user = userEvent.setup()
    renderAt()
    await user.type(searchBox(), '302')
    await waitFor(() => expect(rows().length).toBeGreaterThan(0))

    await user.type(searchBox(), '{ArrowDown}')
    await waitFor(() => {
      const first = within(rows()[0]!).getByRole('button')
      expect(first).toHaveFocus()
    })
  })
})

describe('the offence date', () => {
  /**
   * `dateRule.test.ts` proves the 1 July 2024 boundary. This is the other half
   * of it: that the answer reaches the card, where a reader can act on it.
   */
  it('says the old codes apply the day before commencement', async () => {
    renderAt('/law?q=302&date=2024-06-30')
    await screen.findByRole('button', { name: 'Close this section' })
    expect(screen.getByText(/Old law applies/)).toBeInTheDocument()
    // BNSS s.531 is the saving provision that makes that true, and the banner
    // cites it rather than asserting the rule on its own authority.
    expect(document.body.textContent).toContain('531')
  })

  it('says the Sanhitas apply on the day itself', async () => {
    renderAt('/law?q=302&date=2024-07-01')
    await screen.findByRole('button', { name: 'Close this section' })
    expect(screen.getByText(/New law applies/)).toBeInTheDocument()
  })

  it('declines to guess when no date is given', async () => {
    renderAt('/law?q=302')
    await screen.findByRole('button', { name: 'Close this section' })
    expect(screen.getByText(/No offence date given/)).toBeInTheDocument()
  })
})

describe('when the section tables cannot be loaded', () => {
  it('offers a retry that recovers', async () => {
    const user = userEvent.setup()
    loadCorpus.mockImplementationOnce(() => Promise.reject(new Error('interrupted')))
    renderAt('/law?q=302')

    await screen.findByText('The section tables could not be loaded')
    await user.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByRole('button', { name: 'Close this section' })).toBeInTheDocument()
  })
})

describe('queries that are not questions', () => {
  /**
   * A query arrives from the URL, so it is whatever somebody put there. None of
   * these should throw, and none should reach the DOM as markup.
   */
  const odd: readonly (readonly [string, string])[] = [
    ['<script>alert(1)</script>', 'markup'],
    ['302'.repeat(200), 'a 600-character query'],
    ['%%%', 'punctuation alone'],
    ['-1', 'a negative number'],
    ['999999', 'a section that does not exist'],
  ]

  it.each(odd)(
    'survives %s (%s)',
    async (query) => {
      renderAt(`/law?q=${encodeURIComponent(query)}`)
      await waitFor(
        () => {
          expect(screen.queryByText('Loading the section tables...')).not.toBeInTheDocument()
        },
        { timeout: SLOW },
      )
      expect(document.querySelector('script')).toBeNull()
    },
    SLOW,
  )

  it('treats a query of only spaces as no query at all', () => {
    renderAt('/law?q=%20%20%20')
    expect(screen.getByText('Type a section number or a word')).toBeInTheDocument()
    expect(rows()).toHaveLength(0)
  })
})

describe('the saved list', () => {
  const stub = (n: number): LawSection => ({
    section: String(n),
    act: 'BNS',
    heading: { en: `Heading ${n}`, hi: `शीर्षक ${n}` },
    status: 'changed',
    chapter: { number: 'I', title: { en: '', hi: '' } },
    mappings: [],
    repeals: [],
    text: { en: '', hi: '' },
    classification: [],
    punishment: { en: '', hi: '' },
    keywords: { en: [], hi: [], roman: [] },
    notes: [],
    sources: ['s'],
    verify: false,
  })

  it('says both lists are empty on a new device', async () => {
    renderAt('/law/saved')
    expect(await screen.findByText('Nothing saved yet')).toBeInTheDocument()
    expect(screen.getByText(/Sections you open appear here/)).toBeInTheDocument()
  })

  it('shows favourites, and the newest twenty lookups', async () => {
    for (let n = 1; n <= 25; n += 1) await recordLookup('bns', stub(n), String(n))
    await toggleFavourite('bns', stub(1))

    renderAt('/law/saved')
    await screen.findByText('Heading 25')

    // Newest first, capped at 20: 25 down to 6, with 1-5 dropped. The rows are
    // trimmed by timestamp, and an earlier version broke the tie on the string
    // key — which deleted 10 and 11 while keeping 4.
    expect(screen.getByText('Heading 6')).toBeInTheDocument()
    expect(screen.queryByText('Heading 5')).not.toBeInTheDocument()
    // Section 1 is gone from recents but kept as a favourite.
    expect(screen.getByText('Heading 1')).toBeInTheDocument()
  })
})
