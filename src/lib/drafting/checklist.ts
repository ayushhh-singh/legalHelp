import { countWords } from './format'

import type { ChecklistResult, Lang, RenderResult } from './types'
import type { ChecklistRule, DocTemplate } from '@/modules/drafting/schema'

/**
 * The checklist, evaluated against the rendered document rather than against
 * the form.
 *
 * Each item in a template's `checklist` carries a declarative rule, and this
 * file is the only place any of them is implemented. That split is the point:
 * "an Office Memorandum is written in the third person" is a claim about the
 * manual and lives in `data/drafting/templates/office-memorandum.json` with
 * its paragraph reference; "third person means no first-person pronouns in the
 * body" is a claim about text and lives here.
 *
 * An unknown rule kind throws. A checklist item that silently passed because
 * nobody implemented its rule would be worse than no checklist at all.
 */

/** First-person pronouns, tokenised — Hindi needs the whole word, not a substring. */
const FIRST_PERSON: Record<Lang, ReadonlySet<string>> = {
  en: new Set(['i', 'we', 'me', 'us', 'my', 'our', 'mine', 'ours', 'myself', 'ourselves']),
  hi: new Set([
    'मैं',
    'मैंने',
    'मुझे',
    'मुझको',
    'मेरा',
    'मेरी',
    'मेरे',
    'हम',
    'हमने',
    'हमें',
    'हमको',
    'हमारा',
    'हमारी',
    'हमारे',
  ]),
}

/**
 * Words, split so that a Hindi pronoun is matched whole. `\b` does not do this
 * for Devanagari — `अहम` would otherwise read as `हम`.
 */
function tokens(text: string, lang: Lang): string[] {
  return lang === 'hi'
    ? text.split(/[^ऀ-ॿ]+/u).filter(Boolean)
    : text
        .toLowerCase()
        .split(/[^a-z]+/u)
        .filter(Boolean)
}

const hasFirstPerson = (text: string, lang: Lang): boolean =>
  tokens(text, lang).some((word) => FIRST_PERSON[lang].has(word))

/** Words that say a document has something attached. */
const ENCLOSURE_MENTION: Record<Lang, RegExp> = {
  en: /\b(enclos\w*|annexure|appended|attached herewith)\b/i,
  hi: /(संलग्न|अनुलग्नक|इसके साथ)/,
}

/** Cues that the document is asking someone for something. */
const ASKING: Record<Lang, RegExp> = {
  en: /\b(may be sent|may be furnished|are requested|is requested|please furnish|compliance report|comments)\b/i,
  hi: /(भेज|अपेक्षित|उपलब्ध कराएँ|अनुपालन|टिप्पणियाँ|प्रस्तुत कर)/,
}

/** A date in the running text, in either script. */
const DATE_IN_TEXT = /(?:\d{1,2}[.\-/]\d{1,2}[.\-/]\d{4})|(?:[०-९]{1,2}[.\-/][०-९]{1,2}[.\-/][०-९]{4})/

function textOf(result: RenderResult, role?: string): string {
  const blocks = result.document.blocks.filter((block) => !role || block.role === role)
  return blocks.flatMap((block) => block.lines).join('\n')
}

const isEmpty = (value: string | string[] | undefined): boolean =>
  value === undefined || (Array.isArray(value) ? value.length === 0 : value.trim().length === 0)

/**
 * Paragraph numbering, read back off the rendered text rather than trusted.
 *
 * The block says `numberFrom`; this checks that what came out matches — the
 * first paragraph unnumbered and the rest running 2, 3, 4 without a gap, or
 * every paragraph numbered from 1.
 *
 * It reads the **one block** the numbering belongs to, found by its layout
 * index, and not `document.paras`. A template may have more than one `body`
 * block: the tour programme has its paragraphs and then its itinerary, which is
 * a separate list starting again at 1, and checking the concatenation of the
 * two would fail a document that is perfectly correct.
 */
function paraNumberingHolds(result: RenderResult, template: DocTemplate): boolean {
  const lang = result.document.lang
  const index = template.layout[lang].findIndex((block) => block.role === 'body' && block.numbered)
  if (index === -1) return true

  const layout = template.layout[lang][index]
  const rendered = result.document.blocks.find((block) => block.layoutIndex === index)
  if (!layout || !rendered) return false

  // A lead line is the block's heading, not its first paragraph.
  //
  // `nodes` is present when the body came from the document editor rather than
  // from a `paras` textarea (ADR-041 §3), and it is read here for a reason the
  // legacy path never had: an editor body may contain a heading, a list item, a
  // quotation or a table row, and NONE of those is a numbered paragraph. Over
  // `lines` alone those are indistinguishable from a paragraph that lost its
  // number, so a perfectly correct document with a "Grounds of appeal" heading
  // in it would fail this rule. Where there are no `nodes` — every draft of the
  // fourteen original forms — the behaviour is exactly what it was.
  const paras = rendered.nodes
    ? rendered.nodes
        .filter((node) => node.kind === 'para')
        .map((node) => `${node.marker}${node.runs.map((run) => run.text).join('')}`)
        .filter((line) => line.trim().length > 0)
    : layout.lead
      ? rendered.lines.slice(1)
      : rendered.lines
  if (paras.length === 0) return false

  const from = layout.numberFrom ?? 2
  return paras.every((para, position) => {
    const number = position + 1
    const match = /^([0-9]+|[०-९]+)\.\s/u.exec(para)
    if (number < from) return match === null
    if (!match) return false
    const digits = (match[1] ?? '').replace(/[०-९]/g, (digit) => String(digit.charCodeAt(0) - 0x0966))
    return Number(digits) === number
  })
}

function evaluateRule(rule: ChecklistRule, template: DocTemplate, result: RenderResult): boolean {
  const lang = result.document.lang
  const { resolved } = result

  switch (rule.kind) {
    case 'required':
      return !isEmpty(resolved[rule.field ?? ''])

    case 'allRequired':
      return (rule.fields ?? []).every((id) => !isEmpty(resolved[id]))

    case 'listNonEmpty': {
      const value = resolved[rule.field ?? '']
      return Array.isArray(value) ? value.length > 0 : !isEmpty(value)
    }

    case 'blockPresent':
      return result.document.blocks.some((block) => block.role === rule.role && block.filled)

    case 'contains': {
      const needle = rule.text?.[lang] ?? ''
      return needle.length > 0 && textOf(result, rule.role).toLowerCase().includes(needle.toLowerCase())
    }

    case 'regex':
      return new RegExp(rule.pattern ?? '', 'iu').test(textOf(result, rule.role))

    case 'regexAbsent':
      return !new RegExp(rule.pattern ?? '', 'iu').test(textOf(result, rule.role))

    case 'paraNumbering':
      return paraNumberingHolds(result, template)

    case 'noPlaceholders':
      return !/\{\{[a-zA-Z]/.test(textOf(result))

    case 'person': {
      const body = textOf(result, 'body')
      return rule.value === 'first' ? hasFirstPerson(body, lang) : !hasFirstPerson(body, lang)
    }

    case 'enclosuresConsistent': {
      const mentioned = ENCLOSURE_MENTION[lang].test(textOf(result, 'body'))
      return !mentioned || result.document.enclosures.length > 0
    }

    case 'maxWords':
      return countWords(textOf(result, rule.role)) <= (rule.count ?? Number.POSITIVE_INFINITY)

    case 'replyDate': {
      const body = textOf(result, 'body')
      return !ASKING[lang].test(body) || DATE_IN_TEXT.test(body)
    }

    default: {
      // Exhaustive: a rule kind added to the schema and not to this switch is a
      // build error here and a thrown error at runtime, never a silent pass.
      const unreachable: never = rule.kind
      throw new Error(`unimplemented checklist rule: ${String(unreachable)}`)
    }
  }
}

/**
 * Every checklist item, in the template's order, marked pass or fail against
 * the document as rendered. Labels come back in the document's own language.
 */
export function evaluateChecklist(template: DocTemplate, result: RenderResult): ChecklistResult[] {
  const lang = result.document.lang
  return template.checklist.map((item) => ({
    id: item.id,
    label: item.label[lang],
    why: item.why[lang],
    severity: item.severity,
    ...(item.csmopRef ? { csmopRef: item.csmopRef } : {}),
    passed: evaluateRule(item.rule, template, result),
  }))
}

/** How many of the `must` items are still failing — the number to show. */
export function countFailures(results: ChecklistResult[]): { must: number; should: number } {
  return {
    must: results.filter((item) => !item.passed && item.severity === 'must').length,
    should: results.filter((item) => !item.passed && item.severity === 'should').length,
  }
}
