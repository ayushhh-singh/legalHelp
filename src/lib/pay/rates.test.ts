import { describe, expect, it } from 'vitest'

import { computePay, type PayInput } from './engine'
import { computeTaxUnder } from './tax'

import { loadPayTables } from '@/test/payTables'
import type { Allowance, AllowanceRate } from '@/modules/pay/schema'

/**
 * Every rate `measure` the schema allows, and the two escapes the engine has
 * when a figure cannot be resolved.
 *
 * The golden slips in `engine.test.ts` price the allowances an officer actually
 * draws, which is the right test for those. It leaves four of the eight
 * measures unexercised, because `data/pay/allowances.json` happens to contain
 * no current allowance that uses them — `percent-of-basic-pay-plus-da` has no
 * live example at all today. "No live example today" is not the same as
 * "unreachable": the schema admits all eight, `scripts/ingest/validate_data.py`
 * would accept an order that introduced one, and the branch that priced it
 * would then run for the first time on a reader's device.
 *
 * So the allowances here are synthetic, and deliberately so. They are built to
 * the committed `allowanceSchema` shape and handed to the real `computePay`
 * over the real matrix, DA and city tables; only the allowance rows are
 * fabricated. The alternative — waiting for a Ministry to publish an order that
 * uses `rupees-per-hour` — is not a test strategy.
 */

const tables = loadPayTables()

const bilingual = (en: string, hi: string) => ({ en, hi })

function allowance(id: string, rates: AllowanceRate[], overrides: Partial<Allowance> = {}): Allowance {
  return {
    id,
    name: bilingual(id, id),
    type: 'fixed',
    status: 'current',
    appliesTo: bilingual('a test', 'एक परीक्षण'),
    rates,
    daLinked: { kind: 'none', timesApplied: 0 },
    taxable: true,
    conditions: [],
    source: { name: 'synthetic', url: 'https://doe.gov.in/' },
    fetchedAt: '2026-08-29T00:00:00.000Z',
    verify: true,
    ...overrides,
  }
}

const rate = (over: Partial<AllowanceRate> = {}): AllowanceRate => ({
  key: null,
  when: bilingual('always', 'हमेशा'),
  measure: 'rupees-per-month',
  value: 1000,
  ...over,
})

/** The real tables with one synthetic allowance appended. */
function withSynthetic(...extra: Allowance[]) {
  return {
    ...tables,
    allowances: { ...tables.allowances, allowances: [...tables.allowances.allowances, ...extra] },
  }
}

const base: PayInput = {
  level: '7',
  cellIndex: 0, // ₹44,900
  daRate: 60, // ₹26,940
  cityId: 'delhi',
  pensionScheme: 'nps',
  group: 'B',
  regime: 'new',
}

const run = (extra: Allowance[], input: Partial<PayInput> = {}) =>
  computePay(
    { ...base, ...input, allowances: extra.map((a) => ({ id: a.id, enabled: true })) },
    withSynthetic(...extra),
  )

const lineFor = (result: ReturnType<typeof run>, id: string) =>
  result.allowancesBreakdown.find((line) => line.id === id)

describe('rate measures', () => {
  it('prices a percentage of basic pay alone', () => {
    const a = allowance('synthetic-pct-basic', [rate({ measure: 'percent-of-basic-pay', value: 20 })])
    expect(lineFor(run([a]), a.id)?.amount).toBe(8980) // 20% of 44,900
  })

  it('prices a percentage of basic pay PLUS Dearness Allowance', () => {
    // The third base. Collapsing it into `percent-of-basic-pay` would understate
    // the line by the whole DA component — ₹14,368 against ₹8,980 here.
    const a = allowance('synthetic-pct-basic-da', [
      rate({ measure: 'percent-of-basic-pay-plus-da', value: 20 }),
    ])
    const line = lineFor(run([a]), a.id)
    expect(line?.amount).toBe(14_368) // 20% of (44,900 + 26,940)
    expect(line?.formula).toContain('basic + da')
    expect(line?.inputs.da).toBe(26_940)
  })

  it('prices a monthly rupee figure as it stands', () => {
    const a = allowance('synthetic-monthly', [rate({ measure: 'rupees-per-month', value: 2250 })])
    expect(lineFor(run([a]), a.id)?.amount).toBe(2250)
  })

  it('spreads an annual rupee figure over twelve months', () => {
    // Dress Allowance is stated per year and paid as part of a monthly slip;
    // showing the annual figure on a monthly line would be twelve times out.
    const a = allowance('synthetic-annual', [rate({ measure: 'rupees-per-year', value: 24_000 })])
    const line = lineFor(run([a]), a.id)
    expect(line?.amount).toBe(2000)
    expect(line?.formula).toContain('÷ 12')
  })

  for (const measure of ['rupees-per-day', 'rupees-per-hour'] as const) {
    it(`shows a ${measure} allowance and refuses to price it`, () => {
      // No pay slip carries a count of days or hours. Guessing one would be
      // worse than saying so: the line is shown, and priced at nothing.
      const a = allowance(`synthetic-${measure}`, [rate({ measure, value: 500 })])
      const line = lineFor(run([a]), a.id)
      expect(line?.unpriced).toBe(true)
      expect(line?.amount).toBe(0)
      expect(line?.formula).toContain(measure === 'rupees-per-day' ? 'day' : 'hour')
    })
  }
})

describe('ceilings and floors', () => {
  it('caps an amount at the rate’s own ceiling and says so', () => {
    const a = allowance('synthetic-ceiling', [
      rate({ measure: 'percent-of-basic-pay', value: 20, ceiling: 4500 }),
    ])
    const line = lineFor(run([a]), a.id)
    expect(line?.amount).toBe(4500) // 8,980 capped
    expect(line?.inputs.ceiling).toBe(4500)
    expect(line?.formula).toContain('capped')
  })

  it('raises an amount to the rate’s own floor and says so', () => {
    const a = allowance('synthetic-floor', [rate({ measure: 'percent-of-basic-pay', value: 1, floor: 5400 })])
    const line = lineFor(run([a]), a.id)
    expect(line?.amount).toBe(5400) // 449 floored
    expect(line?.inputs.floor).toBe(5400)
    expect(line?.formula).toContain('floored')
  })

  it('leaves an amount inside both alone', () => {
    const a = allowance('synthetic-inside', [
      rate({ measure: 'percent-of-basic-pay', value: 10, floor: 1000, ceiling: 9000 }),
    ])
    const line = lineFor(run([a]), a.id)
    expect(line?.amount).toBe(4490)
    expect(line?.formula).not.toContain('capped')
    expect(line?.formula).not.toContain('floored')
  })
})

describe('DA escalation on a fixed allowance', () => {
  it('applies the quarter-per-fifty uplift once DA has crossed 50 per cent', () => {
    // The rate an order printed is not the rate payable. A fixed allowance goes
    // up 25% each time DA crosses 50%, which it did on 01.01.2024 — so ₹2,250
    // of Children Education Allowance is actually ₹2,812.50, rounded to ₹2,813.
    const a = allowance('synthetic-da-linked', [rate({ value: 2250 })], {
      daLinked: { kind: 'quarter-per-fifty', timesApplied: 1, since: '2024-01-01' },
    })
    expect(lineFor(run([a]), a.id)?.amount).toBe(2813)
  })

  it('applies it twice when the order says it has been applied twice', () => {
    const a = allowance('synthetic-da-linked-2', [rate({ value: 2250 })], {
      daLinked: { kind: 'quarter-per-fifty', timesApplied: 2, since: '2024-01-01' },
    })
    expect(lineFor(run([a]), a.id)?.amount).toBe(3516) // 2250 × 1.25²
  })

  it('adds a companion DA line to a fully indexed allowance, at the DA rate', () => {
    // Transport Allowance is the one that matters. The rule is written once, in
    // the engine, rather than special-cased for it.
    const a = allowance('synthetic-fully-indexed', [rate({ value: 3600 })], {
      daLinked: { kind: 'fully-indexed', timesApplied: 0 },
    })
    const result = run([a])
    expect(lineFor(result, a.id)?.amount).toBe(3600)
    const companion = lineFor(result, `da-on-${a.id}`)
    expect(companion?.amount).toBe(2160) // 60% of 3,600
    expect(companion?.inputs.daRate).toBe(60)
    // The companion is a line in its own right, not an attachment: it must
    // reach `lines` too, or the gross would not add up to what is printed.
    expect(result.lines.some((line) => line.id === `da-on-${a.id}`)).toBe(true)
    expect('companion' in (lineFor(result, a.id) ?? {})).toBe(false)
  })

  it('adds no companion line when a fully indexed allowance prices at nothing', () => {
    const a = allowance('synthetic-indexed-zero', [rate({ measure: 'rupees-per-day', value: 500 })], {
      daLinked: { kind: 'fully-indexed', timesApplied: 0 },
    })
    const result = run([a])
    expect(lineFor(result, `da-on-${a.id}`)).toBeUndefined()
  })
})

describe('an allowance that is no longer payable', () => {
  for (const status of ['subsumed', 'abolished'] as const) {
    it(`warns rather than pricing a ${status} allowance`, () => {
      const a = allowance(`synthetic-${status}`, [rate({ value: 5000 })], { status, type: status })
      const result = run([a])
      expect(lineFor(result, a.id)).toBeUndefined()
      expect(result.warnings.some((w) => w.en.includes(status))).toBe(true)
      // Both languages, always — a warning shown only in English is a missing
      // Hindi string that no i18n check can see, because it is not a key.
      expect(result.warnings.every((w) => w.hi.trim().length > 0)).toBe(true)
    })
  }

  it('ignores an allowance id that is in no dataset at all', () => {
    const result = computePay({ ...base, allowances: [{ id: 'no-such-allowance', enabled: true }] }, tables)
    expect(result.allowancesBreakdown.find((line) => line.id === 'no-such-allowance')).toBeUndefined()
  })

  it('ignores an allowance the reader has switched off', () => {
    const a = allowance('synthetic-off', [rate({ value: 5000 })])
    const result = computePay({ ...base, allowances: [{ id: a.id, enabled: false }] }, withSynthetic(a))
    expect(lineFor(result, a.id)).toBeUndefined()
  })
})

describe('a rate that needs a choice the slip cannot make', () => {
  it('returns the choices, an amount of nothing, and never a guess', () => {
    // Ten of the thirty-two real allowances turn on a fact this app has no way
    // to know. Taking the first rate would hand a CAPF constable an Army
    // officer's Dress Allowance without saying so.
    const a = allowance('synthetic-choice', [
      rate({ key: 'officers', value: 20_000, measure: 'rupees-per-year' }),
      rate({ key: 'other-staff', value: 5000, measure: 'rupees-per-year' }),
    ])
    const line = lineFor(run([a]), a.id)
    expect(line?.needsChoice).toBe(true)
    expect(line?.amount).toBe(0)
    expect(line?.choices?.map((choice) => choice.key)).toEqual(['officers', 'other-staff'])
  })

  it('prices it once the reader has picked a rate key', () => {
    const a = allowance('synthetic-choice-made', [
      rate({ key: 'officers', value: 24_000, measure: 'rupees-per-year' }),
      rate({ key: 'other-staff', value: 6000, measure: 'rupees-per-year' }),
    ])
    const result = computePay(
      { ...base, allowances: [{ id: a.id, enabled: true, rateKey: 'other-staff' }] },
      withSynthetic(a),
    )
    const line = lineFor(result, a.id)
    expect(line?.needsChoice).toBeFalsy()
    expect(line?.amount).toBe(500) // 6,000 ÷ 12
  })

  it('honours a reader’s own override of the figure itself', () => {
    const a = allowance('synthetic-override', [rate({ value: 1000 })])
    const result = computePay(
      { ...base, allowances: [{ id: a.id, enabled: true, rate: 7777 }] },
      withSynthetic(a),
    )
    expect(lineFor(result, a.id)?.amount).toBe(7777)
  })

  it('multiplies a per-child allowance by the number of units', () => {
    const a = allowance('synthetic-per-child', [rate({ value: 2250 })])
    const result = computePay(
      { ...base, allowances: [{ id: a.id, enabled: true, units: 2 }] },
      withSynthetic(a),
    )
    const line = lineFor(result, a.id)
    expect(line?.amount).toBe(4500)
    expect(line?.inputs.units).toBe(2)
    expect(line?.formula).toContain('units')
  })
})

describe('Level bands in a rate key', () => {
  /** One allowance, three bands, so exactly one applies at each Level. */
  const banded = allowance('synthetic-banded', [
    rate({ key: 'band:level-9-and-above', value: 7200 }),
    rate({ key: 'band:level-3-to-8', value: 3600 }),
    rate({ key: 'band:level-2-and-below', value: 1350 }),
  ])

  it.each([
    ['1', 1350],
    ['2', 1350],
    ['3', 3600],
    ['8', 3600],
    ['9', 7200],
    ['13A', 7200],
    ['14', 7200],
  ])('resolves Level %s to ₹%d without the reader choosing', (level, expected) => {
    const result = computePay(
      { ...base, level: level, allowances: [{ id: banded.id, enabled: true }] },
      withSynthetic(banded),
    )
    expect(lineFor(result, banded.id)?.amount).toBe(expected)
  })

  it('reads 13A as its own rank between 13 and 14, not as thirteen', () => {
    // `levelRank` has to place 13A explicitly; a numeric parse reads it as 13
    // and puts an officer one rank low in every band that spans the boundary.
    const spanning = allowance('synthetic-13a', [
      rate({ key: 'band:level-13a-and-above', value: 9000 }),
      rate({ key: 'band:level-13-to-13a', value: 4000 }),
    ])
    const at13 = computePay(
      { ...base, level: '13', allowances: [{ id: spanning.id, enabled: true }] },
      withSynthetic(spanning),
    )
    const at14 = computePay(
      { ...base, level: '14', allowances: [{ id: spanning.id, enabled: true }] },
      withSynthetic(spanning),
    )
    expect(lineFor(at13, spanning.id)?.amount).toBe(4000)
    expect(lineFor(at14, spanning.id)?.amount).toBe(9000)
  })

  it('does not read an option name that merely starts with "level-" as a band', () => {
    // `level-14-and-above-in-lieu-of-car` is the NAME of an option — the
    // allowance drawn instead of an official car — not a band. Reading it as
    // one would hand every Level 14 officer a figure they did not ask for.
    const optionNamed = allowance('synthetic-option-name', [
      rate({ key: 'level-14-and-above-in-lieu-of-car', value: 15_750 }),
      rate({ key: 'ordinary', value: 1000 }),
    ])
    const result = computePay(
      { ...base, level: '14', allowances: [{ id: optionNamed.id, enabled: true }] },
      withSynthetic(optionNamed),
    )
    expect(lineFor(result, optionNamed.id)?.needsChoice).toBe(true)
    expect(lineFor(result, optionNamed.id)?.amount).toBe(0)
  })
})

describe('a tax regime the dataset does not carry', () => {
  it('throws by name rather than computing zero tax', () => {
    // A silent zero would look like a lawful nil liability. `data/pay/tax.json`
    // is validated against a JSON Schema on the way in and a zod schema on the
    // way out, so reaching this means the two have already disagreed — the one
    // case where failing loudly is the only honest answer.
    const input = {
      taxableSalary: 1_200_000,
      hraReceived: 0,
      salaryForHra: 0,
      rentPaid: 0,
      metro: false,
      employerPension: 0,
      employeePension: 0,
      section80c: 0,
      section80ccd1b: 0,
      section80d: 0,
      homeLoanInterest: 0,
      ageBand: 'below-60' as const,
    }
    expect(() =>
      computeTaxUnder('neither' as Parameters<typeof computeTaxUnder>[0], input, tables.tax),
    ).toThrow(/tax\.json/)
  })
})
