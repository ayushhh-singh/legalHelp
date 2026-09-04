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
      wrap(<AnnotatedBody {...base} highlights={[{ id: 'h1', start: at, end: at + 18, colour: 'tulsi' }]} />),
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
      wrap(<AnnotatedBody {...base} highlights={[{ id: 'h1', start: at, end: at + 8, colour: 'coral' }]} />),
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
    render(wrap(<NoteEditor workId="rti" unitId="rti-8" note={null} stored={undefined} onClose={() => {}} />))
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
    // `/study/practise/review-queue`, which is the one path a card enters by.
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

// ------------------------------------------------------------ edge cases

/**
 * DEFECT 1 — auto-continue navigated to the next unit and fell silent.
 *
 * `useReadAloud` calls `controller.load()` whenever the unit's text changes,
 * and `load` stops whatever is speaking. That is right when the READER
 * navigates and was also what happened when read-aloud navigated on its own —
 * so the toggle moved the page and then went quiet, which is the one outcome it
 * exists to prevent.
 *
 * Rendered against a fake `speechSynthesis` because jsdom has none. This is the
 * test that fails against the committed code; the controller-level one in
 * `src/lib/library/edge.test.ts` cannot, and says so.
 */
describe('useReadAloud auto-continue', () => {
  interface Spoken {
    text: string
    onend: (() => void) | null
    onerror: (() => void) | null
    rate: number
    lang: string
    voice: unknown
  }

  const install = () => {
    const spoken: Spoken[] = []
    const synth = {
      speak: (utterance: Spoken) => spoken.push(utterance),
      cancel: () => spoken.at(-1)?.onend?.(),
      pause: () => {},
      resume: () => {},
      getVoices: () => [],
      addEventListener: () => {},
      removeEventListener: () => {},
    }
    class Utterance {
      text: string
      rate = 1
      lang = 'en'
      voice: unknown = null
      onend: (() => void) | null = null
      onerror: (() => void) | null = null
      constructor(text: string) {
        this.text = text
      }
    }
    Object.assign(globalThis, { speechSynthesis: synth, SpeechSynthesisUtterance: Utterance })
    return spoken
  }

  const drain = (spoken: Spoken[]) => {
    for (let guard = 0; guard < 50; guard += 1) {
      const before = spoken.length
      spoken.at(-1)?.onend?.()
      if (spoken.length === before) return
    }
  }

  it('speaks the next unit rather than falling silent', async () => {
    const { renderHook, act } = await import('@testing-library/react')
    const { useReadAloud } = await import('./useReadAloud')
    const spoken = install()
    const onFinished = vi.fn()

    const { result, rerender } = renderHook(
      ({ text }: { text: string }) =>
        useReadAloud(text, 'en', { ...DEFAULT_READER_PREFS, autoContinue: true }, onFinished),
      { initialProps: { text: 'One. Two.' } },
    )

    act(() => result.current.play())
    expect(spoken.at(-1)?.text).toBe('One.')

    // Finish the unit: `onFinished` fires and the caller navigates, which here
    // is the text changing under the hook.
    act(() => drain(spoken))
    expect(onFinished).toHaveBeenCalledTimes(1)

    const before = spoken.length
    rerender({ text: 'Three. Four.' })
    expect(spoken.length, 'the next unit was never spoken').toBeGreaterThan(before)
    expect(spoken.at(-1)?.text).toBe('Three.')
  })

  it('does not start the next unit when auto-continue is off', async () => {
    const { renderHook, act } = await import('@testing-library/react')
    const { useReadAloud } = await import('./useReadAloud')
    const spoken = install()

    const { result, rerender } = renderHook(
      ({ text }: { text: string }) =>
        useReadAloud(text, 'en', { ...DEFAULT_READER_PREFS, autoContinue: false }, () => {}),
      { initialProps: { text: 'One.' } },
    )

    act(() => result.current.play())
    act(() => drain(spoken))
    const before = spoken.length

    rerender({ text: 'Two.' })
    expect(spoken.length).toBe(before)
    expect(result.current.snapshot.state).toBe('idle')
  })

  it('does not start reading a unit the reader merely navigated to', async () => {
    const { renderHook } = await import('@testing-library/react')
    const { useReadAloud } = await import('./useReadAloud')
    const spoken = install()

    // Never played at all: arriving at a unit must be silent, whatever the
    // auto-continue setting says. This is the other half of the fix — a flag
    // set unconditionally would read the whole book aloud to somebody who
    // pressed nothing.
    const { rerender } = renderHook(
      ({ text }: { text: string }) =>
        useReadAloud(text, 'en', { ...DEFAULT_READER_PREFS, autoContinue: true }, () => {}),
      { initialProps: { text: 'One.' } },
    )
    rerender({ text: 'Two.' })
    expect(spoken).toHaveLength(0)
  })
})

/**
 * DEFECT 3 — "needs attention" could never fire.
 *
 * The session brief is explicit: a highlight that can be found by neither its
 * offsets nor its quote is listed under "needs attention" in My Study and never
 * dropped. My Study deliberately loads no corpus, so the first version could
 * only guess from the row itself — it flagged an empty quote and nothing else,
 * which is a state no highlight this app writes can be in (`createHighlight`
 * refuses an empty span). The promise was unreachable.
 *
 * `useHighlightHealth` loads the corpora of the works the reader has ACTUALLY
 * annotated — usually one or two, and every one of them precached — and
 * resolves each highlight against the text as it is now.
 */
describe('useStudyContext', () => {
  it('finds the highlight whose text is no longer in the unit, and only that one', async () => {
    const { renderHook, waitFor: waitForHook } = await import('@testing-library/react')
    const { useStudyContext } = await import('./useAnnotations')

    const highlights = [
      {
        id: 'still-there',
        workId: 'ccs-conduct',
        unitId: 'ccs-conduct-3',
        lang: 'en' as const,
        start: 0,
        end: 5,
        // A phrase that really is in CCS (Conduct) Rule 3.
        quote: 'absolute integrity',
        colour: 'marigold',
        createdAt: '2026-09-01T00:00:00.000Z',
      },
      {
        id: 'gone',
        workId: 'ccs-conduct',
        unitId: 'ccs-conduct-3',
        lang: 'en' as const,
        start: 0,
        end: 5,
        quote: 'a clause this rule has never contained',
        colour: 'coral',
        createdAt: '2026-09-01T00:00:00.000Z',
      },
    ]

    const { result } = renderHook(() => useStudyContext({ highlights, notes: [], bookmarks: [] }, 'en'))
    await waitForHook(() => expect(result.current.checked).toBe(true))

    expect([...result.current.lost]).toEqual(['gone'])
  })

  /**
   * The other half of the same pass, and the reason it is one pass: an export
   * that leaves this app has to carry a citation, and "ccs-conduct-3" is an
   * internal id. The corpus is already open; asking it for the citation costs
   * nothing more.
   */
  it('reads each annotated unit’s real citation, in the reader’s language', async () => {
    const { renderHook, waitFor: waitForHook } = await import('@testing-library/react')
    const { useStudyContext } = await import('./useAnnotations')

    const { result } = renderHook(() =>
      useStudyContext(
        {
          highlights: [],
          notes: [],
          bookmarks: [
            {
              id: 'ccs-conduct:ccs-conduct-3',
              workId: 'ccs-conduct',
              unitId: 'ccs-conduct-3',
              createdAt: '2026-09-01T00:00:00.000Z',
            },
          ],
        },
        'en',
      ),
    )
    await waitForHook(() => expect(result.current.checked).toBe(true))

    const unit = result.current.units.get('ccs-conduct:ccs-conduct-3')
    expect(unit?.number).toBe('3')
    expect(unit?.citation).toMatch(/^Rule 3, /)
  })

  it('is empty, and settled, when there is nothing to check', async () => {
    const { renderHook, waitFor: waitForHook } = await import('@testing-library/react')
    const { useStudyContext } = await import('./useAnnotations')
    const { result } = renderHook(() => useStudyContext({ highlights: [], notes: [], bookmarks: [] }, 'en'))
    await waitForHook(() => expect(result.current.checked).toBe(true))
    expect(result.current.lost.size).toBe(0)
    expect(result.current.units.size).toBe(0)
  })
})
