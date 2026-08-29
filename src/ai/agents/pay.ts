import { runAgent, type UsageLedger } from '../agent'
import { buildContext, type BuiltContext } from '../context'
import { buildSystem } from '../prompts'
import type { AiProvider } from '../provider'
import { listTools, validateToolInput, type RegisteredTool } from '../tools/registry'
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
import { estimateCost } from '../usage'

import type { Language } from '@/i18n'

/**
 * The Pay & Allowances Calculator's agent — "Explain my payslip" and
 * "Compare these two posts for me".
 *
 * Both entry points here are READS, and this file calls every pay tool
 * itself — `compute_pay_for_job`, `explain_pay_line`, `get_allowance_source`,
 * `compare_jobs` — before the model ever runs, exactly as
 * `src/ai/agents/tutor.ts`'s `explainAnswer` reads `get_rule_text` itself
 * rather than trusting the model to fetch it. The model is offered NO tools
 * and cannot call anything: its only job is to phrase what this file already
 * computed, and "never state a rate you were not shown" is enforced twice —
 * once as an instruction, and once by `ungroundedFigures()` reading the
 * answer back after the run and rejecting any rupee figure or percentage that
 * does not appear anywhere in what was actually computed.
 */

const AGENT_ID = 'pay-explain' as const

function system(language: Language, context: BuiltContext) {
  return buildSystem({ agentId: AGENT_ID, language, context })
}

/* ------------------------------------------------------------------ *
 * Calling a registered tool directly, without the model in the loop
 * ------------------------------------------------------------------ */

async function callTool(
  tools: readonly RegisteredTool[],
  name: string,
  input: unknown,
  signal: AbortSignal | undefined,
): Promise<unknown> {
  const tool = tools.find((entry) => entry.def.name === name)
  if (!tool) throw new AiError('unknown_tool', `The pay agent needs the "${name}" tool.`)
  const validation = validateToolInput(tool, input)
  if (!validation.ok) throw new AiError('invalid_args', validation.message)
  const handler = tool.def.handler as (
    value: unknown,
    ctx: { language: Language; signal: AbortSignal },
  ) => Promise<unknown>
  return handler(validation.value, { language: 'en', signal: signal ?? new AbortController().signal })
}

/* ------------------------------------------------------------------ *
 * The two checks run on every answer, never trusted to the prompt alone
 * ------------------------------------------------------------------ */

/** Every rupee figure and percentage the answer states. */
export function figuresInText(text: string): string[] {
  const figures: string[] = []
  for (const match of text.matchAll(/₹\s?[\d,]+(?:\.\d+)?/g)) figures.push(match[0])
  for (const match of text.matchAll(/\b\d+(?:\.\d+)?\s?%/g)) figures.push(match[0])
  return figures
}

const digitsOnly = (value: string): string => value.replace(/\D/g, '')

/**
 * Every figure in `text` that does not appear anywhere in `groundedText` —
 * the JSON of what was actually computed. Digits-only comparison, so
 * "₹21,600" in prose and the bare `21600` a JSON number serialises as compare
 * equal, and "60%" matches a `daRate` of `60` the same way.
 *
 * This is what stops a model that was told "the DA rate is 60%" from also
 * volunteering "which works out to roughly 35% of your basic" — a rate this
 * app never computed and never showed it.
 */
export function ungroundedFigures(text: string, groundedText: string): string[] {
  const grounded = new Set<string>()
  for (const match of groundedText.matchAll(/\d+(?:\.\d+)?/g)) {
    const digits = digitsOnly(match[0])
    if (digits) grounded.add(digits)
  }
  return figuresInText(text).filter((figure) => {
    const digits = digitsOnly(figure)
    return digits.length > 0 && !grounded.has(digits)
  })
}

/**
 * Recommendation language, bilingual. A comparison must describe the
 * difference, not choose a side — `docs/AI.md`'s neutrality rule for this
 * agent, enforced here rather than left to the persona alone.
 */
const RECOMMENDATION_PATTERNS: readonly RegExp[] = [
  /\byou should\b/i,
  /\bi recommend\b/i,
  /\bwe recommend\b/i,
  /\bbetter (?:choice|option|post|pick)\b/i,
  /\bi(?:'d| would) (?:suggest|advise)\b/i,
  /\bgo (?:for|with)\b/i,
  /\bopt for\b/i,
  /\bchoose post [ab]\b/i,
  /चुनना चाहिए/,
  /बेहतर (?:विकल्प|पद)/,
  /मेरी सलाह/,
  /की सलाह देता/,
]

export function containsRecommendation(text: string): boolean {
  return RECOMMENDATION_PATTERNS.some((pattern) => pattern.test(text))
}

/* ------------------------------------------------------------------ *
 * Shared params, shared results
 * ------------------------------------------------------------------ */

export const PAY_AGENT_PHASES = ['reading', 'thinking', 'done'] as const
export type PayAgentPhase = (typeof PAY_AGENT_PHASES)[number]
export interface PayAgentStep {
  phase: PayAgentPhase
  tool?: string
}
export type PayAgentProgress = (step: PayAgentStep) => void

interface CommonParams {
  provider: AiProvider
  language: Language
  tools?: readonly RegisteredTool[]
  signal?: AbortSignal
  onProgress?: PayAgentProgress
  onEvent?: AiEventHandler
  tier?: AiTier
  budgetLimit?: number | null
  model?: string
  ledger?: UsageLedger
  now?: () => Date
}

export type PayRefusalReason = 'invented_figure' | 'recommendation_language' | 'not_found'

export interface PayRefusal {
  reason: PayRefusalReason
  message: Bilingual
  /** The figure(s) or phrase that triggered the refusal, for the panel's log. */
  detail?: string
}

export interface PayOk {
  status: 'ok'
  text: string
  usage: TokenUsage
  cost: number
  meta: AiOutputMeta
}

export interface PayRefused {
  status: 'refused'
  refusal: PayRefusal
  usage: TokenUsage
  cost: number
}

export interface PayFailed {
  status: 'error'
  code: AiErrorCode
  message: string
  usage: TokenUsage
  cost: number
}

export type PayAgentResult = PayOk | PayRefused | PayFailed

function localFailure(error: unknown): PayFailed {
  return {
    status: 'error',
    code: isAiError(error) ? error.code : 'provider',
    message: error instanceof Error ? error.message : String(error),
    usage: { ...EMPTY_USAGE },
    cost: 0,
  }
}

function failed(run: {
  error?: { code: AiErrorCode; message: string }
  usage: TokenUsage
  meta: AiOutputMeta
}): PayFailed {
  return {
    status: 'error',
    code: run.error?.code ?? 'empty',
    message: run.error?.message ?? 'The run produced no answer.',
    usage: run.usage,
    cost: estimateCost(run.meta.model, run.usage),
  }
}

const REFUSAL_MESSAGES: Record<PayRefusalReason, Bilingual> = {
  invented_figure: {
    en:
      'This explanation stated a figure this app did not compute, so it has been discarded rather than ' +
      'shown. Ask again.',
    hi:
      'इस स्पष्टीकरण में एक ऐसा आँकड़ा दिया गया जो इस ऐप ने नहीं निकाला, इसलिए इसे दिखाने के बजाय ' +
      'हटा दिया गया है। पुनः पूछें।',
  },
  recommendation_language: {
    en:
      'A comparison must stay neutral. This answer favoured one post over the other, so it has been ' +
      'discarded. Ask again.',
    hi:
      'तुलना निष्पक्ष रहनी चाहिए। इस उत्तर ने एक पद को दूसरे से बेहतर बताया, इसलिए इसे हटा दिया गया ' +
      'है। पुनः पूछें।',
  },
  not_found: {
    en: 'One of the posts named is not in the bundled Pay Matrix data.',
    hi: 'नामित पदों में से एक बंडल किए गए वेतन मैट्रिक्स डेटा में नहीं है।',
  },
}

function refused(reason: PayRefusalReason, usage: TokenUsage, cost: number, detail?: string): PayRefused {
  return {
    status: 'refused',
    refusal: { reason, message: REFUSAL_MESSAGES[reason], ...(detail ? { detail } : {}) },
    usage,
    cost,
  }
}

/* ------------------------------------------------------------------ *
 * "Explain my payslip"
 * ------------------------------------------------------------------ */

export interface PayExplainParams extends CommonParams {
  jobId: string
  overrides?: Record<string, unknown>
  /** Defaults to every line the computed result has. */
  lineIds?: readonly string[]
}

interface ComputedLine {
  id: string
  verify?: boolean
}

interface ComputedResult {
  found: boolean
  lines?: ComputedLine[]
  verify?: boolean
  verifyNote?: string
}

export async function explainPayslip(params: PayExplainParams): Promise<PayAgentResult> {
  const {
    provider,
    jobId,
    overrides,
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
  const tools = params.tools ?? listTools('pay')

  onProgress?.({ phase: 'reading', tool: 'compute_pay_for_job' })
  let computed: ComputedResult
  try {
    computed = (await callTool(
      tools,
      'compute_pay_for_job',
      { jobId, ...(overrides ? { overrides } : {}) },
      signal,
    )) as ComputedResult
  } catch (error) {
    return localFailure(error)
  }

  if (!computed.found) {
    return refused('not_found', { ...EMPTY_USAGE }, 0, jobId)
  }

  const lineIds = params.lineIds ?? (computed.lines ?? []).map((line) => line.id)
  const explained: unknown[] = []
  const sources: unknown[] = []
  try {
    for (const lineId of lineIds) {
      onProgress?.({ phase: 'reading', tool: 'explain_pay_line' })
      explained.push(
        await callTool(tools, 'explain_pay_line', { jobId, lineId, ...(overrides ? { overrides } : {}) }, signal),
      )
    }
    for (const line of computed.lines ?? []) {
      onProgress?.({ phase: 'reading', tool: 'get_allowance_source' })
      const source = (await callTool(tools, 'get_allowance_source', { allowanceId: line.id }, signal)) as {
        found: boolean
      }
      if (source.found) sources.push(source)
    }
  } catch (error) {
    return localFailure(error)
  }

  const context = buildContext(
    [
      { type: 'computed', source: jobId, id: 'payslip', text: JSON.stringify(computed) },
      { type: 'computed', source: 'per-line explanations', id: 'lines', text: JSON.stringify(explained) },
      ...(sources.length > 0
        ? [{ type: 'computed' as const, source: 'allowance sources', id: 'sources', text: JSON.stringify(sources) }]
        : []),
    ],
    language,
  )

  const groundedText = context.entries.map((entry) => entry.text).join(' ')

  onProgress?.({ phase: 'thinking' })
  const run = await runAgent({
    agentId: AGENT_ID,
    provider,
    tools: [],
    groundedRequired: false,
    system: system(language, context),
    userMessage: [
      "Snippet [1] is the reader's computed pay slip, [2] is each line's own formula and source, and [3]",
      '(if present) is fuller detail on any allowance whose order this app holds.',
      '',
      'Explain the pay slip line by line. State ONLY the figures and sources these snippets contain —',
      'never a rate, percentage or rupee amount they do not show. Name the component (basic, DA, HRA, TA,',
      'NPS, tax) behind every figure you quote, and repeat the verify note for any line marked unconfirmed.',
      'Cite [1], [2] and [3] as you use them.',
    ].join('\n'),
    context,
    language,
    tier,
    budgetLimit,
    ledger,
    now,
    ...(model ? { model } : {}),
    ...(signal ? { signal } : {}),
    onEvent,
  })

  if (!run.ok) return failed(run)

  const invented = ungroundedFigures(run.text, groundedText)
  if (invented.length > 0) {
    return refused('invented_figure', run.usage, estimateCost(run.meta.model, run.usage), invented.join(', '))
  }

  onProgress?.({ phase: 'done' })
  return { status: 'ok', text: run.text, usage: run.usage, cost: estimateCost(run.meta.model, run.usage), meta: run.meta }
}

/* ------------------------------------------------------------------ *
 * "Compare these two posts for me"
 * ------------------------------------------------------------------ */

export interface PayCompareParams extends CommonParams {
  jobA: string
  jobB: string
  overrides?: Record<string, unknown>
}

interface CompareResult {
  found: boolean
}

export async function compareJobsForReader(params: PayCompareParams): Promise<PayAgentResult> {
  const {
    provider,
    jobA,
    jobB,
    overrides,
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
  const tools = params.tools ?? listTools('pay')

  onProgress?.({ phase: 'reading', tool: 'compare_jobs' })
  let compared: CompareResult
  try {
    compared = (await callTool(
      tools,
      'compare_jobs',
      { jobA, jobB, ...(overrides ? { overrides } : {}) },
      signal,
    )) as CompareResult
  } catch (error) {
    return localFailure(error)
  }

  if (!compared.found) {
    return refused('not_found', { ...EMPTY_USAGE }, 0, `${jobA}, ${jobB}`)
  }

  const context = buildContext(
    [{ type: 'computed', source: `${jobA} vs ${jobB}`, id: 'compare', text: JSON.stringify(compared) }],
    language,
  )
  const groundedText = context.entries.map((entry) => entry.text).join(' ')

  onProgress?.({ phase: 'thinking' })
  const run = await runAgent({
    agentId: AGENT_ID,
    provider,
    tools: [],
    groundedRequired: false,
    system: system(language, context),
    userMessage: [
      'Snippet [1] is a line-by-line comparison of two posts this app has already computed.',
      '',
      'Describe the difference NEUTRALLY — name which components (basic, DA, HRA, allowances, tax) drive',
      'it, and by how much, using only the figures in [1]. Do not recommend one post over the other: no',
      '"you should", no "better choice", no advice at all. Cite [1].',
    ].join('\n'),
    context,
    language,
    tier,
    budgetLimit,
    ledger,
    now,
    ...(model ? { model } : {}),
    ...(signal ? { signal } : {}),
    onEvent,
  })

  if (!run.ok) return failed(run)

  const invented = ungroundedFigures(run.text, groundedText)
  if (invented.length > 0) {
    return refused('invented_figure', run.usage, estimateCost(run.meta.model, run.usage), invented.join(', '))
  }
  if (containsRecommendation(run.text)) {
    return refused('recommendation_language', run.usage, estimateCost(run.meta.model, run.usage))
  }

  onProgress?.({ phase: 'done' })
  return { status: 'ok', text: run.text, usage: run.usage, cost: estimateCost(run.meta.model, run.usage), meta: run.meta }
}
