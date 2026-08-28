import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { OffenceDateField } from './components/OffenceDateField'
import { ResultList } from './components/ResultList'
import { SearchBar } from './components/SearchBar'
import type { LawHit } from './search'
import type { LawCorpus, LawDataset, LawSection } from './types'

/**
 * The interaction edges of the converter's chrome, in jsdom.
 *
 * Everything here is a defect that was found by probing rather than a
 * restatement of what the components obviously do: the windowed list that only
 * rendered its first page, the `/` shortcut that would have fired while
 * somebody was typing, and the date field's third state.
 */

/* ---------------------------------------------------------------- *
 * Fixtures
 * ---------------------------------------------------------------- */

function section(n: number): LawSection {
  return {
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
  }
}

const dataset = {
  newAct: { id: 'BNS', year: 2023, name: { en: 'Bharatiya Nyaya Sanhita, 2023', hi: 'भा.न्या.सं.' } },
} as unknown as LawDataset

const corpus = { datasets: { bns: dataset } } as unknown as LawCorpus

function hits(count: number): LawHit[] {
  return Array.from({ length: count }, (_, i) => {
    const record = section(i + 1)
    return {
      doc: {
        id: `bns:${record.section}`,
        code: 'bns',
        section: record.section,
        sortKey: i,
        oldRefs: [],
        headingEn: record.heading.en,
        headingHi: record.heading.hi,
        keywords: [],
        roman: [],
        headingKeys: [],
        headingWords: [],
        oldHeadingKeys: [],
        oldHeadingWords: [],
        headingSize: 2,
        excerpt: '',
        ref: { code: 'bns' as const, act: 'BNS' as const, section: record.section, record },
      },
      reason: 'text' as const,
      score: 0.1,
    }
  })
}

function renderList(count: number, overrides: Partial<React.ComponentProps<typeof ResultList>> = {}) {
  const props = {
    id: 'law-results',
    hits: hits(count),
    corpus,
    selectedId: null,
    onSelect: vi.fn(),
    activeIndex: -1,
    onActiveIndexChange: vi.fn(),
    onLeaveTop: vi.fn(),
    ...overrides,
  }
  const utils = render(<ResultList {...props} />)
  return { ...utils, props }
}

/* ---------------------------------------------------------------- *
 * ResultList
 * ---------------------------------------------------------------- */

describe('ResultList', () => {
  it('renders every row while the list is short', () => {
    renderList(10)
    expect(screen.getAllByRole('button')).toHaveLength(10)
  })

  it('renders every row, however long the list', () => {
    // Virtualisation is gone (ADR-016): it produced three user-visible defects
    // and the corpus it guards against is 1,059 rows of six DOM nodes each.
    renderList(400)
    expect(screen.getAllByRole('button')).toHaveLength(400)
  })

  it('has every row present at every scroll position, because nothing is windowed', () => {
    // The class of bug this replaces: a window computed from a stale scroll
    // offset rendered rows the reader was not looking at, and the list appeared
    // to be empty or to stop after a screenful.
    renderList(400)
    expect(screen.queryByText('Heading 1')).toBeInTheDocument()
    expect(screen.queryByText('Heading 200')).toBeInTheDocument()
    expect(screen.queryByText('Heading 400')).toBeInTheDocument()
  })

  it('stays reachable by Tab when the page hands over a stale active row', () => {
    // The page owns `activeIndex`, and a new query can return fewer rows than
    // the old one. When it pointed past the end, NO row had `tabIndex={0}` and
    // the whole list dropped out of the tab order.
    for (const [count, active] of [
      [10, 50],
      [10, 200],
      [400, 500],
    ] as const) {
      const { unmount } = renderList(count, { activeIndex: active })
      const tabbable = screen.getAllByRole('button').filter((button) => button.tabIndex === 0)
      expect(tabbable, `count=${count} active=${active}`).toHaveLength(1)
      unmount()
    }
  })

  it('puts only the active row in the tab order', () => {
    renderList(10, { activeIndex: 3 })
    const tabbable = screen.getAllByRole('button').filter((button) => button.tabIndex === 0)
    expect(tabbable).toHaveLength(1)
    expect(tabbable[0]).toHaveAttribute('data-index', '3')
  })

  it('moves the active row with the arrow keys and stops at each end', async () => {
    const user = userEvent.setup()
    const onActiveIndexChange = vi.fn()
    const onLeaveTop = vi.fn()
    renderList(5, { activeIndex: 0, onActiveIndexChange, onLeaveTop })

    const first = screen.getAllByRole('button')[0]
    expect(first).toBeDefined()
    first?.focus()

    await user.keyboard('{ArrowDown}')
    expect(onActiveIndexChange).toHaveBeenLastCalledWith(1)

    // ArrowUp from the top leaves the list rather than wrapping to the bottom.
    await user.keyboard('{ArrowUp}')
    expect(onLeaveTop).toHaveBeenCalled()

    await user.keyboard('{End}')
    expect(onActiveIndexChange).toHaveBeenLastCalledWith(4)
  })

  it('marks the open section for assistive technology, not only with a colour', () => {
    renderList(3, { selectedId: 'bns:2' })
    const rows = screen.getAllByRole('button')
    expect(rows[1]).toHaveAttribute('aria-current', 'true')
    expect(rows[0]).not.toHaveAttribute('aria-current')
  })
})

/* ---------------------------------------------------------------- *
 * SearchBar
 * ---------------------------------------------------------------- */

describe('SearchBar', () => {
  const renderBar = (overrides: Partial<React.ComponentProps<typeof SearchBar>> = {}) => {
    const props = {
      value: '',
      onChange: vi.fn(),
      onArrowDown: vi.fn(),
      onSubmit: vi.fn(),
      resultsId: undefined,
      resultCount: 0,
      busy: false,
      ...overrides,
    }
    render(<SearchBar {...props} />)
    return props
  }

  it('takes focus on "/" from anywhere on the page', async () => {
    const user = userEvent.setup()
    renderBar()
    document.body.focus()

    await user.keyboard('/')
    expect(screen.getByLabelText(/Search a section/)).toHaveFocus()
  })

  it('does not steal a "/" the reader is typing into a field', async () => {
    const user = userEvent.setup()
    renderBar()
    const other = document.createElement('input')
    document.body.appendChild(other)
    other.focus()

    await user.keyboard('/')
    expect(other).toHaveFocus()
    other.remove()
  })

  it('ignores "/" with a modifier held, which is a browser shortcut', async () => {
    const user = userEvent.setup()
    renderBar()
    document.body.focus()

    await user.keyboard('{Control>}/{/Control}')
    expect(screen.getByLabelText(/Search a section/)).not.toHaveFocus()
  })

  it('reports ArrowDown and Enter to the page rather than handling them itself', async () => {
    const user = userEvent.setup()
    const props = renderBar({ value: '302' })

    await user.click(screen.getByLabelText(/Search a section/))
    await user.keyboard('{ArrowDown}')
    expect(props.onArrowDown).toHaveBeenCalled()

    await user.keyboard('{Enter}')
    expect(props.onSubmit).toHaveBeenCalled()
  })

  it('points aria-controls at nothing when there is no list', () => {
    renderBar()
    expect(screen.getByLabelText(/Search a section/)).not.toHaveAttribute('aria-controls')
  })

  it('announces the result count rather than only drawing it', () => {
    renderBar({ value: '302', resultCount: 3, resultsId: 'law-results' })
    expect(screen.getByRole('status')).toHaveTextContent('3 results')
  })
})

/* ---------------------------------------------------------------- *
 * OffenceDateField
 * ---------------------------------------------------------------- */

describe('OffenceDateField', () => {
  beforeEach(() => {
    document.documentElement.lang = 'en'
  })

  it('says it does not know when no date has been given', () => {
    render(<OffenceDateField value={null} onChange={vi.fn()} />)
    expect(screen.getByRole('status')).toHaveTextContent(/does not say which code applies/)
  })

  it('applies the repealed Acts on the day before commencement', () => {
    render(<OffenceDateField value="2024-06-30" onChange={vi.fn()} />)
    expect(screen.getByRole('status')).toHaveTextContent(/Old law applies/)
    expect(screen.getByRole('status')).toHaveTextContent(/531/)
  })

  it('applies the Sanhitas on the day of commencement', () => {
    render(<OffenceDateField value="2024-07-01" onChange={vi.fn()} />)
    expect(screen.getByRole('status')).toHaveTextContent(/New law applies/)
  })

  it('refuses a date it cannot read instead of picking an era', () => {
    // Only a hand-edited deep link can produce this; showing "Old law applies"
    // from an unreadable date would be worse than showing nothing.
    render(<OffenceDateField value="2024-02-31" onChange={vi.fn()} />)
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent(/not a date this app can read/)
    expect(status).not.toHaveTextContent(/law applies/)
    expect(screen.getByLabelText('Date of offence')).toHaveAttribute('aria-invalid', 'true')
  })

  it('clears the date back to "not given"', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<OffenceDateField value="2024-06-30" onChange={onChange} />)

    await user.click(screen.getByRole('button', { name: 'Clear the date' }))
    expect(onChange).toHaveBeenCalledWith(null)
  })
})

/* ---------------------------------------------------------------- *
 * useLawEngine
 * ---------------------------------------------------------------- */

describe('useLawEngine', () => {
  it('does not load the section tables until they are asked for', async () => {
    const { useLawEngine, resetEngineCache } = await import('./useLawEngine')
    const { resetCorpusCache } = await import('./data')
    resetEngineCache()
    resetCorpusCache()

    function Probe({ enabled }: { enabled: boolean }) {
      const state = useLawEngine(enabled)
      return <span data-testid="status">{state.status}</span>
    }

    const { rerender } = render(<Probe enabled={false} />)
    expect(screen.getByTestId('status')).toHaveTextContent('idle')

    // Enabling it starts the load; the state machine must not stall on the
    // enable → disable → enable path, which is what clearing a query and typing
    // again does. (It did: the second run saw a populated cache and returned
    // early without ever reporting "ready".)
    rerender(<Probe enabled />)
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'), {
      timeout: 20_000,
    })

    rerender(<Probe enabled={false} />)
    rerender(<Probe enabled />)
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'))
  }, 30_000)
})
