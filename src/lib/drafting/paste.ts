import { docxHtmlToBody, type ImportNotice } from './importDocx'
import { toAsciiDigits, toDevanagariDigits } from './format'
import { type BodyDoc, type BodyNode } from './model'

/**
 * Cleaning up what a word processor puts on the clipboard.
 *
 * A paste from Word, Google Docs or a browser carries three things this app
 * does not want and one it does. It wants the STRUCTURE — the paragraphs, the
 * headings, the list, the table, the bold. It does not want the appearance
 * (`Calibri 11pt #1F497D`, `MsoNormal`, a fixed line height), the typographic
 * substitutions a word processor made on the way in, or a Devanagari string in
 * whatever normalisation form the source happened to use.
 *
 * The structural half is already solved: `docxHtmlToBody` maps HTML to the
 * editor's nodes and keeps only bold, italic and underline, so a paste and a
 * `.docx` import go through exactly one mapping. **This file is the text half**
 * — and it runs over the mapped body rather than over the HTML, so it applies
 * identically to a plain-text paste, which carries no markup at all.
 *
 * ### Why NFC, and why it is not cosmetic
 *
 * `क` + `ि` composed and decomposed are the same word and different strings.
 * Every comparison in this app is a string comparison — `Fuse.js`'s index, the
 * checklist's regular expressions, `resolveAnchor`'s offsets in the Library,
 * `findReplace` in the editor — and a document holding both forms is one where
 * search finds half its own words. `String.prototype.normalize('NFC')` is the
 * single line that prevents it, and the paste boundary is the only place a
 * foreign normalisation form can enter.
 */

export type DigitStyle = 'keep' | 'ascii' | 'devanagari'

export interface PasteOptions {
  /**
   * What to do with numerals. Defaults to `keep`.
   *
   * The app-wide Devanagari-digits setting is a RENDERING option
   * (`RenderOptions.devanagariDigits`) and is applied at render time to numbers
   * the renderer generates. This is different: it rewrites the officer's own
   * typed digits in the stored document, which is why it is opt-in and why
   * `keep` is the default — a file number is `A-11011/2/2026` in both issues of
   * a bilingual document and converting it would make the document wrong.
   */
  digits?: DigitStyle
  /** Curly quotes and the non-breaking space to their plain equivalents. */
  straightQuotes?: boolean
}

const SUBSTITUTIONS: readonly [RegExp, string][] = [
  // The three Word makes as you type, and the one Google Docs makes on paste.
  // Written as escapes rather than as the characters themselves: a curly quote
  // and a non-breaking space are invisible in a diff, and `no-irregular-whitespace`
  // is right that a literal one in source is a trap.
  [/[\u2018\u2019\u201A\u201B]/g, "'"],
  [/[\u201C\u201D\u201E\u201F]/g, '"'],
  [/\u2026/g, '...'],
  // A non-breaking space is invisible, is not matched by `\s` in some engines,
  // and is what makes "Under Secretary" fail an exact search that should hit.
  [/\u00A0/g, ' '],
  // Zero-width space, the two bidi marks and the byte-order mark, which arrive
  // from PDF viewers and from Windows-encoded text and are invisible everywhere.
  [/[\u200B\u200E\u200F\uFEFF]/g, ''],
  // Word's own bullet glyph, pasted as literal text when the list structure
  // did not survive.
  [/^[\u2022\u00B7\u25AA\u25CF]\s+/gm, ''],
]

/**
 * One string, cleaned.
 *
 * Zero-width JOINER (U+200D) and NON-joiner (U+200C) are deliberately NOT
 * stripped, although the other invisibles are: in Devanagari they are
 * meaningful — ZWNJ is what keeps a conjunct from forming, and removing it
 * changes `क्‌ष` into `क्ष`, which is a different spelling. This is the kind of
 * "tidy up the invisible characters" rule that quietly damages one script and
 * not the other.
 */
export function normaliseText(text: string, options: PasteOptions = {}): string {
  let out = text.normalize('NFC')
  if (options.straightQuotes ?? true) {
    for (const [pattern, replacement] of SUBSTITUTIONS) out = out.replace(pattern, replacement)
  } else {
    // Even with the typographic substitutions declined, the two invisible
    // characters go: a non-breaking space and a byte-order mark are not
    // typography, they are things that make a search fail.
    out = out.replace(/\u00A0/g, ' ').replace(/[\u200B\uFEFF]/g, '')
  }
  if (options.digits === 'ascii') out = toAsciiDigits(out)
  else if (options.digits === 'devanagari') out = toDevanagariDigits(out)
  // Trailing spaces before a line end are what a paste from a PDF is full of.
  return out.replace(/[ \t]+$/gm, '')
}

/** The same, over every text node of a body. */
export function normaliseBody(body: BodyDoc, options: PasteOptions = {}): BodyDoc {
  const walk = (node: BodyNode): BodyNode => ({
    ...node,
    ...(node.text !== undefined ? { text: normaliseText(node.text, options) } : {}),
    ...(node.content ? { content: node.content.map(walk) } : {}),
  })
  return { ...body, content: (body.content ?? []).map(walk) }
}

export interface PasteResult {
  body: BodyDoc
  notices: ImportNotice[]
}

/**
 * HTML from a clipboard, as document nodes.
 *
 * The `detectNumbering` default is deliberately OFF here and ON for a `.docx`
 * import. A whole imported document is a document whose paragraph numbers this
 * app is about to take over. A paste is a FRAGMENT going into the middle of one
 * — the officer copied three numbered sub-paragraphs out of a rule book and
 * wants them to read as they did, not to be renumbered from wherever the caret
 * happened to be.
 */
export function cleanPastedHtml(html: string, options: PasteOptions = {}): PasteResult {
  const mapped = docxHtmlToBody(html, { detectNumbering: false })
  return { body: normaliseBody(mapped.body, options), notices: mapped.notices }
}

/**
 * Plain text from a clipboard, as document nodes.
 *
 * A blank line separates paragraphs, a single newline inside one does not —
 * which is how text pasted from a PDF viewer or a terminal is actually shaped.
 * When there is no blank line anywhere, every line is its own paragraph, since
 * a list of addressees pasted from a spreadsheet is not one paragraph.
 */
export function cleanPastedText(text: string, options: PasteOptions = {}): PasteResult {
  const cleaned = normaliseText(text, options)
  const hasBlankLine = /\n[ \t]*\n/.test(cleaned)
  const chunks = hasBlankLine ? cleaned.split(/\n[ \t]*\n+/) : cleaned.split(/\n/)
  const content: BodyNode[] = chunks
    .map((chunk) => chunk.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean)
    .map((paragraph) => ({
      type: 'paragraph' as const,
      content: [{ type: 'text' as const, text: paragraph }],
    }))
  return {
    body: content.length > 0 ? { type: 'doc', content } : { type: 'doc', content: [{ type: 'paragraph' }] },
    notices: [],
  }
}
