/**
 * Where a highlight lives in a unit, and how it survives the text moving.
 *
 * A highlight is stored as a pair of character offsets into ONE normalised
 * rendering of ONE unit in ONE language, plus the text it covered. Every part
 * of that sentence is load-bearing:
 *
 * - **Normalised.** The corpus is not a stable byte sequence: `data/law/*.json`
 *   is rewritten weekly by the NCRB ingest, and Devanagari arrives in whatever
 *   Unicode composition the source PDF happened to use. So offsets index into
 *   `normaliseText()` — NFC, whitespace collapsed, trimmed — and the reader
 *   renders that same normalised string. Two derivations of one number is how
 *   a highlight ends up two characters to the left of what it marked.
 *
 * - **One language.** The English and Hindi renderings of a unit are different
 *   strings of different lengths, so an offset means nothing without knowing
 *   which one it indexes into. `LibraryHighlightRow.lang` carries it, and a
 *   highlight made in English never renders on the Hindi pane.
 *
 * - **Plus the text it covered.** Offsets are the fast path and the quote is
 *   the recovery: a dataset refresh that inserts a word ahead of a highlight
 *   moves every offset after it, and `resolveAnchor` searches for the quote
 *   instead of silently marking the wrong words. A highlight is NEVER dropped
 *   — one that cannot be found either way comes back `lost` and My Study lists
 *   it under "needs attention", because a note an officer wrote is theirs and
 *   this app does not get to decide it has expired.
 *
 * Everything here is pure. `src/lib/library/store.ts` is what writes the rows.
 */

/**
 * The one rendering a highlight indexes into.
 *
 * NFC first: `क` + nukta and `क़` are the same grapheme and different strings,
 * and a corpus refresh can change which one a Ministry's PDF extractor emitted.
 * Then whitespace collapses, because the twelve rule books store a rule as one
 * unbroken line whose internal spacing is an artefact of PDF extraction rather
 * than anything the printed page shows — and HTML collapses it on screen
 * anyway, so an offset counted against the uncollapsed string would not match
 * what the reader actually selected.
 */
export function normaliseText(text: string): string {
  return text.normalize('NFC').replace(/\s+/gu, ' ').trim()
}

/**
 * A unit's paragraphs as the reader sees them.
 *
 * `paragraphs()` in `corpus.ts` guarantees that joining its output with a
 * single space reproduces the corpus text with whitespace collapsed. That is
 * what lets a whole-unit offset be split back into a paragraph and an offset
 * within it without a second source of truth: paragraph `i` occupies
 * `[start_i, start_i + length_i)` of `anchorText()`, and the single space
 * between two paragraphs belongs to neither.
 */
export function anchorParagraphs(paragraphs: readonly string[]): string[] {
  return paragraphs.map(normaliseText).filter((paragraph) => paragraph.length > 0)
}

/** The whole unit, in one language, as one string — what offsets index into. */
export function anchorText(paragraphs: readonly string[]): string {
  return anchorParagraphs(paragraphs).join(' ')
}

export interface ParagraphRange {
  index: number
  start: number
  end: number
  text: string
}

/** Where each paragraph sits inside `anchorText`. */
export function paragraphRanges(paragraphs: readonly string[]): ParagraphRange[] {
  const out: ParagraphRange[] = []
  let cursor = 0
  anchorParagraphs(paragraphs).forEach((text, index) => {
    out.push({ index, start: cursor, end: cursor + text.length, text })
    cursor += text.length + 1 // the joining space
  })
  return out
}

/** A stored span: two offsets and the text they covered when it was made. */
export interface AnchorSpan {
  start: number
  end: number
  quote: string
}

export type AnchorResolution =
  | { status: 'exact'; start: number; end: number }
  /** The offsets moved; the quote was found somewhere else and is used instead. */
  | { status: 'reanchored'; start: number; end: number }
  /** Neither the offsets nor the quote match. Listed, never deleted. */
  | { status: 'lost'; start: null; end: null }

/** The text a span covers, for storing beside it. */
export function quoteAt(text: string, start: number, end: number): string {
  return text.slice(Math.max(0, start), Math.max(0, end))
}

/**
 * Find a stored span in the text as it is now.
 *
 * The offsets are tried first and are almost always right. When they are not,
 * every occurrence of the quote is a candidate and the one NEAREST the original
 * start wins — a rule that matters for a quote like "shall be deemed to be" that
 * a long rule repeats: the reader marked one of them, and the one closest to
 * where it used to be is the only defensible guess. A quote that occurs exactly
 * once needs no such reasoning and gets it for free.
 *
 * An empty quote can be found anywhere, which is the same as nowhere, so it is
 * `lost` unless its offsets still hold.
 */
export function resolveAnchor(text: string, span: AnchorSpan): AnchorResolution {
  const { start, end, quote } = span

  if (
    Number.isInteger(start) &&
    Number.isInteger(end) &&
    start >= 0 &&
    end <= text.length &&
    start < end &&
    text.slice(start, end) === quote
  ) {
    return { status: 'exact', start, end }
  }

  if (!quote) return { status: 'lost', start: null, end: null }

  let best = -1
  let bestDistance = Number.POSITIVE_INFINITY
  for (let at = text.indexOf(quote); at >= 0; at = text.indexOf(quote, at + 1)) {
    const distance = Math.abs(at - start)
    if (distance < bestDistance) {
      best = at
      bestDistance = distance
    }
  }

  if (best < 0) return { status: 'lost', start: null, end: null }
  return { status: 'reanchored', start: best, end: best + quote.length }
}

/** One highlight, reduced to what a renderer needs. */
export interface AnchoredRange {
  id: string
  start: number
  end: number
}

/**
 * A run of one paragraph's text and every highlight covering it.
 *
 * `ids` is a list rather than one id because highlights overlap — an officer
 * marking a clause inside a sentence they already marked is a normal thing to
 * do, and the segment where both apply belongs to both. The renderer decides
 * what two colours look like; this only says which apply.
 */
export interface Segment {
  text: string
  ids: string[]
}

/**
 * Cut one paragraph into segments at every highlight boundary.
 *
 * Offsets are given in WHOLE-UNIT coordinates and `paragraphStart` is where
 * this paragraph begins in them, so a highlight spanning a paragraph break is
 * clipped to each side rather than dropped — which is what happens whenever a
 * reader drags a selection across a proviso.
 */
export function segmentParagraph(
  paragraphText: string,
  paragraphStart: number,
  ranges: readonly AnchoredRange[],
): Segment[] {
  const paragraphEnd = paragraphStart + paragraphText.length

  const clipped = ranges
    .map((range) => ({
      id: range.id,
      start: Math.max(range.start, paragraphStart),
      end: Math.min(range.end, paragraphEnd),
    }))
    .filter((range) => range.end > range.start)

  if (clipped.length === 0) return [{ text: paragraphText, ids: [] }]

  const boundaries = new Set<number>([paragraphStart, paragraphEnd])
  for (const range of clipped) {
    boundaries.add(range.start)
    boundaries.add(range.end)
  }

  const points = [...boundaries].sort((a, b) => a - b)
  const segments: Segment[] = []
  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index] ?? 0
    const to = points[index + 1] ?? 0
    if (to <= from) continue
    segments.push({
      text: paragraphText.slice(from - paragraphStart, to - paragraphStart),
      ids: clipped.filter((range) => range.start <= from && range.end >= to).map((range) => range.id),
    })
  }
  return segments
}
