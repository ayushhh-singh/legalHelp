import { z } from 'zod'

import { runAgent, type UsageLedger } from '../agent'
import { buildContext, type BuiltContext } from '../context'
import { buildSystem, PROMPT_VERSIONS } from '../prompts'
import type { AiProvider } from '../provider'
import { callToolDirectly, listTools, type RegisteredTool } from '../tools/registry'
import {
  EMPTY_USAGE,
  isAiError,
  type AiErrorCode,
  type AiEventHandler,
  type AiOutputMeta,
  type AiTier,
  type TokenUsage,
} from '../types'
import { estimateCost } from '../usage'

import { db } from '@/db'
import type { Language } from '@/i18n'
import { cardSchema } from '@/modules/trainer/schema'

/**
 * The Rules Trainer's coaching agent — "Explain", "Give me a scenario on this
 * rule" and the weekly focus plan.
 *
 * ### Who calls which tool, and why that split
 *
 * `explainAnswer` and `weeklyFocusPlan` are READS: this file calls
 * `get_rule_text` / `get_card_history` / `get_user_weak_areas` itself, before
 * the model ever runs, and hands the real result to the model as numbered
 * PLATFORM CONTEXT. The model's only job in those two is to phrase what it is
 * given — it is offered no tools and cannot call anything, so there is no
 * question of whether it fetched the right rule or the right history: the
 * fetch already happened, deterministically, in code. This mirrors
 * `src/ai/agents/drafting.ts` calling `render_draft`/`check_draft` itself
 * rather than trusting the model's report of them — the same lesson applies
 * here: a model that CLAIMS to have read Rule 3 is reporting an intention, and
 * a rule's text is cheap enough to read for real.
 *
 * `proposeScenario` is a WRITE. Only the model can author a scenario's wording
 * and options, so it alone runs through `runAgent`'s tool loop with
 * `propose_card` available, and this file verifies afterwards what actually
 * landed in `proposedCards` — never what the model said it did.
 *
 * `propose_card` always stores `reviewState: 'unreviewed'` in `proposedCards`,
 * a table `get_user_weak_areas` (via `weakAreasFor`) never reads: that
 * function aggregates `reviewLog`/`srsCards`, which a freshly proposed card has
 * none of until a human accepts it at `/study/practise/review-queue`. An AI-authored
 * card therefore cannot move a weak-area figure, a streak, or anything else
 * this agent reports, on its own.
 */

const AGENT_ID = 'trainer-coach' as const

function system(language: Language, context: BuiltContext) {
  return buildSystem({ agentId: AGENT_ID, language, context })
}

const callTool = (
  tools: readonly RegisteredTool[],
  name: string,
  input: unknown,
  signal: AbortSignal | undefined,
): Promise<unknown> => callToolDirectly(tools, name, input, { signal, callerLabel: 'tutor agent' })

/* ------------------------------------------------------------------ *
 * Progress, shared params, shared results
 * ------------------------------------------------------------------ */

export const TUTOR_PHASES = ['reading', 'thinking', 'done'] as const
export type TutorPhase = (typeof TUTOR_PHASES)[number]
export interface TutorStep {
  phase: TutorPhase
  tool?: string
}
export type TutorProgress = (step: TutorStep) => void

interface CommonParams {
  provider: AiProvider
  language: Language
  tools?: readonly RegisteredTool[]
  signal?: AbortSignal
  onProgress?: TutorProgress
  onEvent?: AiEventHandler
  tier?: AiTier
  budgetLimit?: number | null
  model?: string
  ledger?: UsageLedger
  now?: () => Date
}

export interface TutorOk {
  status: 'ok'
  text: string
  usage: TokenUsage
  cost: number
  meta: AiOutputMeta
}

export interface TutorFailed {
  status: 'error'
  code: AiErrorCode
  message: string
  usage: TokenUsage
  cost: number
}

export type TutorResult = TutorOk | TutorFailed

function localFailure(error: unknown): TutorFailed {
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
}): TutorFailed {
  return {
    status: 'error',
    code: run.error?.code ?? 'empty',
    message: run.error?.message ?? 'The run produced no answer.',
    usage: run.usage,
    cost: estimateCost(run.meta.model, run.usage),
  }
}

/**
 * A trivial success that never touched the provider — for the case where
 * there is nothing to explain (no weak areas yet). Spending a request to have
 * a model say "you have none" is a request this app should not make.
 */
function trivialOk(text: string, tier: AiTier, now: () => Date): TutorOk {
  const usage = { ...EMPTY_USAGE }
  return {
    status: 'ok',
    text,
    usage,
    cost: 0,
    meta: {
      agentId: AGENT_ID,
      model: 'none',
      promptVersion: PROMPT_VERSIONS[AGENT_ID],
      tier,
      contextIds: [],
      tokens: usage,
      cost: 0,
      cached: false,
      at: now().toISOString(),
    },
  }
}

/* ------------------------------------------------------------------ *
 * "Explain" — after a wrong answer
 * ------------------------------------------------------------------ */

export interface ExplainAnswerParams extends CommonParams {
  act: string
  rule: string
  /** `Card.id` of the card the reader just answered. */
  qId: string
  /** What the reader picked, in whatever language the card showed it in. */
  pickedAnswer: string
  /** The card's own correct answer, for the same reason. */
  correctAnswer: string
}

/**
 * Reads `get_rule_text` and `get_card_history` itself — see the file header.
 * The model sees both results as numbered context and is offered no tools: it
 * cannot skip either fetch, because neither fetch is its job.
 */
export async function explainAnswer(params: ExplainAnswerParams): Promise<TutorResult> {
  const {
    provider,
    act,
    rule,
    qId,
    pickedAnswer,
    correctAnswer,
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
  const tools = params.tools ?? listTools('learn')

  onProgress?.({ phase: 'reading', tool: 'get_rule_text' })
  let ruleText: { found: boolean }
  let cardHistory: unknown
  try {
    ruleText = (await callTool(tools, 'get_rule_text', { act, rule }, signal)) as { found: boolean }
    onProgress?.({ phase: 'reading', tool: 'get_card_history' })
    cardHistory = await callTool(tools, 'get_card_history', { qId }, signal)
  } catch (error) {
    return localFailure(error)
  }

  if (!ruleText.found) {
    return {
      status: 'error',
      code: 'not_configured',
      message: `${act} Rule ${rule} is not in the committed rule text.`,
      usage: { ...EMPTY_USAGE },
      cost: 0,
    }
  }

  const context = buildContext(
    [
      { type: 'rule', source: `${act} Rule ${rule}`, id: 'rule', text: JSON.stringify(ruleText) },
      { type: 'progress', id: 'history', text: JSON.stringify(cardHistory) },
      {
        type: 'note',
        source: 'what the reader answered',
        id: 'answer',
        text: `Picked: ${pickedAnswer}\nCorrect answer: ${correctAnswer}`,
      },
    ],
    language,
  )

  onProgress?.({ phase: 'thinking' })
  const run = await runAgent({
    agentId: AGENT_ID,
    provider,
    tools: [],
    groundedRequired: false,
    system: system(language, context),
    userMessage: [
      'The reader answered a rules-practice card and got it wrong. Snippet [1] is the rule text, [2] is',
      "the reader's own history with this card, and [3] is what they picked versus what was correct.",
      '',
      'Explain in at most four sentences why the correct answer is correct and what in the rule text makes',
      'the picked answer wrong. Quote the rule rather than paraphrasing its substance, and mention the',
      'history in [2] if it shows a pattern (repeated lapses, a long-held card that just failed). Cite [1]',
      'whenever you name the rule number, and cite [2] if you use the history.',
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
 * "Give me a scenario on this rule" — proposes a card, never schedules one
 * ------------------------------------------------------------------ */

export interface ProposeScenarioParams extends CommonParams {
  act: string
  rule: string
}

export interface TutorScenarioOk {
  status: 'ok'
  text: string
  /** `proposedCards` row id, read from the tool's OWN result, not claimed. */
  cardId: string
  reviewQueueUrl: string
  usage: TokenUsage
  cost: number
  meta: AiOutputMeta
}

export type TutorScenarioResult = TutorScenarioOk | TutorFailed

const proposedCardOutputSchema = z.object({
  stored: z.boolean(),
  id: z.string().nullable(),
  reviewQueueUrl: z.string().optional(),
  error: z.string().optional(),
})

/**
 * The one entry point here that is a WRITE, so it is the one that runs
 * through `runAgent`'s tool loop for real: only the model can author a
 * scenario's wording and options. The rule text is still fetched by this file
 * first (never trusted to the model to fetch correctly), both to ground the
 * confirmation sentence and to stop the model inventing a rule number for a
 * rule that does not exist.
 *
 * The confirmation on screen is never the model's claim that it added a card.
 * `propose_card`'s OWN result — what `src/ai/tools/rules.ts` actually wrote to
 * `proposedCards` — is what this function reads back; a card shape
 * `cardSchema` rejects comes back `stored: false` from the tool itself, and
 * that failure is what this function reports, not a success the model merely
 * asserted.
 */
export async function proposeScenario(params: ProposeScenarioParams): Promise<TutorScenarioResult> {
  const {
    provider,
    act,
    rule,
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
  const tools = params.tools ?? listTools('learn')

  onProgress?.({ phase: 'reading', tool: 'get_rule_text' })
  let ruleText: { found: boolean }
  try {
    ruleText = (await callTool(tools, 'get_rule_text', { act, rule }, signal)) as { found: boolean }
  } catch (error) {
    return localFailure(error)
  }
  if (!ruleText.found) {
    return {
      status: 'error',
      code: 'not_configured',
      message: `${act} Rule ${rule} is not in the committed rule text.`,
      usage: { ...EMPTY_USAGE },
      cost: 0,
    }
  }

  const context = buildContext(
    [{ type: 'rule', source: `${act} Rule ${rule}`, id: 'rule', text: JSON.stringify(ruleText) }],
    language,
  )

  onProgress?.({ phase: 'thinking' })
  const run = await runAgent({
    agentId: AGENT_ID,
    provider,
    tools,
    system: system(language, context),
    userMessage: [
      `Write one scenario-style practice question on ${act} Rule ${rule}, grounded in snippet [1] — never`,
      'invent a fact or a rule number the rule text does not contain.',
      '',
      `Call propose_card with kind "scenario", act "${act}", rule "${rule}", options and answerIndex, and`,
      'a citation matching the rule. Cite [1] whenever you name the rule number, and cite the tool result',
      'as [T1].',
      '',
      'Finish with one sentence telling the reader what you proposed.',
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
      if (event.type === 'toolCall') onProgress?.({ phase: 'thinking', tool: event.call.name })
      onEvent?.(event)
    },
  })

  if (!run.ok) return failed(run)

  // The LAST propose_card call, in case an earlier one was rejected by the
  // tool's own schema and the model retried — judged on what actually landed,
  // not on its first attempt.
  const proposeCall = [...run.toolResults].reverse().find((result) => result.name === 'propose_card')
  const parsedOutput = proposeCall?.ok ? proposedCardOutputSchema.safeParse(proposeCall.output) : null

  if (!proposeCall || !parsedOutput?.success || !parsedOutput.data.stored || !parsedOutput.data.id) {
    return {
      status: 'error',
      code: 'ungrounded',
      message: `The model did not actually store a scenario card${
        parsedOutput?.success && parsedOutput.data.error ? ` (${parsedOutput.data.error})` : ''
      }.`,
      usage: run.usage,
      cost: estimateCost(run.meta.model, run.usage),
    }
  }

  // `stored: true` only says SOME card landed — not that it is a card ABOUT
  // this rule. A model can call propose_card with a shape the tool accepts
  // for a completely different act/rule than the one it was asked for and
  // this branch alone would still call that success. The stored row itself,
  // never the model's account of it, is what settles that — parsed through
  // `cardSchema`, the same check `reviewQueue.ts` applies to this table's
  // `unknown`-typed `card` column on its own way out.
  const storedRow = await db.proposedCards.get(parsedOutput.data.id)
  const storedCard = storedRow ? cardSchema.safeParse(storedRow.card) : null
  if (!storedCard?.success || storedCard.data.act !== act || storedCard.data.rule !== rule) {
    return {
      status: 'error',
      code: 'ungrounded',
      message: `The model proposed a card for ${
        storedCard?.success ? `${storedCard.data.act} Rule ${storedCard.data.rule}` : 'an unrecognisable rule'
      }, not ${act} Rule ${rule}.`,
      usage: run.usage,
      cost: estimateCost(run.meta.model, run.usage),
    }
  }

  onProgress?.({ phase: 'done' })
  return {
    status: 'ok',
    text: run.text,
    cardId: parsedOutput.data.id,
    reviewQueueUrl: parsedOutput.data.reviewQueueUrl ?? '/study/practise/review-queue',
    usage: run.usage,
    cost: estimateCost(run.meta.model, run.usage),
    meta: run.meta,
  }
}

/* ------------------------------------------------------------------ *
 * The weekly focus plan — text only, from the reader's own weak areas
 * ------------------------------------------------------------------ */

export interface FocusPlanParams extends CommonParams {
  /** Restrict to one rule book. Omit for every act the reader studies. */
  act?: string
}

/**
 * Reads `get_user_weak_areas` itself — see the file header. `weakAreasFor`
 * (behind that tool) aggregates only `reviewLog`/`srsCards`, so an
 * AI-proposed, still-`unreviewed` card in `proposedCards` cannot appear here:
 * it has no review history to aggregate until a human accepts it.
 */
export async function weeklyFocusPlan(params: FocusPlanParams): Promise<TutorResult> {
  const {
    provider,
    act,
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
  const tools = params.tools ?? listTools('learn')

  onProgress?.({ phase: 'reading', tool: 'get_user_weak_areas' })
  let weakAreas: { count: number; areas: unknown[] }
  try {
    weakAreas = (await callTool(tools, 'get_user_weak_areas', { ...(act ? { act } : {}) }, signal)) as {
      count: number
      areas: unknown[]
    }
  } catch (error) {
    return localFailure(error)
  }

  if (weakAreas.areas.length === 0) {
    onProgress?.({ phase: 'done' })
    return trivialOk(
      language === 'hi'
        ? 'अभी तक कोई कमज़ोर क्षेत्र सामने नहीं आया है — अधिक अभ्यास के बाद यह योजना बनाई जा सकेगी।'
        : 'No weak areas have shown up yet — there is not enough review history to build a plan from.',
      tier,
      now,
    )
  }

  const context = buildContext(
    [{ type: 'progress', source: 'weak areas', id: 'weak-areas', text: JSON.stringify(weakAreas) }],
    language,
  )

  onProgress?.({ phase: 'thinking' })
  const run = await runAgent({
    agentId: AGENT_ID,
    provider,
    tools: [],
    groundedRequired: false,
    system: system(language, context),
    userMessage: [
      "Snippet [1] is the reader's weak areas, worst lapse rate first. Write a short focus plan from it —",
      'at most four rules, one line each naming the rule and roughly how often the reader is failing it.',
      'Cite [1]. Do not suggest a scenario or propose a card — this is a plan to read, not an action.',
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

  onProgress?.({ phase: 'done' })
  return {
    status: 'ok',
    text: run.text,
    usage: run.usage,
    cost: estimateCost(run.meta.model, run.usage),
    meta: run.meta,
  }
}
