import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { compareJobsForReader, containsRecommendation, explainPayslip, ungroundedFigures } from './pay'
import { MockProvider } from '../providers/mock'
import { clearRegistry, getTool, listTools, validateToolInput } from '../tools/registry'
import { registerBuiltinTools } from '../tools/index'
import { resetPayToolCache } from '../tools/pay'

/**
 * The Pay calculator's agent, against the REAL committed Pay Matrix data.
 *
 * Both entry points here read their tools directly, in code, before the model
 * runs — so every MockProvider script is a single `end_turn` turn, and the
 * figures in each mock answer are pulled from a REAL `compute_pay_for_job` /
 * `compare_jobs` call made in `beforeAll`, never hand-typed. A test that
 * asserts "the explanation states the right basic pay" against a number a
 * test author invented would only be testing the test author.
 */

const JOB_A = 'ib-acio-ii-executive'
const JOB_B = 'aso-css'

const call = async (name: string, input: unknown): Promise<Record<string, unknown>> => {
  const tool = getTool(name)
  if (!tool) throw new Error(`tool not registered: ${name}`)
  const validated = validateToolInput(tool, input)
  if (!validated.ok) throw new Error(validated.message)
  return (await tool.def.handler(validated.value as never, {
    language: 'en',
    signal: new AbortController().signal,
  })) as Record<string, unknown>
}

let computedA: { basic: number; gross: number; netMonthly: number; daRate: number }
let compared: { found: boolean }

beforeAll(async () => {
  clearRegistry()
  resetPayToolCache()
  registerBuiltinTools()
  computedA = (await call('compute_pay_for_job', { jobId: JOB_A })) as typeof computedA
  compared = (await call('compare_jobs', { jobA: JOB_A, jobB: JOB_B })) as typeof compared
})

beforeEach(() => {
  clearRegistry()
  resetPayToolCache()
  registerBuiltinTools()
})

const tools = () => listTools('pay')

describe('explainPayslip', () => {
  it('explains the real pay slip, restating only what was computed', async () => {
    const provider = new MockProvider({
      id: 'explain-ok',
      turns: [
        {
          stopReason: 'end_turn',
          content: [
            {
              type: 'text',
              text: [
                `The basic pay is ₹${computedA.basic.toLocaleString('en-IN')} [1].`,
                `Dearness Allowance is applied at ${computedA.daRate}% of the pay elements it is computed`,
                `on [1][2].`,
                `Gross pay comes to ₹${computedA.gross.toLocaleString('en-IN')} and net pay to`,
                `₹${computedA.netMonthly.toLocaleString('en-IN')} [1].`,
              ].join(' '),
            },
          ],
        },
      ],
    })

    const result = await explainPayslip({ provider, jobId: JOB_A, language: 'en', tools: tools() })

    expect(result.status).toBe('ok')
    // The model called no tool at all — every figure came from this file's own
    // pre-fetch, so the mock script needed a single turn.
    expect(provider.calls).toHaveLength(1)
  })

  it('rejects an answer that invents a rate this app never computed', async () => {
    const provider = new MockProvider({
      id: 'explain-invented',
      turns: [
        {
          stopReason: 'end_turn',
          content: [
            {
              type: 'text',
              text:
                `The basic pay is ₹${computedA.basic.toLocaleString('en-IN')} [1], and on top of that a` +
                ' special unadvertised bonus of 37% is also credited this month.',
            },
          ],
        },
      ],
    })

    const result = await explainPayslip({ provider, jobId: JOB_A, language: 'en', tools: tools() })

    expect(result.status).toBe('refused')
    if (result.status !== 'refused') return
    expect(result.refusal.reason).toBe('invented_figure')
    expect(result.refusal.detail).toContain('37%')
  })

  it('refuses before the provider is touched for a post this app does not have', async () => {
    const provider = new MockProvider({ id: 'unused', turns: [] })
    const result = await explainPayslip({ provider, jobId: 'not-a-real-job', language: 'en', tools: tools() })

    expect(result.status).toBe('refused')
    if (result.status !== 'refused') return
    expect(result.refusal.reason).toBe('not_found')
    expect(provider.calls).toHaveLength(0)
  })
})

describe('compareJobsForReader', () => {
  it('describes the real difference neutrally', async () => {
    expect(compared.found).toBe(true)

    const provider = new MockProvider({
      id: 'compare-ok',
      turns: [
        {
          stopReason: 'end_turn',
          content: [
            {
              type: 'text',
              text: 'The two posts differ mainly in basic pay and the allowances tied to their Level [1].',
            },
          ],
        },
      ],
    })

    const result = await compareJobsForReader({
      provider,
      jobA: JOB_A,
      jobB: JOB_B,
      language: 'en',
      tools: tools(),
    })

    expect(result.status).toBe('ok')
    expect(provider.calls).toHaveLength(1)
  })

  it('rejects a comparison that recommends one post over the other', async () => {
    const provider = new MockProvider({
      id: 'compare-recommends',
      turns: [
        {
          stopReason: 'end_turn',
          content: [
            {
              type: 'text',
              text: 'The two posts differ in basic pay [1]. Overall you should choose post A — it is the better option.',
            },
          ],
        },
      ],
    })

    const result = await compareJobsForReader({
      provider,
      jobA: JOB_A,
      jobB: JOB_B,
      language: 'en',
      tools: tools(),
    })

    expect(result.status).toBe('refused')
    if (result.status !== 'refused') return
    expect(result.refusal.reason).toBe('recommendation_language')
  })

  it('refuses before the provider is touched when a post is unknown', async () => {
    const provider = new MockProvider({ id: 'unused', turns: [] })
    const result = await compareJobsForReader({
      provider,
      jobA: JOB_A,
      jobB: 'not-a-real-job',
      language: 'en',
      tools: tools(),
    })

    expect(result.status).toBe('refused')
    if (result.status !== 'refused') return
    expect(result.refusal.reason).toBe('not_found')
    expect(provider.calls).toHaveLength(0)
  })
})

describe('ungroundedFigures', () => {
  it('matches a rupee figure and a percentage regardless of formatting', () => {
    const grounded = JSON.stringify({ amount: 21600, daRate: 60 })
    expect(ungroundedFigures('Basic is ₹21,600 and DA is 60%.', grounded)).toEqual([])
    expect(ungroundedFigures('A bonus of 35% was also paid.', grounded)).toEqual(['35%'])
  })
})

describe('containsRecommendation', () => {
  it('flags advice language in both languages', () => {
    expect(containsRecommendation('You should pick post A.')).toBe(true)
    expect(containsRecommendation('आपको पद ए चुनना चाहिए।')).toBe(true)
    expect(containsRecommendation('Post A pays more basic; post B carries a higher allowance.')).toBe(false)
  })
})
