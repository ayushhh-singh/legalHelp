import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  PageBreak,
  PageNumber,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TableLayoutType,
  TextRun,
  VerticalAlign,
  WidthType,
  type IParagraphOptions,
  type ISectionOptions,
} from 'docx'

import { defaultPageSetup, twipsOf, type PageSetup } from './print'
import type { DocumentModel, RenderedBlock, RenderedNode, RenderedRun } from './types'

/**
 * The document as a `.docx`.
 *
 * **Import this module dynamically.** `docx` is ~340 KB of JavaScript and is
 * needed only by a reader who presses Export, which is once per document at
 * most and never at all for a reader who prints instead. `ExportBar.tsx` pulls
 * it in on the click; a static import would put it in the editor chunk and
 * charge every visit to `/draft/documents` for it.
 *
 * ### Two projections, one file, and which one wins
 *
 * A `RenderedBlock` carries `lines` always and `nodes` only when it came from
 * the document editor (ADR-041 §3). This writer reads `nodes` when they are
 * there and `lines` when they are not, and that single rule is what closes
 * `docs/DATA-GAPS.md` #78: before it, a table an officer built in the editor
 * exported as one paragraph of tab-separated text, because `linesOfNodes` is
 * the plain-text projection and tabs are what a plain-text table is.
 *
 * The fallback is not a legacy path to be removed. Every block of CHROME — the
 * file number, the Government of India block, the subject, the salutation, the
 * signature, the copy-to list — is rendered from a template layout and has no
 * `nodes`, in a document written in the new editor as much as in one migrated
 * from the old form. Both halves are live in every export.
 *
 * ### What Word decides, and what the engine decides
 *
 * The rule used to be that the engine decided everything and Word decided
 * nothing. That is still true of every block without `nodes`. It is
 * deliberately NOT true of paragraph numbers in the body any more: the session
 * brief asks for "true Word numbering, so Word renumbers on edit", and an
 * officer who deletes paragraph 3 in Word and gets 1, 2, 4, 5 has been handed a
 * document that is wrong in a way they will not notice.
 *
 * Fidelity survives because the numbering's `start` is taken from the marker
 * the engine generated. CSMOP leaves the first paragraph of an O.M. unnumbered
 * and numbers from 2 (`numberFrom`), so the exported numbering starts at 2 and
 * Word continues from there. `wordNumbering: false` puts the marker back as
 * literal text for anyone who wants the old behaviour.
 *
 * ### The fonts, and what a `.docx` can and cannot promise
 *
 * A Word run names ONE font per script slot; there is no fallback list in the
 * format. So every run here sets `ascii`/`hAnsi` to a Latin face and `cs` — the
 * complex script slot — to a Devanagari one, and Word and LibreOffice pick
 * between them **per character**. That is what makes a bilingual signature
 * block come out right: `(A.B.C.)` in Times New Roman and `अवर सचिव, भारत सरकार`
 * in Nirmala UI, inside one run, with no scanning of the string here.
 *
 * `DEVANAGARI_STACK` is therefore a stack in the APP, not in the file: the
 * first entry is written into the document, and the export dialog names the
 * whole list so an officer can tell their reader what to install. Nirmala UI
 * ships with Windows 8 and later and Mangal with every Windows since XP, which
 * is what government desktops have; Kohinoor Devanagari is macOS's and Noto
 * Sans Devanagari is what this app itself ships. On a machine with none of
 * them the text is correct, the shaping is correct, and the face is whatever
 * that machine substitutes. That is a property of `.docx` itself; embedding a
 * font would put ~200 KB of Noto into every exported file and is a licence
 * question besides.
 */

export const DEVANAGARI_STACK = [
  'Nirmala UI',
  'Mangal',
  'Kohinoor Devanagari',
  'Noto Sans Devanagari',
] as const

export interface DocxLetterhead {
  data: Uint8Array
  /** `docx` embeds a raster directly; an SVG has no raster and is left out. */
  format: 'png' | 'jpg'
  widthMm: number
  heightMm: number
}

export interface DocxProperties {
  title?: string
  subject?: string
  /** The officer, from the drafting profile. Empty when the profile is empty. */
  creator?: string
  description?: string
  keywords?: string
}

export interface DocxOptions {
  /** The Latin face, in the `ascii` and `hAnsi` slots. */
  latinFont?: string
  /** The Devanagari faces, most preferred first. Only the first is written. */
  devanagariFonts?: readonly string[]
  /** Body size in points. Headings are not scaled — CSMOP prints one size. */
  fontSizePt?: number
  page?: PageSetup
  properties?: DocxProperties
  /** Lines printed at the top of every page. The profile's letterhead. */
  headerLines?: readonly string[]
  letterhead?: DocxLetterhead | null
  /** A short note printed at the left of the running footer. */
  footerNoteText?: string
  /** "Page 1 of 3" in the footer. */
  pageNumbers?: boolean
  pageNumberLabel?: { of: string }
  /** A file number and date, as the two-column table at the head of the page. */
  numberDate?: { number: string; date: string } | null
  /** Two documents side by side in one table, or one after the other. */
  bilingual?: 'sequential' | 'sideBySide'
  columnHeadings?: readonly [string, string]
  /** Body paragraph numbers as real Word numbering. Default true. */
  wordNumbering?: boolean
}

const DEFAULTS = {
  latinFont: 'Times New Roman',
  fontSizePt: 12,
  pageNumbers: true,
  wordNumbering: true,
  bilingual: 'sequential' as const,
}

const ALIGNMENT = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
} as const

/**
 * Blocks whose lines are a list of people or papers, and which therefore want
 * their items kept together rather than orphaned across a page break.
 */
const KEEP_TOGETHER: ReadonlySet<RenderedBlock['role']> = new Set([
  'signature',
  'enclosures',
  'copyTo',
  'endorsement',
  'addressee',
])

// --------------------------------------------------------------- sanitising

/**
 * Characters that must not travel into a signed document.
 *
 * Two classes, and they are here for different reasons.
 *
 * **Bidirectional controls** (U+202A-202E, U+2066-2069) reorder the text a
 * reader sees without changing the text a program reads. A file number that
 * displays as `A-11011/2/2026` and IS something else is the "Trojan Source"
 * problem in an office document, and an official record is exactly where it
 * matters. Arabic, Hebrew and Urdu LETTERS are untouched — this strips the
 * invisible overrides, not the scripts.
 *
 * **Emoji and pictographs** are stripped because the session brief asks for it
 * and because Word substitutes a colour font for them, which prints as a black
 * box on an office laser. They are reported, not silently dropped.
 */
const BIDI_CONTROLS = /[\u202A-\u202E\u2066-\u2069]/g
/*
  `Emoji_Presentation`, NOT `Extended_Pictographic`.

  The two differ by exactly the characters a Government document uses:
  `Extended_Pictographic` includes U+00A9 ©, U+00AE ® and U+2122 ™, so the
  first version of this silently exported `© 2026 Government of India` as
  ` 2026 Government of India`. `Emoji_Presentation` means "renders as an emoji
  unless told otherwise", which is the property that actually predicts the
  black box on an office laser — and none of those three has it.

  The three alternatives after it are the pieces that carry no presentation of
  their own: a skin-tone modifier, the variation selector that forces emoji
  presentation onto a text character (so `✓️` becomes `✓` rather than a hole),
  and the enclosing keycap.

  Alternation rather than one character class, because a class holding a base
  character AND a combining one is what `no-misleading-character-class` exists
  to catch — inside a class each piece matches separately, which is what is
  wanted here but reads as though the pair were one glyph.
*/
const PICTOGRAPHS = /\p{Emoji_Presentation}|[\u{1F3FB}-\u{1F3FF}]|\u{FE0F}|\u{20E3}/gu

export interface SanitiseResult {
  text: string
  bidi: number
  pictographs: number
}

export function sanitiseForDocx(text: string): SanitiseResult {
  const bidi = (text.match(BIDI_CONTROLS) ?? []).length
  const withoutBidi = text.replace(BIDI_CONTROLS, '')
  const pictographs = (withoutBidi.match(PICTOGRAPHS) ?? []).length
  return {
    text: withoutBidi.replace(PICTOGRAPHS, '').replace(/\u200D(?=\s|$)/g, ''),
    bidi,
    pictographs,
  }
}

// ------------------------------------------------------------------- runs

interface Resolved {
  latinFont: string
  devanagariFont: string
  fontSizePt: number
  wordNumbering: boolean
}

function runFor(
  text: string,
  resolved: Resolved,
  marks: { bold?: boolean; italic?: boolean; underline?: boolean } = {},
): TextRun {
  const bold = marks.bold ?? false
  return new TextRun({
    text: sanitiseForDocx(text).text,
    bold,
    // Both halves, or a bold Hindi heading comes out regular: Word tracks the
    // complex-script weight separately from the Latin one.
    boldComplexScript: bold,
    italics: marks.italic ?? false,
    italicsComplexScript: marks.italic ?? false,
    ...(marks.underline ? { underline: {} } : {}),
    size: resolved.fontSizePt * 2,
    sizeComplexScript: resolved.fontSizePt * 2,
    font: {
      ascii: resolved.latinFont,
      hAnsi: resolved.latinFont,
      cs: resolved.devanagariFont,
    },
  })
}

const runsFor = (runs: readonly RenderedRun[], resolved: Resolved, bold: boolean): TextRun[] =>
  runs
    .filter((run) => run.text !== '')
    .map((run) =>
      runFor(run.text, resolved, {
        bold: bold || run.bold === true,
        italic: run.italic === true,
        underline: run.underline === true,
      }),
    )

// -------------------------------------------------------------- numbering

const PARA_REFERENCE = (index: number) => `sahayak-paras-${index}`
const BULLET_REFERENCE = (index: number) => `sahayak-bullets-${index}`
const ORDERED_REFERENCE = (index: number) => `sahayak-ordered-${index}`

const INDENT = [
  { left: 0, hanging: 0 },
  { left: 425, hanging: 425 },
  { left: 850, hanging: 425 },
]

/**
 * The first body paragraph number the engine generated, so Word starts there.
 *
 * CSMOP leaves the opening paragraph of an O.M. unnumbered and numbers from 2;
 * `renderDoc.ts#withNodes` honours that with `numberFrom`. Word's own numbering
 * starts at 1 unless told otherwise, so without this the exported document
 * would renumber every paragraph the moment it opened — the export would
 * disagree with the preview before anyone had edited anything.
 */
export function firstParaNumber(documents: readonly DocumentModel[]): number {
  for (const document of documents) {
    for (const block of document.blocks) {
      for (const node of block.nodes ?? []) {
        if (node.kind !== 'para' || !node.marker) continue
        const digits = /^(\d+)/.exec(node.marker.replace(/[०-९]/g, (d) => String(d.charCodeAt(0) - 0x0966)))
        if (digits) return Number(digits[1])
      }
    }
  }
  return 1
}

function numberingConfig(documents: readonly DocumentModel[], start: number) {
  return documents.flatMap((_document, index) => [
    {
      reference: PARA_REFERENCE(index),
      levels: [0, 1, 2].map((level) => ({
        level,
        format: LevelFormat.DECIMAL,
        text: level === 0 ? '%1.' : level === 1 ? '%1.%2' : '%1.%2.%3',
        alignment: AlignmentType.LEFT,
        ...(level === 0 ? { start } : {}),
        style: { paragraph: { indent: INDENT[level] } },
      })),
    },
    {
      reference: BULLET_REFERENCE(index),
      levels: [0, 1, 2].map((level) => ({
        level,
        format: LevelFormat.BULLET,
        text: level === 0 ? '•' : level === 1 ? '◦' : '▪',
        alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: INDENT[Math.min(level + 1, 2)] } },
      })),
    },
    {
      reference: ORDERED_REFERENCE(index),
      levels: [0, 1, 2].map((level) => ({
        level,
        format: level === 0 ? LevelFormat.DECIMAL : LevelFormat.LOWER_ROMAN,
        text: level === 0 ? '%1.' : `(%${level + 1})`,
        alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: INDENT[Math.min(level + 1, 2)] } },
      })),
    },
  ])
}

// ----------------------------------------------------------------- tables

const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: 'auto' } as const
const HAIRLINE = { style: BorderStyle.SINGLE, size: 4, color: '000000' } as const

const GRID_BORDERS = {
  top: HAIRLINE,
  bottom: HAIRLINE,
  left: HAIRLINE,
  right: HAIRLINE,
  insideHorizontal: HAIRLINE,
  insideVertical: HAIRLINE,
}

const OPEN_BORDERS = {
  top: NO_BORDER,
  bottom: NO_BORDER,
  left: NO_BORDER,
  right: NO_BORDER,
  insideHorizontal: NO_BORDER,
  insideVertical: NO_BORDER,
}

function tableFor(node: Extract<RenderedNode, { kind: 'table' }>, resolved: Resolved): Table {
  const width = Math.max(1, ...node.rows.map((row) => row.cells.length))
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: GRID_BORDERS,
    rows: node.rows.map(
      (row) =>
        new TableRow({
          tableHeader: row.header,
          children: Array.from({ length: width }, (_unused, index) => {
            const cell = row.cells[index] ?? []
            return new TableCell({
              verticalAlign: VerticalAlign.TOP,
              margins: { top: 60, bottom: 60, left: 100, right: 100 },
              children: [
                new Paragraph({
                  children: runsFor(cell, resolved, row.header),
                  spacing: { after: 0, line: 240 },
                }),
              ],
            })
          }),
        }),
    ),
  })
}

// ------------------------------------------------------------------ nodes

/**
 * How deep a paragraph marker is: `2.` is 0, `2.1` is 1, `2.1.1` is 2.
 *
 * Counting the GROUPS, not the pieces `split('.')` returns. A marker ends in a
 * full stop and a space, so `'2. '.split('.')` is `['2', ' ']` — length two —
 * and `length - 1` put every ordinary numbered paragraph at Word level 1.
 * Nothing throws and the numbers still appear: Word draws level 1 with the
 * `%1.%2` format at a 425-twip indent, so an O.M. whose paragraphs should read
 * `2.` `3.` `4.` down the left margin opens indented and numbered `2.1` `2.2`.
 *
 * Clamped at 2 because `numberingConfig` defines three levels; a reference to a
 * level that was never defined opens unnumbered.
 */
function markerDepth(marker: string): number {
  const groups = marker
    .trim()
    .replace(/[.)]+$/, '')
    .split('.')
    .filter(Boolean)
  return Math.min(2, Math.max(0, groups.length - 1))
}

type Child = Paragraph | Table

function paragraphFor(children: TextRun[], shape: Omit<IParagraphOptions, 'children'>): Paragraph {
  return new Paragraph({ ...shape, children })
}

function nodesFor(
  nodes: readonly RenderedNode[],
  resolved: Resolved,
  documentIndex: number,
  block: RenderedBlock,
): Child[] {
  const out: Child[] = []
  for (const node of nodes) {
    switch (node.kind) {
      case 'para': {
        const numbered = resolved.wordNumbering && node.marker !== ''
        const level = numbered ? markerDepth(node.marker) : 0
        out.push(
          paragraphFor(
            runsFor(
              // With Word numbering on, the marker is Word's to draw. With it
              // off it is text, exactly as it has always been.
              numbered ? node.runs : node.marker ? [{ text: node.marker }, ...node.runs] : node.runs,
              resolved,
              block.emphasis !== 'normal',
            ),
            {
              alignment: ALIGNMENT[node.align],
              spacing: { after: 160, line: 276 },
              ...(numbered ? { numbering: { reference: PARA_REFERENCE(documentIndex), level } } : {}),
            },
          ),
        )
        break
      }
      case 'heading': {
        out.push(
          paragraphFor(runsFor(node.runs, resolved, true), {
            heading:
              node.level === 1
                ? HeadingLevel.HEADING_1
                : node.level === 2
                  ? HeadingLevel.HEADING_2
                  : HeadingLevel.HEADING_3,
            // A heading with nothing under it at the foot of a page is an
            // orphan; Word's own `keepNext` is the fix and costs nothing.
            keepNext: true,
            spacing: { before: 240, after: 120 },
          }),
        )
        break
      }
      case 'listItem': {
        const bullet = node.marker.trim().startsWith('•') || node.marker.trim() === ''
        out.push(
          paragraphFor(runsFor(node.runs, resolved, false), {
            numbering: {
              reference: bullet ? BULLET_REFERENCE(documentIndex) : ORDERED_REFERENCE(documentIndex),
              level: Math.min(2, node.depth),
            },
            spacing: { after: 80, line: 276 },
          }),
        )
        break
      }
      case 'quote': {
        out.push(
          paragraphFor(runsFor(node.runs, resolved, false), {
            indent: { left: 720, right: 360 },
            spacing: { after: 160, line: 276 },
          }),
        )
        break
      }
      case 'table':
        out.push(tableFor(node, resolved))
        // Word requires a paragraph after a table, or two adjacent tables merge
        // into one and the next block lands inside the last cell.
        out.push(new Paragraph({ spacing: { after: 120 }, children: [] }))
        break
      case 'pageBreak':
        out.push(new Paragraph({ children: [new PageBreak()] }))
        break
    }
  }
  return out
}

/** A block whose only projection is `lines` — every block of chrome. */
function linesFor(block: RenderedBlock, resolved: Resolved): Child[] {
  const bold = block.emphasis !== 'normal'
  const alignment = ALIGNMENT[block.align]
  return block.lines.map((line, index) =>
    paragraphFor(line === '' ? [] : [runFor(line, resolved, { bold })], {
      alignment,
      spacing: {
        // Space after the block, not after every line of it: an address whose
        // three lines are a paragraph apart is not an address.
        after: index === block.lines.length - 1 ? 200 : 0,
        line: 276,
      },
      ...(KEEP_TOGETHER.has(block.role) && index < block.lines.length - 1 ? { keepNext: true } : {}),
    }),
  )
}

const childrenForBlock = (block: RenderedBlock, resolved: Resolved, documentIndex: number): Child[] =>
  block.nodes ? nodesFor(block.nodes, resolved, documentIndex, block) : linesFor(block, resolved)

// ------------------------------------------------------- number/date table

/**
 * The file number on the left and the date on the right, as a borderless
 * two-column table.
 *
 * Every Government letter is laid out this way, and a table is how Word does
 * it: two right/left-aligned paragraphs stacked would put the date on its own
 * line, and a tab stop moves the moment somebody changes the margins. It is
 * emitted only when both facts are present — a document with a number and no
 * date is a draft, and a one-cell table would be a strange thing to hand it.
 */
function numberDateTable(parts: { number: string; date: string }, resolved: Resolved): Table {
  const cell = (text: string, alignment: (typeof AlignmentType)[keyof typeof AlignmentType]) =>
    new TableCell({
      borders: {
        top: NO_BORDER,
        bottom: NO_BORDER,
        left: NO_BORDER,
        right: NO_BORDER,
      },
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      children: [new Paragraph({ alignment, spacing: { after: 120 }, children: [runFor(text, resolved)] })],
    })
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: OPEN_BORDERS,
    rows: [
      new TableRow({
        children: [cell(parts.number, AlignmentType.LEFT), cell(parts.date, AlignmentType.RIGHT)],
      }),
    ],
  })
}

// ---------------------------------------------------- header and footer

function headerFor(options: DocxOptions, resolved: Resolved): Header | undefined {
  const children: (Paragraph | Table)[] = []
  const image = options.letterhead
  if (image && image.data.length > 0) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 60 },
        children: [
          new ImageRun({
            type: image.format,
            data: image.data,
            transformation: {
              width: Math.round((image.widthMm / 25.4) * 96),
              height: Math.round((image.heightMm / 25.4) * 96),
            },
          }),
        ],
      }),
    )
  }
  for (const line of options.headerLines ?? []) {
    if (!line.trim()) continue
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 0 },
        children: [runFor(line, resolved, { bold: true })],
      }),
    )
  }
  if (children.length === 0) return undefined
  return new Header({ children })
}

function footerFor(options: DocxOptions, resolved: Resolved): Footer | undefined {
  const children: Paragraph[] = []
  if (options.footerNoteText) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.LEFT,
        children: [runFor(options.footerNoteText, resolved)],
      }),
    )
  }
  if (options.pageNumbers ?? DEFAULTS.pageNumbers) {
    // `PAGE` and `NUMPAGES` are Word FIELDS: they are computed when the
    // document is opened and repaginated, which is the only way "of 3" can be
    // right after an officer edits it.
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({
            children: [
              PageNumber.CURRENT,
              ` ${options.pageNumberLabel?.of ?? 'of'} `,
              PageNumber.TOTAL_PAGES,
            ],
            size: resolved.fontSizePt * 2,
            sizeComplexScript: resolved.fontSizePt * 2,
            font: { ascii: resolved.latinFont, hAnsi: resolved.latinFont, cs: resolved.devanagariFont },
          }),
        ],
      }),
    )
  }
  return children.length > 0 ? new Footer({ children }) : undefined
}

// ------------------------------------------------------------ side by side

/**
 * Both languages as one two-column table, paired on `layoutIndex`.
 *
 * `layoutIndex` and not position in the array: roles repeat, a demi-official
 * letter has two `header` blocks, and `drafting_seed.py` guarantees the two
 * languages place the same blocks in the same order — which is exactly what
 * `renderOfficialDocBilingual` pairs on and what `A4Preview` keys on.
 *
 * A side missing a block gets an em dash rather than an empty cell, so the
 * mismatch is visible on the page instead of reading as a document that just
 * happens to be shorter in Hindi.
 */
function sideBySideTable(
  documents: readonly DocumentModel[],
  resolved: Resolved,
  headings: readonly [string, string] | undefined,
): Table {
  const [left, right] = documents
  const indices = [
    ...new Set([...(left?.blocks ?? []), ...(right?.blocks ?? [])].map((block) => block.layoutIndex)),
  ].sort((a, b) => a - b)

  const cellFor = (block: RenderedBlock | undefined, index: number): TableCell =>
    new TableCell({
      verticalAlign: VerticalAlign.TOP,
      margins: { top: 60, bottom: 60, left: 120, right: 120 },
      children:
        block && (block.lines.length > 0 || (block.nodes?.length ?? 0) > 0)
          ? childrenForBlock(block, resolved, index)
          : [new Paragraph({ children: [runFor('—', resolved)] })],
    })

  const rows: TableRow[] = []
  if (headings) {
    rows.push(
      new TableRow({
        tableHeader: true,
        children: headings.map(
          (heading) =>
            new TableCell({
              margins: { top: 60, bottom: 60, left: 120, right: 120 },
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [runFor(heading, resolved, { bold: true })],
                }),
              ],
            }),
        ),
      }),
    )
  }
  for (const index of indices) {
    rows.push(
      new TableRow({
        children: [
          cellFor(
            left?.blocks.find((block) => block.layoutIndex === index),
            0,
          ),
          cellFor(
            right?.blocks.find((block) => block.layoutIndex === index),
            1,
          ),
        ],
      }),
    )
  }
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: OPEN_BORDERS,
    rows,
  })
}

// -------------------------------------------------------------------- build

/**
 * One or more rendered documents as a Word file.
 *
 * Pass one `DocumentModel` for a single-language export, or two for the
 * bilingual one — English then Hindi. `bilingual: 'sequential'` (the default)
 * separates them with a page break, which is how a bilingual issue is filed;
 * `'sideBySide'` puts them in one two-column table, which is how one is
 * checked. Sequential uses a break rather than two sections because it is one
 * document with two halves, and two sections would let a word processor number
 * them independently.
 */
export function buildDocxDocument(documents: readonly DocumentModel[], options: DocxOptions = {}): Document {
  const resolved: Resolved = {
    latinFont: options.latinFont ?? DEFAULTS.latinFont,
    devanagariFont: options.devanagariFonts?.[0] ?? DEVANAGARI_STACK[0],
    fontSizePt: options.fontSizePt ?? DEFAULTS.fontSizePt,
    wordNumbering: options.wordNumbering ?? DEFAULTS.wordNumbering,
  }
  const page = options.page ?? defaultPageSetup('A4')
  const geometry = twipsOf(page)
  const children: Child[] = []

  if (options.numberDate && options.numberDate.number && options.numberDate.date) {
    children.push(numberDateTable(options.numberDate, resolved))
  }

  if ((options.bilingual ?? DEFAULTS.bilingual) === 'sideBySide' && documents.length === 2) {
    children.push(sideBySideTable(documents, resolved, options.columnHeadings))
  } else {
    documents.forEach((document, index) => {
      if (index > 0) children.push(new Paragraph({ children: [new PageBreak()] }))
      for (const block of document.blocks) children.push(...childrenForBlock(block, resolved, index))
    })
  }

  const header = headerFor(options, resolved)
  const footer = footerFor(options, resolved)
  const section: ISectionOptions = {
    properties: { page: { size: geometry.size, margin: geometry.margin } },
    ...(header ? { headers: { default: header } } : {}),
    ...(footer ? { footers: { default: footer } } : {}),
    children,
  }

  const fontSet = {
    ascii: resolved.latinFont,
    hAnsi: resolved.latinFont,
    cs: resolved.devanagariFont,
  }

  return new Document({
    // Word shows these in File > Info. They come from the document and from the
    // officer's own profile; when the profile is empty they are empty, because
    // a `creator` naming the app would be a claim the app should not make about
    // a document an officer signs.
    creator: options.properties?.creator ?? '',
    description: options.properties?.description ?? '',
    title: options.properties?.title ?? '',
    subject: options.properties?.subject ?? '',
    keywords: options.properties?.keywords ?? '',
    numbering: { config: numberingConfig(documents, firstParaNumber(documents)) },
    styles: {
      default: {
        document: { run: { size: resolved.fontSizePt * 2, font: fontSet } },
        // Real Word styles, so an officer can restyle the whole document from
        // Word's own styles pane rather than selecting text. Headings are NOT
        // scaled up: CSMOP prints one size, and a 16pt heading in the middle of
        // an O.M. is not the house style.
        title: {
          run: { size: resolved.fontSizePt * 2, bold: true, font: fontSet, allCaps: true },
          paragraph: { alignment: AlignmentType.CENTER, spacing: { after: 240 } },
        },
        heading1: {
          run: { size: resolved.fontSizePt * 2, bold: true, color: '000000', font: fontSet },
          paragraph: { spacing: { before: 240, after: 120 } },
        },
        heading2: {
          run: { size: resolved.fontSizePt * 2, bold: true, color: '000000', font: fontSet },
          paragraph: { spacing: { before: 200, after: 100 } },
        },
        heading3: {
          run: { size: resolved.fontSizePt * 2, bold: true, italics: true, color: '000000', font: fontSet },
          paragraph: { spacing: { before: 160, after: 80 } },
        },
      },
    },
    sections: [section],
  })
}

/** The same, packed. Browser only — `Packer.toBlob` needs a `Blob`. */
export function toDocxBlob(documents: readonly DocumentModel[], options: DocxOptions = {}): Promise<Blob> {
  return Packer.toBlob(buildDocxDocument(documents, options))
}

/** The same, as bytes — what the batch export puts into a zip. */
export async function toDocxBytes(
  documents: readonly DocumentModel[],
  options: DocxOptions = {},
): Promise<Uint8Array> {
  const blob = await toDocxBlob(documents, options)
  return new Uint8Array(await blob.arrayBuffer())
}

/**
 * What was stripped on the way out, so the export can say so.
 *
 * Counted over the plain-text projection of every block, which is the same text
 * the runs are built from — so a count of zero here means nothing was removed
 * anywhere in the file.
 */
export function strippedCharacters(documents: readonly DocumentModel[]): {
  bidi: number
  pictographs: number
} {
  let bidi = 0
  let pictographs = 0
  for (const document of documents) {
    for (const block of document.blocks) {
      for (const line of block.lines) {
        const result = sanitiseForDocx(line)
        bidi += result.bidi
        pictographs += result.pictographs
      }
    }
  }
  return { bidi, pictographs }
}

/**
 * A file name an officer can find again.
 *
 * The file number first where there is one, because that is how a document is
 * filed and how it will be searched for; the form's name otherwise. Everything
 * a file system dislikes is replaced, and Devanagari is kept — a Hindi O.M.
 * deserves a Hindi file name, and every platform this app runs on handles it.
 */
export function docxFileName(parts: { fileNumber?: string; fallback: string; lang: string }): string {
  const base = (parts.fileNumber?.trim() || parts.fallback).trim()
  const safe = base
    // Windows forbids these outright; the rest are merely a nuisance in a shell.
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s-]+|[.\s-]+$/g, '')
    .slice(0, 80)
  return `${safe || 'draft'} (${parts.lang}).docx`
}

/**
 * A name no other entry in the same archive has.
 *
 * A batch of ten documents with no file numbers would otherwise be ten copies
 * of `Office Memorandum (EN).docx`, and a ZIP with duplicate names extracts to
 * one file on every platform — nine of the officer's documents would silently
 * not be there.
 */
export function uniqueName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) {
    taken.add(name)
    return name
  }
  const dot = name.lastIndexOf('.')
  const stem = dot === -1 ? name : name.slice(0, dot)
  const extension = dot === -1 ? '' : name.slice(dot)
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${stem} (${index})${extension}`
    if (!taken.has(candidate)) {
      taken.add(candidate)
      return candidate
    }
  }
  const fallback = `${stem} (${taken.size})${extension}`
  taken.add(fallback)
  return fallback
}
