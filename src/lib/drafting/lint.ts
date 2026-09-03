import { countWords, parseDate } from './format'
import { bindings, pick, placeholderFields, type OfficialDoc } from './model'

import type { Lang, RenderResult } from './types'
import type { DocTemplate } from '@/modules/drafting/schema'

/**
 * Format lint — the checks that are about **how a document is written**, beside
 * the checklist, which is about what CSMOP says a form must contain.
 *
 * The split is worth stating, because the two are easy to confuse and this file
 * exists rather than nine more rule kinds in `checklist.ts`:
 *
 * - A **checklist item** is a claim the template makes about itself, declared
 *   in `data/drafting/templates/*.json` with its CSMOP paragraph beside it, and
 *   evaluated by `checklist.ts`. "An Office Memorandum is written in the third
 *   person, 8.4(3)." It is per form, it is data, and it passes or it fails.
 * - A **lint finding** is a claim about writing that holds for every form and
 *   belongs to no paragraph of the manual on its own. "This paragraph is 140
 *   words long." "You wrote 3.2.2026 and today is 3.9.2026." It is code, it is
 *   graded, and most of it is advice rather than a bar.
 *
 * Three properties, all deliberate:
 *
 * 1. **`now` is an argument.** This file is pure and has no clock, which is
 *    what lets "the date is in the future" be tested at all rather than being
 *    a test that passes until January.
 * 2. **The glossary is an argument too**, for the reason the pay engine takes
 *    its tables as one: `data/glossary.json` is 970 KB behind a lazy import,
 *    and a pure function that reaches for a dataset puts the dataset in
 *    whatever chunk imports the function. With no terms supplied the
 *    terminology check reports NOTHING rather than passing — an absent dataset
 *    is not evidence of consistent vocabulary.
 * 3. **Nothing here rewrites anything.** Every terminology finding names the
 *    standard term and leaves the officer's Hindi alone. All 1,891 glossary
 *    entries carry `verify: true` (ADR-024), and a lint that silently corrected
 *    an officer's wording against an unverified list would be putting a
 *    compiled glossary above their judgement.
 */

export type LintSeverity = 'error' | 'warning' | 'hint'

export interface LintFinding {
  id: string
  severity: LintSeverity
  message: { en: string; hi: string }
  /** Which rule fired, for a test and for a "don't show me this again" later. */
  rule: LintRuleId
  /** The paragraph number this is about, when it is about one. */
  para?: number
  /** For a terminology hint: what was written, and what the glossary calls it. */
  suggestion?: { found: string; standard: string }
}

export const LINT_RULES = [
  'placeholders',
  'subject',
  'date',
  'references',
  'enclosures',
  'terminology',
  'paragraphLength',
  'passiveVoice',
] as const

export type LintRuleId = (typeof LINT_RULES)[number]

export interface GlossaryTerm {
  en: string
  hi: string
}

export interface LintInput {
  doc: OfficialDoc
  template: DocTemplate
  lang: Lang
  result: RenderResult
  /** ISO instant. Pure: this file has no clock of its own. */
  now: string
  /** Optional — see the note above about why an absent glossary reports nothing. */
  glossary?: readonly GlossaryTerm[]
  /** Words past which a paragraph is flagged. CSMOP 9.2(ii), quantified here. */
  maxParagraphWords?: number
}

const DEFAULT_MAX_PARA_WORDS = 120

const bodyText = (result: RenderResult): string =>
  result.document.blocks
    .filter((block) => block.role === 'body')
    .flatMap((block) => block.lines)
    .join('\n')

const bodyParagraphs = (result: RenderResult): string[] =>
  result.document.blocks
    .filter((block) => block.role === 'body')
    .flatMap((block) => block.lines)
    .filter((line) => line.trim().length > 0)

// ------------------------------------------------------------- individual rules

/** An unfilled `{{field}}` anywhere in the body. Blocks an export. */
function lintPlaceholders(input: LintInput): LintFinding[] {
  const body = input.lang === 'hi' && input.doc.bodyHi ? input.doc.bodyHi : input.doc.body
  const values = bindings(input.doc, input.lang)
  const fields = [...new Set(placeholderFields(body))]
  return fields.map((field) => ({
    id: `placeholders:${field}`,
    rule: 'placeholders' as const,
    // An error rather than a warning, and the one lint finding that is a bar:
    // `{{fileNumber}}` printed on a signed Office Memorandum is the failure
    // this whole layer exists to prevent.
    severity: 'error' as const,
    message: {
      en: `"${field}" has not been filled in.${field in values ? '' : ' It is not a field this form defines.'}`,
      hi: `"${field}" भरा नहीं गया है।${field in values ? '' : ' यह इस प्ररूप का कोई फ़ील्ड नहीं है।'}`,
    },
  }))
}

function lintSubject(input: LintInput): LintFinding[] {
  // An endorsement and a condolence D.O. carry no subject line at all — the
  // template says so by not placing a `subject` block, and asking for one there
  // would be asking for something the form does not have.
  //
  // A block marked `omitWhenEmpty` is the form saying the subject is OPTIONAL:
  // a demi-official letter drops the line rather than printing an empty
  // "Subject:", and CSMOP 8.4(2)'s specimen carries none. So the rule is "the
  // form places a subject line it always prints", not "the form mentions a
  // subject anywhere".
  const wanted = input.template.layout[input.lang].some(
    (block) => block.role === 'subject' && !block.omitWhenEmpty,
  )
  if (!wanted) return []
  if (pick(input.doc.meta.subject, input.lang).trim()) return []
  return [
    {
      id: 'subject',
      rule: 'subject',
      severity: 'error',
      message: {
        en: 'This form carries a subject line and it is empty.',
        hi: 'इस प्ररूप में विषय पंक्ति होती है और वह रिक्त है।',
      },
    },
  ]
}

/** `2026-13-40` is not a date, and `2027-01-01` is probably a typo in the year. */
function lintDate(input: LintInput): LintFinding[] {
  const raw = input.doc.meta.date.trim()
  if (!raw) {
    return [
      {
        id: 'date:missing',
        rule: 'date',
        severity: 'error',
        message: { en: 'The document has no date.', hi: 'दस्तावेज़ पर कोई दिनांक नहीं है।' },
      },
    ]
  }
  const parsed = parseDate(raw)
  if (!parsed) {
    return [
      {
        id: 'date:invalid',
        rule: 'date',
        severity: 'error',
        message: {
          en: `"${raw}" is not a date. Use dd.mm.yyyy or yyyy-mm-dd.`,
          hi: `"${raw}" कोई दिनांक नहीं है। dd.mm.yyyy या yyyy-mm-dd का प्रयोग करें।`,
        },
      },
    ]
  }
  // Compared as UTC days, not instants: a document dated today in India must
  // not read as "in the future" because the runner is in another timezone.
  const stamped = Date.UTC(parsed.year, parsed.month - 1, parsed.day)
  const today = new Date(input.now)
  const nowDay = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  if (stamped <= nowDay) return []
  return [
    {
      id: 'date:future',
      rule: 'date',
      // Declared-ahead is a real thing — an order taking effect on the 1st is
      // signed before it — so the flag turns the bar into a note rather than
      // removing the check. A typo in the year is far commoner than either.
      severity: input.doc.meta.futureDateIntended ? 'hint' : 'warning',
      message: input.doc.meta.futureDateIntended
        ? {
            en: 'This document is dated ahead, which you have marked as intended.',
            hi: 'यह दस्तावेज़ आगे की तिथि का है, जिसे आपने जानबूझकर चिह्नित किया है।',
          }
        : {
            en: 'The date is in the future. Check the year, or mark the date as intended.',
            hi: 'दिनांक भविष्य का है। वर्ष जाँचें, या दिनांक को अभीष्ट के रूप में चिह्नित करें।',
          },
    },
  ]
}

/** CSMOP 9.2(iv) — quote the number and date of the last communication. */
function lintReferences(input: LintInput): LintFinding[] {
  const out: LintFinding[] = []
  input.doc.meta.referenceLines.forEach((line, index) => {
    const hasNumber = line.number.trim().length > 0
    const hasDate = line.date.trim().length > 0
    if (hasNumber && hasDate && parseDate(line.date)) return
    if (!hasNumber && !hasDate) {
      out.push({
        id: `references:${line.id}`,
        rule: 'references',
        severity: 'warning',
        message: {
          en: `Reference ${index + 1} is empty. Remove it, or quote the number and date.`,
          hi: `संदर्भ ${index + 1} रिक्त है। इसे हटाएँ, या संख्या और दिनांक उद्धृत करें।`,
        },
      })
      return
    }
    out.push({
      id: `references:${line.id}`,
      rule: 'references',
      severity: 'warning',
      message: {
        en: `Reference ${index + 1} quotes ${hasNumber ? 'a number with no date' : 'a date with no number'}. CSMOP 9.2(iv) wants both.`,
        hi: `संदर्भ ${index + 1} में ${hasNumber ? 'संख्या है पर दिनांक नहीं' : 'दिनांक है पर संख्या नहीं'}। सीएसएमओपी 9.2(iv) दोनों चाहता है।`,
      },
    })
  })
  return out
}

const ENCLOSURE_MENTION: Record<Lang, RegExp> = {
  en: /\b(enclos\w*|annexure|appended|attached herewith|as at annex)\b/i,
  hi: /(संलग्न|अनुलग्नक|इसके साथ संलग्न)/,
}

/**
 * Both directions, which is the half `checklist.ts` does not do.
 *
 * `enclosuresConsistent` there answers "the text says there are enclosures and
 * none are listed". The other direction is just as wrong on paper and commoner
 * in practice: three papers listed at the bottom of a letter that never
 * mentions them leaves the reader guessing what they are for.
 */
function lintEnclosures(input: LintInput): LintFinding[] {
  const mentioned = ENCLOSURE_MENTION[input.lang].test(bodyText(input.result))
  const listed = input.doc.meta.enclosures.filter((item) => item.trim()).length

  if (mentioned && listed === 0) {
    return [
      {
        id: 'enclosures:missing',
        rule: 'enclosures',
        severity: 'error',
        message: {
          en: 'The text mentions an enclosure and none is listed. CSMOP 9.2(vii).',
          hi: 'पाठ में संलग्नक का उल्लेख है पर कोई सूचीबद्ध नहीं है। सीएसएमओपी 9.2(vii)।',
        },
      },
    ]
  }
  if (!mentioned && listed > 0) {
    return [
      {
        id: 'enclosures:unmentioned',
        rule: 'enclosures',
        severity: 'warning',
        message: {
          en: `${listed} enclosure${listed === 1 ? ' is' : 's are'} listed and the text never refers to ${listed === 1 ? 'it' : 'them'}.`,
          hi: `${listed} संलग्नक सूचीबद्ध ${listed === 1 ? 'है' : 'हैं'} पर पाठ में उनका कोई उल्लेख नहीं है।`,
        },
      },
    ]
  }
  return []
}

/**
 * A Hindi document using an English term the Rajbhasha glossary has a word for.
 *
 * Runs only in Hindi, only over the body, and only on a whole ASCII word of
 * four characters or more — "OM" and "RTI" are what officers actually write and
 * flagging them would make this noise. Every finding is a `hint`.
 */
function lintTerminology(input: LintInput): LintFinding[] {
  if (input.lang !== 'hi' || !input.glossary || input.glossary.length === 0) return []
  const text = bodyText(input.result)
  const words = new Set((text.match(/[A-Za-z][A-Za-z-]{3,}/g) ?? []).map((word) => word.toLowerCase()))
  if (words.size === 0) return []

  const out: LintFinding[] = []
  const seen = new Set<string>()
  for (const term of input.glossary) {
    const key = term.en.trim().toLowerCase()
    if (!key || seen.has(key) || !term.hi.trim()) continue
    // Single-word terms only. A multi-word English term inside Hindi prose
    // would need a phrase search over mixed script, and a partial match on
    // "office" inside "Office Memorandum" is worse than saying nothing.
    if (key.includes(' ') || !words.has(key)) continue
    seen.add(key)
    out.push({
      id: `terminology:${key}`,
      rule: 'terminology',
      severity: 'hint',
      message: {
        en: `"${term.en}" is written in English. The standard Hindi term is "${term.hi}".`,
        hi: `"${term.en}" अंग्रेज़ी में लिखा है। मानक हिंदी शब्द "${term.hi}" है।`,
      },
      suggestion: { found: term.en, standard: term.hi },
    })
    if (out.length >= 10) break
  }
  return out
}

/** CSMOP 9.2(ii) — "no lengthy sentences", quantified. */
function lintParagraphLength(input: LintInput): LintFinding[] {
  const limit = input.maxParagraphWords ?? DEFAULT_MAX_PARA_WORDS
  const out: LintFinding[] = []
  bodyParagraphs(input.result).forEach((para, index) => {
    const words = countWords(para)
    if (words <= limit) return
    out.push({
      id: `paragraphLength:${index}`,
      rule: 'paragraphLength',
      severity: 'warning',
      para: index + 1,
      message: {
        en: `Paragraph ${index + 1} runs to ${words} words. CSMOP 9.2(ii) asks for short paragraphs; consider splitting it.`,
        hi: `अनुच्छेद ${index + 1} में ${words} शब्द हैं। सीएसएमओपी 9.2(ii) संक्षिप्त अनुच्छेद चाहता है; इसे बाँटने पर विचार करें।`,
      },
    })
  })
  return out
}

/**
 * CSMOP 9.5(i), and the one lint rule that is about ONE form.
 *
 * The manual is unusually specific here: a demi-official letter says
 * *I notice*, not *It is noticed*; *I seek your cooperation*, not
 * *It is expedient*. So the impersonal passive is worth flagging in a D.O. and
 * is the correct register everywhere else — an Office Memorandum's whole
 * grammar is "The undersigned is directed to…", which this rule would be wrong
 * to complain about.
 */
const PASSIVE: Record<Lang, RegExp> = {
  en: /\b(it is (?:noticed|observed|felt|requested|expedient|considered|proposed|seen|understood)|it has been (?:noticed|observed|decided|felt)|it may be (?:mentioned|added|stated))\b/gi,
  hi: /(यह देखा गया|यह पाया गया|यह अनुभव किया गया|यह समीचीन|ऐसा समझा गया)/g,
}

function lintPassiveVoice(input: LintInput): LintFinding[] {
  if (input.template.person !== 'first' || !isDemiOfficial(input.template)) return []
  const text = bodyText(input.result)
  const pattern = new RegExp(PASSIVE[input.lang].source, PASSIVE[input.lang].flags)
  const hits = [...new Set((text.match(pattern) ?? []).map((hit) => hit.toLowerCase()))]
  if (hits.length === 0) return []
  return [
    {
      id: 'passiveVoice',
      rule: 'passiveVoice',
      severity: 'hint',
      message: {
        en: `A demi-official letter is written in the first person and the active voice — CSMOP 9.5(i) says "I notice", not "It is noticed". Found: ${hits.join(', ')}.`,
        hi: `अर्ध-सरकारी पत्र उत्तम पुरुष और कर्तृवाच्य में लिखा जाता है — सीएसएमओपी 9.5(i) "मैंने देखा" कहता है, "यह देखा गया" नहीं। मिला: ${hits.join(', ')}।`,
      },
    },
  ]
}

/**
 * Whether this template IS a demi-official letter.
 *
 * Read off the template's own CSMOP reference rather than its id, because a
 * personal template cloned from the official one has a different id and the
 * same form — and because a condolence or felicitation D.O. is a D.O. too.
 */
const isDemiOfficial = (template: DocTemplate): boolean =>
  template.csmopRef.paras.some((para) => para.startsWith('8.4(2)') || para.startsWith('9.5')) ||
  template.csmopRef.chassis === 'demi-official'

// -------------------------------------------------------------------- runner

const RUNNERS: Record<LintRuleId, (input: LintInput) => LintFinding[]> = {
  placeholders: lintPlaceholders,
  subject: lintSubject,
  date: lintDate,
  references: lintReferences,
  enclosures: lintEnclosures,
  terminology: lintTerminology,
  paragraphLength: lintParagraphLength,
  passiveVoice: lintPassiveVoice,
}

/** Every finding, errors first, in a stable order. */
export function lintDocument(input: LintInput): LintFinding[] {
  const order: Record<LintSeverity, number> = { error: 0, warning: 1, hint: 2 }
  return LINT_RULES.flatMap((rule) => RUNNERS[rule](input)).sort(
    (a, b) => order[a.severity] - order[b.severity],
  )
}

/** What an export gate asks: is there anything here that must be fixed first? */
export const lintBlocksExport = (findings: readonly LintFinding[]): boolean =>
  findings.some((finding) => finding.severity === 'error')
