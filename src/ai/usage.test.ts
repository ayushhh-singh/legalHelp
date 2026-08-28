import { describe, expect, it } from 'vitest'

import { billableTokens, budgetState, currentMonth, estimateCost, readMonthUsage, recordUsage } from './usage'
import type { TokenUsage } from './types'

const usage: TokenUsage = {
  inputTokens: 10_000,
  outputTokens: 1_000,
  cacheCreationInputTokens: 2_000,
  cacheReadInputTokens: 8_000,
}

describe('cost estimation', () => {
  it('prices each token class at its own published rate', () => {
    // Sonnet 4.6: 3 / 15 / 3.75 / 0.30 USD per million.
    const expected = (10_000 * 3 + 1_000 * 15 + 2_000 * 3.75 + 8_000 * 0.3) / 1_000_000

    expect(estimateCost('claude-sonnet-4-6', usage)).toBeCloseTo(expected, 10)
  })

  it('prices an unknown model at the default rather than at zero', () => {
    expect(estimateCost('claude-imaginary', usage)).toBe(estimateCost('claude-sonnet-4-6', usage))
  })
})

describe('the monthly ledger', () => {
  it('counts every billable class towards the budget', () => {
    expect(billableTokens(usage)).toBe(21_000)
  })

  it('accumulates across runs', async () => {
    await recordUsage('claude-sonnet-4-6', usage)
    await recordUsage('claude-sonnet-4-6', usage)

    const row = await readMonthUsage()
    expect(row.month).toBe(currentMonth())
    expect(row.runs).toBe(2)
    expect(row.inputTokens).toBe(20_000)
    expect(row.costUsd).toBeGreaterThan(0)
  })

  it('reports the month as exhausted once the ceiling is reached', async () => {
    await recordUsage('claude-sonnet-4-6', usage)

    expect((await budgetState(21_000)).exhausted).toBe(true)
    expect(await budgetState(30_000)).toMatchObject({ exhausted: false, remaining: 9_000 })
  })

  it('treats a zero budget as "make no calls"', async () => {
    expect((await budgetState(0)).exhausted).toBe(true)
  })

  it('starts an untouched month at zero rather than at undefined', async () => {
    expect(await readMonthUsage('1999-01')).toMatchObject({ month: '1999-01', runs: 0, costUsd: 0 })
  })
})
