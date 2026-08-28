import { countWords, formatDate, itemMarker, paraMarker, parseDate } from './format'

import type {
  BilingualRenderResult,
  BlockPair,
  DraftValues,
  FieldValue,
  Lang,
  RenderOptions,
  RenderResult,
  RenderedBlock,
  DocumentModel,
  ValidationIssue,
} from './types'
import type { DocTemplate, LayoutBlock, TemplateField } from '@/modules/drafting/schema'

/**
 * The drafting engine: a template plus an officer's values, rendered into a
 * structured document.
 *
 * Pure. No React, no Dexie, no clock, no dataset import — the template is an
 * argument, exactly as the pay engine takes its tables (ADR-018). That is what
 * lets the unit suite render all fourteen committed templates off disk, and
 * what will let an AI tool render one without pulling the UI in behind it.
 *
 * The engine knows about **block roles**, never about document types. There is
 * no branch here for an Office Memorandum: the O.M. is a list of blocks in
 * `data/drafting/templates/office-memorandum.json`, and a fifteenth form is a
 * fifteenth JSON file. Anything that would need a branch here — 'the first
 * paragraph of an O.M. is unnumbered but an I.D. note starts at 1' — is a
 * field on the block instead (`numberFrom`).
 *
 * Three behaviours are the engine's own rather than the data's, because each
 * is a rule about documents and not about one form:
 *
 *  - **Paragraph numbering.** The Appendix 8.1 specimens leave the first
 *    paragraph unnumbered and number from 2; a note and an I.D. note number
 *    from 1. `numberFrom` picks, the engine counts.
 *  - **The enclosure line.** A block that lists enclosures gets
 *    `Encl.: as above (3)` appended — CSMOP 9.2(vii) wants the count at the
 *    bottom left, and nobody remembers to type it.
 *  - **Dates.** A `date` field is normalised to dd.mm.yyyy however it was
 *    typed, and to Devanagari digits in Hindi when the reader asks for them.
 */

const ENCLOSURE_LINE: Record<Lang, (count: number) => string> = {
  en: (count) => `Encl.: as above (${count})`,
  hi: (count) => `संलग्नक : उपर्युक्तानुसार (${count})`,
}

const PLACEHOLDER = /\{\{([a-zA-Z][a-zA-Z0-9]*)\}\}/g

const MESSAGES = {
  required: (label: { en: string; hi: string }) => ({
    en: `${label.en} is required.`,
    hi: `${label.hi} आवश्यक है।`,
  }),
  dateFormat: (label: { en: string; hi: string }, value: string) => ({
    en: `${label.en}: "${value}" is not a date. Use dd.mm.yyyy or yyyy-mm-dd.`,
    hi: `${label.hi}: "${value}" कोई दिनांक नहीं है। dd.mm.yyyy या yyyy-mm-dd का प्रयोग करें।`,
  }),
  unknownField: (id: string) => ({
    en: `The layout refers to a field "${id}" that this template does not define.`,
    hi: `लेआउट ऐसे फ़ील्ड "${id}" का उल्लेख करता है जो इस टेम्पलेट में परिभाषित नहीं है।`,
  }),
  unknownOption: (label: { en: string; hi: string }, value: string) => ({
    en: `${label.en}: "${value}" is not one of the choices.`,
    hi: `${label.hi}: "${value}" दिए गए विकल्पों में नहीं है।`,
  }),
  tooLong: (label: { en: string; hi: string }, limit: number) => ({
    en: `${label.en} runs past ${limit} words.`,
    hi: `${label.hi} ${limit} शब्दों से अधिक है।`,
  }),
}

const emptyFor = (field: TemplateField): string | string[] =>
  field.type === 'list' || field.type === 'paras' ? [] : ''

/**
 * The template's worked example as a set of values.
 *
 * Every template can be rendered from this alone, with no unresolved
 * placeholder and no validation issue — `tests/drafting-data.test.ts` asserts
 * it for all fourteen. It is what a "fill with the example" control hands the
 * engine, and it is deliberately something a caller has to ask for: rendering
 * an empty form used to fall back to the samples field by field, which meant a
 * form with one field filled in produced a complete document signed by
 * "(A.B.C.)" with a specimen telephone number and **no issue reported**.
 */
export function sampleValues(template: DocTemplate): DraftValues {
  return Object.fromEntries(template.fields.map((field) => [field.id, field.sample]))
}

/** One field's value in one language, as a string or a list of strings. */
function valueFor(field: TemplateField, values: DraftValues, lang: Lang): string | string[] {
  const raw: FieldValue | undefined = values[field.id]
  if (raw === undefined) return emptyFor(field)
  if (typeof raw === 'string' || Array.isArray(raw)) return raw
  const picked = raw[lang]
  if (picked !== undefined) return picked
  // A value typed in one language only is still the officer's value: showing it
  // in both columns beats showing an empty box beside it.
  const other = raw[lang === 'en' ? 'hi' : 'en']
  return other ?? emptyFor(field)
}

const asList = (value: string | string[]): string[] =>
  (Array.isArray(value) ? value : value.split('\n')).map((item) => item.trim()).filter(Boolean)

const asText = (value: string | string[]): string => (Array.isArray(value) ? value.join('\n') : value)

const isEmpty = (value: string | string[]): boolean =>
  Array.isArray(value) ? value.length === 0 : value.trim().length === 0

/**
 * Resolve every field once, in this language: dates normalised, select values
 * turned into their label, everything else as typed. Issues are collected here
 * so a value is validated once however many blocks mention it.
 */
function resolveValues(
  template: DocTemplate,
  values: DraftValues,
  lang: Lang,
  options: RenderOptions,
): { resolved: Record<string, string | string[]>; issues: ValidationIssue[] } {
  const resolved: Record<string, string | string[]> = {}
  const issues: ValidationIssue[] = []

  for (const field of template.fields) {
    let value = valueFor(field, values, lang)

    // A list is normalised to exactly what will render. `asList` drops blank
    // items, so a box the officer emptied arrives here as [''] from a textarea
    // and renders as nothing — while `resolved` still looked non-empty, which
    // meant a required list reported no issue and `listNonEmpty` passed over a
    // list with nothing in it. `resolved` is what the checklist reads, so it
    // has to agree with the page.
    if (field.type === 'list' || field.type === 'paras') value = asList(value)

    if (field.type === 'date' && !Array.isArray(value) && value.trim()) {
      if (parseDate(value)) {
        value = formatDate(value, lang, options.devanagariDigits)
      } else {
        issues.push({
          code: 'date-format',
          field: field.id,
          message: MESSAGES.dateFormat(field.label, value),
        })
      }
    }

    if (field.type === 'select' && !Array.isArray(value) && value.trim()) {
      const option = field.options?.find((choice) => choice.value === value)
      if (option) {
        // "none" is a real choice meaning "no urgency grading"; it renders as
        // nothing so the block drops out rather than printing the word None.
        value = option.value === 'none' ? '' : option.label[lang]
      } else {
        issues.push({
          code: 'unknown-option',
          field: field.id,
          message: MESSAGES.unknownOption(field.label, value),
        })
      }
    }

    if (field.required && isEmpty(value)) {
      issues.push({ code: 'required', field: field.id, message: MESSAGES.required(field.label) })
    }

    if (field.maxWords && countWords(asText(value)) > field.maxWords) {
      issues.push({
        code: 'too-long',
        field: field.id,
        message: MESSAGES.tooLong(field.label, field.maxWords),
      })
    }

    resolved[field.id] = value
  }

  return { resolved, issues }
}

/** Substitute `{{field}}`; an unknown field is left visible and reported. */
function substitute(
  line: string,
  resolved: Record<string, string | string[]>,
  seen: { used: string[]; unknown: string[] },
): string {
  return line.replace(PLACEHOLDER, (match, id: string) => {
    if (!(id in resolved)) {
      seen.unknown.push(id)
      return match
    }
    seen.used.push(id)
    return asText(resolved[id] ?? '')
  })
}

function renderBlock(
  block: LayoutBlock,
  layoutIndex: number,
  resolved: Record<string, string | string[]>,
  lang: Lang,
  options: RenderOptions,
  issues: ValidationIssue[],
): RenderedBlock | null {
  const align = block.align ?? 'left'
  const emphasis = block.emphasis ?? 'normal'
  const lines: string[] = []
  const seen = { used: [] as string[], unknown: [] as string[] }
  let filled: boolean

  if (block.source) {
    const items = asList(resolved[block.source] ?? [])
    if (block.lead) lines.push(substitute(block.lead, resolved, seen))

    if (block.numbered) {
      // The Appendix 8.1 specimens leave paragraph 1 unnumbered and number
      // from 2; a note and an I.D. note number every paragraph from 1.
      const from = block.numberFrom ?? 2
      items.forEach((item, index) => {
        const number = index + 1
        lines.push(`${paraMarker(number >= from ? number : null, lang, options.devanagariDigits)}${item}`)
      })
    } else {
      const prefix = block.itemPrefix ?? 'none'
      items.forEach((item, index) => {
        lines.push(`${itemMarker(prefix, index, lang, options.devanagariDigits)}${item}`)
      })
    }

    if (block.role === 'enclosures' && items.length > 0) lines.push(ENCLOSURE_LINE[lang](items.length))
    filled = items.length > 0
  } else {
    for (const line of block.lines ?? []) {
      const hasPlaceholder = PLACEHOLDER.test(line)
      PLACEHOLDER.lastIndex = 0

      // A value typed across several lines — an addressee, an address — is
      // several lines of the document, not one line with newlines in it. Split
      // it here or every consumer has to: `align` pads against `line.length`,
      // which would count the newline and the second line's characters, and
      // `wrap` would break the first line in the wrong place.
      for (const part of substitute(line, resolved, seen).split('\n')) {
        // Trailing space is what an empty placeholder leaves behind — "No. "
        // where a file number should be — and it survives into a .docx.
        const text = part.replace(/\s+$/u, '')
        // A line that was nothing but a placeholder for an empty value would
        // print as blank; drop it and keep the ones that still say something.
        if (text.trim() || !hasPlaceholder) lines.push(text)
      }
    }
    // A block with no placeholders at all — "Sir / Madam," — is always filled.
    filled = seen.used.length === 0 || seen.used.some((id) => !isEmpty(resolved[id] ?? ''))
  }

  for (const id of new Set(seen.unknown)) {
    issues.push({ code: 'unknown-field', field: id, message: MESSAGES.unknownField(id) })
  }

  if (!filled && block.omitWhenEmpty) return null
  if (lines.length === 0) return null
  return { role: block.role, layoutIndex, align, emphasis, lines, filled }
}

const linesOf = (blocks: RenderedBlock[], role: string): string[] =>
  blocks.filter((block) => block.role === role && block.filled).flatMap((block) => block.lines)

const firstOf = (blocks: RenderedBlock[], role: string): string | null => linesOf(blocks, role)[0] ?? null

function toModel(template: DocTemplate, lang: Lang, blocks: RenderedBlock[]): DocumentModel {
  const bodyBlocks = blocks.filter((block) => block.role === 'body' && block.filled)
  return {
    templateId: template.id,
    lang,
    urgency: firstOf(blocks, 'urgency'),
    header: linesOf(blocks, 'header'),
    title: firstOf(blocks, 'title'),
    refLine: linesOf(blocks, 'refLine').join('\n') || null,
    subject: firstOf(blocks, 'subject'),
    paras: bodyBlocks.flatMap((block) => block.lines),
    closing: firstOf(blocks, 'closing'),
    signature: linesOf(blocks, 'signature'),
    enclosures: linesOf(blocks, 'enclosures'),
    copyTo: linesOf(blocks, 'copyTo'),
    blocks,
  }
}

/** Render one language. */
export function renderDocument(
  template: DocTemplate,
  values: DraftValues,
  lang: Lang,
  options: RenderOptions = {},
): RenderResult {
  const { resolved, issues } = resolveValues(template, values, lang, options)
  const blocks: RenderedBlock[] = []

  for (const [layoutIndex, block] of template.layout[lang].entries()) {
    const rendered = renderBlock(block, layoutIndex, resolved, lang, options, issues)
    if (rendered) blocks.push(rendered)
  }

  return { document: toModel(template, lang, blocks), issues, resolved }
}

/**
 * Render both, and pair the blocks for a side-by-side view.
 *
 * Pairing is by **layout index**, not by role. Roles repeat — a demi-official
 * letter has two `header` blocks (the writer's letterhead and the Government of
 * India block) and two `closing` blocks — and pairing by role put both headers
 * together at the position of the first, which moved `D.O. No.` below the
 * letterhead in the side-by-side view. The index is safe to pair on because
 * `drafting_seed.py` refuses to write a template whose two layouts place
 * different blocks in a different order.
 *
 * A block that drops out in one language only — an empty optional subject — is
 * paired with an empty counterpart rather than shifting everything below it.
 */
export function renderBilingual(
  template: DocTemplate,
  values: DraftValues,
  options: RenderOptions = {},
): BilingualRenderResult {
  const en = renderDocument(template, values, 'en', options)
  const hi = renderDocument(template, values, 'hi', options)

  const blank = (role: RenderedBlock['role'], layoutIndex: number): RenderedBlock => ({
    role,
    layoutIndex,
    align: 'left',
    emphasis: 'normal',
    lines: [],
    filled: false,
  })

  const at = (blocks: RenderedBlock[], index: number) => blocks.find((block) => block.layoutIndex === index)

  const pairs: BlockPair[] = []
  const indices = [
    ...new Set([...en.document.blocks, ...hi.document.blocks].map((block) => block.layoutIndex)),
  ]
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

/** `render(template, values, 'bilingual')` — the shape callers asked for. */
export function render(
  template: DocTemplate,
  values: DraftValues,
  lang: Lang,
  options?: RenderOptions,
): RenderResult
export function render(
  template: DocTemplate,
  values: DraftValues,
  lang: 'bilingual',
  options?: RenderOptions,
): BilingualRenderResult
export function render(
  template: DocTemplate,
  values: DraftValues,
  lang: Lang | 'bilingual',
  options: RenderOptions = {},
): RenderResult | BilingualRenderResult {
  return lang === 'bilingual'
    ? renderBilingual(template, values, options)
    : renderDocument(template, values, lang, options)
}

const DEFAULT_WIDTH = 78

/**
 * Greedy word wrap. A paragraph of an Office Memorandum is one string in the
 * data and one very long line without this; the A4 preview will wrap it in
 * CSS, but the plain text is what goes on the clipboard and into a .txt.
 * Continuation lines are indented under the paragraph number, so "2." keeps
 * its hanging indent.
 */
function wrap(line: string, width: number): string[] {
  if (line.length <= width) return [line]
  const indent = ' '.repeat((/^(\s*(?:[0-9०-९]+\.|\(?[ivx]+\)|•)\s+)/u.exec(line)?.[1] ?? '').length)
  const out: string[] = []
  let current = ''
  for (const word of line.split(' ')) {
    const candidate = current ? `${current} ${word}` : `${out.length === 0 ? '' : indent}${word}`
    if (candidate.length > width && current) {
      out.push(current)
      current = `${indent}${word}`
    } else {
      current = candidate
    }
  }
  if (current) out.push(current)
  return out
}

function align(line: string, how: 'left' | 'center' | 'right', width: number): string {
  if (how === 'left' || line.length >= width) return line
  const space = width - line.length
  return how === 'center' ? ' '.repeat(Math.floor(space / 2)) + line : ' '.repeat(space) + line
}

/**
 * The document as plain text — what goes on the clipboard, into a `.txt`, and
 * into a test snapshot. Centring and right-alignment are done with spaces
 * against a fixed width so the shape of the page survives the copy.
 */
export function serialise(document: DocumentModel, options: RenderOptions = {}): string {
  const width = options.width ?? DEFAULT_WIDTH
  return document.blocks
    .map((block) =>
      block.lines
        .flatMap((line) => (block.align === 'left' ? wrap(line, width) : [line]))
        .map((line) => align(block.emphasis === 'title' ? line.toUpperCase() : line, block.align, width))
        .join('\n'),
    )
    .join('\n\n')
    .replace(/[ \t]+$/gm, '')
    .concat('\n')
}

/** Both languages, one under the other, each headed by its own name. */
export function serialiseBilingual(result: BilingualRenderResult, options: RenderOptions = {}): string {
  return `${serialise(result.en.document, options)}\n${'-'.repeat(options.width ?? DEFAULT_WIDTH)}\n\n${serialise(
    result.hi.document,
    options,
  )}`
}
