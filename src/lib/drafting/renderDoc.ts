import { renderDocument } from './engine'
import { paraMarker, toDevanagariDigits } from './format'
import { bindings, type BodyDoc, type BodyNode, type OfficialDoc } from './model'

import type {
  BilingualRenderResult,
  BlockPair,
  DraftValues,
  Lang,
  RenderOptions,
  RenderResult,
  RenderedBlock,
  RenderedNode,
  RenderedRun,
} from './types'
import type { DocTemplate } from '@/modules/drafting/schema'

/**
 * The one renderer: an `OfficialDoc` and its template, in one language, as the
 * same `RenderResult` the form-based engine has always produced.
 *
 * ADR-041 §3 has the reasoning and it is worth restating here, because the
 * shape of this file is the decision. The obvious design was a new block type
 * for the new model. It was refused: `RenderedBlock`/`DocumentModel` is already
 * what `evaluateChecklist`, `serialise`, `docx.ts` and every one of the fourteen
 * committed `.txt` snapshots read, and a second block shape would have meant a
 * second checklist evaluator — two implementations of one grammar, which is the
 * thing ADR-039 §4 spent a whole Node script avoiding.
 *
 * So this file does two things and no more:
 *
 * 1. **It flattens the editor body into the template's own body field** and
 *    hands the whole thing to `renderDocument`. Every block of chrome — the
 *    file number, the Government of India block, the date line, the subject,
 *    the salutation, the signature, the copy-to list — is rendered by exactly
 *    the code that rendered it before, from exactly the same layout data. That
 *    is why "the editor is new" does not mean "every template's layout is
 *    untested".
 *
 * 2. **It attaches the rich projection** to the body block afterwards, and
 *    regenerates that block's `lines` FROM the projection so the two cannot
 *    disagree.
 *
 * Pure. No Tiptap import, no React, no clock — the body arrives as plain JSON,
 * which is the property `purity.test.ts` asserts by reading this file.
 */

// -------------------------------------------------------------- projection

const runsOf = (node: BodyNode): RenderedRun[] => {
  const out: RenderedRun[] = []
  for (const child of node.content ?? []) {
    if (child.type === 'text') {
      const marks = new Set((child.marks ?? []).map((mark) => mark.type))
      out.push({
        text: child.text ?? '',
        ...(marks.has('bold') ? { bold: true } : {}),
        ...(marks.has('italic') ? { italic: true } : {}),
        ...(marks.has('underline') ? { underline: true } : {}),
      })
    } else if (child.type === 'placeholder') {
      const field = typeof child.attrs?.field === 'string' ? child.attrs.field : ''
      // The text is the literal `{{field}}`, not a blank and not a dash. That
      // is what `checklist.ts`'s `noPlaceholders` rule matches (`/\{\{[a-zA-Z]/`,
      // a `must` on ten of the fourteen forms) and what `ExportBar` refuses —
      // an unfilled field has to be visible in the plain text, or the one rule
      // stopping a document going out with a hole in it stops seeing it.
      out.push({ text: `{{${field}}}`, placeholder: field })
    } else if (child.type === 'hardBreak') {
      out.push({ text: ' ' })
    } else {
      out.push(...runsOf(child))
    }
  }
  return out
}

const textOfRuns = (runs: RenderedRun[]): string => runs.map((run) => run.text).join('')

const ROMAN_LOWER = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'xi', 'xii']

interface Counters {
  /** The running paragraph number for `numberedPara` at each depth. */
  para: number[]
  lang: Lang
  devanagariDigits: boolean
}

const digits = (value: string, counters: Counters): string =>
  counters.lang === 'hi' && counters.devanagariDigits ? toDevanagariDigits(value) : value

/**
 * The number in front of a `numberedPara`, and the renumbering that makes it
 * automatic.
 *
 * `attrs.level` is 1 for a top-level paragraph and 2 for a sub-paragraph, and
 * the marker is `2.` or `2.1` accordingly — the form CSMOP's own specimens use.
 * The counters live here rather than on the node, so moving a paragraph in the
 * editor renumbers everything below it with no edit to the stored document at
 * all. `attrs.number` is deliberately NOT read: a number stored on a node is a
 * number that goes stale the first time a paragraph is deleted.
 */
function numberFor(node: BodyNode, counters: Counters): string {
  const raw = node.attrs?.level
  const level = raw === 2 || raw === 3 ? raw : 1
  while (counters.para.length < level) counters.para.push(0)
  counters.para.length = level
  counters.para[level - 1] = (counters.para[level - 1] ?? 0) + 1
  const parts = counters.para.slice(0, level).map((n) => String(n))
  return `${digits(parts.join('.'), counters)}. `
}

function projectList(
  node: BodyNode,
  ordered: boolean,
  depth: number,
  counters: Counters,
  out: RenderedNode[],
): void {
  ;(node.content ?? []).forEach((item, index) => {
    const [first, ...rest] = item.content ?? []
    const marker = ordered
      ? depth === 0
        ? `${digits(String(index + 1), counters)}. `
        : `(${ROMAN_LOWER[index] ?? String(index + 1)}) `
      : '• '
    out.push({ kind: 'listItem', marker, depth, runs: first ? runsOf(first) : [] })
    for (const child of rest) {
      if (child.type === 'bulletList' || child.type === 'orderedList') {
        projectList(child, child.type === 'orderedList', depth + 1, counters, out)
      } else {
        out.push({ kind: 'listItem', marker: '', depth: depth + 1, runs: runsOf(child) })
      }
    }
  })
}

/** The editor body as a flat list of drawable nodes, numbered as it goes. */
export function projectBody(body: BodyDoc, lang: Lang, options: RenderOptions = {}): RenderedNode[] {
  const counters: Counters = { para: [], lang, devanagariDigits: options.devanagariDigits ?? false }
  const out: RenderedNode[] = []

  for (const node of body.content ?? []) {
    switch (node.type) {
      case 'numberedPara': {
        const marker = numberFor(node, counters)
        const align = node.attrs?.textAlign
        out.push({
          kind: 'para',
          marker,
          align: align === 'center' || align === 'right' ? align : 'left',
          runs: runsOf(node),
        })
        break
      }
      case 'paragraph': {
        const align = node.attrs?.textAlign
        out.push({
          kind: 'para',
          marker: '',
          align: align === 'center' || align === 'right' ? align : 'left',
          runs: runsOf(node),
        })
        break
      }
      case 'heading': {
        const raw = node.attrs?.level
        const level = raw === 2 ? 2 : raw === 3 ? 3 : 1
        out.push({ kind: 'heading', level, runs: runsOf(node) })
        break
      }
      case 'blockquote': {
        for (const child of node.content ?? []) out.push({ kind: 'quote', runs: runsOf(child) })
        break
      }
      case 'bulletList':
      case 'orderedList':
        projectList(node, node.type === 'orderedList', 0, counters, out)
        break
      case 'table': {
        const rows = (node.content ?? []).map((row) => {
          const cells = (row.content ?? []).map((cell) =>
            (cell.content ?? []).flatMap((paragraph) => runsOf(paragraph)),
          )
          return { header: (row.content ?? []).every((cell) => cell.type === 'tableHeader'), cells }
        })
        out.push({ kind: 'table', rows })
        break
      }
      case 'pageBreak':
        out.push({ kind: 'pageBreak' })
        break
      default:
        break
    }
  }
  return out
}

/**
 * The plain-text projection of a rendered node.
 *
 * Everything that has always read `lines` goes on reading `lines`, so this is
 * where a table becomes something a `.txt` snapshot and a checklist regex can
 * see. Cells are joined with a tab, which is what a plain-text table is.
 */
export function linesOfNodes(nodes: RenderedNode[]): string[] {
  const out: string[] = []
  for (const node of nodes) {
    switch (node.kind) {
      case 'para':
        out.push(`${node.marker}${textOfRuns(node.runs)}`)
        break
      case 'heading':
        out.push(textOfRuns(node.runs))
        break
      case 'listItem':
        out.push(`${'  '.repeat(node.depth)}${node.marker}${textOfRuns(node.runs)}`)
        break
      case 'quote':
        out.push(`    ${textOfRuns(node.runs)}`)
        break
      case 'table':
        for (const row of node.rows) out.push(row.cells.map((cell) => textOfRuns(cell)).join('\t'))
        break
      case 'pageBreak':
        break
    }
  }
  return out.filter((line) => line.trim().length > 0)
}

// ---------------------------------------------------------------- rendering

/**
 * The template's body field — the one the editor body replaces.
 *
 * Found from the LAYOUT rather than by guessing at a name, because that is the
 * block whose position on the page the body has to take. Every one of the
 * fourteen committed templates has exactly one numbered `body` block sourced
 * from a `paras` field; a template that has none (an endorsement is a single
 * fixed sentence) simply has no body to replace, and the editor is where its
 * covering text goes instead.
 */
export function bodyFieldOf(template: DocTemplate, lang: Lang): string | null {
  for (const block of template.layout[lang]) {
    if (block.role === 'body' && block.source) return block.source
  }
  return null
}

const bodyFor = (doc: OfficialDoc, lang: Lang): BodyDoc =>
  lang === 'hi' && doc.bodyHi ? doc.bodyHi : doc.body

/**
 * One language of an `OfficialDoc`, rendered.
 *
 * The body's plain text goes into the template's own body field, so
 * `renderDocument` numbers it, wraps it and places it exactly where the layout
 * says — and then the rich nodes are attached to the block that came back. The
 * markers are stripped before handing the lines over, because the layout block
 * carries `numbered: true` and would number them a second time.
 */
export function renderOfficialDoc(
  doc: OfficialDoc,
  template: DocTemplate,
  lang: Lang,
  options: RenderOptions = {},
): RenderResult {
  const values = bindings(doc, lang)
  const nodes = projectBody(bodyFor(doc, lang), lang, options)
  const field = bodyFieldOf(template, lang)

  const draftValues: DraftValues = { ...values }
  if (field) {
    // The layout numbers the paragraphs itself (`numberFrom`), so hand it the
    // text WITHOUT this projection's markers. Anything that is not an ordinary
    // paragraph — a heading, a list item, a table row — keeps its own marker,
    // because the layout has no numbering to apply to those and dropping it
    // would lose the structure from the plain text entirely.
    draftValues[field] = nodes.flatMap((node) =>
      node.kind === 'para' ? [textOfRuns(node.runs)].filter((line) => line.trim()) : linesOfNodes([node]),
    )
  }

  const result = renderDocument(template, draftValues, lang, options)
  if (!field) return result

  const index = template.layout[lang].findIndex((block) => block.role === 'body' && block.source === field)
  const blocks: RenderedBlock[] = result.document.blocks.map((block) =>
    block.layoutIndex === index ? withNodes(block, nodes, template, lang, options) : block,
  )
  return {
    ...result,
    document: {
      ...result.document,
      blocks,
      paras: blocks.flatMap((b) => (b.role === 'body' ? b.lines : [])),
    },
  }
}

/**
 * Attach the rich projection to the body block and regenerate its `lines`.
 *
 * The regenerated lines carry the layout's own paragraph numbering — the
 * `numberFrom` rule that leaves the first paragraph of a letter unnumbered and
 * numbers from 2, which `checklist.ts`'s `paraNumbering` rule reads back off
 * the rendered text. So the numbers in `lines` are the layout's and the numbers
 * in `nodes` are the editor's, and a `numberedPara` in the editor is what asks
 * for one at all.
 */
function withNodes(
  block: RenderedBlock,
  nodes: RenderedNode[],
  template: DocTemplate,
  lang: Lang,
  options: RenderOptions,
): RenderedBlock {
  const layout = template.layout[lang][block.layoutIndex]
  const lead = layout?.lead ? block.lines[0] : undefined
  const from = layout?.numberFrom ?? 2
  const devanagariDigits = options.devanagariDigits ?? false

  let paragraph = 0
  const numbered: RenderedNode[] = nodes.map((node) => {
    if (node.kind !== 'para' || textOfRuns(node.runs).trim() === '') return node
    paragraph += 1
    if (!layout?.numbered) return node
    return { ...node, marker: paraMarker(paragraph >= from ? paragraph : null, lang, devanagariDigits) }
  })

  const lines = linesOfNodes(numbered)
  return {
    ...block,
    nodes: numbered,
    lines: lead ? [lead, ...lines] : lines,
    filled: lines.length > 0,
  }
}

/** Both languages, paired the way `renderBilingual` pairs them — on layout index. */
export function renderOfficialDocBilingual(
  doc: OfficialDoc,
  template: DocTemplate,
  options: RenderOptions = {},
): BilingualRenderResult {
  const en = renderOfficialDoc(doc, template, 'en', options)
  const hi = renderOfficialDoc(doc, template, 'hi', options)

  const blank = (role: RenderedBlock['role'], layoutIndex: number): RenderedBlock => ({
    role,
    layoutIndex,
    align: 'left',
    emphasis: 'normal',
    lines: [],
    filled: false,
  })
  const at = (blocks: RenderedBlock[], index: number) => blocks.find((b) => b.layoutIndex === index)

  const pairs: BlockPair[] = []
  const indices = [...new Set([...en.document.blocks, ...hi.document.blocks].map((b) => b.layoutIndex))]
  for (const index of indices.sort((a, b) => a - b)) {
    const left = at(en.document.blocks, index)
    const right = at(hi.document.blocks, index)
    const role = (left ?? right)?.role
    if (!role) continue
    pairs.push({ role, layoutIndex: index, en: left ?? blank(role, index), hi: right ?? blank(role, index) })
  }

  return {
    en,
    hi,
    pairs,
    issues: [
      ...en.issues.map((issue) => ({ ...issue, lang: 'en' as const })),
      ...hi.issues.map((issue) => ({ ...issue, lang: 'hi' as const })),
    ],
  }
}
