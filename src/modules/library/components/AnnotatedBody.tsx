import { useMemo } from 'react'

import type { ReaderPrefs } from '../useLibrary'

import type { Language } from '@/i18n'
import {
  buildTermMatcher,
  findReferences,
  findTermOccurrences,
  paragraphRanges,
  resolveReference,
  segmentParagraph,
  type AnchoredRange,
  type HighlightColour,
  type UnitReference,
} from '@/lib/library'
import { cn } from '@/lib/utils'
import type { DefinedTermRecord } from '@/schemas/library'

/**
 * One unit's text with three layers drawn over it: the reader's highlights, the
 * terms the document defines, and the citations it makes.
 *
 * The layers NEST rather than compete. A citation or a defined term is one
 * clickable thing, so it is the outer element and the highlight colours are
 * drawn as spans inside it — the reverse would cut a link in half at a
 * highlight boundary and hand a screen reader two links where the document has
 * one. Highlights, by contrast, genuinely may overlap each other, and
 * `segmentParagraph` is what splits a run that two of them cover.
 *
 * Every paragraph carries `data-para-start`, its offset into the unit's
 * normalised text. That is the whole contract with `../selection.ts`: nothing
 * inside a paragraph may render text the provision does not contain, or every
 * offset after it is wrong.
 */

const SIZE_CLASS: Readonly<Record<number, string>> = {
  1: 'text-sm',
  2: 'text-base',
  3: 'text-lg',
  4: 'text-xl',
}

const PROVISO = /^(Provided|PROVIDED|Explanation|Illustration|परन्तु|परंतु|स्पष्टीकरण|दृष्टांत)/

/**
 * A /15 tint with its PAIRED foreground, never the raw token as text colour.
 *
 * The design system's one rule about these four (`src/styles/tokens.css`), and
 * the reason a highlight can be read at all: `--marigold` as text on the card
 * is well under the contrast floor, while `--marigold-foreground` on a
 * `--marigold/15` tint is what `tokens.test.ts` actually asserts.
 */
const COLOUR_CLASS: Readonly<Record<HighlightColour, string>> = {
  marigold: 'bg-marigold/15 text-marigold-foreground',
  tulsi: 'bg-tulsi/15 text-tulsi-foreground',
  violet: 'bg-violet/15 text-violet-foreground',
  coral: 'bg-coral/15 text-coral-foreground',
}

interface Interactive {
  start: number
  end: number
  kind: 'term' | 'reference'
  term?: DefinedTermRecord
  reference?: UnitReference
  target?: { kind: 'unit'; workId: string; unitId: string } | { kind: 'law'; query: string }
}

export interface AnnotatedBodyProps {
  paragraphs: readonly string[]
  lang: Language
  prefs: ReaderPrefs
  /** Highlights already resolved against THIS rendering, in whole-unit offsets. */
  highlights: readonly (AnchoredRange & { colour: HighlightColour })[]
  terms: readonly DefinedTermRecord[]
  /** Which work we are in — a citation with no Act named means this one. */
  workId: string
  /** Does this work print a unit with this number? Decides whether a citation links. */
  resolveUnitId: (workId: string, number: string) => string | null
  onTerm: (term: DefinedTermRecord, at: { top: number; left: number }) => void
  onReference: (target: NonNullable<Interactive['target']>, reference: UnitReference) => void
  onHighlight: (id: string) => void
  /** Sentence being read aloud, in whole-unit offsets, or null. */
  speaking: { start: number; end: number } | null
  className?: string
}

export function AnnotatedBody({
  paragraphs,
  lang,
  prefs,
  highlights,
  terms,
  workId,
  resolveUnitId,
  onTerm,
  onReference,
  onHighlight,
  speaking,
  className,
}: AnnotatedBodyProps) {
  const ranges = useMemo(() => paragraphRanges(paragraphs), [paragraphs])

  const termIndex = useMemo(() => {
    if (!prefs.terms || terms.length === 0) return null
    return {
      matcher: buildTermMatcher(terms.map((term) => term.term)),
      byLowerCase: new Map(terms.map((term) => [term.term.toLowerCase(), term.term])),
      byTerm: new Map(terms.map((term) => [term.term, term])),
    }
  }, [prefs.terms, terms])

  const typography = cn(
    SIZE_CLASS[prefs.size] ?? SIZE_CLASS[2],
    prefs.family === 'serif' ? 'font-reading' : 'font-sans',
    prefs.lineHeight === 'relaxed' && 'leading-[1.9]',
  )

  if (paragraphs.length === 0) return null

  return (
    <div lang={lang} className={cn(typography, className)}>
      {ranges.map((paragraph) => {
        /**
         * References first, then terms, and an overlap goes to the reference:
         * "section 8" inside "the Central Public Information Officer under
         * section 8" is the more specific thing to offer, and two controls over
         * the same words is one too many.
         */
        const marks: Interactive[] = []
        for (const reference of findReferences(paragraph.text)) {
          const target = resolveReference(reference, workId, resolveUnitId)
          if (!target) continue
          marks.push({
            start: paragraph.start + reference.start,
            end: paragraph.start + reference.end,
            kind: 'reference',
            reference,
            target,
          })
        }
        if (termIndex?.matcher) {
          for (const found of findTermOccurrences(paragraph.text, termIndex.matcher, termIndex.byLowerCase)) {
            const start = paragraph.start + found.start
            const end = paragraph.start + found.end
            if (marks.some((mark) => start < mark.end && end > mark.start)) continue
            const term = termIndex.byTerm.get(found.term)
            if (term) marks.push({ start, end, kind: 'term', term })
          }
        }
        marks.sort((a, b) => a.start - b.start)

        // Cut the paragraph into alternating plain and interactive pieces.
        const pieces: { from: number; to: number; mark: Interactive | null }[] = []
        let cursor = paragraph.start
        for (const mark of marks) {
          if (mark.start > cursor) pieces.push({ from: cursor, to: mark.start, mark: null })
          pieces.push({ from: mark.start, to: mark.end, mark })
          cursor = mark.end
        }
        if (cursor < paragraph.end) pieces.push({ from: cursor, to: paragraph.end, mark: null })

        /**
         * `insideControl` is why a highlight is sometimes a button and
         * sometimes a `<mark>`.
         *
         * Clicking a highlight to change its colour or attach a note is the
         * gesture readers expect, and it needs a real control — but a piece
         * that is already a citation or a defined term IS a control, and a
         * button inside a button is invalid markup that hands a screen reader
         * two nested controls over the same words. So a highlight under a
         * citation is drawn and not clickable, and the annotations panel below
         * the text lists every highlight as a button regardless. Nothing is
         * unreachable; one gesture is unavailable in the rarer place.
         */
        const spansFor = (from: number, to: number, insideControl: boolean) =>
          segmentParagraph(paragraph.text.slice(from - paragraph.start, to - paragraph.start), from, [
            ...highlights,
            ...(speaking ? [{ id: '__speaking', start: speaking.start, end: speaking.end }] : []),
          ]).map((segment, index) => {
            const ids = segment.ids.filter((id) => id !== '__speaking')
            const reading = segment.ids.includes('__speaking')
            const colour = highlights.find((entry) => entry.id === ids[0])?.colour
            if (ids.length === 0 && !reading) return segment.text

            // Position within one immutable string; two identical runs in one
            // paragraph are a real thing.
            const key = `${from}-${index}`
            const paint = cn(
              'rounded-[3px] bg-transparent px-px text-inherit',
              colour && COLOUR_CLASS[colour],
              ids.length > 1 && 'underline decoration-dotted underline-offset-4',
              // The sentence being read aloud. Not a colour alone: it also gets
              // a rule, because a reader who cannot distinguish the tint still
              // needs to see where the voice is.
              reading && 'bg-action/15 ring-1 ring-action/40',
            )

            const id = ids[0]
            if (!id || insideControl) {
              return (
                <mark key={key} className={paint}>
                  {segment.text}
                </mark>
              )
            }

            return (
              <button
                key={key}
                type="button"
                data-highlight={id}
                onClick={() => onHighlight(id)}
                className={cn(
                  paint,
                  'font-inherit cursor-pointer p-0 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                )}
              >
                {segment.text}
              </button>
            )
          })

        return (
          <p
            key={paragraph.index}
            data-para-start={paragraph.start}
            className={cn(
              'mb-4 last:mb-0',
              PROVISO.test(paragraph.text) && 'ml-4 border-l-2 border-border pl-4',
            )}
          >
            {pieces.map((piece) => {
              const content = spansFor(piece.from, piece.to, piece.mark !== null)
              if (!piece.mark) return content
              const key = `${piece.from}-${piece.mark.kind}`

              if (piece.mark.kind === 'term' && piece.mark.term) {
                const term = piece.mark.term
                return (
                  <button
                    key={key}
                    type="button"
                    // Both the definition and the fact that it IS a definition
                    // live on the label; putting either in the text flow would
                    // break every offset after it (see ../selection.ts).
                    aria-label={`${term.term}: ${term.definition.slice(0, 160)}`}
                    onClick={(event) => {
                      const rect = event.currentTarget.getBoundingClientRect()
                      onTerm(term, { top: rect.bottom, left: rect.left })
                    }}
                    className="font-inherit cursor-help border-b border-dotted border-input bg-transparent p-0 text-left text-inherit underline-offset-4 hover:border-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    {content}
                  </button>
                )
              }

              const target = piece.mark.target
              const reference = piece.mark.reference
              if (!target || !reference) return content
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => onReference(target, reference)}
                  className="font-inherit cursor-pointer bg-transparent p-0 text-left text-primary underline decoration-dotted underline-offset-4 hover:decoration-solid focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  {content}
                </button>
              )
            })}
          </p>
        )
      })}
    </div>
  )
}
