import { isLocalModelId } from './local/catalogue'
import { resolveModel } from './models'
import { EMPTY_USAGE, type TokenUsage } from './types'

import { db, type AiUsageRow } from '@/db'

/**
 * Token and cost accounting, and the hard monthly stop.
 *
 * "Hard" means the budget is checked BEFORE each provider call, not after: a
 * reader who set a 200,000-token ceiling must not be able to end the month at
 * 260,000 because the last run happened to be a long one. A run that would
 * start over the line does not start.
 */

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheCreationInputTokens: a.cacheCreationInputTokens + b.cacheCreationInputTokens,
    cacheReadInputTokens: a.cacheReadInputTokens + b.cacheReadInputTokens,
  }
}

/** What the budget counts: everything the reader is billed for. */
export function billableTokens(usage: TokenUsage): number {
  return usage.inputTokens + usage.outputTokens + usage.cacheCreationInputTokens + usage.cacheReadInputTokens
}

/**
 * USD, from the model's published per-million rates. An estimate shown to the
 * reader — the app never sees an invoice, and Anthropic's bill is the truth.
 *
 * A Tier 0 run is free, and free means zero rather than "priced at whatever
 * the default model costs". `resolveModel()` falls back to DEFAULT_MODEL for
 * an id it does not know, which is right for a mistyped settings row and very
 * wrong here: it would put a dollar figure on tokens nobody was billed for, on
 * the one tier whose entire promise is that nothing left the device.
 */
export function estimateCost(modelId: string, usage: TokenUsage): number {
  if (isLocalModelId(modelId)) return 0
  const { pricing } = resolveModel(modelId)
  const perMillion =
    usage.inputTokens * pricing.input +
    usage.outputTokens * pricing.output +
    usage.cacheCreationInputTokens * pricing.cacheWrite +
    usage.cacheReadInputTokens * pricing.cacheRead
  return perMillion / 1_000_000
}

/** `YYYY-MM` in the device's own time zone — the reader's sense of "month". */
export function currentMonth(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

const emptyRow = (month: string): AiUsageRow => ({
  month,
  ...EMPTY_USAGE,
  costUsd: 0,
  runs: 0,
})

export async function readMonthUsage(month: string = currentMonth()): Promise<AiUsageRow> {
  return (await db.aiUsage.get(month)) ?? emptyRow(month)
}

/**
 * Read-modify-write, inside a Dexie transaction.
 *
 * Without one, two runs finishing a turn at the same moment both read the same
 * row and the second `put` overwrites the first — the month under-counts, and a
 * budget that under-counts is not a hard stop. Concurrency here is ordinary:
 * one agent's tool loop and another surface's run can overlap.
 */
export async function recordUsage(
  modelId: string,
  usage: TokenUsage,
  month: string = currentMonth(),
): Promise<AiUsageRow> {
  return db.transaction('rw', db.aiUsage, async () => {
    const current = (await db.aiUsage.get(month)) ?? emptyRow(month)
    const next: AiUsageRow = {
      month,
      ...addUsage(current, usage),
      costUsd: current.costUsd + estimateCost(modelId, usage),
      runs: current.runs + 1,
    }
    await db.aiUsage.put(next)
    return next
  })
}

export interface BudgetState {
  month: string
  used: number
  limit: number
  remaining: number
  exhausted: boolean
}

/**
 * A limit of 0 means "no calls at all" and is a legitimate setting — it is what
 * a reader picks who wants the UI present but nothing spendable.
 */
export async function budgetState(limit: number, month: string = currentMonth()): Promise<BudgetState> {
  const row = await readMonthUsage(month)
  const used = billableTokens(row)
  return {
    month,
    used,
    limit,
    remaining: Math.max(0, limit - used),
    exhausted: used >= limit,
  }
}

/** Reset for a reader who raised their own ceiling mid-month, and for tests. */
export async function clearUsage(): Promise<void> {
  await db.aiUsage.clear()
}
