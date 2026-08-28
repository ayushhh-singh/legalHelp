import { beforeAll, describe, expect, it } from 'vitest'

import { registerPayTools, resetPayToolCache } from './pay'
import { clearRegistry, getTool, listTools, registeredToolNames, validateToolInput } from './registry'

import type { ToolContext } from '../types'

/**
 * The Pay calculator's agent tools.
 *
 * Three properties are checked, and only the first is "the function returns the
 * right number":
 *
 *  1. **Every result carries the figures AND the source.** `runAgent` discards
 *     an answer that states a figure no cited tool result contains (ADR-011),
 *     so a result that returned a net pay without the lines that make it up
 *     would make every correct explanation of it unciteable.
 *  2. **`verify` travels with the figure.** `data/pay/jobs.json` is almost
 *     entirely unconfirmed (ADR-016). A tool that returned a pay slip without
 *     saying so would let an agent present a job-title pick as an authority,
 *     which is exactly what the card on screen is built not to do.
 *  3. **A miss is an explicit answer, not an empty object.** An agent that
 *     reads nothing for an unknown post will invent a pay scale.
 */

const ctx: ToolContext = { language: 'en', signal: new AbortController().signal }

const call = async (name: string, input: unknown) => {
  const tool = getTool(name)
  expect(tool, `${name} is not registered`).toBeDefined()
  if (!tool) throw new Error('unreachable')

  // Through the same validation the agent loop does, so a test cannot pass an
  // input shape the model would never be allowed to send.
  const validated = validateToolInput(tool, input)
  expect(validated.ok ? null : validated.message).toBeNull()
  if (!validated.ok) throw new Error(validated.message)

  return (await tool.def.handler(validated.value as never, ctx)) as Record<string, unknown>
}

beforeAll(() => {
  clearRegistry()
  resetPayToolCache()
  registerPayTools()
})

describe('registration', () => {
  it('registers the five pay tools, all in the pay scope', () => {
    expect(registeredToolNames()).toEqual([
      'compare_jobs',
      'compute_pay_for_job',
      'explain_pay_line',
      'get_allowance_source',
      'search_pay_jobs',
    ])
    for (const tool of listTools('pay')) {
      expect(tool.def.scope).toBe('pay')
      expect(tool.def.description.hi.length).toBeGreaterThan(0)
      expect(tool.def.description.hi).not.toBe(tool.def.description.en)
    }
  })

  it('registers idempotently, so a hot reload does not throw', () => {
    expect(() => {
      registerPayTools()
    }).not.toThrow()
  })
})

describe('search_pay_jobs', () => {
  it('finds a post by the acronym, with its source', async () => {
    const result = await call('search_pay_jobs', { query: 'ACIO' })
    const results = result.results as Array<Record<string, unknown>>
    expect(results.length).toBeGreaterThan(0)
    expect(results.map((hit) => hit.jobId)).toContain('ib-acio-ii-executive')
    for (const hit of results) {
      expect((hit.source as { url: string }).url).toMatch(/^https:\/\//)
      expect(typeof hit.verify).toBe('boolean')
    }
  })
})

describe('compute_pay_for_job', () => {
  it('computes the ACIO pay slip and carries every figure an answer could quote', async () => {
    const result = await call('compute_pay_for_job', {
      jobId: 'ib-acio-ii-executive',
      overrides: { cityId: 'delhi', daRate: 60 },
    })
    expect(result.found).toBe(true)
    expect(result.basic).toBe(44_900)
    expect(result.da).toBe(26_940)
    expect(result.hra).toBe(13_470)
    expect(result.ta).toBe(3600)
    expect(result.daOnTransportAllowance).toBe(2160)
    expect(result.gross).toBe(100_050)
    expect(result.netMonthly).toBe(92_156)
    expect(result.annualCostToGovernment).toBe(1_321_296)
  })

  it('returns the Special Security Allowance as a line with its own order', async () => {
    const result = await call('compute_pay_for_job', {
      jobId: 'ib-acio-ii-executive',
      overrides: { cityId: 'delhi', daRate: 60 },
    })
    const lines = result.lines as Array<Record<string, unknown>>
    const ssa = lines.find((line) => line.id === 'special-security-allowance-ib')
    expect(ssa?.amount).toBe(8980)
    expect((ssa?.source as { url: string }).url).toMatch(/^https:\/\//)
  })

  it('carries the verify note whenever the figures rest on unconfirmed data', async () => {
    const result = await call('compute_pay_for_job', { jobId: 'ib-acio-ii-executive' })
    expect(result.verify).toBe(true)
    expect(String(result.verifyNote)).toContain('DDO')
  })

  it('defaults to the latest NOTIFIED rate, never the projection', async () => {
    const result = await call('compute_pay_for_job', { jobId: 'aso-css' })
    expect(result.daRate).toBe(60)
  })

  it('says so for a post that does not exist, rather than returning nothing', async () => {
    const result = await call('compute_pay_for_job', { jobId: 'director-of-nothing' })
    expect(result).toEqual({ jobId: 'director-of-nothing', found: false })
  })
})

describe('explain_pay_line', () => {
  it('returns the formula, its inputs and the order behind one line', async () => {
    const result = await call('explain_pay_line', {
      jobId: 'ib-acio-ii-executive',
      lineId: 'house-rent-allowance',
      overrides: { cityId: 'delhi', daRate: 60 },
    })
    expect(result.found).toBe(true)
    expect(result.amount).toBe(13_470)
    expect(String(result.formula)).toContain('rate%')
    expect(result.inputs).toMatchObject({ basic: 44_900, cityClass: 'X', rate: 30, floor: 5400 })
    expect((result.source as { url: string }).url).toContain('doe.gov.in')
    expect((result.conditions as string[]).join(' ')).toContain('Government accommodation')
  })

  it('explains a derived line that is not an allowance at all', async () => {
    const result = await call('explain_pay_line', {
      jobId: 'ib-acio-ii-executive',
      lineId: 'da-on-ta',
      overrides: { cityId: 'delhi', daRate: 60 },
    })
    expect(result.amount).toBe(2160)
    expect(result.inputs).toMatchObject({ ta: 3600, daRate: 60 })
  })

  it('lists the lines that do exist when asked for one that does not', async () => {
    const result = await call('explain_pay_line', {
      jobId: 'ib-acio-ii-executive',
      lineId: 'bonus',
    })
    expect(result.found).toBe(false)
    expect(result.availableLines).toContain('basic')
  })
})

describe('get_allowance_source', () => {
  it('gives both the figure the order printed and the figure payable now', async () => {
    const result = await call('get_allowance_source', {
      allowanceId: 'children-education-allowance',
    })
    expect(result.found).toBe(true)
    const rates = result.rates as Array<Record<string, unknown>>
    const standard = rates.find((rate) => rate.key === 'standard')
    expect(standard?.statedInOrder).toBe(2250)
    expect(standard?.payableNow).toBe(2813) // raised once, DA having crossed 50
    expect(result.daLinked).toBe('quarter-per-fifty')
  })

  it('carries the order’s number and date', async () => {
    const result = await call('get_allowance_source', { allowanceId: 'house-rent-allowance' })
    const source = result.source as Record<string, string>
    expect(source.reference).toContain('2/5/2017')
    expect(source.dated).toBe('2017-07-07')
    expect(result.taxSection).toContain('10(13A)')
  })

  it('lists what exists when asked for an allowance that does not', async () => {
    const result = await call('get_allowance_source', { allowanceId: 'chai-allowance' })
    expect(result.found).toBe(false)
    expect(result.available).toContain('dearness-allowance')
  })
})

describe('compare_jobs', () => {
  it('applies the same assumptions to both posts and returns the difference', async () => {
    const result = await call('compare_jobs', {
      jobA: 'aso-css',
      jobB: 'ib-acio-ii-executive',
      overrides: { cityId: 'delhi', daRate: 60 },
    })
    expect(result.found).toBe(true)
    const difference = result.difference as Record<string, unknown>
    // Both posts are Level 7, cell 1. The whole difference is the Special
    // Security Allowance, and the tax and pension that ride on it.
    expect(difference.gross).toBe(8980)
    const lines = difference.lines as Array<Record<string, unknown>>
    expect(lines.map((line) => line.id)).toContain('special-security-allowance-ib')
  })

  it('says so when either post is unknown', async () => {
    const result = await call('compare_jobs', { jobA: 'aso-css', jobB: 'not-a-post' })
    expect(result.found).toBe(false)
  })
})
