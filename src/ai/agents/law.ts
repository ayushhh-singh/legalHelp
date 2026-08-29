import { z } from 'zod'

import { runAgent, type AgentRun, type UsageLedger } from '../agent'
import {
  buildContext,
  validateCitations,
  type BuiltContext,
  type Snippet,
  type SnippetType,
} from '../context'
import LAW_INSTRUCTIONS from '../prompts/law.md?raw'
import { buildSystem, PROMPT_VERSIONS } from '../prompts'
import type { AiProvider } from '../provider'
import { listTools, toJsonSchema, validateToolInput, type RegisteredTool } from '../tools/registry'
import {
  AiError,
  EMPTY_USAGE,
  isAiError,
  type AiErrorCode,
  type AiEventHandler,
  type AiOutputMeta,
  type AiTier,
  type Bilingual,
  type TokenUsage,
  type ToolResult,
} from '../types'
import { addUsage, estimateCost } from '../usage'

import type { Language } from '@/i18n'
import { ACT_SHORT } from '@/modules/law/citation'
import { eraForOffenceDate } from '@/modules/law/dateRule'
import type { LawCode, NewActId, OldActId } from '@/modules/law/types'

/**
 * The law research agent — the second agent this app runs, and the first one
 * that answers a question in prose rather than filling a form.
 *
 * ### Why it is two model passes and not one
 *
 * `validateCitations()` (src/ai/context.ts) rejects any section, rule or
 * paragraph number in a final answer that does not appear in a **cited
 * PLATFORM CONTEXT snippet**. Tool results are not context snippets: they come
 * back on the wire as `tool_result` blocks and carry the handles `T1`, `T2`.
 * So a single pass that called `get_section` and then wrote "BNS 103" would
 * fail its own citation check every time — the number is in a tool result and
 * in no snippet.
 *
 * That is not a bug to route around. It is the reason this agent is shaped the
 * way the brief asks for: the tool results are turned into numbered,
 * type-labelled snippets and handed BACK to the model as the only thing it may
 * write from. Five stages, of which three are this file's:
 *
 *   1. **screen**    — `screenLawQuestion()`, pure, before any provider call.
 *   2. **research**  — one `runAgent` pass with the law tools. The model calls
 *                      `search_sections` / `get_section` / `compare_old_new` /
 *                      `get_classification` and finishes with nothing but the
 *                      handles it used.
 *   3. **read**      — THIS FILE turns every successful tool result into a
 *                      `Snippet` with a provenance label. A First Schedule row
 *                      is labelled `(classification, BNSS First Schedule: …)`,
 *                      never `(section …)`, because "punishable with
 *                      imprisonment for life" and "Punishment for murder" read
 *                      alike in a prompt and only one of them answers "is it
 *                      bailable".
 *   4. **answer**    — one `runAgent` pass with NO tools and those snippets as
 *                      its context, returning the structured answer.
 *   5. **verify**    — THIS FILE re-derives everything the model asserted about
 *                      its own answer: `validateCitations` with
 *                      `requireCitation: true`, every section number named in
 *                      `answer` must appear in `citations`, and every citation
 *                      must be backed by a tool result that actually contains
 *                      it and by a section the dataset actually has.
 *
 * The date rule and the disclaimer are added by stage 5 in both languages and
 * are never the model's to write. A model that states the commencement rule
 * itself states it as an opinion; here it is a fact about the reader's own
 * offence date, and the app knows that date and the model does not have to.
 *
 * ### What is sent
 *
 * The question the reader typed, the offence date if they gave one, and the
 * tool results — which are rows of `data/law/*.json`, already on the device.
 * Nothing else. There is no tool in this app that can reach the reader's saved
 * sections or recent lookups, and this agent does not take them as an argument
 * either.
 */

/* ------------------------------------------------------------------ *
 * The refusal screen
 * ------------------------------------------------------------------ */

/**
 * What this screen refuses, and — just as deliberately — what it does not.
 *
 * The drafting agent's `screenBrief()` refuses a brief that so much as mentions
 * a classification marking, and that is right for a brief: an officer writing
 * "a note on the confidential report" is describing a document this app must
 * not help carry. It would be WRONG here. "Which BNS section covers
 * unauthorised communication of secret information" is a question about the
 * published statute, and refusing it would refuse the Official Secrets Act.
 *
 * What this screen refuses instead is a reference to a particular departmental
 * RECORD — an FIR number, a case or diary number, a charge-sheet number. Each
 * pattern requires a number after the word, which is what keeps "an FIR was
 * filed on 20 June 2024" (a question about the date rule, and one of this
 * surface's own acceptance cases) answerable.
 */
const RECORD_PATTERNS: readonly RegExp[] = [
  /\bf\.?i\.?r\.?\s*(?:no\.?|number|#)\s*[0-9]/i,
  /\bcase\s*(?:no\.?|number|#)\s*[0-9]/i,
  /\b(?:case|general)\s*diary\s*(?:no\.?|number|#)?\s*[0-9]/i,
  /\bcr\.?\s*no\.?\s*[0-9]/i,
  /\bcharge[\s-]?sheet\s*(?:no\.?|number|#)\s*[0-9]/i,
  /\bcrime\s*(?:no\.?|number|#)\s*[0-9]/i,
  /(?:प्राथमिकी|एफ\.?आई\.?आर\.?)\s*(?:सं\.?|संख्या|क्रमांक)\s*[0-9०-९]/,
  /(?:मामला|मुकदमा|केस)\s*(?:सं\.?|संख्या|क्रमांक)\s*[0-9०-९]/,
]

export interface LawRefusal {
  reason: 'departmental'
  /** The exact text that matched, so the reader can see what to remove. */
  matched: string
  message: Bilingual
}

const RECORD_REFUSAL: Bilingual = {
  en:
    'This question names a departmental record, so nothing has been sent. Sahayak holds public, ' +
    'non-departmental data only. Ask the same question without the record number — "which code applies ' +
    'to an offence on 20 June 2024" — and it can be answered.',
  hi:
    'इस प्रश्न में विभागीय अभिलेख का उल्लेख है, इसलिए कुछ भी भेजा नहीं गया। सहायक केवल सार्वजनिक, ' +
    'गैर-विभागीय डेटा रखता है। अभिलेख संख्या हटाकर वही प्रश्न पूछें — "20 जून 2024 के अपराध पर कौन-सी ' +
    'संहिता लागू होगी" — तो उत्तर मिल जाएगा।',
}

/**
 * Pure, and called before the provider is touched. `null` means the question
 * may be sent. `src/ai/agents/law.test.ts` proves it by counting
 * `MockProvider.calls`, not by reading the returned status — "we told the model
 * to refuse" and "nothing was sent" are different claims.
 */
export function screenLawQuestion(question: string): LawRefusal | null {
  for (const pattern of RECORD_PATTERNS) {
    const match = pattern.exec(question)
    if (match) return { reason: 'departmental', matched: match[0], message: RECORD_REFUSAL }
  }
  return null
}

/* ------------------------------------------------------------------ *
 * Advice about a particular person's case
 * ------------------------------------------------------------------ */

/**
 * A question asking what will happen to somebody, rather than what the law
 * says.
 *
 * This is a STEER, not a refusal, and the difference matters. "Will my brother
 * get bail under 420" is a question with a real, answerable, general core —
 * whether the corresponding offence is bailable under the First Schedule — and
 * an officer asking it deserves that answer. What they must not get is a
 * prediction about their brother. So the run proceeds, the model is told to
 * answer the rule and nothing beyond it, and a caveat saying so is added to
 * the result in both languages whether or not the model remembers.
 *
 * `src/ai/heuristics.ts#isPersonalQuery` is deliberately not reused: it matches
 * "can I" and "should I", which open a large share of perfectly general
 * questions here ("can I file an FIR under a repealed section"). Its bias — a
 * false positive costs only a cache hit — is the wrong bias for a control that
 * changes the answer.
 */
const CASE_ADVICE_PATTERNS: readonly RegExp[] = [
  /\b(?:my|his|her|their|our)\s+(?:case|matter|fir|bail|trial|appeal|brother|sister|son|daughter|husband|wife|father|mother|friend|client|neighbour|neighbor)\b/i,
  /\bwill\s+(?:he|she|they|i|we|my|his|her)\b[^.?!]{0,40}\b(?:get|be)\s+(?:bail|arrested|convicted|punished|acquitted|released)\b/i,
  // `should`, and not `can` or `must`: "can I file a complaint under a
  // repealed section" is a question about the law, and steering it would
  // put a lawyer's caveat on an ordinary lookup.
  /\bshould\s+(?:i|he|she|we|they)\s+(?:file|plead|apply|appeal|surrender|settle|compound)\b/i,
  /\bwhat\s+should\s+(?:i|he|she|we|they)\s+do\b/i,
  /\b(?:am|is|are)\s+(?:i|he|she|they|we)\s+(?:guilty|liable|punishable)\b/i,
  /(?:मेरे|मेरी|मेरा|उसके|उसकी|उसका|हमारे|हमारा)\s*(?:केस|मामले|मामला|मुकदमे|मुकदमा|भाई|बहन|बेटे|बेटी|पति|पत्नी|पिता|दोस्त)/,
  /क्या\s+(?:मुझे|उसे|उन्हें|हमें)\s*[^।?]{0,30}(?:जमानत|सज़ा|सजा|बरी|गिरफ्तार)/,
  /(?:मुझे|हमें)\s+क्या\s+करना\s+चाहिए/,
]

export interface CaseAdviceSteer {
  matched: string
  caveat: Bilingual
}

const CASE_ADVICE_CAVEAT: Bilingual = {
  en:
    'This answers the general rule and the provision it comes from. It is not advice about any ' +
    'particular case, and nothing here says what a court will do on a given set of facts. For that, ' +
    'consult the record and a lawyer.',
  hi:
    'यह उत्तर सामान्य नियम और उसका उपबंध बताता है। यह किसी विशेष मामले पर सलाह नहीं है, और यह नहीं ' +
    'बताता कि किन्हीं तथ्यों पर न्यायालय क्या करेगा। उसके लिए अभिलेख देखें और अधिवक्ता से परामर्श करें।',
}

/** `null` when the question is about the law rather than about somebody. */
export function caseAdviceSteer(question: string): CaseAdviceSteer | null {
  for (const pattern of CASE_ADVICE_PATTERNS) {
    const match = pattern.exec(question)
    if (match) return { matched: match[0].trim(), caveat: CASE_ADVICE_CAVEAT }
  }
  return null
}

/* ------------------------------------------------------------------ *
 * The date rule and the disclaimer — always added, never the model's
 * ------------------------------------------------------------------ */

/**
 * The single most consequential rule in this module, and the one an answer is
 * likeliest to get wrong by omission: which code applies is decided by the date
 * of the OFFENCE, not by today's date (BNSS section 531(2)).
 *
 * It is authored here rather than asked of the model for the same reason the
 * drafting agent evaluates its own checklist: the app knows the offence date
 * the reader typed, so this is a fact it can state, and a fact stated is worth
 * more than an instruction obeyed. `src/ai/prompts/law.md` tells the model NOT
 * to write it, so the reader never reads two versions of it.
 */
export function dateRuleCaveat(offenceDate: string | null | undefined): Bilingual {
  const era = eraForOffenceDate(offenceDate)

  if (era === 'old') {
    return {
      en:
        `The offence date given (${offenceDate}) is before 1 July 2024, so this matter is investigated, ` +
        'tried and punished under the IPC, the CrPC and the Indian Evidence Act, 1872 — the new Sanhitas ' +
        'do not apply to it. BNSS section 531(2) is the saving provision.',
      hi:
        `दी गई अपराध तिथि (${offenceDate}) 1 जुलाई 2024 से पहले की है, अतः इस मामले का अनुसंधान, विचारण ` +
        'तथा दंड भा.दं.सं., दं.प्र.सं. तथा भारतीय साक्ष्य अधिनियम, 1872 के अधीन होगा — नई संहिताएँ इस पर ' +
        'लागू नहीं होतीं। भा.ना.सु.सं. की धारा 531(2) व्यावृत्ति उपबंध है।',
    }
  }

  if (era === 'new') {
    return {
      en:
        `The offence date given (${offenceDate}) is on or after 1 July 2024, the date all three Sanhitas ` +
        'came into force, so the BNS, the BNSS and the BSA apply.',
      hi:
        `दी गई अपराध तिथि (${offenceDate}) 1 जुलाई 2024 या उसके बाद की है, जिस दिन तीनों संहिताएँ प्रवृत्त ` +
        'हुईं, अतः भा.न्या.सं., भा.ना.सु.सं. तथा भा.सा.अ. लागू होंगे।',
    }
  }

  return {
    en:
      'Which code applies is decided by the DATE OF THE OFFENCE, not by today’s date. No offence date was ' +
      'given, so this answer does not say which code governs your matter. Offences before 1 July 2024 stay ' +
      'under the IPC, the CrPC and the Indian Evidence Act, 1872 (BNSS section 531(2)).',
    hi:
      'कौन-सी संहिता लागू होगी, यह अपराध की तिथि से तय होता है, आज की तिथि से नहीं। कोई अपराध तिथि नहीं दी ' +
      'गई, इसलिए यह उत्तर यह नहीं बताता कि आपके मामले पर कौन-सी संहिता लागू होगी। 1 जुलाई 2024 से पहले के ' +
      'अपराध भा.दं.सं., दं.प्र.सं. तथा भारतीय साक्ष्य अधिनियम, 1872 के अधीन ही रहते हैं ' +
      '(भा.ना.सु.सं. की धारा 531(2))।',
  }
}

/** The master context's own disclaimer, verbatim from `data/law/*.json`. */
export const LAW_DISCLAIMER: Bilingual = {
  en: 'Reference only; verify with the official gazette/order or your DDO.',
  hi: 'केवल संदर्भ हेतु; आधिकारिक राजपत्र/आदेश या अपने डीडीओ से सत्यापित करें।',
}

/* ------------------------------------------------------------------ *
 * Acts, and how a citation names one
 * ------------------------------------------------------------------ */

export const LAW_ACTS = ['BNS', 'BNSS', 'BSA', 'IPC', 'CrPC', 'IEA'] as const
export type LawAct = (typeof LAW_ACTS)[number]

/** The dataset a citation of that Act belongs to — an old Act shares its pair's. */
const CODE_FOR_ACT: Readonly<Record<LawAct, LawCode>> = {
  BNS: 'bns',
  BNSS: 'bnss',
  BSA: 'bsa',
  IPC: 'bns',
  CrPC: 'bnss',
  IEA: 'bsa',
}

const NEW_ACT_FOR_CODE: Readonly<Record<LawCode, NewActId>> = { bns: 'BNS', bnss: 'BNSS', bsa: 'BSA' }

const OLD_ACTS: readonly LawAct[] = ['IPC', 'CrPC', 'IEA']
const isOldAct = (act: LawAct): act is OldActId => OLD_ACTS.includes(act)

/** `"318(4)"` and `"318 (4)"` and `"३१८(४)"` all key the same provision. */
function digitsOf(reference: string): string {
  return reference.replace(/[०-९]/g, (d) => String('०१२३४५६७८९'.indexOf(d))).replace(/[^0-9]/g, '')
}

/**
 * The two keys one written reference answers to.
 *
 * `"318(4)"` and `"318"` are the same provision at different resolutions, and
 * which one appears is a property of how a sentence was phrased rather than of
 * what was read: `get_classification` returns rows per sub-section, the mapping
 * table stores the section. Indexing and matching on both is what stops
 * "BNS 318(4)" in a sentence being reported as an uncited number because the
 * tool result said 318.
 */
function sectionKeys(act: LawAct, section: string): { full: string; base: string } {
  const full = digitsOf(section)
  const base = digitsOf(section.split('(')[0] ?? section) || full
  return { full: `${act}:${full}`, base: `${act}:${base}` }
}

/**
 * Every way this app's two languages name a provision, in a form that also
 * catches the Act-first shape a citation actually uses.
 *
 * Two alternatives, and both are needed: `BNS 103` and `IPC section 420` name
 * the Act, while `Section 103 of the Bharatiya Nyaya Sanhita` and `धारा 103` do
 * not. A bare numeral is deliberately never matched — "1 July 2024" and
 * "2023" are not claims about a provision, and treating them as such would
 * reject every correct answer that carried a date.
 */
const SECTION_MENTION =
  /(?:\b(?:BNS|BNSS|BSA|IPC|CrPC|IEA)\s+(?:sections?\s+|sec\.?\s*|s\.\s*)?|\b(?:sections?|sec\.|s\.)\s*(?:no\.?\s*)?|(?:धाराओं|धारा)\s*(?:सं\.?\s*)?)([0-9०-९]+(?:\s*\([0-9a-zA-Z०-९]+\))*[A-Z]{0,2})/gi

/**
 * The provision numbers a piece of prose names, as digit-only keys.
 *
 * Used for one check and one only: every number the answer states must appear
 * in the citation list the reader can click. A number discussed but not
 * citeable is a number nobody can check, which on this surface is the whole
 * failure mode.
 */
export interface SectionMention {
  /** As it was written: `"318(4)"`. */
  written: string
  /** Digits only: `"3184"`. */
  full: string
  /** Digits of the section alone: `"318"`. */
  base: string
}

export function mentionedSections(text: string): SectionMention[] {
  const found = new Map<string, SectionMention>()
  for (const match of text.matchAll(SECTION_MENTION)) {
    const written = (match[1] ?? '').trim()
    const full = digitsOf(written)
    if (!full || found.has(full)) continue
    found.set(full, { written, full, base: digitsOf(written.split('(')[0] ?? written) || full })
  }
  return [...found.values()].sort((a, b) => (a.full < b.full ? -1 : a.full > b.full ? 1 : 0))
}

/* ------------------------------------------------------------------ *
 * The tier policy
 * ------------------------------------------------------------------ */

/**
 * Tier 0 runs a small model in the reader's own browser, so the run has to be
 * smaller too: one tool-calling turn, the snippets it produced and nothing
 * else, and an answer of a couple of sentences.
 *
 * `maxSteps: 2` is what enforces the single tool turn — one turn to call,
 * one to finish — rather than an instruction the model may ignore.
 * `maxToolResults` is the second half of it and is enforced here: a model that
 * returns three parallel calls in its one turn still yields one snippet.
 */
export interface TierPolicy {
  /** Steps allowed in the research pass. 2 = one tool-calling turn. */
  researchSteps: number
  /** How many tool results become snippets. */
  maxToolResults: number
  /** How many search hits from one `search_sections` result become snippets. */
  maxSearchHits: number
  /** Told to the model, and the reason the local answer is shorter. */
  answerSentences: number
}

export const TIER_POLICIES: Readonly<Record<'default' | 'local', TierPolicy>> = {
  default: { researchSteps: 6, maxToolResults: 8, maxSearchHits: 5, answerSentences: 6 },
  local: { researchSteps: 2, maxToolResults: 1, maxSearchHits: 2, answerSentences: 2 },
}

export function policyForTier(tier: AiTier): TierPolicy {
  return tier === 'local' ? TIER_POLICIES.local : TIER_POLICIES.default
}

/* ------------------------------------------------------------------ *
 * What the model returns
 * ------------------------------------------------------------------ */

const bilingualText = z.object({ en: z.string().min(1), hi: z.string().min(1) })

const citationSchema = z.object({
  act: z.enum(LAW_ACTS),
  section: z.string().min(1).max(16),
  /** The handle of the research tool result it came from — `"T1"`. */
  toolResultId: z.string().min(1).max(8),
})

const answerSchema = z.object({
  answer: bilingualText,
  citations: z.array(citationSchema),
  caveats: z.array(bilingualText).optional(),
})

/* ------------------------------------------------------------------ *
 * Progress
 * ------------------------------------------------------------------ */

export const LAW_PHASES = ['screening', 'researching', 'reading', 'answering', 'verifying', 'done'] as const
export type LawPhase = (typeof LAW_PHASES)[number]

/**
 * `tool` is the registered tool's NAME rather than a sentence: the panel
 * translates it (`law.ask.step.get_classification`), because a sentence built
 * here would be a user-visible string outside the i18n catalogues and would
 * exist in one language.
 */
export interface LawStep {
  phase: LawPhase
  tool?: string
}

export type LawProgress = (step: LawStep) => void

/* ------------------------------------------------------------------ *
 * The result
 * ------------------------------------------------------------------ */

export interface LawCitation {
  act: LawAct
  /** The dataset the section belongs to, so the UI can open its card. */
  code: LawCode
  section: string
  /** The research tool result that actually contains it — verified, not claimed. */
  toolResultId: string
  /** Written by `format_citation`, or by this file for a repealed Act. */
  citation: Bilingual
  heading: Bilingual | null
}

/** One numbered snippet the answer may cite, for the `[n]` marks on screen. */
export interface AnswerSnippet {
  index: number
  kind: SnippetType
  label: Bilingual
  ref: { act: LawAct; code: LawCode; section: string } | null
}

export interface LawAnswerResult {
  status: 'answer'
  question: string
  answer: Bilingual
  citations: LawCitation[]
  /** The date rule first, the disclaimer last; both always present. */
  caveats: Bilingual[]
  snippets: AnswerSnippet[]
  /** Anything dropped or corrected on the way, in English, for the panel's log. */
  problems: string[]
  usage: TokenUsage
  cost: number
  meta: AiOutputMeta
}

export interface LawRefusedResult {
  status: 'refused'
  refusal: LawRefusal
}

export interface LawFailedResult {
  status: 'error'
  code: AiErrorCode
  message: string
  /** The tool results the run did produce, so the panel can say what it read. */
  toolsCalled: string[]
  usage: TokenUsage
  cost: number
}

export type LawAgentResult = LawAnswerResult | LawRefusedResult | LawFailedResult

/* ------------------------------------------------------------------ *
 * Parameters
 * ------------------------------------------------------------------ */

export interface LawAgentParams {
  provider: AiProvider
  /** What the reader typed. Screened before it is sent. */
  question: string
  /** The interface language: which half of `answer` the panel shows first. */
  language: Language
  /** `YYYY-MM-DD` from the converter's own offence-date field, if given. */
  offenceDate?: string | null
  /** Defaults to `listTools('law')`. Injected by tests. */
  tools?: readonly RegisteredTool[]
  signal?: AbortSignal
  onProgress?: LawProgress
  /** The answer as it streams, in `language`. Best-effort; see `partialAnswerText`. */
  onPartialAnswer?: (text: string) => void
  onEvent?: AiEventHandler
  tier?: AiTier
  budgetLimit?: number | null
  model?: string
  ledger?: UsageLedger
  now?: () => Date
}

const AGENT_ID = 'law-explain' as const

/* ------------------------------------------------------------------ *
 * The run
 * ------------------------------------------------------------------ */

export async function runLawAgent(params: LawAgentParams): Promise<LawAgentResult> {
  const {
    provider,
    question,
    language,
    offenceDate = null,
    signal,
    onProgress,
    onPartialAnswer,
    onEvent,
    tier = 'byok',
    budgetLimit = null,
    model,
    ledger,
    now = () => new Date(),
  } = params

  const tools = params.tools ?? listTools('law')
  const policy = policyForTier(tier)
  const step = (phase: LawPhase, tool?: string) => onProgress?.(tool ? { phase, tool } : { phase })

  /* ---- 1. screen ------------------------------------------------- */

  step('screening')
  const refusal = screenLawQuestion(question)
  if (refusal) return { status: 'refused', refusal }

  const steer = caseAdviceSteer(question)

  let usage: TokenUsage = { ...EMPTY_USAGE }
  const problems: string[] = []
  const spend = (run: AgentRun) => {
    usage = addUsage(usage, run.usage)
  }

  /* ---- 2. research ----------------------------------------------- */

  step('researching')
  const researchCtx = buildContext(
    [
      { type: 'note', source: 'the reader’s question', id: 'question', text: question },
      { type: 'note', source: 'the offence date rule', id: 'date', text: dateRuleCaveat(offenceDate).en },
    ],
    'en',
  )

  const researchRun = await runAgent({
    agentId: AGENT_ID,
    provider,
    tools,
    system: system({ language, context: researchCtx }),
    userMessage: researchMessage({ question, offenceDate, policy, steer: Boolean(steer) }),
    context: researchCtx,
    maxSteps: policy.researchSteps,
    language,
    tier,
    budgetLimit,
    ledger,
    now,
    ...(model ? { model } : {}),
    ...(signal ? { signal } : {}),
    onEvent: (event) => {
      if (event.type === 'toolCall') step('researching', event.call.name)
      onEvent?.(event)
    },
  })
  spend(researchRun)

  const gathered = researchRun.toolResults.filter((result) => result.ok)

  /*
    The research pass's final sentence is thrown away — the tool results are its
    output — so two of `runAgent`'s failures are not failures of this run.

    `ungrounded` and `invalid_citation` are both judgments about that discarded
    sentence: the first says it cited no handle, the second that it named a
    section number which, because tool results are not context snippets, could
    never be "supported" at this stage. Neither says anything about what the
    reader will be shown, and the answer pass is validated far harder than
    `runAgent` validates anything. Every other failure — the provider, the
    budget, cancellation, the step cap — really did stop the run, and no amount
    of tool results makes an answer possible without a second pass.
  */
  const TOLERATED: readonly AiErrorCode[] = ['ungrounded', 'invalid_citation']
  if (!researchRun.ok) {
    const code = researchRun.error?.code
    if (!code || !TOLERATED.includes(code)) {
      return failed(researchRun, usage, researchRun.toolResults)
    }
    if (gathered.length > 0) {
      problems.push(
        `The research pass ended with "${code}" — its closing sentence was discarded and the ` +
          `${gathered.length} tool result(s) it had already gathered were used.`,
      )
    }
  }

  // Reached from two directions — a research pass that finished cleanly having
  // called nothing, and one that failed `ungrounded` for the same reason — and
  // both deserve the sentence that says what to do about it rather than
  // `runAgent`'s, which is written for a developer reading a log.
  if (gathered.length === 0) {
    return {
      status: 'error',
      code: 'ungrounded',
      message:
        'The assistant read nothing from the section tables, so there is nothing to answer from. ' +
        'Ask about a section number, an offence or a phrase that appears in the BNS, BNSS or BSA.',
      toolsCalled: researchRun.toolResults.map((result) => result.name),
      usage,
      cost: estimateCost(researchRun.meta.model, usage),
    }
  }

  if (signal?.aborted) return cancelled(usage, researchRun.meta.model)

  /* ---- 3. read: tool results become numbered, labelled snippets ---- */

  step('reading')
  const read = readToolResults(gathered, policy)
  if (read.dropped > 0) {
    problems.push(
      `${read.dropped} tool result(s) beyond this tier’s limit of ${policy.maxToolResults} were not read.`,
    )
  }
  const answerCtx = buildContext(
    [{ type: 'note', source: 'the reader’s question', id: 'question', text: question }, ...read.snippets],
    'en',
  )

  /* ---- 4. answer -------------------------------------------------- */

  step('answering')
  let streamed = ''
  const answerRun = await runAgent({
    agentId: AGENT_ID,
    provider,
    // No tools, deliberately: everything the answer may contain is already a
    // numbered snippet, and a tool call here would produce a result nothing
    // validated. `groundedRequired` is off for the same reason and the
    // grounding is re-derived below, harder — ADR-035.
    tools: [],
    groundedRequired: false,
    system: system({ language, context: answerCtx }),
    userMessage: answerMessage({
      question,
      policy,
      steer: Boolean(steer),
      snippetCount: answerCtx.entries.length,
    }),
    jsonSchema: { name: 'law_answer', schema: toJsonSchema(answerSchema) },
    context: answerCtx,
    maxSteps: 1,
    language,
    tier,
    budgetLimit,
    ledger,
    now,
    ...(model ? { model } : {}),
    ...(signal ? { signal } : {}),
    onEvent: (event) => {
      if (event.type === 'token') {
        streamed += event.text
        if (onPartialAnswer) {
          const partial = partialAnswerText(streamed, language)
          if (partial) onPartialAnswer(partial)
        }
      }
      onEvent?.(event)
    },
  })
  spend(answerRun)

  if (!answerRun.ok || answerRun.json === undefined) {
    return failed(answerRun, usage, researchRun.toolResults)
  }

  const parsed = answerSchema.safeParse(answerRun.json)
  if (!parsed.success) {
    return {
      status: 'error',
      code: 'provider',
      message: `The answer did not match the expected shape — ${parsed.error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; ')}`,
      toolsCalled: researchRun.toolResults.map((result) => result.name),
      usage,
      cost: estimateCost(answerRun.meta.model, usage),
    }
  }

  if (signal?.aborted) return cancelled(usage, answerRun.meta.model)

  /* ---- 5. verify -------------------------------------------------- */

  step('verifying')
  const answerText = `${parsed.data.answer.en}\n${parsed.data.answer.hi}`

  /*
    `runAgent` ran this too, over the whole JSON blob and with
    `requireCitation` off (this pass has no tools). Running it again here, over
    the ANSWER text alone and with the requirement on, is the check the brief
    asks for and the one that matters: an answer that states a provision number
    and cites no snippet is indistinguishable from a guess.
  */
  const citations = validateCitations(answerText, answerCtx, { requireCitation: true })
  if (!citations.ok) {
    return {
      status: 'error',
      code: 'invalid_citation',
      message: citations.problems.map((problem) => problem.detail).join(' '),
      toolsCalled: researchRun.toolResults.map((result) => result.name),
      usage,
      cost: estimateCost(answerRun.meta.model, usage),
    }
  }

  let resolved: LawCitation[]
  try {
    resolved = await resolveCitations({
      claimed: parsed.data.citations,
      support: read.support,
      headings: read.headings,
      tools,
      problems,
      ...(signal ? { signal } : {}),
    })
  } catch (error) {
    return {
      status: 'error',
      code: isAiError(error) ? error.code : 'provider',
      message: error instanceof Error ? error.message : String(error),
      toolsCalled: researchRun.toolResults.map((result) => result.name),
      usage,
      cost: estimateCost(answerRun.meta.model, usage),
    }
  }

  const cited = new Set<string>()
  for (const citation of resolved) {
    cited.add(digitsOf(citation.section))
    cited.add(digitsOf(citation.section.split('(')[0] ?? citation.section))
  }
  const uncited = mentionedSections(answerText).filter(
    (mention) => !cited.has(mention.full) && !cited.has(mention.base),
  )
  if (uncited.length > 0) {
    return {
      status: 'error',
      code: 'invalid_citation',
      message:
        `The answer names section ${uncited.map((mention) => mention.written).join(', ')} but lists no citation for ` +
        `${uncited.length === 1 ? 'it' : 'them'}, so there is no source to open. The answer was discarded.`,
      toolsCalled: researchRun.toolResults.map((result) => result.name),
      usage,
      cost: estimateCost(answerRun.meta.model, usage),
    }
  }

  /* ---- 6. the caveats this app owns ------------------------------- */

  const caveats: Bilingual[] = [
    dateRuleCaveat(offenceDate),
    ...(steer ? [steer.caveat] : []),
    ...(parsed.data.caveats ?? []),
    LAW_DISCLAIMER,
  ]

  step('done')
  return {
    status: 'answer',
    question,
    answer: parsed.data.answer,
    citations: resolved,
    caveats,
    snippets: read.snippets.map((snippet, index) => ({
      // +1 for the question, which is always snippet [1].
      index: index + 2,
      kind: snippet.type,
      label: read.labels[index] ?? { en: snippet.source ?? '', hi: snippet.source ?? '' },
      ref: read.refs[index] ?? null,
    })),
    problems,
    usage,
    cost: estimateCost(answerRun.meta.model, usage),
    meta: mergedMeta(answerRun, usage, tier, now),
  }
}

/* ------------------------------------------------------------------ *
 * Streaming
 * ------------------------------------------------------------------ */

/**
 * The answer text so far, pulled out of a half-arrived JSON document.
 *
 * The answer pass returns structured output, so there is no plain-text stream
 * to show — and showing a reader raw JSON accumulating on screen would be
 * worse than showing them a spinner. This reads the FIRST `"en": "…"` (or
 * `"hi"`) string in the buffer, which is the `answer` object's, because
 * `answer` is the first property of the schema and `caveats` the last.
 *
 * It is best-effort by construction: the value that is finally rendered comes
 * from `JSON.parse`, never from here. A wrong guess costs a flicker.
 */
export function partialAnswerText(buffer: string, lang: Language): string {
  const opening = new RegExp(`"${lang}"\\s*:\\s*"`).exec(buffer)
  if (!opening) return ''

  let out = ''
  for (let i = opening.index + opening[0].length; i < buffer.length; i += 1) {
    const ch = buffer[i]
    if (ch === '"') break
    if (ch !== '\\') {
      out += ch
      continue
    }
    const next = buffer[i + 1]
    if (next === undefined) break
    if (next === 'u') {
      const hex = buffer.slice(i + 2, i + 6)
      if (hex.length < 4) break
      out += String.fromCharCode(Number.parseInt(hex, 16))
      i += 5
      continue
    }
    out += next === 'n' ? '\n' : next === 't' ? '\t' : next === 'r' ? '\r' : next
    i += 1
  }
  return out
}

/* ------------------------------------------------------------------ *
 * Copying an answer out
 * ------------------------------------------------------------------ */

/**
 * The answer, its citations and its caveats as one block of plain text.
 *
 * A citation pasted into a note or a chat loses every piece of UI around it,
 * so the `[n]` marks travel with a numbered source list and the disclaimer
 * travels with the answer. Same rule `shareText()` follows in the converter.
 */
export function copyableAnswer(result: LawAnswerResult, language: Language): string {
  const lines = [result.answer[language], '']

  if (result.citations.length > 0) {
    lines.push(language === 'hi' ? 'उद्धरण:' : 'Citations:')
    for (const citation of result.citations) {
      lines.push(
        `- ${citation.citation[language]}${citation.heading ? ` — ${citation.heading[language] || citation.heading.en}` : ''}`,
      )
    }
    lines.push('')
  }

  for (const caveat of result.caveats) lines.push(caveat[language])
  return lines.join('\n').trim()
}

/* ------------------------------------------------------------------ *
 * Reading tool results into snippets
 * ------------------------------------------------------------------ */

interface ReadResult {
  snippets: Snippet[]
  /** Bilingual short labels, parallel to `snippets`. */
  labels: Bilingual[]
  /** The section each snippet is about, parallel to `snippets`. */
  refs: (AnswerSnippet['ref'] | null)[]
  /** `"BNS:103"` → the tool result ids that actually contain it. */
  support: Map<string, string[]>
  /** `"BNS:103"` → the heading the tool results carried for it. */
  headings: Map<string, Bilingual>
  dropped: number
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}

const asString = (value: unknown): string => (typeof value === 'string' ? value : '')

function asBilingual(value: unknown): Bilingual | null {
  const record = asRecord(value)
  const en = asString(record.en)
  const hi = asString(record.hi)
  return en || hi ? { en, hi } : null
}

const shortLabel = (act: LawAct, section: string): Bilingual => ({
  en: `${ACT_SHORT[act].en} ${section}`,
  hi: `${ACT_SHORT[act].hi} ${section}`,
})

/**
 * How a provision is written INSIDE a snippet's text, and it is not decoration.
 *
 * `validateCitations()` decides whether a number in the answer is supported by
 * scanning the cited snippets for the same number — with the full sub-section
 * only where a snippet spells it as "Section 318(4)". Its fallback scan for a
 * bare numeral matches `318` and `4` separately, so a snippet that said only
 * "BNS 318(4)" would leave a perfectly correct answer saying "Section 318(4)"
 * unsupported and fail the run. Writing it the way a citation is written is
 * what makes the check work in both languages at once: the Hindi
 * "धारा 318(4)" reduces to the same digits.
 */
const asWritten = (act: LawAct, section: string): string => `Section ${section} of the ${act}`

/** A long field, kept to what a prompt can afford to carry. */
function clip(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit).trimEnd()}…`
}

/**
 * Every successful tool result, turned into the numbered snippets the answer
 * pass is allowed to write from, plus the two indexes stage 5 verifies against.
 *
 * The labelling is the substance of this function, not the formatting. A model
 * that is handed a First Schedule row under a `(section …)` label will answer
 * "is it bailable" from the section heading, because a heading beginning
 * "Punishment for murder" reads exactly like an answer about punishment. The
 * label is what tells it that only one of the two snippets can settle the
 * question.
 */
function readToolResults(results: readonly ToolResult[], policy: TierPolicy): ReadResult {
  const snippets: Snippet[] = []
  const labels: Bilingual[] = []
  const refs: (AnswerSnippet['ref'] | null)[] = []
  const support = new Map<string, string[]>()
  const headings = new Map<string, Bilingual>()

  const kept = results.slice(0, policy.maxToolResults)

  const note = (act: LawAct, section: string, id: string, heading?: Bilingual | null) => {
    const { full, base } = sectionKeys(act, section)
    for (const key of new Set([full, base])) {
      const ids = support.get(key) ?? []
      if (!ids.includes(id)) ids.push(id)
      support.set(key, ids)
      if (heading && (heading.en || heading.hi) && !headings.has(key)) headings.set(key, heading)
    }
  }

  const push = (
    type: SnippetType,
    source: string,
    id: string,
    text: string,
    label: Bilingual,
    ref: AnswerSnippet['ref'] | null,
  ) => {
    snippets.push({ type, source: `${source} [${id}]`, id: `${id}-${snippets.length + 1}`, text })
    labels.push(label)
    refs.push(ref)
  }

  for (const result of kept) {
    const output = asRecord(result.output)

    switch (result.name) {
      case 'search_sections': {
        const hits = Array.isArray(output.results) ? output.results : []
        for (const raw of hits.slice(0, policy.maxSearchHits)) {
          const hit = asRecord(raw)
          const act = asString(hit.act) as LawAct
          const section = asString(hit.section)
          if (!LAW_ACTS.includes(act) || !section) continue
          const heading = asBilingual(hit.heading)
          const corresponds = Array.isArray(hit.correspondsTo) ? hit.correspondsTo.map(asString) : []
          note(act, section, result.id, heading)
          for (const ref of corresponds) noteCorresponding(ref, result.id, note)
          push(
            'section',
            `${act} ${section}`,
            result.id,
            [
              `${asWritten(act, section)} — ${heading?.en ?? ''}`,
              heading?.hi ? `Hindi heading: ${heading.hi}` : '',
              `Status: ${asString(hit.status) || 'unknown'}.`,
              corresponds.length > 0
                ? `Replaces: ${corresponds.map(asWrittenRef).join('; ')}.`
                : 'Replaces nothing in the repealed Act.',
              hit.hindiIsCurated === true
                ? 'The Hindi heading here is hand-authored by this app, not statutory — say so if you use it.'
                : '',
            ]
              .filter(Boolean)
              .join('\n'),
            shortLabel(act, section),
            { act, code: CODE_FOR_ACT[act], section },
          )
        }

        const droppedProvisions = Array.isArray(output.droppedProvisions) ? output.droppedProvisions : []
        for (const raw of droppedProvisions) {
          const entry = asRecord(raw)
          const act = asString(entry.act) as LawAct
          const section = asString(entry.section)
          if (!LAW_ACTS.includes(act) || !section) continue
          note(act, section, result.id, asBilingual(entry.heading))
          push(
            'mapping',
            `${act} ${section}, dropped`,
            result.id,
            [
              `${asWritten(act, section)} (${asBilingual(entry.heading)?.en ?? ''}) has NO counterpart in the new Act.`,
              asBilingual(entry.note)?.en ?? '',
            ]
              .filter(Boolean)
              .join(' '),
            shortLabel(act, section),
            { act, code: CODE_FOR_ACT[act], section },
          )
        }
        break
      }

      case 'get_section': {
        if (output.found !== true) break
        const act = asString(output.act) as LawAct
        const section = asString(output.section)
        if (!LAW_ACTS.includes(act) || !section) break
        const heading = asBilingual(output.heading)
        const corresponds = Array.isArray(output.correspondsTo) ? output.correspondsTo.map(asString) : []
        note(act, section, result.id, heading)
        for (const ref of corresponds) noteCorresponding(ref, result.id, note)
        const notes = Array.isArray(output.notes) ? output.notes : []
        push(
          'section',
          `${act} ${section}`,
          result.id,
          [
            `${asWritten(act, section)} — ${heading?.en ?? ''}`,
            heading?.hi ? `Hindi heading: ${heading.hi}` : '',
            `Status: ${asString(output.status) || 'unknown'}.`,
            corresponds.length > 0 ? `Replaces: ${corresponds.map(asWrittenRef).join('; ')}.` : '',
            asBilingual(output.text)?.en ? `Text: ${clip(asBilingual(output.text)?.en ?? '', 1_200)}` : '',
            asBilingual(output.punishment)?.en
              ? `Punishment as printed: ${asBilingual(output.punishment)?.en}`
              : '',
            ...notes.map((raw) => {
              const entry = asRecord(raw)
              return `Note (${asString(entry.kind)}): ${asBilingual(entry.title)?.en ?? ''} — ${asBilingual(entry.body)?.en ?? ''}`
            }),
            output.hindiIsCurated === true
              ? 'The Hindi here is hand-authored by this app, not statutory — say so if you use it.'
              : '',
          ]
            .filter(Boolean)
            .join('\n'),
          shortLabel(act, section),
          { act, code: CODE_FOR_ACT[act], section },
        )
        break
      }

      case 'compare_old_new': {
        if (output.found !== true) break
        const oldAct = asString(output.oldAct) as LawAct
        const oldSection = asString(output.oldSection)
        if (!LAW_ACTS.includes(oldAct) || !oldSection) break
        const dropped = output.status === 'dropped'
        const oldHeading = asBilingual(output.oldHeading) ?? asBilingual(output.heading)
        note(oldAct, oldSection, result.id, oldHeading)

        const corresponds = Array.isArray(output.corresponds) ? output.corresponds : []
        const newAct = NEW_ACT_FOR_CODE[CODE_FOR_ACT[oldAct]] as LawAct
        const lines: string[] = [`${asWritten(oldAct, oldSection)} — ${oldHeading?.en ?? ''}`]

        if (dropped) {
          lines.push(`This provision was DROPPED: the new Act has no counterpart to it.`)
          const droppedNote = asBilingual(output.note)?.en
          if (droppedNote) lines.push(droppedNote)
        } else {
          for (const raw of corresponds) {
            const entry = asRecord(raw)
            const section = asString(entry.section)
            if (!section) continue
            note(newAct, section, result.id, asBilingual(entry.heading))
            lines.push(
              `Corresponds to ${asWritten(newAct, section)} — ${asBilingual(entry.heading)?.en ?? ''} ` +
                `(${asString(entry.sectionStatus) || 'status unknown'}${entry.numberOnly === true ? ', only the number changed' : ''}).`,
            )
            const changed = Array.isArray(entry.changedSubSections)
              ? entry.changedSubSections.map(asString)
              : []
            const added = Array.isArray(entry.newSubSections) ? entry.newSubSections.map(asString) : []
            if (changed.length > 0) {
              lines.push(
                `Sub-sections NCRB marks as changed: ${changed.map((one) => asWritten(newAct, one)).join('; ')}.`,
              )
            }
            if (added.length > 0) {
              lines.push(`New sub-sections: ${added.map((one) => asWritten(newAct, one)).join('; ')}.`)
            }
          }
        }

        const warnings = Array.isArray(output.warnings) ? output.warnings : []
        for (const raw of warnings) {
          const warning = asRecord(raw)
          lines.push(
            `WARNING (${asString(warning.kind)}): ${asBilingual(warning.title)?.en ?? ''} — ${asBilingual(warning.body)?.en ?? ''}`,
          )
        }

        push(
          'mapping',
          `${oldAct} ${oldSection}`,
          result.id,
          lines.filter(Boolean).join('\n'),
          shortLabel(oldAct, oldSection),
          { act: oldAct, code: CODE_FOR_ACT[oldAct], section: oldSection },
        )
        break
      }

      case 'get_classification': {
        if (output.found !== true) break
        const code = asString(output.code) as LawCode
        const section = asString(output.section)
        const act = (NEW_ACT_FOR_CODE[code] ?? 'BNS') as LawAct
        if (!section) break
        const heading = asBilingual(output.heading)
        note(act, section, result.id, heading)

        if (output.classified !== true) {
          push(
            'classification',
            `${act} ${section}, not classified`,
            result.id,
            `${asWritten(act, section)} carries NO First Schedule entry. ${asString(output.reason)}`,
            shortLabel(act, section),
            { act, code: CODE_FOR_ACT[act], section },
          )
          break
        }

        const rows = Array.isArray(output.classification) ? output.classification : []
        push(
          'classification',
          `${act} ${section}`,
          result.id,
          rows
            .map((raw) => {
              const row = asRecord(raw)
              const clause = asString(row.clause) || section
              // Each clause is recorded, not only the section: the Schedule
              // classifies sub-sections, and a citation of "318(4)" has to be
              // backed by the row that actually carries its bail entry.
              note(act, clause, result.id, heading)
              return [
                `${asWritten(act, clause)}: ${asBilingual(row.offence)?.en ?? ''}`,
                `punishment — ${asBilingual(row.punishment)?.en ?? ''}`,
                `${asString(row.cognizable)}, ${asString(row.bailable)}, ${asString(row.compoundable)}`,
                `triable by ${asBilingual(row.triableBy)?.en ?? ''}`,
              ].join('; ')
            })
            .join('\n'),
          shortLabel(act, section),
          { act, code: CODE_FOR_ACT[act], section },
        )
        break
      }

      default: {
        // `format_citation`, `dataset_versions`, `today_in_india` and anything a
        // later session registers: kept, unlabelled as law, so the model can
        // still cite them but cannot mistake one for a provision.
        push(
          'note',
          result.name,
          result.id,
          clip(typeof result.output === 'string' ? result.output : JSON.stringify(result.output), 800),
          { en: result.name, hi: result.name },
          null,
        )
      }
    }
  }

  return { snippets, labels, refs, support, headings, dropped: Math.max(0, results.length - kept.length) }
}

/** `"IPC 302"` from a `correspondsTo` list, rewritten as a citation. */
function asWrittenRef(reference: string): string {
  const parsed = parseActRef(reference)
  return parsed ? asWritten(parsed.act, parsed.section) : reference
}

function parseActRef(reference: string): { act: LawAct; section: string } | null {
  const match = /^(BNS|BNSS|BSA|IPC|CrPC|IEA)\s+(.+)$/i.exec(reference.trim())
  const act = LAW_ACTS.find((candidate) => candidate.toLowerCase() === (match?.[1] ?? '').toLowerCase())
  if (!match || !act || !match[2]) return null
  return { act, section: match[2].trim() }
}

/** `"IPC 302"` from a `correspondsTo` list, recorded under the Act it names. */
function noteCorresponding(
  reference: string,
  id: string,
  note: (act: LawAct, section: string, id: string, heading?: Bilingual | null) => void,
): void {
  const parsed = parseActRef(reference)
  if (!parsed) return
  note(parsed.act, parsed.section, id)
}

/* ------------------------------------------------------------------ *
 * Citations: verified against the evidence, then formatted by the tool
 * ------------------------------------------------------------------ */

interface ResolveParams {
  claimed: readonly z.infer<typeof citationSchema>[]
  support: Map<string, string[]>
  headings: Map<string, Bilingual>
  tools: readonly RegisteredTool[]
  problems: string[]
  signal?: AbortSignal
}

/**
 * Every citation the model returned, checked against what was actually read and
 * then formatted by `format_citation` rather than by the model.
 *
 * Three things happen here and each is a claim being re-derived rather than
 * believed:
 *
 *  - **`toolResultId` is verified, and corrected where it is wrong.** The model
 *    says which result a section came from; this file knows. A citation whose
 *    handle is wrong but which some other result does support is kept with the
 *    right handle and the correction is recorded; one that NO result supports is
 *    dropped, because a citation nothing read is an invented citation.
 *  - **The section is confirmed to exist.** `format_citation` returns
 *    `found: false` for a number the dataset does not have, which catches a
 *    plausible-looking sub-section that no snippet ever mentioned.
 *  - **The citation text is the tool's.** Act name, word order and the
 *    repealed Act's abbreviation all differ between the two languages, and the
 *    tool's own description says not to compose one by hand.
 */
async function resolveCitations(params: ResolveParams): Promise<LawCitation[]> {
  const { claimed, support, headings, tools, problems, signal } = params
  const out: LawCitation[] = []
  const seen = new Set<string>()

  for (const citation of claimed) {
    const { full, base } = sectionKeys(citation.act, citation.section)
    if (seen.has(full)) continue

    const backing = support.get(full) ?? support.get(base) ?? []
    if (backing.length === 0) {
      problems.push(
        `Dropped the citation "${citation.act} ${citation.section}": no tool result read in this run contains it.`,
      )
      continue
    }

    const toolResultId = backing.includes(citation.toolResultId)
      ? citation.toolResultId
      : (backing[0] as string)
    if (toolResultId !== citation.toolResultId) {
      problems.push(
        `Corrected the source of "${citation.act} ${citation.section}" from ${citation.toolResultId} to ${toolResultId}.`,
      )
    }

    const code = CODE_FOR_ACT[citation.act]
    const formatted = isOldAct(citation.act)
      ? oldActCitation(citation.act, citation.section)
      : await formatWithTool(tools, code, citation.section, signal)

    if (!formatted) {
      problems.push(
        `Dropped the citation "${citation.act} ${citation.section}": the section tables have no such section.`,
      )
      continue
    }

    seen.add(full)
    out.push({
      act: citation.act,
      code,
      section: citation.section,
      toolResultId,
      citation: formatted,
      heading: headings.get(full) ?? headings.get(base) ?? null,
    })
  }

  return out
}

/**
 * `Section 420 IPC` / `भा.दं.सं. की धारा 420`.
 *
 * `format_citation` is a tool over the NEW Acts — it cites BNS 318(4), naming
 * IPC 420 in the parenthesis — so it cannot produce a citation OF the repealed
 * provision, which is what a reader who asked about 420 wants to see beside the
 * new number. The two forms here are the same ones `formatCitation()` builds
 * inside its own parenthesis, from the same `ACT_SHORT` table.
 */
function oldActCitation(act: OldActId, section: string): Bilingual {
  return {
    en: `Section ${section} ${ACT_SHORT[act].en}`,
    hi: `${ACT_SHORT[act].hi} की धारा ${section}`,
  }
}

async function formatWithTool(
  tools: readonly RegisteredTool[],
  code: LawCode,
  section: string,
  signal: AbortSignal | undefined,
): Promise<Bilingual | null> {
  const [en, hi] = await Promise.all([
    callTool(tools, 'format_citation', { code, section, lang: 'en' }, signal),
    callTool(tools, 'format_citation', { code, section, lang: 'hi' }, signal),
  ])
  const enOut = asRecord(en)
  const hiOut = asRecord(hi)
  if (enOut.found !== true || hiOut.found !== true) return null
  return { en: asString(enOut.citation), hi: asString(hiOut.citation) }
}

/**
 * Run a registered tool directly, with its own zod schema applied.
 *
 * The model is not in this path, which is the point: the citation an officer
 * copies out of this app is produced by the same code the Law Converter's own
 * share button uses, not by a model reproducing a format from memory.
 */
async function callTool(
  tools: readonly RegisteredTool[],
  name: string,
  input: unknown,
  signal: AbortSignal | undefined,
): Promise<unknown> {
  const tool = tools.find((entry) => entry.def.name === name)
  if (!tool) throw new AiError('unknown_tool', `The law agent needs the "${name}" tool.`)
  const validation = validateToolInput(tool, input)
  if (!validation.ok) throw new AiError('invalid_args', validation.message)
  const handler = tool.def.handler as (
    value: unknown,
    ctx: { language: Language; signal: AbortSignal },
  ) => Promise<unknown>
  return handler(validation.value, { language: 'en', signal: signal ?? new AbortController().signal })
}

/* ------------------------------------------------------------------ *
 * Plumbing
 * ------------------------------------------------------------------ */

function system({ language, context }: { language: Language; context: BuiltContext }) {
  return buildSystem({ agentId: AGENT_ID, language, context, instructions: LAW_INSTRUCTIONS })
}

function researchMessage({
  question,
  offenceDate,
  policy,
  steer,
}: {
  question: string
  offenceDate: string | null
  policy: TierPolicy
  steer: boolean
}): string {
  return [
    'RESEARCH PASS. Gather what this question needs from the section tables. Do not answer it yet.',
    '',
    'Question:',
    question,
    '',
    offenceDate
      ? `The reader gave an offence date of ${offenceDate}. You do not need to state the date rule — the application adds it.`
      : 'The reader gave no offence date.',
    steer
      ? 'The question is phrased as being about a particular person. Research the general rule it turns on, nothing about the person.'
      : '',
    '',
    policy.researchSteps <= 2
      ? 'You have ONE turn in which to call tools, so make it count: pick the single tool that answers this and call it once.'
      : 'Call search_sections first when you are not certain which Act a number belongs to, get_section before quoting what a section says, compare_old_new for anything phrased in a repealed Act’s numbering, and get_classification before saying anything about cognizability, bail or compoundability.',
    '',
    'When you have what you need, reply with the word "Gathered" followed by the handles of the tool',
    'results you used, and NOTHING else — for example: Gathered [T1] [T2].',
    'Do not write a section number, a heading or a summary in that reply. It is discarded; the tool',
    'results are what carry forward.',
  ]
    .filter(Boolean)
    .join('\n')
}

function answerMessage({
  question,
  policy,
  steer,
  snippetCount,
}: {
  question: string
  policy: TierPolicy
  steer: boolean
  snippetCount: number
}): string {
  return [
    `ANSWER PASS. You have no tools now. Everything you may say is in the ${snippetCount} numbered`,
    'PLATFORM CONTEXT snippets above; snippet [1] is the reader’s own question.',
    '',
    'Question:',
    question,
    '',
    `Answer in at most ${policy.answerSentences} sentences per language.`,
    steer
      ? 'The question is phrased as being about a particular person. Answer the general rule it turns on and say nothing about what will happen to anyone.'
      : '',
    '',
    'Rules for this turn, and each of them fails the answer if broken:',
    '- Every section number you write must come from a snippet, and you must cite that snippet as [n]',
    '  in the sentence that states it. Keep the [n] marks in BOTH languages.',
    '- Answer cognizability, bail or compoundability only from a snippet labelled',
    '  "(classification, BNSS First Schedule: …)". A section heading cannot settle those.',
    '- List every provision you name in `citations`, with its Act, its section as written, and the',
    '  handle [Tn] of the tool result the snippet came from — the snippet label ends with that handle.',
    '- Do not write the offence-date rule and do not write a disclaimer. Both are added for you.',
    '- Fill both `answer.en` and `answer.hi`. The Hindi is written in Hindi, not transliterated.',
  ]
    .filter(Boolean)
    .join('\n')
}

function mergedMeta(run: AgentRun, usage: TokenUsage, tier: AiTier, now: () => Date): AiOutputMeta {
  return {
    ...run.meta,
    promptVersion: PROMPT_VERSIONS[AGENT_ID],
    tier,
    tokens: usage,
    cost: estimateCost(run.meta.model, usage),
    at: now().toISOString(),
  }
}

function failed(run: AgentRun, usage: TokenUsage, results: readonly ToolResult[]): LawFailedResult {
  return {
    status: 'error',
    code: run.error?.code ?? 'empty',
    message: run.error?.message ?? 'The run produced no answer.',
    toolsCalled: results.map((result) => result.name),
    usage,
    cost: estimateCost(run.meta.model, usage),
  }
}

function cancelled(usage: TokenUsage, model: string): LawFailedResult {
  return {
    status: 'error',
    code: 'aborted',
    message: 'The run was cancelled.',
    toolsCalled: [],
    usage,
    cost: estimateCost(model, usage),
  }
}
