import { z } from 'zod'

import { runAgent, type AgentRun, type UsageLedger } from '../agent'
import { buildContext, validateCitations, type Snippet, type SnippetType } from '../context'
import { buildSystem, PROMPT_VERSIONS } from '../prompts'
import STUDY_INSTRUCTIONS from '../prompts/study.md?raw'
import type { AiProvider } from '../provider'
import { listTools, toJsonSchema, type RegisteredTool } from '../tools/registry'
import {
  EMPTY_USAGE,
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

/**
 * The study agent — the fifth agent this app runs, and the second that answers
 * in prose.
 *
 * ### It is the ADR-035 shape, and that is not a copy-paste
 *
 * `validateCitations()` rejects a provision number in a final answer that
 * appears in no CITED PLATFORM CONTEXT snippet, and tool results are not
 * context snippets — they arrive as `tool_result` blocks with the handles `T1`,
 * `T2`, which that function does not read. So a single pass that calls
 * `get_unit` and then writes "Rule 18 requires…" fails its own citation check
 * every time. `src/ai/agents/law.ts` hit this wall first and its ADR says
 * plainly that any future prose agent will hit it too. This is that agent, and
 * it starts from the shape rather than rediscovering it:
 *
 *   1. `screening`   — `screenStudyQuestion()`, pure, BEFORE any provider call.
 *   2. `researching` — one `runAgent` pass with the library tools.
 *   3. `reading`     — THIS FILE turns each successful tool result into a
 *                      numbered, type-labelled `Snippet`.
 *   4. `answering`   — one `runAgent` pass with NO tools, writing from those
 *                      snippets alone.
 *   5. `verifying`   — `validateCitations` with `requireCitation: true`, and
 *                      the personal-attribution check below.
 *
 * ### The one check this agent adds that the law agent did not need
 *
 * `get_my_notes` returns the reader's OWN writing, and it is the only tool in
 * this app that does. A model handed a note saying "I think this means X" and a
 * rule saying Y can write "the rule says X" without inventing a single word —
 * every clause traceable, the attribution wrong. `misattributesPersonal()` is
 * the code-side check for it: if the answer states a requirement whose only
 * support is a personal snippet, the run is refused. The persona says the same
 * thing, and `docs/AI.md`'s own checklist is why it is also in code — whatever
 * an agent asserts about its own output is re-derived before the reader sees it.
 */

/* ------------------------------------------------------------------ *
 * The refusal screen
 * ------------------------------------------------------------------ */

/**
 * What this screen refuses, and what it deliberately does not.
 *
 * Narrower than `screenBrief()` and wider than `screenLawQuestion()`, and both
 * differences are about what the surface is for. A DRAFTING brief that mentions
 * "confidential" is describing a document this app must not help carry, so that
 * screen refuses the word. A LAW question about "communicating secret
 * information" is a question about published statute, so that screen refuses a
 * record number instead. A STUDY question is asked while reading a rule book —
 * which includes the Official Secrets Act, so the word "secret" cannot be a
 * trigger here either.
 *
 * What it refuses is a question about a PARTICULAR MATTER: a named departmental
 * record, or a request for a decision on somebody's own case. Each record
 * pattern requires a digit after the word, so "what does Rule 14 say about a
 * charge-sheet" stays answerable and "our charge-sheet no. 42" does not.
 */
const RECORD_PATTERNS: readonly RegExp[] = [
  /\bf\.?i\.?r\.?\s*(?:no\.?|number|#)\s*[0-9]/i,
  /\bcharge[\s-]?sheet\s*(?:no\.?|number|#)\s*[0-9]/i,
  /\b(?:case|file|diary|memo|o\.?m\.?)\s*(?:no\.?|number|#)\s*[0-9]/i,
  /\bvigilance\s*(?:case|no\.?|number)\s*[0-9]/i,
  /(?:प्राथमिकी|एफ\.?आई\.?आर\.?)\s*(?:सं\.?|संख्या|क्रमांक)\s*[0-9०-९]/,
  /(?:फ़ाइल|फाइल|मामला|मुकदमा|आरोप-?पत्र)\s*(?:सं\.?|संख्या|क्रमांक)\s*[0-9०-९]/,
]

export interface StudyRefusal {
  reason: 'departmental'
  /** The exact text that matched, so the reader can see what to remove. */
  matched: string
  message: Bilingual
}

const RECORD_REFUSAL: Bilingual = {
  en:
    'This question names a departmental record, so nothing has been sent. Sahayak holds public, ' +
    'non-departmental data only. Ask the same question without the number — "what does Rule 14 require ' +
    'before a charge-sheet is drawn up" — and it can be answered.',
  hi:
    'इस प्रश्न में विभागीय अभिलेख का उल्लेख है, इसलिए कुछ भी भेजा नहीं गया। सहायक केवल सार्वजनिक, ' +
    'गैर-विभागीय डेटा रखता है। संख्या हटाकर वही प्रश्न पूछें — "आरोप-पत्र तैयार करने से पूर्व नियम 14 ' +
    'क्या अपेक्षित करता है" — तो उत्तर मिल जाएगा।',
}

/**
 * Pure, and called before the provider is constructed.
 * `src/ai/agents/study.test.ts` proves it by counting `MockProvider.calls` —
 * "we told the model to refuse" and "nothing was sent" are different claims.
 */
export function screenStudyQuestion(question: string): StudyRefusal | null {
  for (const pattern of RECORD_PATTERNS) {
    const match = pattern.exec(question)
    if (match) return { reason: 'departmental', matched: match[0].trim(), message: RECORD_REFUSAL }
  }
  return null
}

/* ------------------------------------------------------------------ *
 * Advice about a particular case
 * ------------------------------------------------------------------ */

const CASE_ADVICE_PATTERNS: readonly RegExp[] = [
  /\b(?:my|our|his|her|their)\s+(?:case|matter|inquiry|enquiry|charge|appeal|promotion|increment|suspension)\b/i,
  /\bwhat\s+should\s+(?:i|we|he|she|they)\s+do\b/i,
  /\bwill\s+(?:i|we|he|she|they)\s+(?:be|get)\s+(?:punished|dismissed|removed|promoted|paid)\b/i,
  /\b(?:am|is|are)\s+(?:i|he|she|they|we)\s+(?:liable|guilty|entitled)\b/i,
  /(?:मेरे|मेरी|मेरा|हमारे|हमारा|उसके|उसकी)\s*(?:मामले|मामला|जाँच|आरोप|अपील|पदोन्नति|निलंबन)/,
  /(?:मुझे|हमें)\s+क्या\s+करना\s+चाहिए/,
]

export interface CaseAdviceSteer {
  matched: string
  caveat: Bilingual
}

const CASE_ADVICE_CAVEAT: Bilingual = {
  en:
    'This answers the general rule and the provision it comes from. It is not advice about any ' +
    'particular case or file, and it does not say what an authority will decide on a given set of ' +
    'facts. For that, read the record and ask your administration.',
  hi:
    'यह उत्तर सामान्य नियम और उसका उपबंध बताता है। यह किसी विशेष मामले अथवा फ़ाइल पर सलाह नहीं है, और ' +
    'यह नहीं बताता कि किन्हीं तथ्यों पर कोई प्राधिकारी क्या निर्णय करेगा। उसके लिए अभिलेख देखें और ' +
    'अपने प्रशासन से पूछें।',
}

/**
 * A STEER, not a refusal — the distinction `src/ai/agents/law.ts` draws and the
 * reason it gives. "Will I be punished for this" has a real general core: what
 * the rule requires and what the penalty provision says. The officer deserves
 * that answer without a prediction about themselves.
 *
 * `heuristics.ts#isPersonalQuery` is deliberately not reused: it matches
 * "can I" and "should I", which open a large share of perfectly ordinary study
 * questions ("can I take commuted leave without a certificate"), and its bias —
 * a false positive costs a cache hit — is wrong for a control that changes the
 * answer.
 */
export function caseAdviceSteer(question: string): CaseAdviceSteer | null {
  for (const pattern of CASE_ADVICE_PATTERNS) {
    const match = pattern.exec(question)
    if (match) return { matched: match[0].trim(), caveat: CASE_ADVICE_CAVEAT }
  }
  return null
}

/* ------------------------------------------------------------------ *
 * The caveats this app owns
 * ------------------------------------------------------------------ */

/** The master context's own disclaimer, verbatim from every dataset. */
export const STUDY_DISCLAIMER: Bilingual = {
  en: 'Reference only; verify with the official gazette/order or your DDO.',
  hi: 'केवल संदर्भ हेतु; आधिकारिक राजपत्र/आदेश या अपने डीडीओ से सत्यापित करें।',
}

/**
 * Shown when a study aid was among the snippets.
 *
 * Carried on the RESULT rather than pushed into `caveats`, and as text rather
 * than a boolean — the two reasons `src/ai/agents/law.ts#curatedHindiNote`
 * gives, and both apply here. A mark that depends on what the answer used must
 * not be frozen at the moment the run ends; and the panel must not `import` the
 * agent for a string, or the dynamic import that keeps the agent out of the
 * panel's chunk is quietly undone.
 */
export const AID_NOTE: Bilingual = {
  en:
    'Part of this answer rests on a study aid — Sahayak’s own explanation of the provision, reviewed ' +
    'here but published by no Ministry. The provision’s own text is what governs.',
  hi:
    'इस उत्तर का एक भाग अध्ययन सहायिका पर आधारित है — यह उपबंध की सहायक द्वारा लिखी अपनी व्याख्या है, ' +
    'यहाँ समीक्षित किंतु किसी मंत्रालय द्वारा प्रकाशित नहीं। शासन उपबंध के अपने पाठ का ही होता है।',
}

/** Shown when the reader's own note or highlight was among the snippets. */
export const PERSONAL_NOTE: Bilingual = {
  en: 'This answer refers to something you wrote yourself. Your notes are yours, not the law.',
  hi: 'यह उत्तर उस बात का उल्लेख करता है जो आपने स्वयं लिखी थी। आपकी टिप्पणियाँ आपकी हैं, विधि नहीं।',
}

/* ------------------------------------------------------------------ *
 * The tier policy
 * ------------------------------------------------------------------ */

/**
 * Tier 0 runs a 1.5B model in the reader's own browser, so the run has to be
 * smaller. `docs/AI.md` §11's last checklist item asks for this row on any
 * agent that can run there, and the reason it gives is the right one: a step
 * cap sized for a frontier model is a minute of waiting per step on a device
 * generating twenty tokens a second.
 */
export interface TierPolicy {
  researchSteps: number
  maxToolResults: number
  answerSentences: number
}

export const TIER_POLICIES: Readonly<Record<'default' | 'local', TierPolicy>> = {
  default: { researchSteps: 6, maxToolResults: 8, answerSentences: 6 },
  local: { researchSteps: 2, maxToolResults: 1, answerSentences: 2 },
}

export const policyForTier = (tier: AiTier): TierPolicy =>
  tier === 'local' ? TIER_POLICIES.local : TIER_POLICIES.default

/* ------------------------------------------------------------------ *
 * What the model returns
 * ------------------------------------------------------------------ */

const bilingualText = z.object({ en: z.string().min(1), hi: z.string().min(1) })

const answerSchema = z.object({
  answer: bilingualText,
  /** The 1-based snippet indices the answer rests on. */
  used: z.array(z.number().int().min(1).max(99)),
  caveats: z.array(bilingualText).optional(),
})

/* ------------------------------------------------------------------ *
 * Progress, and the result
 * ------------------------------------------------------------------ */

export const STUDY_PHASES = ['screening', 'researching', 'reading', 'answering', 'verifying', 'done'] as const
export type StudyPhase = (typeof STUDY_PHASES)[number]

/** `tool` is the registered tool's NAME, translated by the panel. */
export interface StudyStep {
  phase: StudyPhase
  tool?: string
}

export type StudyProgress = (step: StudyStep) => void

/** One numbered snippet the answer may cite, for the `[n]` marks on screen. */
export interface StudySnippet {
  index: number
  kind: SnippetType
  label: Bilingual
  /** Where the reader can open it, when it points at something openable. */
  href: string | null
  /** The reader's own writing. Rendered differently, always. */
  personal: boolean
}

export interface StudyAnswerResult {
  status: 'answer'
  question: string
  answer: Bilingual
  snippets: StudySnippet[]
  /** The disclaimer last; the case-advice steer first when it applies. */
  caveats: Bilingual[]
  /** Set when a study aid was among the cited snippets. */
  aidNote: Bilingual | null
  /** Set when the reader's own note or highlight was among them. */
  personalNote: Bilingual | null
  problems: string[]
  usage: TokenUsage
  cost: number
  meta: AiOutputMeta
}

export interface StudyRefusedResult {
  status: 'refused'
  refusal: StudyRefusal
}

export interface StudyFailedResult {
  status: 'error'
  code: AiErrorCode
  message: string
  toolsCalled: string[]
  usage: TokenUsage
  cost: number
}

export type StudyAgentResult = StudyAnswerResult | StudyRefusedResult | StudyFailedResult

/** The six things the surface offers. Free text is `custom`. */
export const STUDY_INTENTS = [
  'simpler',
  'example',
  'difference',
  'whatIf',
  'summarise',
  'quiz',
  'custom',
] as const
export type StudyIntent = (typeof STUDY_INTENTS)[number]

export interface StudyAgentParams {
  provider: AiProvider
  /** What the reader typed, or the prompt the intent button carries. */
  question: string
  intent: StudyIntent
  language: Language
  /** The work and unit the reader has open. The agent starts from these. */
  workId: string
  unitId?: string | null
  /** A table-of-contents node, for "summarise this chapter". */
  nodeId?: string | null
  /** Whether the reader's own notes may be read. Default false. */
  includeNotes?: boolean
  tools?: readonly RegisteredTool[]
  signal?: AbortSignal
  onProgress?: StudyProgress
  onPartialAnswer?: (text: string) => void
  onEvent?: AiEventHandler
  tier?: AiTier
  budgetLimit?: number | null
  model?: string
  ledger?: UsageLedger
  now?: () => Date
}

const AGENT_ID = 'study-explain' as const

/* ------------------------------------------------------------------ *
 * Stage 3 — tool results become numbered, labelled snippets
 * ------------------------------------------------------------------ */

/**
 * Which `SnippetType` a tool result is labelled with.
 *
 * The labels are the substance of this stage, exactly as they are in
 * `src/ai/agents/law.ts`: a study aid and a rule read alike in a prompt and
 * only one of them is the law, and a personal note read under a `rule` label
 * would be indistinguishable from a provision. `progress` is the label
 * `buildContext` renders as "user's own progress", which is the closest honest
 * description this vocabulary has for the reader's own writing.
 */
const SNIPPET_TYPES: Readonly<Record<string, SnippetType>> = {
  get_unit: 'rule',
  get_study_aid: 'note',
  get_definitions: 'glossary',
  retrieve: 'rule',
  get_related_cards: 'note',
  get_my_notes: 'progress',
}

interface ReadResult {
  snippets: Snippet[]
  meta: StudySnippet[]
  dropped: number
  usedAid: boolean
  usedPersonal: boolean
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}

const str = (value: unknown): string => (typeof value === 'string' ? value : '')

/**
 * Turn each successful tool result into one snippet.
 *
 * A tool that SUCCEEDED and FOUND NOTHING produces no snippet, and that
 * distinction is the one `src/ai/agents/law.ts` learned the hard way: `found:
 * false` is `ok: true`, so gating on "did any tool succeed" let a run that had
 * read nothing pay for an answer pass whose entire context was the reader's own
 * question — and the only numbers such a context can support are the ones the
 * reader typed.
 */
function readToolResults(results: readonly ToolResult[], policy: TierPolicy): ReadResult {
  const snippets: Snippet[] = []
  const meta: StudySnippet[] = []
  let usedAid = false
  let usedPersonal = false
  let dropped = 0

  for (const result of results) {
    if (!result.ok) continue
    if (snippets.length >= policy.maxToolResults) {
      dropped += 1
      continue
    }

    const output = asRecord(result.output)
    const type = SNIPPET_TYPES[result.name] ?? 'note'
    const personal = result.name === 'get_my_notes'

    const built = describe(result.name, output)
    if (!built) continue

    if (result.name === 'get_study_aid') usedAid = true
    if (personal) usedPersonal = true

    const index = snippets.length + 1
    snippets.push({ type, source: built.source, text: built.text, id: `s${index}` })
    meta.push({
      index: index + 1, // +1: snippet [1] is always the reader's question.
      kind: type,
      label: { en: built.source, hi: built.source },
      href: built.href,
      personal,
    })
  }

  return { snippets, meta, dropped, usedAid, usedPersonal }
}

interface Described {
  source: string
  text: string
  href: string | null
}

/**
 * One tool's output as prose the model can read, and a source line naming it.
 *
 * A provision inside a snippet is written `Rule 18 of the CCS (Conduct) Rules`
 * rather than `ccs-conduct-18`, for the reason ADR-035 records:
 * `validateCitations` extracts the full reference only after the unit word, and
 * its bare-numeral fallback would split a bracketed sub-rule in two.
 */
function describe(tool: string, output: Record<string, unknown>): Described | null {
  switch (tool) {
    case 'get_unit': {
      if (output.found !== true) return null
      const work = str(output.work)
      const unit = str(output.unit)
      return {
        source: str(output.citation) || `${work} ${unit}`,
        text: [str(output.heading), str(output.text)].filter(Boolean).join(' — '),
        href: work && unit ? `/study/read/${work}/${unit}` : null,
      }
    }
    case 'get_study_aid': {
      if (output.found !== true) return null
      const work = str(output.work)
      const unit = str(output.unit)
      const lines = [
        str(output.explanation),
        str(output.example),
        str(output.misconception),
        str(output.examRelevance),
        str(output.mnemonic),
      ].filter(Boolean)
      if (lines.length === 0) return null
      return {
        source: `study aid, ${work} ${unit}`,
        text: lines.join(' '),
        href: work && unit ? `/study/read/${work}/${unit}` : null,
      }
    }
    case 'get_definitions': {
      const terms = Array.isArray(output.terms) ? output.terms : []
      if (terms.length === 0) return null
      return {
        source: `defined terms, ${str(output.work)}`,
        text: terms
          .slice(0, 8)
          .map((raw) => {
            const term = asRecord(raw)
            return `"${str(term.term)}" means ${str(term.definition)}`
          })
          .join(' '),
        href: null,
      }
    }
    case 'retrieve': {
      const results = Array.isArray(output.results) ? output.results : []
      if (results.length === 0) return null
      return {
        source: `search of ${str(output.work)} for "${str(output.query)}"`,
        text: results
          .slice(0, 5)
          .map((raw) => {
            const hit = asRecord(raw)
            return `${str(hit.citation)}: ${str(hit.heading)} ${str(hit.text)}`.trim()
          })
          .join(' | '),
        href: null,
      }
    }
    case 'get_related_cards': {
      const cards = Array.isArray(output.cards) ? output.cards : []
      if (cards.length === 0) return null
      return {
        source: `practice questions on ${str(output.work)}`,
        text: cards
          .slice(0, 6)
          .map((raw) => {
            const card = asRecord(raw)
            return `Q: ${str(card.question)} A: ${str(card.answer)} (${str(card.citation)})`
          })
          .join(' | '),
        href: null,
      }
    }
    case 'get_my_notes': {
      const notes = Array.isArray(output.notes) ? output.notes : []
      const highlights = Array.isArray(output.highlights) ? output.highlights : []
      if (notes.length === 0 && highlights.length === 0) return null
      const written = notes
        .slice(0, 6)
        .map((raw) => `note: ${str(asRecord(raw).body)}`)
        .concat(highlights.slice(0, 6).map((raw) => `marked: "${str(asRecord(raw).quote)}"`))
      return {
        // Named in the snippet itself, not only in the type label — a model
        // reading fast has two chances to notice whose words these are.
        source: 'the reader’s OWN notes and highlights (not the law)',
        text: written.join(' | '),
        href: null,
      }
    }
    default:
      return null
  }
}

/* ------------------------------------------------------------------ *
 * Stage 5 — the check the persona alone cannot enforce
 * ------------------------------------------------------------------ */

/**
 * Sentences that state a REQUIREMENT — what a provision obliges, forbids or
 * permits. Both languages, and the Devanagari alternatives are unanchored for
 * the reason `\b` cannot help them (ADR-035, ADR-038).
 */
const REQUIREMENT =
  /\b(?:must|shall|may not|is required to|requires|forbids|prohibits|permits|entitles)\b|(?:चाहिए|होगा|वर्जित|अपेक्षित|अनुज्ञेय)/iu

/**
 * True when the answer states a requirement and the ONLY snippet it says it
 * used is the reader's own writing.
 *
 * The failure this guards is subtle and entirely plausible: a model handed a
 * note saying "I think this means X" and a rule saying Y can write "the rule
 * requires X" without inventing a word — every clause traceable, the
 * attribution wrong. A reader would have no way to tell, because the citation
 * chip would resolve to something real.
 *
 * It reads `used` — the indices the MODEL says it relied on — rather than the
 * `[n]` marks, deliberately: a model that leaned on a note and cited a rule for
 * cover is exactly the case, and `used` is where that shows.
 */
export function misattributesPersonal(
  answer: string,
  used: readonly number[],
  personalIndices: ReadonlySet<number>,
): boolean {
  if (!REQUIREMENT.test(answer)) return false
  if (used.length === 0) return false
  return used.every((index) => personalIndices.has(index))
}

/* ------------------------------------------------------------------ *
 * The run
 * ------------------------------------------------------------------ */

const INTENT_INSTRUCTION: Readonly<Record<StudyIntent, string>> = {
  simpler: 'Explain the provision in simpler words. Keep every limitation it carries.',
  example: 'Give one further worked example, in the same shape as the aid’s but a different situation.',
  difference: 'State what each provision requires, then the difference between them.',
  whatIf:
    'Answer only from the provisions you were given. Name the provision that would answer anything else.',
  summarise: 'One line per provision, in the chapter’s own order.',
  quiz: 'Propose questions the reader can review. Say that a human accepts them before they are scheduled.',
  custom: 'Answer the question asked, from the snippets alone.',
}

export async function runStudyAgent(params: StudyAgentParams): Promise<StudyAgentResult> {
  const {
    provider,
    question,
    intent,
    language,
    workId,
    unitId = null,
    nodeId = null,
    includeNotes = false,
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

  const policy = policyForTier(tier)
  const step = (phase: StudyPhase, tool?: string) => onProgress?.(tool ? { phase, tool } : { phase })

  /* ---- 1. screen ------------------------------------------------- */

  step('screening')

  if (!question.trim()) {
    return {
      status: 'error',
      code: 'empty',
      message: 'There is no question to answer.',
      toolsCalled: [],
      usage: { ...EMPTY_USAGE },
      cost: 0,
    }
  }

  const refusal = screenStudyQuestion(question)
  if (refusal) return { status: 'refused', refusal }

  const steer = caseAdviceSteer(question)

  /*
    `get_my_notes` is withheld unless the caller asked for it, and the model is
    told the tool does not exist rather than told not to use it. A tool that is
    absent cannot be called; a tool that is present and forbidden is one
    instruction away from being called.
  */
  const all = params.tools ?? listTools('library')
  const tools = includeNotes ? all : all.filter((tool) => tool.def.name !== 'get_my_notes')

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
      {
        type: 'note',
        source: 'where the reader is',
        id: 'place',
        text: `Work: ${workId}. ${unitId ? `Unit: ${unitId}.` : ''} ${nodeId ? `Chapter node: ${nodeId}.` : ''}`,
      },
    ],
    'en',
  )

  const researchRun = await runAgent({
    agentId: AGENT_ID,
    provider,
    tools,
    system: system({ language, context: researchCtx }),
    userMessage: researchMessage({ question, intent, workId, unitId, nodeId, policy }),
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

  /*
    The research pass's closing sentence is DISCARDED — the tool results are its
    output — so two of `runAgent`'s failures are not failures of this run.
    `ungrounded` says that sentence cited no handle; `invalid_citation` says it
    named a number which, because tool results are not context snippets, could
    never be "supported" at this stage. Neither says anything about what the
    reader will be shown. ADR-035 §2 has the full argument; there is a test on
    each branch, because a tolerance with no test on its negative side is an
    unconditional bypass.
  */
  const TOLERATED: readonly AiErrorCode[] = ['ungrounded', 'invalid_citation']
  const gathered = researchRun.toolResults.filter((result) => result.ok)
  if (!researchRun.ok) {
    const code = researchRun.error?.code
    if (!code || !TOLERATED.includes(code)) return failed(researchRun, usage, researchRun.toolResults)
    if (gathered.length > 0) {
      problems.push(
        `The research pass ended with "${code}" — its closing sentence was discarded and the ` +
          `${gathered.length} tool result(s) it had already gathered were used.`,
      )
    }
  }

  const nothingRead = (): StudyFailedResult => ({
    status: 'error',
    code: 'ungrounded',
    message:
      'The assistant read nothing from this work, so there is nothing to answer from. Try naming the ' +
      'rule or section number you are asking about.',
    toolsCalled: researchRun.toolResults.map((result) => result.name),
    usage,
    cost: estimateCost(researchRun.meta.model, usage),
  })

  if (gathered.length === 0) return nothingRead()
  if (signal?.aborted) return cancelled(usage, researchRun.meta.model)

  /* ---- 3. read --------------------------------------------------- */

  step('reading')
  const read = readToolResults(gathered, policy)
  if (read.dropped > 0) {
    problems.push(
      `${read.dropped} tool result(s) beyond this tier’s limit of ${policy.maxToolResults} were not read.`,
    )
  }
  if (read.snippets.length === 0) return nothingRead()

  const answerCtx = buildContext(
    [{ type: 'note', source: 'the reader’s question', id: 'question', text: question }, ...read.snippets],
    'en',
  )
  const personalIndices = new Set(read.meta.filter((entry) => entry.personal).map((entry) => entry.index))

  /* ---- 4. answer -------------------------------------------------- */

  step('answering')
  let streamed = ''
  const answerRun = await runAgent({
    agentId: AGENT_ID,
    provider,
    // No tools: everything the answer may contain is already a numbered
    // snippet, and a tool call here would produce a result nothing validated.
    // `groundedRequired` is off for the same reason and the grounding is
    // re-derived below, harder — ADR-035 §1.
    tools: [],
    groundedRequired: false,
    system: system({ language, context: answerCtx }),
    userMessage: answerMessage({
      question,
      intent,
      policy,
      steer: Boolean(steer),
      snippetCount: answerCtx.entries.length,
    }),
    jsonSchema: { name: 'study_answer', schema: toJsonSchema(answerSchema) },
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
      if (event.type === 'token' && onPartialAnswer) {
        streamed += event.text
        const partial = partialAnswerText(streamed, language)
        if (partial) onPartialAnswer(partial)
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

  if (misattributesPersonal(answerText, parsed.data.used, personalIndices)) {
    return {
      status: 'error',
      code: 'invalid_citation',
      message:
        'The answer states what a provision requires but rests only on the reader’s own notes. A note ' +
        'is not the law, so the answer was discarded.',
      toolsCalled: researchRun.toolResults.map((result) => result.name),
      usage,
      cost: estimateCost(answerRun.meta.model, usage),
    }
  }

  if (signal?.aborted) return cancelled(usage, answerRun.meta.model)

  /* ---- 6. the caveats this app owns ------------------------------- */

  const cited = new Set(citations.cited)
  const caveats: Bilingual[] = [
    ...(steer ? [steer.caveat] : []),
    ...(parsed.data.caveats ?? []),
    STUDY_DISCLAIMER,
  ]

  step('done')
  return {
    status: 'answer',
    question,
    answer: parsed.data.answer,
    snippets: read.meta,
    caveats,
    aidNote: read.usedAid ? AID_NOTE : null,
    personalNote:
      read.usedPersonal && [...personalIndices].some((index) => cited.has(index)) ? PERSONAL_NOTE : null,
    problems,
    usage,
    cost: estimateCost(answerRun.meta.model, usage),
    meta: { ...answerRun.meta, agentId: AGENT_ID, promptVersion: PROMPT_VERSIONS[AGENT_ID], tokens: usage },
  }

  /* ---------------------------------------------------------------- */

  function failed(run: AgentRun, spent: TokenUsage, results: readonly ToolResult[]): StudyFailedResult {
    return {
      status: 'error',
      code: run.error?.code ?? 'provider',
      message: run.error?.message ?? 'The run did not finish.',
      toolsCalled: results.map((result) => result.name),
      usage: spent,
      cost: estimateCost(run.meta.model, spent),
    }
  }

  function cancelled(spent: TokenUsage, usedModel: string): StudyFailedResult {
    return {
      status: 'error',
      code: 'aborted',
      message: 'The run was cancelled.',
      toolsCalled: [],
      usage: spent,
      cost: estimateCost(usedModel, spent),
    }
  }
}

/* ------------------------------------------------------------------ *
 * Prompt assembly
 * ------------------------------------------------------------------ */

function system({ language, context }: { language: Language; context: ReturnType<typeof buildContext> }) {
  return buildSystem({ agentId: AGENT_ID, language, context, instructions: STUDY_INSTRUCTIONS })
}

function researchMessage(input: {
  question: string
  intent: StudyIntent
  workId: string
  unitId: string | null
  nodeId: string | null
  policy: TierPolicy
}): string {
  return [
    `The reader is in work "${input.workId}"${input.unitId ? `, on unit "${input.unitId}"` : ''}${
      input.nodeId ? `, in chapter node "${input.nodeId}"` : ''
    }.`,
    `They asked: ${input.question}`,
    INTENT_INSTRUCTION[input.intent],
    '',
    'GATHER ONLY. Call the tools you need and nothing more.',
    `Use at most ${input.policy.researchSteps - 1} tool-calling turn(s).`,
    'Then reply with exactly the handles you used and nothing else, like: Gathered [T1] [T2]',
  ].join('\n')
}

function answerMessage(input: {
  question: string
  intent: StudyIntent
  policy: TierPolicy
  steer: boolean
  snippetCount: number
}): string {
  return [
    `The reader asked: ${input.question}`,
    INTENT_INSTRUCTION[input.intent],
    '',
    `You have ${input.snippetCount} numbered snippet(s) and no tools. Write from those alone.`,
    `Keep the answer to about ${input.policy.answerSentences} sentence(s) in each language.`,
    'Cite every snippet you use as [n] in the sentence it supports, and list the same numbers in `used`.',
    input.steer
      ? 'The reader asked about their own situation. Answer the general rule and say that is what you are answering. Do not predict an outcome.'
      : '',
    'Do not write the "verify with the gazette or your DDO" line; the app adds it.',
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * The answer as it streams, read out of half-arrived JSON.
 *
 * Best-effort by construction — the rendered value always comes from
 * `JSON.parse` at the end. The same shape `src/ai/agents/law.ts` uses, and it
 * matters most on Tier 0, where a run takes half a minute.
 */
export function partialAnswerText(streamed: string, language: Language): string {
  const pattern = new RegExp(`"${language}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)`)
  const match = pattern.exec(streamed)
  if (!match?.[1]) return ''
  try {
    return JSON.parse(`"${match[1]}"`) as string
  } catch {
    // A trailing backslash mid-escape. Nothing to show yet.
    return ''
  }
}
