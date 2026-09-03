import { htmlText, parseHtml, styleOf, walkHtml, type HtmlElement, type HtmlNode } from './html'
import { emptyBody, type BodyDoc, type BodyMark, type BodyNode } from './model'

/**
 * `.docx` → the editor's document JSON.
 *
 * This is the MAPPING LAYER the session brief asks for, and the split it
 * implies is the whole design: `mammoth` turns Word's XML into HTML, and this
 * file turns that HTML into `BodyNode`s. Neither half knows about the other's
 * dependencies — mammoth is imported in `src/modules/drafting/import/`, and
 * this file is pure, so every mapping decision below is testable against a
 * string with no zip, no browser and no `File`.
 *
 * ### Four things an officer's document contains that HTML cannot carry
 *
 * mammoth's HTML is lossy in ways that matter here, and each is recovered from
 * the OOXML directly rather than guessed at:
 *
 * - **Tracked changes.** mammoth accepts every insertion and drops every
 *   deletion, silently. That is the right answer — it is what "accept all"
 *   means — but an officer importing somebody's marked-up draft must be TOLD,
 *   because the document they are now editing is not the document they were
 *   sent. `scanDocumentXml` counts `w:ins`/`w:del`.
 * - **Merged cells.** mammoth emits `colspan`/`rowspan`; the editor's table
 *   model has neither, so a merge is flattened into a rectangular grid and
 *   reported. Flattening is not silent loss: the content is all still there,
 *   in the cell it was in, with empty cells filling the span.
 * - **Headers and footers.** mammoth does not read them at all. They are the
 *   letterhead of a Government document, which is exactly the part this app
 *   has a field for, so they are read out of `word/header*.xml` and offered
 *   for review rather than dropped.
 * - **Page breaks.** Only reachable through a style-map entry
 *   (`br[type='page'] => hr`), which the reader in the module layer supplies;
 *   this file maps the resulting `<hr>` to a `pageBreak` node.
 *
 * ### Nothing is imported silently
 *
 * Every lossy step produces an `ImportNotice`, and the import screen lists them
 * under "not imported" before the document is saved. The rule this file follows
 * is the one `resolveAnchor` follows in the Library (ADR-039 §1): a conversion
 * that cannot be exact must be able to say so. An importer that quietly drops
 * an image is worse than one that refuses the file, because the officer signs
 * what came out.
 */

export type ImportNoticeCode =
  | 'tracked-changes'
  | 'images'
  | 'merged-cells'
  | 'header'
  | 'footer'
  | 'footnotes'
  | 'columns'
  | 'numbered-paras'
  | 'unsupported'

export interface ImportNotice {
  code: ImportNoticeCode
  /** How many times it happened. Always ≥ 1 for a notice that is present. */
  count: number
  /** Named examples — an image's alternative text, a dropped element's tag. */
  items: string[]
}

export interface DocxImportResult {
  body: BodyDoc
  notices: ImportNotice[]
}

export interface DocxMapOptions {
  /**
   * Turn a paragraph that begins `2.` or `2.1` into a `numberedPara` with the
   * marker removed, so the renderer numbers it and moving it renumbers the
   * rest (ADR-041 §3). On by default: a Government document numbers its
   * paragraphs, and importing the numbers as literal text is how a document
   * ends up numbered `1. 2. 3.` under a heading that renumbers from 2.
   */
  detectNumbering?: boolean
}

// ------------------------------------------------------------------ notices

class Notices {
  private map = new Map<ImportNoticeCode, ImportNotice>()

  add(code: ImportNoticeCode, item?: string, count = 1): void {
    const existing = this.map.get(code)
    if (existing) {
      existing.count += count
      if (item && existing.items.length < 12 && !existing.items.includes(item)) existing.items.push(item)
      return
    }
    this.map.set(code, { code, count, items: item ? [item] : [] })
  }

  list(): ImportNotice[] {
    return [...this.map.values()].filter((notice) => notice.count > 0)
  }
}

/** Merge two notice lists, summing counts. Used to fold the XML scan in. */
export function mergeNotices(...lists: readonly ImportNotice[][]): ImportNotice[] {
  const merged = new Notices()
  for (const list of lists) {
    for (const notice of list) {
      merged.add(notice.code, undefined, notice.count)
      for (const item of notice.items) merged.add(notice.code, item, 0)
    }
  }
  return merged.list()
}

// -------------------------------------------------------------- inline runs

const MARK_TAGS: Record<string, BodyMark> = {
  strong: 'bold',
  b: 'bold',
  em: 'italic',
  i: 'italic',
  u: 'underline',
  ins: 'underline',
}

/**
 * Whether an inline element's own styling adds a mark.
 *
 * Word does not always use `<strong>`: a run bolded directly carries
 * `font-weight:bold` on a `<span>`, and Google Docs uses nothing else. Every
 * OTHER declaration on that span — the font, the size, the colour — is dropped,
 * which is the paste-cleanup rule applied to an import as well: a document's
 * appearance is this app's to decide, and an imported `Calibri 11pt #1F497D`
 * would print in the middle of a CSMOP letter.
 */
function marksFromStyle(element: HtmlElement): BodyMark[] {
  const style = styleOf(element)
  const out: BodyMark[] = []
  const weight = style['font-weight'] ?? ''
  if (weight === 'bold' || weight === 'bolder' || Number(weight) >= 600) out.push('bold')
  if ((style['font-style'] ?? '').startsWith('italic')) out.push('italic')
  if ((style['text-decoration'] ?? style['text-decoration-line'] ?? '').includes('underline')) {
    out.push('underline')
  }
  return out
}

const NBSP = /\u00A0/g

/** Collapse the whitespace HTML would collapse, and keep the rest verbatim. */
const collapse = (text: string): string => text.replace(NBSP, ' ').replace(/[ \t\r\n]+/g, ' ')

function runsFrom(nodes: readonly HtmlNode[], marks: BodyMark[], notices: Notices, out: BodyNode[]): void {
  for (const node of nodes) {
    if (node.kind === 'text') {
      const text = collapse(node.text)
      if (!text) continue
      out.push({
        type: 'text',
        text,
        ...(marks.length > 0 ? { marks: [...new Set(marks)].map((type) => ({ type })) } : {}),
      })
      continue
    }
    if (node.tag === 'br') {
      out.push({ type: 'hardBreak' })
      continue
    }
    if (node.tag === 'img') {
      // Listed, never embedded. `image-dropped` is the one notice an officer
      // most needs to see: an order that referred to "the seal above" now
      // refers to nothing.
      notices.add('images', node.attrs.alt || node.attrs.src?.slice(0, 40) || '')
      continue
    }
    if (node.tag === 'del') {
      // A rejected deletion. mammoth normally drops these before we see them;
      // if a style map ever surfaces one, it is not part of the accepted text.
      continue
    }
    const added = MARK_TAGS[node.tag]
    runsFrom(node.children, added ? [...marks, added] : [...marks, ...marksFromStyle(node)], notices, out)
  }
}

const textOfNodes = (nodes: readonly BodyNode[]): string =>
  nodes.map((node) => (node.type === 'text' ? (node.text ?? '') : ' ')).join('')

const trimRuns = (runs: BodyNode[]): BodyNode[] => {
  const out = runs.map((run) => ({ ...run }))
  const first = out[0]
  if (first && first.type === 'text') first.text = (first.text ?? '').replace(/^ +/, '')
  const last = out[out.length - 1]
  if (last && last.type === 'text') last.text = (last.text ?? '').replace(/ +$/, '')
  return out.filter((run) => run.type !== 'text' || (run.text ?? '').length > 0)
}

// ------------------------------------------------------------ numbered paras

/**
 * `2.` and `2.1` at the start of a paragraph — and nothing else.
 *
 * Deliberately narrow. `(a)` is a sub-clause an officer typed and means
 * something; `2026.` is a year at the start of a sentence; a Devanagari digit
 * is matched because a Hindi document numbers its paragraphs `२.`, and refusing
 * that would make the feature work in one language only — the trap ADR-039's
 * addendum records for `refs.ts`.
 */
const PARA_MARKER = /^([0-9०-९]{1,3}(?:\.[0-9०-९]{1,3}){0,2})\.?[)\s]\s*/

export function splitParaMarker(text: string): { marker: string; rest: string } | null {
  const match = PARA_MARKER.exec(text)
  if (!match) return null
  const marker = match[1] ?? ''
  const rest = text.slice(match[0].length)
  if (!rest.trim()) return null
  return { marker, rest }
}

const markerDepth = (marker: string): 1 | 2 | 3 => {
  const depth = marker.split('.').length
  return depth >= 3 ? 3 : depth === 2 ? 2 : 1
}

/** Strip a leading paragraph number from a run list, in place of the text. */
function stripMarker(runs: BodyNode[]): { level: 1 | 2 | 3; runs: BodyNode[] } | null {
  const first = runs[0]
  if (!first || first.type !== 'text') return null
  const split = splitParaMarker(first.text ?? '')
  if (!split) return null
  const rest = [...runs]
  rest[0] = { ...first, text: split.rest }
  return { level: markerDepth(split.marker), runs: rest.filter((run) => run.type !== 'text' || run.text) }
}

// -------------------------------------------------------------------- tables

interface Cell {
  header: boolean
  content: BodyNode[]
  colspan: number
  rowspan: number
}

const spanOf = (element: HtmlElement, name: string): number => {
  const raw = Number.parseInt(element.attrs[name] ?? '1', 10)
  return Number.isFinite(raw) && raw > 1 ? Math.min(raw, 64) : 1
}

/**
 * A table, flattened into a rectangle.
 *
 * The editor's table model has no `colspan` and no `rowspan`, by choice: a
 * merged cell has no meaning in the plain-text projection every checklist rule
 * reads (`renderDoc.ts#linesOfNodes` joins a row with tabs), and a model that
 * carried spans would have to be understood by the renderer, the `.docx`
 * writer and the print stylesheet as well.
 *
 * So the content stays where it was and the span is filled with empty cells.
 * Nothing is lost except the merge itself, and the officer is told the merge
 * was flattened so they can re-make it in Word if the table needs it.
 */
function tableFrom(element: HtmlElement, notices: Notices): BodyNode {
  const rows: Cell[][] = []
  for (const node of walkHtml(element.children)) {
    if (node.kind !== 'element' || node.tag !== 'tr') continue
    const cells: Cell[] = []
    for (const child of node.children) {
      if (child.kind !== 'element' || (child.tag !== 'td' && child.tag !== 'th')) continue
      const content: BodyNode[] = []
      runsFrom(child.children, [], notices, content)
      cells.push({
        header: child.tag === 'th',
        content: trimRuns(content),
        colspan: spanOf(child, 'colspan'),
        rowspan: spanOf(child, 'rowspan'),
      })
    }
    rows.push(cells)
  }

  const grid: (Cell | null)[][] = []
  const pending: { cell: Cell; column: number; left: number }[] = []
  rows.forEach((cells, rowIndex) => {
    const line: (Cell | null)[] = []
    grid[rowIndex] = line
    for (const carry of pending) {
      if (carry.left <= 0) continue
      while (line.length < carry.column) line.push(null)
      line[carry.column] = null
      carry.left -= 1
    }
    let column = 0
    for (const cell of cells) {
      while (line[column] !== undefined) column += 1
      line[column] = cell
      if (cell.colspan > 1 || cell.rowspan > 1) notices.add('merged-cells')
      for (let extra = 1; extra < cell.colspan; extra += 1) line[column + extra] = null
      if (cell.rowspan > 1) {
        for (let span = 0; span < cell.colspan; span += 1) {
          pending.push({ cell, column: column + span, left: cell.rowspan - 1 })
        }
      }
      column += cell.colspan
    }
    for (const carry of pending) if (carry.left < 0) carry.left = 0
  })

  const width = Math.max(1, ...grid.map((line) => line.length))
  const content: BodyNode[] = grid.map((line) => ({
    type: 'tableRow',
    content: Array.from({ length: width }, (_unused, index) => {
      const cell = line[index] ?? null
      return {
        type: cell?.header ? ('tableHeader' as const) : ('tableCell' as const),
        content: [{ type: 'paragraph' as const, content: cell ? cell.content : [] }],
      }
    }),
  }))

  return { type: 'table', content: content.length > 0 ? content : [] }
}

// -------------------------------------------------------------------- lists

const LIST_TAG = { ul: 'bulletList', ol: 'orderedList' } as const

function listFrom(element: HtmlElement, notices: Notices): BodyNode {
  const items: BodyNode[] = []
  for (const child of element.children) {
    if (child.kind !== 'element' || child.tag !== 'li') continue
    const inline: BodyNode[] = []
    const nested: BodyNode[] = []
    for (const part of child.children) {
      if (part.kind === 'element' && (part.tag === 'ul' || part.tag === 'ol')) {
        nested.push(listFrom(part, notices))
      } else if (part.kind === 'element' && part.tag === 'p') {
        // mammoth wraps a multi-paragraph list item in `<p>`; a nested list
        // inside it has to keep nesting rather than becoming a sibling.
        const inner: BodyNode[] = []
        runsFrom(part.children, [], notices, inner)
        inline.push(...inner)
      } else {
        runsFrom([part], [], notices, inline)
      }
    }
    items.push({
      type: 'listItem',
      content: [{ type: 'paragraph', content: trimRuns(inline) }, ...nested],
    })
  }
  return { type: LIST_TAG[element.tag as 'ul' | 'ol'], content: items }
}

// ------------------------------------------------------------------- blocks

const HEADING_LEVEL: Record<string, 1 | 2 | 3> = {
  h1: 1,
  h2: 2,
  h3: 3,
  h4: 3,
  h5: 3,
  h6: 3,
}

/** Elements that carry no document meaning and whose children are kept. */
const TRANSPARENT = new Set([
  'div',
  'body',
  'html',
  'section',
  'article',
  'main',
  'header',
  'footer',
  'span',
  'a',
  'font',
])

function blocksFrom(
  nodes: readonly HtmlNode[],
  notices: Notices,
  options: Required<DocxMapOptions>,
  out: BodyNode[],
): void {
  for (const node of nodes) {
    if (node.kind === 'text') {
      // Loose text between blocks — a Google Docs paste does this. It is a
      // paragraph; dropping it would lose a line of somebody's document.
      const runs: BodyNode[] = []
      runsFrom([node], [], notices, runs)
      const trimmed = trimRuns(runs)
      if (trimmed.length > 0) out.push({ type: 'paragraph', content: trimmed })
      continue
    }

    switch (node.tag) {
      case 'p': {
        pushParagraph(node, notices, options, out)
        break
      }
      case 'h1':
      case 'h2':
      case 'h3':
      case 'h4':
      case 'h5':
      case 'h6': {
        const runs: BodyNode[] = []
        runsFrom(node.children, [], notices, runs)
        const trimmed = trimRuns(runs)
        if (trimmed.length > 0) {
          out.push({ type: 'heading', attrs: { level: HEADING_LEVEL[node.tag] ?? 1 }, content: trimmed })
        }
        break
      }
      case 'ul':
      case 'ol':
        out.push(listFrom(node, notices))
        break
      case 'table':
        out.push(tableFrom(node, notices))
        break
      case 'blockquote': {
        const inner: BodyNode[] = []
        blocksFrom(node.children, notices, options, inner)
        const paragraphs = inner.filter(
          (child) => child.type === 'paragraph' || child.type === 'numberedPara',
        )
        out.push({
          type: 'blockquote',
          content:
            paragraphs.length > 0
              ? paragraphs.map((p) => ({ ...p, type: 'paragraph' as const }))
              : [{ type: 'paragraph' }],
        })
        break
      }
      case 'hr':
        out.push({ type: 'pageBreak' })
        break
      case 'br':
        break
      case 'img':
        notices.add('images', node.attrs.alt || '')
        break
      default:
        if (TRANSPARENT.has(node.tag)) blocksFrom(node.children, notices, options, out)
        else {
          notices.add('unsupported', node.tag)
          blocksFrom(node.children, notices, options, out)
        }
    }
  }
}

/**
 * One `<p>`, which may contain a page break and therefore be more than one
 * paragraph. A `<hr>` inside a paragraph is what the `br[type='page']` style
 * map produces, and Word puts a page break in the middle of a paragraph often
 * enough to be worth splitting rather than dropping.
 */
function pushParagraph(
  element: HtmlElement,
  notices: Notices,
  options: Required<DocxMapOptions>,
  out: BodyNode[],
): void {
  const groups: HtmlNode[][] = [[]]
  for (const child of element.children) {
    if (child.kind === 'element' && child.tag === 'hr') groups.push([])
    else (groups[groups.length - 1] as HtmlNode[]).push(child)
  }

  groups.forEach((group, index) => {
    if (index > 0) out.push({ type: 'pageBreak' })
    const runs: BodyNode[] = []
    runsFrom(group, [], notices, runs)
    const trimmed = trimRuns(runs)
    if (trimmed.length === 0) return
    const align = alignOf(element)
    const numbered = options.detectNumbering ? stripMarker(trimmed) : null
    if (numbered) {
      notices.add('numbered-paras')
      out.push({
        type: 'numberedPara',
        attrs: { level: numbered.level, ...(align ? { textAlign: align } : {}) },
        content: numbered.runs,
      })
      return
    }
    out.push({
      type: 'paragraph',
      ...(align ? { attrs: { textAlign: align } } : {}),
      content: trimmed,
    })
  })
}

function alignOf(element: HtmlElement): 'center' | 'right' | null {
  const value = styleOf(element)['text-align'] ?? ''
  return value === 'center' || value === 'right' ? value : null
}

// ------------------------------------------------------------------- public

/**
 * The mapping itself.
 *
 * Always returns a body with at least one paragraph, because the editor needs
 * somewhere to put a caret and an "imported successfully, nothing on screen"
 * is the worst outcome available.
 */
export function docxHtmlToBody(html: string, options: DocxMapOptions = {}): DocxImportResult {
  const resolved: Required<DocxMapOptions> = { detectNumbering: options.detectNumbering ?? true }
  const notices = new Notices()
  const content: BodyNode[] = []
  blocksFrom(parseHtml(html), notices, resolved, content)
  const kept = content.filter((node) => !isEmptyBlock(node))
  return {
    body: kept.length > 0 ? { type: 'doc', content: kept } : emptyBody(),
    notices: notices.list(),
  }
}

const isEmptyBlock = (node: BodyNode): boolean =>
  (node.type === 'paragraph' || node.type === 'numberedPara') &&
  textOfNodes(node.content ?? []).trim().length === 0 &&
  (node.content ?? []).every((child) => child.type === 'text')

// --------------------------------------------------------------- OOXML scan

export interface DocxScan {
  /** Insertions and deletions marked in the file. Both mean "accept all ran". */
  trackedChanges: number
  mergedCells: number
  pageBreaks: number
  footnotes: number
  /** Section columns > 1 — a two-column Word document, which we flatten. */
  columns: number
}

const countMatches = (xml: string, pattern: RegExp): number => (xml.match(pattern) ?? []).length

/**
 * What `word/document.xml` says that the HTML cannot.
 *
 * Counting with regular expressions over XML is normally a mistake and is the
 * right tool here: these five facts are each a distinct element name in a
 * namespace nothing else in the part uses, none of them nests, and the
 * alternative is an XML parser this directory would then own. The counts are
 * used only to raise a notice — nothing is placed by position — so an over-count
 * on a pathological file costs an officer one extra sentence of warning.
 */
export function scanDocumentXml(xml: string): DocxScan {
  return {
    trackedChanges: countMatches(xml, /<w:(ins|del)\b/g),
    mergedCells: countMatches(xml, /<w:(gridSpan|vMerge)\b/g),
    pageBreaks: countMatches(xml, /<w:br\b[^>]*w:type="page"/g),
    footnotes: countMatches(xml, /<w:footnoteReference\b/g),
    columns: countMatches(xml, /<w:cols\b[^>]*w:num="(?!1")/g),
  }
}

/** The scan as notices, so the import screen has one list to render. */
export function noticesFromScan(scan: DocxScan): ImportNotice[] {
  const notices = new Notices()
  if (scan.trackedChanges > 0) notices.add('tracked-changes', undefined, scan.trackedChanges)
  if (scan.mergedCells > 0) notices.add('merged-cells', undefined, scan.mergedCells)
  if (scan.footnotes > 0) notices.add('footnotes', undefined, scan.footnotes)
  if (scan.columns > 0) notices.add('columns', undefined, scan.columns)
  return notices.list()
}

// -------------------------------------------------------- headers / footers

/**
 * The text of a `word/header*.xml` or `word/footer*.xml` part, one line per
 * paragraph.
 *
 * `<w:t>` runs are concatenated within a paragraph and split between them,
 * which is what a letterhead is: three or four lines, each a run of runs. A
 * `<w:tab/>` becomes a space rather than a tab — a letterhead line pasted into
 * a text field should not carry a tab an officer cannot see.
 */
export function partLines(xml: string): string[] {
  const lines: string[] = []
  for (const paragraph of xml.split(/<w:p[\s>]/).slice(1)) {
    let text = ''
    for (const match of paragraph.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/>/g)) {
      text += match[1] === undefined ? ' ' : decodeXml(match[1])
    }
    const trimmed = text.replace(/\s+/g, ' ').trim()
    if (trimmed) lines.push(trimmed)
  }
  return lines
}

const decodeXml = (text: string): string =>
  text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (whole, code: string) => {
      const value = Number(code)
      return value > 0 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff)
        ? String.fromCodePoint(value)
        : whole
    })
    .replace(/&amp;/g, '&')

/**
 * Every header and footer part, as lines, for review.
 *
 * They are OFFERED, never applied: a header may be a page number, a
 * confidentiality stamp or a letterhead, and only the officer knows which.
 * `PAGE`/`NUMPAGES` field results are dropped — a literal "1" imported into a
 * letterhead field is the sort of thing nobody notices until it prints on
 * every page.
 */
/**
 * Whether a line is a page-number field and nothing else.
 *
 * `PAGE`/`NUMPAGES` fields arrive as their last computed RESULT — "Page 1 of 2"
 * — and a literal "1" imported into a letterhead field is the sort of thing
 * nobody notices until it prints on every page. The test is subtractive: take
 * away the words a page number is made of and the digits, and if nothing is
 * left, that is all it was. Both languages, because a Hindi footer says
 * "पृष्ठ 1 में से 2".
 */
const PAGE_WORDS = /\b(?:page|of|pages)\b|पृष्ठ|में\s*से|कुल/gi

export function isPageField(line: string): boolean {
  return line.replace(PAGE_WORDS, '').replace(/[\d\s/\u0966-\u096F.,:-]+/g, '') === ''
}

export function headerFooterLines(parts: Map<string, string>): { header: string[]; footer: string[] } {
  const gather = (prefix: string): string[] => {
    const out: string[] = []
    for (const name of [...parts.keys()].sort()) {
      if (!name.startsWith(`word/${prefix}`) || !name.endsWith('.xml')) continue
      for (const line of partLines(parts.get(name) ?? '')) {
        if (isPageField(line)) continue
        if (!out.includes(line)) out.push(line)
      }
    }
    return out.slice(0, 8)
  }
  return { header: gather('header'), footer: gather('footer') }
}

/** The plain text of a mapped body — what `extractMeta` reads. */
export function bodyText(body: BodyDoc): string {
  const lines: string[] = []
  const walk = (node: BodyNode, into: string[]): void => {
    if (node.type === 'text') {
      const last = into.length - 1
      into[last] = (into[last] ?? '') + (node.text ?? '')
      return
    }
    if (node.type === 'hardBreak') {
      into.push('')
      return
    }
    const block =
      node.type === 'paragraph' ||
      node.type === 'numberedPara' ||
      node.type === 'heading' ||
      node.type === 'listItem' ||
      node.type === 'tableCell' ||
      node.type === 'tableHeader'
    if (block) into.push('')
    for (const child of node.content ?? []) walk(child, into)
  }
  for (const node of body.content ?? []) walk(node, lines)
  return lines
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
}

/** The raw text of an HTML fragment, for a quick "is there anything here". */
export const htmlPlainText = (html: string): string => htmlText(parseHtml(html)).trim()
