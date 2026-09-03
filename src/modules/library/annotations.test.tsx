import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AddToTrainerDialog } from './components/AddToTrainerDialog'
import { AnnotatedBody } from './components/AnnotatedBody'
import { NoteEditor } from './components/NoteEditor'
import { selectionOffsets } from './selection'
import { DEFAULT_READER_PREFS } from './useLibrary'

import { clearAllData, db } from '@/db'
import { anchorParagraphs, anchorText, normaliseText, type LibraryUnit } from '@/lib/library'

/**
 * The annotation layer in jsdom.
 *
 * WHAT THIS CAN AND CANNOT PROVE is worth stating, because the split is the
 * same one ADR-038 and the peer session's edge pass both ran into. jsdom has a
 * real `Selection` and a real `Range`, so mapping a selection back to two
 * offsets IS testable here — and it is the single most breakable thing in this
 * session's work. What is not testable here is anything about layout: whether
 * the floating toolbar lands on screen, whether a highlight under a citation
 * renders as one control or two. `tests/e2e/library-annotations.spec.ts` holds
 * those.
 */

const TEXT = normaliseText(
  'Every Government servant shall at all times maintain absolute integrity. ' +
    'The competent authority may relax rule 12 in a proper case.',
)
const PARAGRAPHS = anchorParagraphs([TEXT])

const unit: LibraryUnit = {
  id: 'ccs-conduct-3',
  number: '3',
  heading: { en: 'General', hi: 'सामान्य' },
  excerpt: null,
  body: { en: [TEXT], hi: [] },
  parts: [],
  chapter: null,
  citation: { en: 'Rule 3, CCS (Conduct) Rules, 1964', hi: 'नियम 3, सीसीएस (आचरण) नियम, 1964' },
  repealedRefs: [],
}

const wrap = (node: React.ReactElement) => <MemoryRouter>{node}</MemoryRouter>

beforeEach(async () => {
  await clearAllData()
})

describe('selectionOffsets', () => {
  /**
   * The contract with `AnnotatedBody`: paragraphs carry `data-para-start`, and
   * a selection inside one resolves to offsets into the whole unit's
   * normalised text. Everything a highlight stores rests on this.
   */
  const renderParagraph = () => {
    const { container } = render(
      <div>
        <p data-para-start="0">{TEXT}</p>
      </div>,
    )
    return container.firstElementChild as HTMLElement
  }

  const select = (root: HTMLElement, from: number, to: number) => {
    const node = root.querySelector('p')!.firstChild!
    const range = document.createRange()
    range.setStart(node, from)
    range.setEnd(node, to)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
  }

  it('reports the offsets of what was selected', () => {
    const root = renderParagraph()
    const at = TEXT.indexOf('absolute integrity')
    select(root, at, at + 18)

    const offsets = selectionOffsets(root)
    expect(offsets).toEqual({ start: at, end: at + 18, text: 'absolute integrity' })
    expect(TEXT.slice(offsets!.start, offsets!.end)).toBe('absolute integrity')
  })

  it('is null for a click rather than a drag', () => {
    const root = renderParagraph()
    select(root, 5, 5)
    expect(selectionOffsets(root)).toBeNull()
  })

  it('is null for a selection of nothing but whitespace', () => {
    const root = renderParagraph()
    const at = TEXT.indexOf(' shall')
    select(root, at, at + 1)
    expect(selectionOffsets(root)).toBeNull()
  })

  it('is null when the selection is outside this unit', () => {
    const root = renderParagraph()
    render(<p data-para-start="0">Somewhere else entirely.</p>)
    const other = screen.getByText('Somewhere else entirely.')
    const range = document.createRange()
    range.setStart(other.firstChild!, 0)
    range.setEnd(other.firstChild!, 9)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    expect(selectionOffsets(root)).toBeNull()
  })

  it('is null for no root at all', () => {
    expect(selectionOffsets(null)).toBeNull()
  })

  /**
   * The rule `../selection.ts` states and the one a future change is most
   * likely to break: nothing inside a paragraph may render text the provision
   * does not contain, because `Range.toString()` counts it.
   */
  it('counts only the provision’s own characters, across the spans a highlight adds', () => {
    const { container } = render(
      <div>
        <p data-para-start="0">
          <span>Every </span>
          <mark>Government</mark>
          <span> servant</span>
        </p>
      </div>,
    )
    const root = container.firstElementChild as HTMLElement
    const tail = root.querySelectorAll('span')[1]!.firstChild!
    const range = document.createRange()
    range.setStart(tail, 1)
    range.setEnd(tail, 8)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)

    // "Every " is 6 and "Government" is 10, so the mark's own text has to be
    // counted for the word after it to land at 17 — which is the whole reason
    // `Range.toString().length` does the counting rather than a text-node walk.
    expect(selectionOffsets(root)).toMatchObject({ start: 17, end: 24, text: 'servant' })
  })
})

describe('AnnotatedBody', () => {
  const base = {
    paragraphs: PARAGRAPHS,
    lang: 'en' as const,
    prefs: DEFAULT_READER_PREFS,
    terms: [],
    workId: 'ccs-conduct',
    resolveUnitId: () => null,
    onTerm: vi.fn(),
    onReference: vi.fn(),
    onHighlight: vi.fn(),
    speaking: null,
  }

  it('renders every paragraph with its offset, so a selection can be anchored', () => {
    const { container } = render(wrap(<AnnotatedBody {...base} highlights={[]} />))
    const paragraph = container.querySelector('[data-para-start]')
    expect(paragraph).not.toBeNull()
    expect(paragraph!.getAttribute('data-para-start')).toBe('0')
    expect(paragraph!.textContent).toBe(TEXT)
  })

  it('paints a highlight over exactly the words it covers', () => {
    const at = TEXT.indexOf('absolute integrity')
    const { container } = render(
      wrap(
        <AnnotatedBody
          {...base}
          highlights={[{ id: 'h1', start: at, end: at + 18, colour: 'tulsi' }]}
        />,
      ),
    )
    const mark = container.querySelector('[data-highlight="h1"]')
    expect(mark?.textContent).toBe('absolute integrity')
    expect(mark?.className).toContain('bg-tulsi/15')
    // The paired foreground, never the raw token — the design system's one
    // rule about these four colours.
    expect(mark?.className).toContain('text-tulsi-foreground')
  })

  it('keeps the paragraph readable when a highlight splits it', () => {
    const at = TEXT.indexOf('absolute')
    const { container } = render(
      wrap(
        <AnnotatedBody {...base} highlights={[{ id: 'h1', start: at, end: at + 8, colour: 'coral' }]} />,
      ),
    )
    expect(container.querySelector('[data-para-start]')!.textContent).toBe(TEXT)
  })

  it('opens a highlight when it is pressed', async () => {
    const onHighlight = vi.fn()
    const at = TEXT.indexOf('absolute')
    render(
      wrap(
        <AnnotatedBody
          {...base}
          onHighlight={onHighlight}
          highlights={[{ id: 'h1', start: at, end: at + 8, colour: 'marigold' }]}
        />,
      ),
    )
    await userEvent.click(screen.getByText('absolute'))
    expect(onHighlight).toHaveBeenCalledWith('h1')
  })

  it('links a citation this work can resolve, and leaves one it cannot as text', () => {
    const { container, rerender } = render(
      wrap(<AnnotatedBody {...base} highlights={[]} resolveUnitId={() => 'ccs-conduct-12'} />),
    )
    expect(container.textContent).toContain('rule 12')
    expect(screen.getByRole('button', { name: /rule 12/i })).toBeInTheDocument()

    rerender(wrap(<AnnotatedBody {...base} highlights={[]} resolveUnitId={() => null} />))
    expect(screen.queryByRole('button', { name: /rule 12/i })).not.toBeInTheDocument()
  })

  it('underlines a defined term and hands the whole record to the popover', async () => {
    const onTerm = vi.fn()
    render(
      wrap(
        <AnnotatedBody
          {...base}
          highlights={[]}
          onTerm={onTerm}
          terms={[
            {
              term: 'competent authority',
              definition: 'the President or an authority to whom the power is delegated',
              marker: '(v)',
              confidence: 'high',
              verify: false,
            },
          ]}
        />,
      ),
    )
    await userEvent.click(screen.getByText('competent authority'))
    expect(onTerm).toHaveBeenCalledWith(
      expect.objectContaining({ term: 'competent authority' }),
      expect.anything(),
    )
  })

  it('does not underline defined terms when the reader has turned them off', () => {
    render(
      wrap(
        <AnnotatedBody
          {...base}
          highlights={[]}
          prefs={{ ...DEFAULT_READER_PREFS, terms: false }}
          terms={[
            { term: 'competent authority', definition: 'x', marker: null, confidence: 'high', verify: false },
          ]}
        />,
      ),
    )
    expect(screen.queryByRole('button', { name: /competent authority/i })).not.toBeInTheDocument()
  })

  /**
   * A control inside a control is invalid markup and gives a screen reader two
   * nested controls over one phrase. Under a citation the highlight is painted
   * and not clickable; the annotations panel lists it as a button regardless.
   */
  it('does not nest a highlight button inside a citation link', () => {
    const at = TEXT.indexOf('rule 12')
    const { container } = render(
      wrap(
        <AnnotatedBody
          {...base}
          resolveUnitId={() => 'ccs-conduct-12'}
          highlights={[{ id: 'h1', start: at, end: at + 7, colour: 'violet' }]}
        />,
      ),
    )
    expect(container.querySelector('button button')).toBeNull()
    expect(container.querySelector('[data-highlight]')).toBeNull()
  })

  it('marks the sentence being read aloud with more than a colour', () => {
    const { container } = render(
      wrap(<AnnotatedBody {...base} highlights={[]} speaking={{ start: 0, end: 24 }} />),
    )
    const mark = container.querySelector('mark')
    expect(mark?.className).toContain('ring-1')
  })
})

describe('NoteEditor', () => {
  /**
   * REAL timers, deliberately.
   *
   * The obvious version of this test installs `vi.useFakeTimers()` and advances
   * past the debounce. It hung — and then hung every test that ran after it,
   * for thirty seconds each, because a test killed by its own timeout never
   * reaches the `finally` that would have restored the clock. One leaked fake
   * clock is indistinguishable from seven broken components. A 500 ms debounce
   * is cheap enough to simply wait out.
   */
  it('saves after the debounce, and only reports it once the write resolved', async () => {
    render(
      wrap(<NoteEditor workId="rti" unitId="rti-8" note={null} stored={undefined} onClose={() => {}} />),
    )
    await userEvent.type(screen.getByRole('textbox'), 'read with the DPDP amendment')

    await waitFor(async () => {
      expect(await db.libraryNotes.count()).toBe(1)
    })
    const [row] = await db.libraryNotes.toArray()
    expect(row?.body).toBe('read with the DPDP amendment')
    expect(screen.getByText('Saved')).toBeInTheDocument()
  })

  it('deletes rather than keeping a note the reader emptied', async () => {
    const existing = {
      id: 'note-1',
      workId: 'rti',
      unitId: 'rti-8',
      body: 'something',
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    }
    await db.libraryNotes.put(existing)
    render(
      wrap(<NoteEditor workId="rti" unitId="rti-8" note={existing} stored={existing} onClose={() => {}} />),
    )
    await userEvent.clear(screen.getByRole('textbox'))
    await waitFor(async () => {
      expect(await db.libraryNotes.count()).toBe(0)
    })
  })

  it('tells the reader when another tab wrote over what they are editing', () => {
    const mine = {
      id: 'note-1',
      workId: 'rti',
      unitId: 'rti-8',
      body: 'mine',
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    }
    render(
      wrap(
        <NoteEditor
          workId="rti"
          unitId="rti-8"
          note={mine}
          stored={{ ...mine, body: 'theirs', updatedAt: '2026-09-02T00:00:00.000Z' }}
          onClose={() => {}}
        />,
      ),
    )
    expect(screen.getByRole('alert')).toHaveTextContent(/another tab/i)
  })

  it('offers the stored version, and shows it when asked', async () => {
    const mine = {
      id: 'note-1',
      workId: 'rti',
      unitId: 'rti-8',
      body: 'mine',
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    }
    render(
      wrap(
        <NoteEditor
          workId="rti"
          unitId="rti-8"
          note={mine}
          stored={{ ...mine, body: 'theirs', updatedAt: '2026-09-02T00:00:00.000Z' }}
          onClose={() => {}}
        />,
      ),
    )
    await userEvent.click(screen.getByRole('button', { name: /stored version/i }))
    expect(screen.getByRole('textbox')).toHaveValue('theirs')
  })
})

describe('AddToTrainerDialog', () => {
  const source = { name: 'DoPT', url: 'https://dopt.gov.in/x' }

  it('writes a proposed card into the queue the Trainer already reviews', async () => {
    render(
      wrap(
        <AddToTrainerDialog
          open
          onOpenChange={() => {}}
          actId="ccs-conduct"
          unit={unit}
          quote="absolute integrity"
          source={source}
        />,
      ),
    )
    await userEvent.click(screen.getByRole('button', { name: /review queue/i }))

    await waitFor(async () => expect(await db.proposedCards.count()).toBe(1))
    const [row] = await db.proposedCards.toArray()
    const card = row!.card as { reviewState: string; act: string; ruleRef: { textId: string } }
    // Never approved, never scheduled: it waits for a human in
    // `/learn/review-queue`, which is the one path a card enters by.
    expect(card.reviewState).toBe('unreviewed')
    expect(card.act).toBe('ccs-conduct')
    expect(card.ruleRef.textId).toBe('ccs-conduct-3')
  })

  it('refuses, with a reason, for a work no card can cite', async () => {
    render(
      wrap(
        <AddToTrainerDialog
          open
          onOpenChange={() => {}}
          actId={null}
          unit={unit}
          quote="absolute integrity"
          source={source}
        />,
      ),
    )
    expect(screen.getByRole('note')).toHaveTextContent(/rule book this app ships/i)
    expect(await db.proposedCards.count()).toBe(0)
  })
})

describe('anchorText and what the reader renders', () => {
  /**
   * The invariant the whole anchoring scheme rests on, asserted where the two
   * halves meet: the paragraphs `AnnotatedBody` renders are slices of the same
   * string `createHighlight` stores offsets into.
   */
  it('renders exactly the string the offsets index into', () => {
    const { container } = render(
      wrap(
        <AnnotatedBody
          paragraphs={anchorParagraphs(['One paragraph here.', 'And a second one.'])}
          lang="en"
          prefs={DEFAULT_READER_PREFS}
          highlights={[]}
          terms={[]}
          workId="rti"
          resolveUnitId={() => null}
          onTerm={() => {}}
          onReference={() => {}}
          onHighlight={() => {}}
          speaking={null}
        />,
      ),
    )
    const whole = anchorText(['One paragraph here.', 'And a second one.'])
    for (const paragraph of container.querySelectorAll('[data-para-start]')) {
      const start = Number(paragraph.getAttribute('data-para-start'))
      expect(whole.slice(start, start + (paragraph.textContent?.length ?? 0))).toBe(paragraph.textContent)
    }
  })
})
