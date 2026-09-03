import { emptyBody, type BodyDoc, type BodyNode } from './model'
import { splitParaMarker, type ImportNotice } from './importDocx'

/**
 * A PDF's text layer → the editor's document JSON.
 *
 * A PDF has no paragraphs. It has glyphs at coordinates, and pdf.js hands them
 * back as text runs with a transform matrix — so everything below is the work
 * of putting a document back together from where its ink landed. That is a
 * heuristic job and it is written as one: every rule has a name, a reason and a
 * test, and the ones that cannot be decided are reported rather than guessed.
 *
 * **No OCR, ever.** A PDF with no text layer is a photograph of a page. The
 * honest answer is to say so and offer the paste box, which is what
 * `src/modules/library/personal/extract.ts` already decided for the Library and
 * what the session brief asks for again here. Guessing at a scan would produce
 * an official document full of plausible misreadings, which is the worst thing
 * this feature could do.
 *
 * ### Devanagari is never re-encoded
 *
 * Not one line here maps a code point to another one. Every Ministry Hindi PDF
 * in this project is typeset from a legacy font whose glyph map yields `ूशासन`
 * for `प्रशासन` (ADR-023, `docs/DATA-GAPS.md` #36), and the ambiguity is real —
 * no substitution table reverses it. So a text layer that fails
 * `devanagariQuality` is REPORTED as unusable and the officer is offered the
 * paste box; it is never "corrected".
 */

/** One text run, as pdf.js reports it, in PDF user space (y grows upward). */
export interface PdfTextItem {
  text: string
  x: number
  y: number
  width: number
  height: number
}

export interface PdfPageText {
  width: number
  height: number
  items: PdfTextItem[]
}

export interface PdfImportResult {
  body: BodyDoc
  notices: ImportNotice[]
  /** Plain text, in reading order — what `extractMeta` is given. */
  text: string
  /** How many columns each page was read as. */
  columns: number[]
  quality: DevanagariQuality
}

// -------------------------------------------------------------- text quality

export interface DevanagariQuality {
  /** Devanagari code points as a share of all letters. 0 when there are none. */
  ratio: number
  /**
   * Characters from blocks a real Hindi document does not contain — Vedic
   * Extensions, Ol Chiki, Devanagari Extended, and the Private Use Area — as a
   * share of all letters. A legacy-font text layer is full of them.
   */
  strayRatio: number
  /** True when there is Devanagari and it cannot be trusted. */
  suspicious: boolean
}

/*
  Code-point arithmetic, not a character class.

  Every one of these blocks is mostly COMBINING marks — Vedic tone marks, the
  Devanagari Extended vowel signs — and a character class containing a
  combining mark is what `no-misleading-character-class` exists to reject: in a
  class it matches on its own, which splits a grapheme. Numbers say exactly
  what is meant and need no rule to be silenced.
*/
const STRAY_RANGES: readonly [number, number][] = [
  [0x1cd0, 0x1cff], // Vedic Extensions
  [0x1c50, 0x1c7f], // Ol Chiki — a different script entirely, and a common
  //                   destination for a legacy font's mangled glyph map
  [0xa8e0, 0xa8ff], // Devanagari Extended
  [0xe000, 0xf8ff], // Private Use Area
]

const isStray = (code: number): boolean => STRAY_RANGES.some(([from, to]) => code >= from && code <= to)

const isDevanagari = (code: number): boolean => code >= 0x0900 && code <= 0x097f

const LETTER = /[^\s\d\p{P}\p{S}]/u

/**
 * Whether a Hindi text layer can be believed.
 *
 * Two independent signals, because either alone is wrong. A stray-block ratio
 * alone misses a font that maps onto ordinary Devanagari code points in the
 * wrong order. A Devanagari ratio alone flags a genuinely English document. The
 * threshold is deliberately generous — 2% of letters from a block no Hindi
 * document uses is already a broken encoding, not a quotation.
 */
export function devanagariQuality(text: string): DevanagariQuality {
  let letters = 0
  let devanagari = 0
  let stray = 0
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0
    if (isStray(code)) {
      stray += 1
      letters += 1
      continue
    }
    if (!LETTER.test(character)) continue
    letters += 1
    if (isDevanagari(code)) devanagari += 1
  }
  if (letters === 0) return { ratio: 0, strayRatio: 0, suspicious: false }
  const ratio = devanagari / letters
  const strayRatio = stray / letters
  return {
    ratio,
    strayRatio,
    // A document with SOME Devanagari and a stray tail, or one that is mostly
    // stray characters with no Devanagari at all — a legacy font renders as
    // both, depending on which map it used.
    suspicious: strayRatio > 0.02 || (ratio > 0 && ratio < 0.15 && strayRatio > 0.005),
  }
}

// ---------------------------------------------------------------- line build

interface Line {
  y: number
  x: number
  right: number
  height: number
  text: string
}

const median = (values: number[]): number => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? (sorted[middle] as number)
    : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2
}

/**
 * Text runs grouped into lines.
 *
 * Two runs are on the same line when their baselines are within half the
 * taller one's height. That tolerance is what absorbs a superscript, a footnote
 * mark and the half-pixel drift a PDF producer introduces between runs of one
 * line — a strict equality test puts every bold word on its own line.
 *
 * Runs are joined with a space only where there is a real gap. A PDF splits a
 * word across runs for a kerning pair, so joining unconditionally puts a space
 * inside `Govern ment`.
 */
export function linesOf(page: PdfPageText): Line[] {
  const items = [...page.items].filter((item) => item.text !== '').sort((a, b) => b.y - a.y || a.x - b.x)
  const rows: PdfTextItem[][] = []
  for (const item of items) {
    const row = rows[rows.length - 1]
    const first = row?.[0]
    if (row && first && Math.abs(first.y - item.y) <= Math.max(first.height, item.height) * 0.5) {
      row.push(item)
      continue
    }
    rows.push([item])
  }

  return rows
    .map((row) => {
      const sorted = [...row].sort((a, b) => a.x - b.x)
      let text = ''
      let cursor = Number.NEGATIVE_INFINITY
      let height = 0
      for (const item of sorted) {
        const gap = item.x - cursor
        // A space's width is roughly a quarter of the type size; anything wider
        // than a third of it is a real gap.
        if (text && gap > Math.max(item.height, 1) * 0.25) text += ' '
        text += item.text
        cursor = item.x + item.width
        height = Math.max(height, item.height)
      }
      const first = sorted[0] as PdfTextItem
      return {
        y: first.y,
        x: first.x,
        right: cursor,
        height: height || first.height,
        text: text.replace(/\s+/g, ' ').trim(),
      }
    })
    .filter((line) => line.text !== '')
}

// ------------------------------------------------------------------ columns

/**
 * Whether a page is set in two columns, and where the gutter is.
 *
 * **It reads the ITEMS, not the lines, and that is the whole subtlety.** Two
 * columns share their baselines: the first line of the left column and the
 * first line of the right column are at the same `y`, so `linesOf` — which
 * groups by baseline, as it must — merges them into one line spanning the page.
 * A gutter search over lines therefore finds nothing on exactly the pages it
 * exists for. The first version of this function did that and reported every
 * two-column document as one column.
 *
 * The test is a vertical band that almost nothing CROSSES. Not "nothing starts
 * in": a centred heading spans both columns and starts to the left of the
 * gutter, so a start-position histogram calls a two-column page one column.
 * `SPANNING_ALLOWANCE` is what lets a title across the top survive — a real
 * two-column document usually has one — while a page of full-width prose,
 * where every item crosses, is refused at once.
 */
const SPANNING_ALLOWANCE = 2

export function findGutter(page: PdfPageText, items: readonly PdfTextItem[]): number | null {
  const real = items.filter((entry) => entry.text.trim() !== '')
  if (real.length < 8) return null
  const from = page.width * 0.3
  const to = page.width * 0.7
  const steps = 40
  let best: { at: number; balance: number } | null = null

  for (let step = 0; step <= steps; step += 1) {
    const at = from + ((to - from) * step) / steps
    const crossing = real.filter((entry) => entry.x < at && entry.x + entry.width > at).length
    if (crossing > SPANNING_ALLOWANCE) continue
    const left = real.filter((entry) => entry.x + entry.width <= at).length
    const right = real.filter((entry) => entry.x >= at).length
    if (left < 4 || right < 4) continue
    const balance = Math.min(left, right)
    if (!best || balance > best.balance) best = { at, balance }
  }
  return best ? best.at : null
}

// --------------------------------------------------------------- paragraphs

/** A line that ends a paragraph on its own — a full stop, a danda, a colon. */
const SENTENCE_END = /[.।:;?!”"')]\s*$/
/** A line that opens something new: a paragraph number, a clause, a bullet. */
const OPENS_BLOCK = /^\s*(?:[0-9०-९]{1,3}(?:\.[0-9०-९]{1,3})*[.)]\s|\([a-zA-Zivx०-९0-9]{1,4}\)\s|[•‣▪*-]\s)/

/**
 * Lines → paragraphs.
 *
 * Five rules, in order, and the first one is the one the brief names: **join a
 * line that ends without punctuation to the next.** That single rule does most
 * of the work on a justified Government letter, where every line but the last
 * of a paragraph ends mid-sentence.
 *
 * The other four stop it going too far: a line that opens a numbered paragraph
 * or a clause always starts a new one; a vertical gap noticeably larger than
 * the page's own line spacing is a paragraph break the typesetter put there; a
 * line indented further than the paragraph's first line starts a new one; and a
 * line ending in a hyphen joins WITHOUT a space, because that is a word broken
 * across a line rather than two words.
 */
export function paragraphsOf(lines: readonly Line[]): string[] {
  if (lines.length === 0) return []
  const gaps: number[] = []
  for (let index = 1; index < lines.length; index += 1) {
    const previous = lines[index - 1] as Line
    const current = lines[index] as Line
    const gap = previous.y - current.y
    if (gap > 0) gaps.push(gap)
  }
  const normal = median(gaps) || (lines[0] as Line).height * 1.2

  const out: string[] = []
  let current = ''
  let openedAt = (lines[0] as Line).x

  const flush = () => {
    const text = current.replace(/\s+/g, ' ').trim()
    if (text) out.push(text)
    current = ''
  }

  lines.forEach((line, index) => {
    const previous = index > 0 ? (lines[index - 1] as Line) : null
    const gap = previous ? previous.y - line.y : 0
    const bigGap = previous !== null && gap > normal * 1.45
    const indented = previous !== null && line.x > openedAt + Math.max(line.height, 1) * 1.2
    const opens = OPENS_BLOCK.test(line.text)
    const previousEnded = previous !== null && SENTENCE_END.test(previous.text)

    if (previous !== null && (opens || bigGap || (previousEnded && (indented || gap > normal * 1.1)))) {
      flush()
      openedAt = line.x
    }
    if (current === '') openedAt = line.x

    if (current.endsWith('-')) current = current.slice(0, -1) + line.text
    else current = current ? `${current} ${line.text}` : line.text
  })
  flush()
  return out
}

// -------------------------------------------------------------------- public

/**
 * Every page, in reading order, as paragraphs.
 *
 * A page break between pages is deliberately NOT emitted: a PDF's page breaks
 * are where the ORIGINAL's type happened to fall, and this document is about to
 * be re-typeset at CSMOP margins with different fonts. Carrying them over would
 * put a page break in the middle of a paragraph. Where a page break is wanted
 * the officer inserts one, which is one keystroke in the editor.
 */
export function reconstructPdf(pages: readonly PdfPageText[]): PdfImportResult {
  const notices: ImportNotice[] = []
  const columns: number[] = []
  const paragraphs: string[] = []

  for (const page of pages) {
    const gutter = findGutter(page, page.items)
    if (gutter === null) {
      columns.push(1)
      paragraphs.push(...paragraphsOf(linesOf(page)))
      continue
    }
    columns.push(2)
    /*
      Column-wise, and the SPLIT HAPPENS BEFORE THE LINES ARE BUILT.

      Two columns share their baselines, so grouping into lines first would
      merge "left column line one" and "right column line one" into a single
      line and no later split could separate them again.

      An item that spans the gutter — a heading across the page — goes with the
      left column, which is where it is read on the page and where a reader's
      eye reaches it first.
    */
    const left = page.items.filter((entry) => entry.x < gutter)
    const right = page.items.filter((entry) => entry.x >= gutter)
    paragraphs.push(
      ...paragraphsOf(linesOf({ ...page, items: left })),
      ...paragraphsOf(linesOf({ ...page, items: right })),
    )
  }

  const twoColumn = columns.filter((count) => count === 2).length
  if (twoColumn > 0) notices.push({ code: 'columns', count: twoColumn, items: [] })

  const text = paragraphs.join('\n')
  const quality = devanagariQuality(text)

  const content: BodyNode[] = paragraphs.map((paragraph) => {
    const split = splitParaMarker(paragraph)
    if (split) {
      const level = split.marker.split('.').length
      return {
        type: 'numberedPara',
        attrs: { level: level >= 3 ? 3 : level === 2 ? 2 : 1 },
        content: [{ type: 'text', text: split.rest }],
      }
    }
    return { type: 'paragraph', content: [{ type: 'text', text: paragraph }] }
  })

  if (content.some((node) => node.type === 'numberedPara')) {
    notices.push({
      code: 'numbered-paras',
      count: content.filter((node) => node.type === 'numberedPara').length,
      items: [],
    })
  }

  return {
    body: content.length > 0 ? { type: 'doc', content } : emptyBody(),
    notices,
    text,
    columns,
    quality,
  }
}
