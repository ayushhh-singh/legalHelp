import { z } from 'zod'

import { runAgent, type AgentRun, type UsageLedger } from '../agent'
import { buildContext, type BuiltContext, type Snippet } from '../context'
import DRAFTING_INSTRUCTIONS from '../prompts/drafting.md?raw'
import { buildSystem, PROMPT_VERSIONS } from '../prompts'
import type { AiProvider } from '../provider'
import { glossaryIndex } from '../tools/glossary'
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
} from '../types'
import { addUsage, estimateCost } from '../usage'

import type { Language } from '@/i18n'
import type { DocTemplate, TemplateField } from '@/modules/drafting/schema'
import { loadPhrases } from '@/modules/drafting/data'
import { searchGlossary } from '@/modules/utils/glossary/search'
import type { DraftValues, FieldValue, Lang } from '@/lib/drafting/types'

/**
 * The Drafting Studio's agent — the first agent in this app that runs.
 *
 * ### Why it is not one call to a model
 *
 * A model asked to "write an Office Memorandum" writes something that looks
 * like one. What makes a document the right document here is not prose quality:
 * it is that the third-person rule holds, that the first paragraph is
 * unnumbered and the rest run from 2, that an enclosure mentioned in the body
 * is listed at the foot, and that no blank was quietly filled in with a
 * plausible file number. Every one of those is already decided by
 * `data/drafting` and already checkable by `src/lib/drafting/checklist.ts`.
 *
 * So the agent's job is narrow: produce FIELD VALUES, and let the engine lay
 * them out and mark them. Five stages, of which two are the model's and three
 * are this file's:
 *
 *   1. **screen**   — `screenBrief()`, pure and before any provider call. A
 *                     brief that looks like classified or departmental
 *                     material is refused here, so nothing leaves the device.
 *   2. **plan**     — one `runAgent` pass. The model picks the form, explains
 *                     it in a line, asks at most three clarifying questions,
 *                     and returns field values as structured output.
 *   3. **check**    — THIS FILE calls `render_draft` and `check_draft` over the
 *                     values that actually came back. Not the model: a model
 *                     that reports its own checklist as passing is reporting an
 *                     intention, and the whole point of the checklist is that
 *                     it is evaluated against the rendered document.
 *   4. **revise**   — one further `runAgent` pass, and only one, given the
 *                     failing items and their `why`.
 *   5. **recheck**  — stage 3 again, over the revision. The outcome returned to
 *                     the reader is always a real evaluation of the values
 *                     being returned, never a claim.
 *
 * A revision is kept only if it does not make `must` failures worse. A model
 * asked to fix three items and returning a draft that fails four is not an
 * improvement, and silently taking it would be worse than saying so.
 *
 * ### What is sent, and what is not
 *
 * The brief the officer typed, the template specification, the phrases and the
 * glossary hits. **Never the `drafts` table**: no tool in this app can reach it
 * (`src/ai/tools/drafting.ts`), and this agent takes its starting values as an
 * argument from the editor rather than reading a row. `improveWording` sends
 * exactly one field's text and nothing else — the field the officer pressed the
 * button on, which is the text the diff will show them.
 *
 * ### Grounding
 *
 * `groundedRequired` is on (`TASK_DEFAULTS['draft-assist']`), so a final answer
 * that cites no tool result is discarded rather than shown, and
 * `validateCitations` independently rejects a rule or paragraph number that
 * appears in no cited snippet. That second rule bites here in a way it does not
 * elsewhere: the answer carries the officer's document text, so a rule number
 * invented INSIDE a paragraph fails the run. That is the correct direction —
 * an invented citation in a document somebody signs is the worst thing this
 * feature could produce — and it is why the officer's own brief is context
 * snippet [1]. A number the brief gave is a number the model may repeat.
 */

/* ------------------------------------------------------------------ *
 * The refusal screen
 * ------------------------------------------------------------------ */

export const REFUSAL_REASONS = ['classified', 'departmental'] as const
export type RefusalReason = (typeof REFUSAL_REASONS)[number]

/**
 * Words that mean the brief is describing material this app must not carry.
 *
 * The bias is deliberately one-way and it is the opposite of the answer-cache
 * heuristics: there, a false positive costs a cache hit; here, a false negative
 * sends an officer's classified brief to a model endpoint. So a brief that
 * merely MENTIONS a classification marking is refused, even though "please
 * draft a note about the confidential report procedure" is an innocent
 * sentence. The refusal says what to do about it — rewrite the brief without
 * the marking — rather than leaving the officer guessing.
 *
 * `secret` is word-bounded so that "Secretary" and "Secretariat", which appear
 * in almost every document this app drafts, do not match.
 */
const SENSITIVE_PATTERNS: ReadonlyArray<{ reason: RefusalReason; pattern: RegExp }> = [
  { reason: 'classified', pattern: /\bclassified\b/i },
  { reason: 'classified', pattern: /\btop[\s-]?secret\b/i },
  { reason: 'classified', pattern: /\bsecret\b/i },
  { reason: 'classified', pattern: /\bconfidential\b/i },
  { reason: 'classified', pattern: /\bfor official use only\b/i },
  { reason: 'classified', pattern: /(गोपनीय|वर्गीकृत)/ },
  { reason: 'classified', pattern: /केवल कार्यालय (?:प्रयोग|उपयोग)/ },
  { reason: 'departmental', pattern: /\bintelligence (?:input|report)\b/i },
  { reason: 'departmental', pattern: /\bcase (?:diary|file)\b/i },
  { reason: 'departmental', pattern: /(?:आसूचना|गुप्तचर)\s*(?:सूचना|रिपोर्ट)/ },
]

export interface BriefRefusal {
  reason: RefusalReason
  /** The exact text that matched, so the officer can see what to remove. */
  matched: string
  message: Bilingual
}

const REFUSAL_MESSAGES: Record<RefusalReason, Bilingual> = {
  classified: {
    en:
      'This brief names classified or confidential material, so nothing has been sent. Do not enter ' +
      'official, sensitive or classified content, file numbers, or anything that identifies a person. ' +
      'Rewrite the brief without it and the same document can be drafted.',
    hi:
      'इस विवरण में गोपनीय अथवा वर्गीकृत सामग्री का उल्लेख है, इसलिए कुछ भी भेजा नहीं गया। शासकीय, ' +
      'संवेदनशील अथवा गोपनीय सामग्री, फाइल संख्या, अथवा किसी व्यक्ति की पहचान कराने वाली कोई बात यहाँ ' +
      'न लिखें। उसे हटाकर विवरण फिर से लिखें — वही दस्तावेज़ तैयार हो जाएगा।',
  },
  departmental: {
    en:
      'This brief names departmental record material, so nothing has been sent. Sahayak holds public, ' +
      'non-departmental data only. Describe the document you need without the record and it can be ' +
      'drafted.',
    hi:
      'इस विवरण में विभागीय अभिलेख सामग्री का उल्लेख है, इसलिए कुछ भी भेजा नहीं गया। सहायक केवल ' +
      'सार्वजनिक, गैर-विभागीय डेटा रखता है। अभिलेख का उल्लेख किए बिना बताएँ कि कौन-सा दस्तावेज़ चाहिए।',
  },
}

/**
 * Pure, and called before the provider is touched. Returns `null` when the
 * text may be sent.
 *
 * Call it on EVERYTHING a run would send, not on the brief alone. The officer's
 * existing draft goes out as a PLATFORM CONTEXT snippet so the agent completes
 * their work rather than replacing it, and the draft is the likelier of the two
 * to carry a marking — `screenOutbound()` below is the one callers should
 * reach for.
 */
export function screenBrief(brief: string): BriefRefusal | null {
  for (const { reason, pattern } of SENSITIVE_PATTERNS) {
    const match = pattern.exec(brief)
    if (match) return { reason, matched: match[0], message: REFUSAL_MESSAGES[reason] }
  }
  return null
}

/**
 * Every piece of text a run would put on the wire, screened as one string.
 *
 * A clean brief over a draft whose body names a classified annexure used to
 * pass, because only the brief was read. The values are serialised rather than
 * walked: a marking can sit in any field, and a screen that had to be told
 * which fields to look at is a screen that misses the fifteenth one.
 */
export function screenOutbound(parts: readonly (string | undefined)[]): BriefRefusal | null {
  return screenBrief(parts.filter(Boolean).join('\n'))
}

/* ------------------------------------------------------------------ *
 * Field values: a zod schema per template
 * ------------------------------------------------------------------ */

/**
 * The blank an officer fills in with a pen.
 *
 * Four underscores rather than `{{fileNumber}}`, because CSMOP's own
 * `no-placeholders` checklist item reads a brace as an unfilled draft and fails
 * the document (`src/lib/drafting/checklist.ts`). A blank that fails the
 * checklist would push the model towards inventing a file number to make the
 * checklist pass, which is precisely the outcome the blank exists to prevent.
 */
export const BLANK = '____'
const BLANK_PATTERN = /_{3,}/

/**
 * One field's accepted shapes: the plain value, or the `{ en, hi }` pair the
 * bilingual editor produces once the two issues diverge.
 *
 * A model hands back whatever shape it likes, so a `paras` field that arrives
 * as one newline-joined string is split rather than rejected — the engine's
 * contract is a list, and a run thrown away over a shape the caller can fix is
 * a run the officer pays for twice.
 */
function valueSchema(field: TemplateField): z.ZodType<FieldValue> {
  const list = z.union([
    z.array(z.string()),
    z.string().transform((text) => (text.trim() === '' ? [] : text.split('\n').map((line) => line.trim()))),
  ])

  const base: z.ZodType<string | string[]> =
    field.type === 'paras' || field.type === 'list'
      ? list
      : field.type === 'select' && field.options && field.options.length > 0
        ? z.enum(field.options.map((option) => option.value) as [string, ...string[]])
        : z.string()

  return z.union([base, z.object({ en: base.optional(), hi: base.optional() }).strict()])
}

export interface FieldValuesResult {
  values: DraftValues
  /** Field ids the model produced that the template does not define. */
  unknownFields: string[]
  /** Field ids whose value did not fit the field's own type. */
  rejectedFields: string[]
  /** Field ids that carry a deliberate blank rather than an invented fact. */
  blanks: string[]
}

/**
 * Validate the model's field values against the template it chose.
 *
 * Unknown and ill-typed fields are DROPPED AND REPORTED rather than failing the
 * whole run — the same posture `src/ai/tools/drafting.ts` takes for the same
 * reason (a number where a string belongs renders as `[object Object]` in a
 * signed document, and a whole run discarded over one stray key helps nobody).
 * They are reported because a value that vanished and was reported by nothing
 * is the failure mode the strict schemas everywhere else in this app exist to
 * prevent.
 */
export function parseFieldValues(template: DocTemplate, raw: unknown): FieldValuesResult {
  const byId = new Map(template.fields.map((field) => [field.id, field]))
  const values: DraftValues = {}
  const unknownFields: string[] = []
  const rejectedFields: string[] = []
  const blanks: string[] = []

  const record = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}

  for (const [id, value] of Object.entries(record)) {
    const field = byId.get(id)
    if (!field) {
      unknownFields.push(id)
      continue
    }
    const parsed = valueSchema(field).safeParse(value)
    if (!parsed.success) {
      rejectedFields.push(id)
      continue
    }
    values[id] = parsed.data
    if (BLANK_PATTERN.test(JSON.stringify(parsed.data))) blanks.push(id)
  }

  return { values, unknownFields, rejectedFields, blanks: blanks.sort() }
}

/* ------------------------------------------------------------------ *
 * What the model returns
 * ------------------------------------------------------------------ */

const bilingualText = z.object({ en: z.string().min(1), hi: z.string().min(1) })

const questionSchema = z.object({
  /** The template field the question is about, so the UI can label the answer. */
  field: z.string(),
  en: z.string().min(1),
  hi: z.string().min(1),
})

const planSchema = z.object({
  templateId: z.string().min(1),
  rationale: bilingualText,
  questions: z.array(questionSchema).optional(),
  fieldValues: z.record(z.string(), z.unknown()).optional(),
  suggestedPhraseIds: z.array(z.string()).optional(),
})

/** At most three, whatever the model returns. The cap is not a suggestion. */
export const MAX_QUESTIONS = 3

export type InterviewQuestion = z.infer<typeof questionSchema>

export interface InterviewAnswer {
  field: string
  answer: string
}

/* ------------------------------------------------------------------ *
 * The checklist outcome — evaluated here, never claimed by the model
 * ------------------------------------------------------------------ */

export interface ChecklistItemOutcome {
  id: string
  label: string
  why: string
  severity: 'must' | 'should'
  csmopRef: string | null
  passed: boolean
  /** Which issue of the document this verdict is about. */
  lang: Lang
}

export interface ChecklistOutcome {
  passed: boolean
  mustFailing: number
  shouldFailing: number
  items: ChecklistItemOutcome[]
  /** Required fields the engine reported as empty, deduplicated. */
  missingFields: string[]
}

const checkResultSchema = z.object({
  found: z.literal(true),
  passed: z.boolean(),
  items: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      why: z.string(),
      severity: z.enum(['must', 'should']),
      csmopRef: z.string().nullable(),
      passed: z.boolean(),
    }),
  ),
  missingFields: z.array(z.string()),
})

const renderResultSchema = z.object({
  found: z.literal(true),
  text: z.string(),
})

/* ------------------------------------------------------------------ *
 * Progress
 * ------------------------------------------------------------------ */

export const DRAFTING_PHASES = [
  'screening',
  'planning',
  'checking',
  'revising',
  'rechecking',
  'done',
] as const
export type DraftingPhase = (typeof DRAFTING_PHASES)[number]

/**
 * What the panel shows while a run is in flight.
 *
 * `tool` is the registered tool's NAME, not a sentence: the UI translates it
 * (`draft.ai.step.check_draft` → "Checking the Office Memorandum checklist…"),
 * because a sentence built here would be a user-visible string outside the i18n
 * catalogues and would exist in one language.
 */
export interface DraftingStep {
  phase: DraftingPhase
  tool?: string
}

export type DraftingProgress = (step: DraftingStep) => void

/* ------------------------------------------------------------------ *
 * Parameters and results
 * ------------------------------------------------------------------ */

/** The language of the document, not of the interface. */
export type DraftingLang = Lang | 'bilingual'

export interface DraftingAgentParams {
  provider: AiProvider
  /** What the officer typed. Screened before it is sent. */
  brief: string
  /** The form already open in the editor. A hint the model may override. */
  templateId?: string
  /** Which issue(s) of the document to produce. */
  lang: DraftingLang
  /** The interface language, for the bilingual strings the agent returns. */
  language: Language
  /** Answers to a previous run's questions, folded into the brief. */
  answers?: readonly InterviewAnswer[]
  /** What the officer has already typed, so the agent completes rather than replaces. */
  currentValues?: DraftValues
  devanagariDigits?: boolean
  /** Defaults to `listTools(['draft', 'utils'])`. Injected by tests. */
  tools?: readonly RegisteredTool[]
  signal?: AbortSignal
  onProgress?: DraftingProgress
  onEvent?: AiEventHandler
  tier?: AiTier
  budgetLimit?: number | null
  model?: string
  ledger?: UsageLedger
  now?: () => Date
}

export interface SuggestedPhrase {
  id: string
  kind: string
  en: string
  hi: string
  csmopRef: string | null
}

export interface DraftingDraft {
  status: 'draft'
  templateId: string
  fieldValues: DraftValues
  rationale: Bilingual
  checklist: ChecklistOutcome
  suggestedPhrases: SuggestedPhrase[]
  /** Fields carrying a deliberate blank the officer must fill. */
  blanks: string[]
  /** The document as plain text, from `render_draft`, for a preview. */
  text: string
  /** True when the revision pass ran and its result was kept. */
  revised: boolean
  /** Anything dropped or refused on the way, in English, for the panel's log. */
  problems: string[]
  usage: TokenUsage
  cost: number
  meta: AiOutputMeta
}

export interface DraftingQuestions {
  status: 'questions'
  templateId: string
  rationale: Bilingual
  questions: InterviewQuestion[]
  usage: TokenUsage
  cost: number
  meta: AiOutputMeta
}

export interface DraftingRefused {
  status: 'refused'
  refusal: BriefRefusal
}

export interface DraftingFailed {
  status: 'error'
  code: AiErrorCode
  message: string
  usage: TokenUsage
  cost: number
}

export type DraftingAgentResult = DraftingDraft | DraftingQuestions | DraftingRefused | DraftingFailed

/* ------------------------------------------------------------------ *
 * The run
 * ------------------------------------------------------------------ */

const AGENT_ID = 'draft-assist' as const

export async function runDraftingAgent(params: DraftingAgentParams): Promise<DraftingAgentResult> {
  const {
    provider,
    brief,
    templateId,
    lang,
    language,
    answers = [],
    currentValues,
    devanagariDigits = false,
    signal,
    onProgress,
    onEvent,
    tier = 'byok',
    budgetLimit = null,
    model,
    ledger,
    now = () => new Date(),
  } = params

  const tools = params.tools ?? listTools(['draft', 'utils'])
  const step = (phase: DraftingPhase, tool?: string) => onProgress?.(tool ? { phase, tool } : { phase })

  step('screening')
  const refusal = screenOutbound([
    briefWithAnswers(brief, answers),
    currentValues && Object.keys(currentValues).length > 0 ? JSON.stringify(currentValues) : undefined,
  ])
  if (refusal) return { status: 'refused', refusal }

  let usage: TokenUsage = { ...EMPTY_USAGE }
  const problems: string[] = []
  const spend = (run: AgentRun) => {
    usage = addUsage(usage, run.usage)
  }

  /* ---- 2. plan --------------------------------------------------- */

  step('planning')
  const template = templateId ? await loadTemplateFor(templateId) : null
  const context = await planContext({ brief, answers, template, lang, currentValues })

  const planRun = await runAgent({
    agentId: AGENT_ID,
    provider,
    tools,
    system: system({ language, context }),
    userMessage: planMessage({ brief, answers, templateId, lang, currentValues, template }),
    jsonSchema: { name: 'drafting_plan', schema: toJsonSchema(planSchema) },
    context,
    language,
    tier,
    budgetLimit,
    ledger,
    now,
    ...(model ? { model } : {}),
    ...(signal ? { signal } : {}),
    onEvent: (event) => {
      if (event.type === 'toolCall') step('planning', event.call.name)
      onEvent?.(event)
    },
  })
  spend(planRun)

  if (!planRun.ok || planRun.json === undefined) {
    return failed(planRun, usage)
  }

  const plan = planSchema.safeParse(planRun.json)
  if (!plan.success) {
    return {
      status: 'error',
      code: 'provider',
      message: `The model's plan did not match the expected shape — ${plan.error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; ')}`,
      usage,
      cost: estimateCost(planRun.meta.model, usage),
    }
  }

  const chosen = await loadTemplateFor(plan.data.templateId)
  if (!chosen) {
    return {
      status: 'error',
      code: 'provider',
      message: `The model chose a form this app does not have: "${plan.data.templateId}".`,
      usage,
      cost: estimateCost(planRun.meta.model, usage),
    }
  }

  const questions = (plan.data.questions ?? []).slice(0, MAX_QUESTIONS)
  if ((plan.data.questions ?? []).length > MAX_QUESTIONS) {
    problems.push(`The model asked ${(plan.data.questions ?? []).length} questions; the last were dropped.`)
  }

  // Questions are only worth asking BEFORE the officer has answered any. A
  // second round would be an interrogation, and the brief's cap of three is a
  // cap on the whole exchange rather than on each turn of it.
  if (questions.length > 0 && answers.length === 0) {
    step('done')
    return {
      status: 'questions',
      templateId: chosen.id,
      rationale: plan.data.rationale,
      questions,
      usage,
      cost: estimateCost(planRun.meta.model, usage),
      meta: mergedMeta(planRun, usage, tier, now),
    }
  }

  const first = parseFieldValues(chosen, plan.data.fieldValues ?? {})
  recordFieldProblems(problems, first)

  /* ---- 3. check -------------------------------------------------- */

  /*
    The local stages are wrapped because they are OUTSIDE `runAgent`'s own
    try/catch. A tool that threw — a missing registration, a dataset chunk that
    would not load — rejected this promise instead of returning the `error`
    member of the union this function documents, so a caller that had handled
    every member still got an unhandled rejection.
  */
  const localFailure = (error: unknown): DraftingFailed => ({
    status: 'error',
    code: isAiError(error) ? error.code : 'provider',
    message: error instanceof Error ? error.message : String(error),
    usage,
    cost: estimateCost(planRun.meta.model, usage),
  })

  const cancelled = (): DraftingFailed => ({
    status: 'error',
    code: 'aborted',
    message: 'The run was cancelled.',
    usage,
    cost: estimateCost(planRun.meta.model, usage),
  })

  // `runAgent` checks the signal at the top of each of ITS loops; these stages
  // sit between two of those, so a run cancelled while the plan was resolving
  // used to go on and return a complete draft.
  if (signal?.aborted) return cancelled()

  const options = { devanagariDigits, signal }
  let rendered: string
  let checklist: ChecklistOutcome
  try {
    step('checking', 'render_draft')
    rendered = await renderWith(tools, chosen.id, first.values, lang, options)
    checklist = await checkWith(tools, chosen.id, first.values, lang, {
      ...options,
      onCall: (tool) => step('checking', tool),
    })
  } catch (error) {
    return localFailure(error)
  }

  /* ---- 4. revise, at most once ----------------------------------- */

  let revised = false
  let values = first.values
  let blanks = first.blanks

  if (!checklist.passed && !signal?.aborted) {
    step('revising')
    const reviseCtx = await reviseContext({ brief, answers, template: chosen, checklist, lang, values })
    const reviseRun = await runAgent({
      agentId: AGENT_ID,
      provider,
      tools,
      system: system({ language, context: reviseCtx }),
      userMessage: reviseMessage({ brief, template: chosen, checklist, lang }),
      jsonSchema: { name: 'drafting_revision', schema: toJsonSchema(planSchema) },
      context: reviseCtx,
      language,
      tier,
      budgetLimit,
      ledger,
      now,
      ...(model ? { model } : {}),
      ...(signal ? { signal } : {}),
      onEvent: (event) => {
        if (event.type === 'toolCall') step('revising', event.call.name)
        onEvent?.(event)
      },
    })
    spend(reviseRun)

    const revision =
      reviseRun.ok && reviseRun.json !== undefined ? planSchema.safeParse(reviseRun.json) : null

    if (revision?.success) {
      const second = parseFieldValues(chosen, revision.data.fieldValues ?? {})
      recordFieldProblems(problems, second)
      let nextRendered: string
      let nextChecklist: ChecklistOutcome
      try {
        step('rechecking', 'render_draft')
        nextRendered = await renderWith(tools, chosen.id, second.values, lang, options)
        nextChecklist = await checkWith(tools, chosen.id, second.values, lang, {
          ...options,
          onCall: (tool) => step('rechecking', tool),
        })
      } catch (error) {
        return localFailure(error)
      }

      /*
        A revision is kept only if it does not make the `must` failures worse.
        A model asked to fix three items and returning a draft that fails four
        has not improved anything, and taking it silently would hand the officer
        a worse document than the one it replaced — with no way to tell.
      */
      if (nextChecklist.mustFailing <= checklist.mustFailing) {
        values = second.values
        blanks = second.blanks
        rendered = nextRendered
        checklist = nextChecklist
        revised = true
      } else {
        problems.push(
          `The revision failed ${nextChecklist.mustFailing} required checklist items against ` +
            `${checklist.mustFailing} before it, so the first draft was kept.`,
        )
      }
    } else if (!reviseRun.ok) {
      problems.push(
        `The revision pass failed (${reviseRun.error?.code ?? 'unknown'}); the first draft stands.`,
      )
    }
  }

  if (signal?.aborted) return cancelled()

  const suggestedPhrases = await resolvePhrases(plan.data.suggestedPhraseIds ?? [], problems)

  step('done')
  return {
    status: 'draft',
    templateId: chosen.id,
    fieldValues: values,
    rationale: plan.data.rationale,
    checklist,
    suggestedPhrases,
    blanks,
    text: rendered,
    revised,
    problems,
    usage,
    cost: estimateCost(planRun.meta.model, usage),
    meta: mergedMeta(planRun, usage, tier, now),
  }
}

/* ------------------------------------------------------------------ *
 * "Improve wording" — one field, and only that field
 * ------------------------------------------------------------------ */

/**
 * What the assistant may be asked to do to a field. The set is closed, and it
 * is the one `src/modules/drafting/ai-seam.ts` declared before there was
 * anything to run it.
 */
export const SUGGESTION_KINDS = ['concise', 'person', 'translate', 'replyDate'] as const
export type SuggestionKind = (typeof SUGGESTION_KINDS)[number]

const SUGGESTION_TASKS: Record<SuggestionKind, string> = {
  concise:
    'Tighten this text against CSMOP 9.2(i)-(ii): no circumlocution, no superlatives, no courtesy padding. ' +
    'Keep every fact, every figure and every blank exactly as they are.',
  person:
    'Recast this text into the person the template requires (CSMOP 8.4(3), 9.5(i)). Change nothing else.',
  translate:
    'Produce the other language’s issue of this text, in formal administrative register, using ' +
    'lookup_admin_term and lookup_glossary_term for every designation and administrative term rather ' +
    'than translating from memory.',
  replyDate:
    'This text asks someone for something by "immediately" or a similar non-date. CSMOP 9.2(v) wants a ' +
    'specific date. If the brief gives no date, write the blank ____ rather than inventing one.',
}

export interface ImproveWordingParams {
  provider: AiProvider
  template: DocTemplate
  field: TemplateField
  /** Exactly the text the diff will show. Nothing else is sent. */
  text: string
  lang: Lang
  language: Language
  kind?: SuggestionKind
  tools?: readonly RegisteredTool[]
  signal?: AbortSignal
  onProgress?: DraftingProgress
  onEvent?: AiEventHandler
  tier?: AiTier
  budgetLimit?: number | null
  model?: string
  ledger?: UsageLedger
  now?: () => Date
}

export type ImproveWordingResult =
  | {
      status: 'ok'
      text: string
      note: Bilingual
      csmopRef: string | null
      usage: TokenUsage
      cost: number
      meta: AiOutputMeta
    }
  | DraftingRefused
  | DraftingFailed

const suggestionSchema = z.object({
  text: z.string().min(1),
  note: bilingualText,
  csmopRef: z.string().nullable().optional(),
})

export async function improveWording(params: ImproveWordingParams): Promise<ImproveWordingResult> {
  const {
    provider,
    template,
    field,
    text,
    lang,
    language,
    kind = 'concise',
    signal,
    onProgress,
    onEvent,
    tier = 'byok',
    budgetLimit = null,
    model,
    ledger,
    now = () => new Date(),
  } = params

  const tools = params.tools ?? listTools(['draft', 'utils'])
  onProgress?.({ phase: 'screening' })

  // Nothing to rewrite. Asking a model to improve an empty string spends the
  // reader's tokens on inventing content for a field they have not filled in,
  // which is the one thing this whole agent is built not to do.
  if (!text.trim()) {
    return {
      status: 'error',
      code: 'empty',
      message: `There is nothing in "${field.label.en}" to rewrite yet.`,
      usage: { ...EMPTY_USAGE },
      cost: 0,
    }
  }

  const refusal = screenBrief(text)
  if (refusal) return { status: 'refused', refusal }

  const context = buildContext(
    [
      { type: 'note', source: 'the text to rewrite', text, id: 'field' },
      { type: 'template', source: template.name.en, text: templateSnippet(template), id: 'template' },
      ...(await glossarySnippets(text, lang)),
    ],
    language,
  )

  onProgress?.({ phase: 'planning' })
  const run = await runAgent({
    agentId: AGENT_ID,
    provider,
    tools,
    system: system({ language, context }),
    userMessage: [
      `Rewrite one field of a ${template.name.en}. The field is "${field.label.en}" (${field.id}), and the`,
      `document's issue is ${lang === 'en' ? 'English' : 'Hindi'}.`,
      '',
      SUGGESTION_TASKS[kind],
      '',
      'Return the rewritten text only, plus a one-line bilingual note saying what you changed and the',
      'CSMOP paragraph that justifies it. Cite the context snippets you used as [1], [2], … in the note,',
      'and cite the tool results you called as [T1], [T2], ….',
      '',
      'The text is snippet [1]. Do not add a fact it does not contain. Keep every ____ blank.',
    ].join('\n'),
    jsonSchema: { name: 'drafting_suggestion', schema: toJsonSchema(suggestionSchema) },
    context,
    language,
    tier,
    budgetLimit,
    ledger,
    now,
    ...(model ? { model } : {}),
    ...(signal ? { signal } : {}),
    onEvent: (event) => {
      if (event.type === 'toolCall') onProgress?.({ phase: 'planning', tool: event.call.name })
      onEvent?.(event)
    },
  })

  if (!run.ok || run.json === undefined) return failed(run, run.usage)

  const parsed = suggestionSchema.safeParse(run.json)
  if (!parsed.success) {
    return {
      status: 'error',
      code: 'provider',
      message: 'The model’s rewrite did not match the expected shape.',
      usage: run.usage,
      cost: estimateCost(run.meta.model, run.usage),
    }
  }

  onProgress?.({ phase: 'done' })
  return {
    status: 'ok',
    text: parsed.data.text,
    note: parsed.data.note,
    csmopRef: parsed.data.csmopRef ?? null,
    usage: run.usage,
    cost: estimateCost(run.meta.model, run.usage),
    meta: run.meta,
  }
}

/* ------------------------------------------------------------------ *
 * "Explain this checklist failure"
 * ------------------------------------------------------------------ */

export interface ExplainChecklistParams {
  provider: AiProvider
  template: DocTemplate
  /** The failing item's id, from the editor's own checklist. */
  itemId: string
  values: DraftValues
  lang: Lang
  language: Language
  tools?: readonly RegisteredTool[]
  signal?: AbortSignal
  onProgress?: DraftingProgress
  onEvent?: AiEventHandler
  tier?: AiTier
  budgetLimit?: number | null
  model?: string
  ledger?: UsageLedger
  now?: () => Date
}

export type ExplainChecklistResult =
  { status: 'ok'; text: string; usage: TokenUsage; cost: number; meta: AiOutputMeta } | DraftingFailed

/**
 * Why one checklist item is failing, in prose, grounded in `check_draft`.
 *
 * The item's own `why` is already on screen in the drawer — this exists for the
 * next question, which is always "yes, but why is MINE failing", and that is a
 * claim about the officer's document rather than about the manual. So the run
 * is given the item's `why` as context and made to call `check_draft` itself:
 * an explanation of a failure that is no longer failing is worse than none.
 */
export async function explainChecklistFailure(
  params: ExplainChecklistParams,
): Promise<ExplainChecklistResult> {
  const {
    provider,
    template,
    itemId,
    values,
    lang,
    language,
    signal,
    onProgress,
    onEvent,
    tier = 'byok',
    budgetLimit = null,
    model,
    ledger,
    now = () => new Date(),
  } = params

  const tools = params.tools ?? listTools(['draft', 'utils'])
  const item = template.checklist.find((entry) => entry.id === itemId)
  if (!item) {
    return {
      status: 'error',
      code: 'not_configured',
      message: `"${itemId}" is not a checklist item of ${template.id}.`,
      usage: { ...EMPTY_USAGE },
      cost: 0,
    }
  }

  const context = buildContext(
    [
      {
        type: 'template',
        source: `${template.name.en}, checklist item "${item.id}"`,
        text: `${item.label.en} — ${item.why.en}${item.csmopRef ? ` (CSMOP ${item.csmopRef})` : ''}`,
        id: 'item',
      },
      { type: 'template', source: template.name.en, text: templateSnippet(template), id: 'template' },
    ],
    language,
  )

  onProgress?.({ phase: 'checking' })
  const run = await runAgent({
    agentId: AGENT_ID,
    provider,
    tools,
    system: system({ language, context }),
    userMessage: [
      `Explain, in at most four sentences, why the checklist item "${item.id}" is failing on this`,
      `${template.name.en} and what the officer should change.`,
      '',
      `Call check_draft with templateId "${template.id}", lang "${lang}" and the values below, and`,
      'answer from what it returns — not from the item wording alone. Cite the tool result as [T1] and',
      'the context snippets as [1], [2].',
      '',
      'values:',
      JSON.stringify(values),
    ].join('\n'),
    context,
    language,
    tier,
    budgetLimit,
    ledger,
    now,
    ...(model ? { model } : {}),
    ...(signal ? { signal } : {}),
    onEvent: (event) => {
      if (event.type === 'toolCall') onProgress?.({ phase: 'checking', tool: event.call.name })
      onEvent?.(event)
    },
  })

  if (!run.ok) return failed(run, run.usage)

  onProgress?.({ phase: 'done' })
  return {
    status: 'ok',
    text: run.text,
    usage: run.usage,
    cost: estimateCost(run.meta.model, run.usage),
    meta: run.meta,
  }
}

/* ------------------------------------------------------------------ *
 * Plumbing
 * ------------------------------------------------------------------ */

function system({ language, context }: { language: Language; context: BuiltContext }) {
  return buildSystem({
    agentId: AGENT_ID,
    language,
    context,
    instructions: DRAFTING_INSTRUCTIONS,
  })
}

const briefWithAnswers = (brief: string, answers: readonly InterviewAnswer[]): string =>
  answers.length === 0
    ? brief
    : [brief, ...answers.map((answer) => `${answer.field}: ${answer.answer}`)].join('\n')

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

function failed(run: AgentRun, usage: TokenUsage): DraftingFailed {
  return {
    status: 'error',
    code: run.error?.code ?? 'empty',
    message: run.error?.message ?? 'The run produced no answer.',
    usage,
    cost: estimateCost(run.meta.model, usage),
  }
}

function recordFieldProblems(problems: string[], result: FieldValuesResult): void {
  if (result.unknownFields.length > 0) {
    problems.push(`Dropped field(s) this form does not have: ${result.unknownFields.join(', ')}.`)
  }
  if (result.rejectedFields.length > 0) {
    problems.push(`Dropped field(s) whose value did not fit the field: ${result.rejectedFields.join(', ')}.`)
  }
}

/* ---- calling a registered tool from this file --------------------- */

/**
 * Run a registered tool directly, with its own zod schema applied.
 *
 * The model is not in this path. `render_draft` and `check_draft` are called
 * here so that the checklist the officer is shown is an evaluation of the
 * values actually being returned — a model that reports its own draft as
 * passing is reporting an intention.
 */
async function callTool(
  tools: readonly RegisteredTool[],
  name: string,
  input: unknown,
  signal: AbortSignal | undefined,
): Promise<unknown> {
  const tool = tools.find((entry) => entry.def.name === name)
  if (!tool) throw new AiError('unknown_tool', `The drafting agent needs the "${name}" tool.`)
  const validation = validateToolInput(tool, input)
  if (!validation.ok) throw new AiError('invalid_args', validation.message)
  const handler = tool.def.handler as (
    value: unknown,
    ctx: { language: Language; signal: AbortSignal },
  ) => Promise<unknown>
  return handler(validation.value, { language: 'en', signal: signal ?? new AbortController().signal })
}

async function loadTemplateFor(templateId: string): Promise<DocTemplate | null> {
  const { loadTemplate, TEMPLATE_IDS } = await import('@/modules/drafting/data')
  if (!TEMPLATE_IDS.includes(templateId)) return null
  try {
    return await loadTemplate(templateId)
  } catch {
    return null
  }
}

async function renderWith(
  tools: readonly RegisteredTool[],
  templateId: string,
  values: DraftValues,
  lang: DraftingLang,
  options: { devanagariDigits: boolean; signal?: AbortSignal },
): Promise<string> {
  const output = await callTool(
    tools,
    'render_draft',
    { templateId, values, lang, devanagariDigits: options.devanagariDigits },
    options.signal,
  )
  const parsed = renderResultSchema.safeParse(output)
  return parsed.success ? parsed.data.text : ''
}

/**
 * The checklist, in every issue the document has.
 *
 * A bilingual draft is checked TWICE, because the rules are about text and the
 * two issues are different text: an English body that satisfies the
 * third-person rule says nothing about whether the Hindi one does. An item is
 * reported once per language, and the draft passes only if every entry does.
 */
async function checkWith(
  tools: readonly RegisteredTool[],
  templateId: string,
  values: DraftValues,
  lang: DraftingLang,
  options: { signal?: AbortSignal; onCall?: (tool: string) => void },
): Promise<ChecklistOutcome> {
  const langs: Lang[] = lang === 'bilingual' ? ['en', 'hi'] : [lang]
  const items: ChecklistItemOutcome[] = []
  const missing = new Set<string>()

  for (const one of langs) {
    // Emitted per language, not once for the pair: a bilingual draft really is
    // two evaluations, and a progress line that said "checking" once while two
    // ran would be a progress line that lies about how long it takes.
    options.onCall?.('check_draft')
    const output = await callTool(tools, 'check_draft', { templateId, values, lang: one }, options.signal)
    const parsed = checkResultSchema.safeParse(output)
    if (!parsed.success) continue
    for (const item of parsed.data.items) items.push({ ...item, lang: one })
    for (const field of parsed.data.missingFields) missing.add(field)
  }

  const failing = items.filter((item) => !item.passed)
  return {
    passed: failing.length === 0 && items.length > 0,
    mustFailing: failing.filter((item) => item.severity === 'must').length,
    shouldFailing: failing.filter((item) => item.severity === 'should').length,
    items,
    missingFields: [...missing].sort(),
  }
}

async function resolvePhrases(ids: readonly string[], problems: string[]): Promise<SuggestedPhrase[]> {
  if (ids.length === 0) return []
  let library
  try {
    library = await loadPhrases()
  } catch {
    return []
  }

  const found: SuggestedPhrase[] = []
  const missing: string[] = []
  // De-duplicated: the list is rendered with the id as its React key, so a
  // model naming its favourite opening twice would collide as well as repeat.
  for (const id of [...new Set(ids)]) {
    const phrase = library.phrases.find((entry) => entry.id === id)
    // A phrase id that is not in the library is an invented phrase id, and a
    // suggested form of words nobody published is the one thing this feature
    // must not put in front of an officer.
    if (!phrase) {
      missing.push(id)
      continue
    }
    found.push({
      id: phrase.id,
      kind: phrase.kind,
      en: phrase.text.en,
      hi: phrase.text.hi,
      csmopRef: phrase.csmopRef ?? null,
    })
  }
  if (missing.length > 0) {
    problems.push(`Dropped phrase id(s) the library does not have: ${missing.join(', ')}.`)
  }
  return found
}

/* ---- context ------------------------------------------------------ */

/** One line per field and per checklist item — enough to cite, small enough to cache. */
function templateSnippet(template: DocTemplate): string {
  const fields = template.fields
    .map((field) => `${field.id} (${field.type}${field.required ? ', required' : ''}): ${field.label.en}`)
    .join('\n')
  const checklist = template.checklist
    .map(
      (item) =>
        `${item.id} [${item.severity}]: ${item.why.en}${item.csmopRef ? ` (CSMOP ${item.csmopRef})` : ''}`,
    )
    .join('\n')
  const prescribed = template.verify
    ? `CSMOP prescribes NO format for this form; it borrows ${template.csmopRef.chassis ?? 'another form'}.`
    : `CSMOP ${template.csmopRef.paras.join(', ')} prescribes this format.`

  return [
    `${template.name.en} / ${template.name.hi} — written in the ${template.person} person.`,
    prescribed,
    '',
    'Fields:',
    fields,
    '',
    'Checklist:',
    checklist,
  ].join('\n')
}

/**
 * English stopwords and the commonest Hindi function words. A glossary lookup
 * of "the" returns noise and costs a Fuse pass.
 */
const STOPWORDS = new Set([
  'about',
  'after',
  'against',
  'and',
  'been',
  'before',
  'being',
  'from',
  'have',
  'into',
  'that',
  'their',
  'them',
  'then',
  'there',
  'these',
  'this',
  'those',
  'were',
  'what',
  'when',
  'which',
  'will',
  'with',
  'would',
  'your',
  'please',
  'draft',
  'write',
  'need',
  'want',
  'के',
  'की',
  'का',
  'को',
  'में',
  'से',
  'पर',
  'और',
  'है',
  'हैं',
  'लिए',
  'कि',
  'यह',
  'वह',
  'तथा',
])

/**
 * Glossary hits for the words in a brief — the Rajbhasha register the document
 * will be written in.
 *
 * Only for a draft that has a Hindi issue. `data/glossary.json` is ~970 KB, and
 * loading it to draft an English Office Memorandum would charge every reader
 * for a lookup nothing in that document needs.
 */
async function glossarySnippets(text: string, lang: DraftingLang): Promise<Snippet[]> {
  if (lang === 'en') return []

  let index
  try {
    index = await glossaryIndex()
  } catch {
    return []
  }

  // `\p{Script=Devanagari}` rather than a `[ऀ-ॿ]` range: the range's endpoints
  // include combining marks, which makes a positive character class built from
  // them ambiguous about what one "character" is (`no-misleading-character-class`).
  const words = [...new Set(text.split(/[^A-Za-z\p{Script=Devanagari}]+/u).filter(Boolean))]
    .filter((word) => (/\p{Script=Devanagari}/u.test(word) ? word.length >= 3 : word.length >= 4))
    .filter((word) => !STOPWORDS.has(word.toLowerCase()))
    .slice(0, 8)

  const seen = new Set<string>()
  const snippets: Snippet[] = []
  for (const word of words) {
    const hit = searchGlossary(index, word)[0]
    if (!hit || seen.has(hit.id)) continue
    seen.add(hit.id)
    snippets.push({
      type: 'glossary',
      source: hit.en,
      id: `g-${hit.id}`,
      text: `${hit.en} = ${hit.hi}${hit.alsoHi?.length ? ` (also written ${hit.alsoHi.join(', ')})` : ''}. Compiled Rajbhasha usage, verify against the Department of Official Language's own term list.`,
    })
    if (snippets.length >= 6) break
  }
  return snippets
}

async function planContext({
  brief,
  answers,
  template,
  lang,
  currentValues,
}: {
  brief: string
  answers: readonly InterviewAnswer[]
  template: DocTemplate | null
  lang: DraftingLang
  currentValues?: DraftValues
}): Promise<BuiltContext> {
  const snippets: Snippet[] = [
    {
      type: 'note',
      source: 'the officer’s brief',
      id: 'brief',
      text: briefWithAnswers(brief, answers),
    },
  ]

  if (template) {
    snippets.push({
      type: 'template',
      source: template.name.en,
      id: `template-${template.id}`,
      text: templateSnippet(template),
    })
  }

  if (currentValues && Object.keys(currentValues).length > 0) {
    snippets.push({
      type: 'note',
      source: 'what the officer has already typed',
      id: 'current',
      text: JSON.stringify(currentValues),
    })
  }

  snippets.push(...(await glossarySnippets(brief, lang)))
  return buildContext(snippets, 'en')
}

async function reviseContext({
  brief,
  answers,
  template,
  checklist,
  lang,
  values,
}: {
  brief: string
  answers: readonly InterviewAnswer[]
  template: DocTemplate
  checklist: ChecklistOutcome
  lang: DraftingLang
  values: DraftValues
}): Promise<BuiltContext> {
  const failing = checklist.items.filter((item) => !item.passed)
  const snippets: Snippet[] = [
    { type: 'note', source: 'the officer’s brief', id: 'brief', text: briefWithAnswers(brief, answers) },
    {
      type: 'template',
      source: template.name.en,
      id: `template-${template.id}`,
      text: templateSnippet(template),
    },
    {
      type: 'note',
      source: 'the checklist items that failed',
      id: 'failures',
      text: failing
        .map(
          (item) =>
            `${item.id} [${item.severity}, ${item.lang}]: ${item.label} — ${item.why}${item.csmopRef ? ` (CSMOP ${item.csmopRef})` : ''}`,
        )
        .join('\n'),
    },
    { type: 'note', source: 'the values that failed', id: 'values', text: JSON.stringify(values) },
  ]
  snippets.push(...(await glossarySnippets(brief, lang)))
  return buildContext(snippets, 'en')
}

/* ---- the user turns ----------------------------------------------- */

function planMessage({
  brief,
  answers,
  templateId,
  lang,
  currentValues,
  template,
}: {
  brief: string
  answers: readonly InterviewAnswer[]
  templateId?: string
  lang: DraftingLang
  currentValues?: DraftValues
  template: DocTemplate | null
}): string {
  const issue =
    lang === 'bilingual'
      ? 'Both issues: give every field an {en, hi} pair where the two differ, and one shared string where they do not.'
      : `The ${lang === 'en' ? 'English' : 'Hindi'} issue.`

  return [
    'Draft this document. The officer’s brief is context snippet [1].',
    '',
    'Brief:',
    briefWithAnswers(brief, answers),
    '',
    template
      ? `The officer already has "${template.id}" (${template.name.en}) open. Use it unless the brief plainly needs another form; if you change it, say why in one line.`
      : templateId
        ? `The officer asked for "${templateId}", which this app does not have. Choose the closest form it does.`
        : 'Choose the form yourself, from list_draft_templates.',
    '',
    issue,
    currentValues && Object.keys(currentValues).length > 0
      ? 'What the officer has already typed is a context snippet. Keep it unless the brief contradicts it.'
      : '',
    '',
    'Return JSON with templateId, rationale (one line, en and hi, citing the snippets and tool results',
    'you used as [1] and [T1]), questions (at most three, only for required fields you cannot infer),',
    'fieldValues (keyed by the template’s own field ids), and suggestedPhraseIds from',
    'list_draft_phrases.',
    '',
    'Anything the brief did not give you is the blank ____, never a guess.',
  ]
    .filter(Boolean)
    .join('\n')
}

function reviseMessage({
  brief,
  template,
  checklist,
  lang,
}: {
  brief: string
  template: DocTemplate
  checklist: ChecklistOutcome
  lang: DraftingLang
}): string {
  const failing = checklist.items.filter((item) => !item.passed)
  return [
    `Your draft of this ${template.name.en} failed ${failing.length} checklist item(s). Fix them.`,
    '',
    'The failures are context snippet [3] and the values you produced are [4].',
    '',
    `Call check_draft with templateId "${template.id}" and lang "${lang === 'bilingual' ? 'en' : lang}"`,
    'over your corrected values before you answer, and cite its result as [T1].',
    '',
    'Return the same JSON shape: templateId, rationale, fieldValues. Change only what the failures',
    'require. Do not fill a ____ blank in to make an item pass — a blank the officer must fill is a',
    'correct draft, and an invented file number is not.',
    '',
    'The original brief, for reference:',
    brief,
  ].join('\n')
}
