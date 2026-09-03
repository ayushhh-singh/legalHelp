import { describe, expect, it } from 'vitest'

import {
  commuteePension,
  currentGpfRate,
  gratuityCeiling,
  projectGpfBalance,
  projectNpsCorpus,
  qualifyingHalfYears,
  retirementGratuity,
  superannuationDate,
  upsAssuredPayout,
  upsLumpSum,
} from './engine'

import type { PensionFacts } from './types'

const facts: PensionFacts = {
  version: '1.0.0',
  generatedAt: '2026-08-29T00:00:00Z',
  disclaimer: { en: 'x', hi: 'x' },
  superannuation: {
    ageYears: 60,
    rule: { en: 'x', hi: 'x' },
    source: { name: 'x', url: 'https://x.example' },
    verify: false,
  },
  gratuity: {
    fractionPerSixMonths: 0.25,
    maxMultiplier: 16.5,
    baseCeiling: 2000000,
    daLinked: { kind: 'quarter-per-fifty', timesApplied: 1 },
    deathGratuityTable: [],
    rule: { en: 'x', hi: 'x' },
    source: { name: 'x', url: 'https://x.example' },
    verify: false,
  },
  commutation: {
    maxFraction: 0.4,
    rule: { en: 'x', hi: 'x' },
    table: [
      { ageNextBirthday: 60, factor: 8.287 },
      { ageNextBirthday: 61, factor: 8.194 },
    ],
    source: { name: 'x', url: 'https://x.example' },
    verify: true,
  },
  gpf: {
    rateHistory: [
      { effectiveFrom: '2020-07-01', rate: 7.1 },
      { effectiveFrom: '2026-04-01', rate: 7.1 },
    ],
    source: { name: 'x', url: 'https://x.example' },
    verify: true,
  },
}

describe('superannuationDate', () => {
  it('retires at the end of the birth month for an ordinary date of birth', () => {
    expect(superannuationDate('1990-03-15')).toBe('2050-03-31')
  })

  it('the DoB-on-1st edge case: retires at the end of the PRECEDING month', () => {
    // Born 1 March 1990 -> attains 60 on 28 Feb 2050 (day before the anniversary) -> retires end of Feb.
    expect(superannuationDate('1990-03-01')).toBe('2050-02-28')
  })

  it('handles a December-1st birth crossing into the previous year', () => {
    expect(superannuationDate('1990-12-01')).toBe('2050-11-30')
  })

  it('handles a January-1st birth crossing into the previous calendar year', () => {
    expect(superannuationDate('1990-01-01')).toBe('2049-12-31')
  })
})

describe('qualifyingHalfYears', () => {
  it('counts completed six-month periods, rounding a 3+ month remainder up', () => {
    expect(qualifyingHalfYears('2000-01-01', '2030-01-01')).toBe(60) // exactly 30 years = 60 half-years
    expect(qualifyingHalfYears('2000-01-01', '2030-04-02')).toBe(61) // +3 months -> one more half-year
    expect(qualifyingHalfYears('2000-01-01', '2030-02-01')).toBe(60) // +1 month -> not enough to round up
  })
})

describe('retirementGratuity — the ceiling', () => {
  it('applies the DA-linked 25% uplift once: Rs. 20 lakh becomes Rs. 25 lakh', () => {
    expect(gratuityCeiling(facts)).toBe(2500000)
  })

  it('caps a long-service, high-emolument case at the ceiling rather than the formula', () => {
    // 40 years = 80 half-years * 0.25 * 200,000 = Rs. 40,00,000 by service, but the 16.5x multiplier
    // caps that to Rs. 33,00,000 first, and the Rs. 25 lakh ceiling caps it again after that.
    const result = retirementGratuity(facts, '1990-01-01', '2030-01-01', 200_000)
    expect(result.halfYears).toBe(80)
    expect(result.cappedByMultiplier).toBe(true)
    expect(result.uncapped).toBe(3_300_000)
    expect(result.amount).toBe(2_500_000)
    expect(result.cappedByCeiling).toBe(true)
  })

  it('caps at 16.5x emoluments before the ceiling ever applies, for a shorter high-emolument case', () => {
    // 40 half-years (20 years) * 0.25 * 30,000 = Rs. 3,00,000 by service; 16.5 * 30,000 = Rs. 4,95,000 max.
    // Service-based figure is smaller here, so the multiplier cap never binds — assert the service figure wins.
    const result = retirementGratuity(facts, '2000-01-01', '2020-01-01', 30_000)
    expect(result.amount).toBe(300_000)
    expect(result.cappedByMultiplier).toBe(false)
    expect(result.cappedByCeiling).toBe(false)
  })

  it('does not exceed the ceiling even when nowhere near the 16.5x multiplier', () => {
    const result = retirementGratuity(facts, '1980-01-01', '2030-01-01', 1_000_000)
    expect(result.amount).toBeLessThanOrEqual(2_500_000)
  })
})

describe('commuteePension', () => {
  it('applies fraction x 12 x the age-next-birthday factor', () => {
    const result = commuteePension(facts, 50_000, 60, 0.4)
    expect(result).toBeDefined()
    expect(result?.monthlyAmountCommuted).toBe(20_000)
    expect(result?.lumpSum).toBe(Math.round(20_000 * 12 * 8.287))
    expect(result?.reducedMonthlyPension).toBe(30_000)
  })

  it('returns undefined for an age not in the table', () => {
    expect(commuteePension(facts, 50_000, 999)).toBeUndefined()
  })
})

describe('upsAssuredPayout', () => {
  it('gives nothing below 10 years of qualifying service', () => {
    const result = upsAssuredPayout(100_000, 9)
    expect(result.eligible).toBe(false)
    expect(result.amount).toBe(0)
  })

  it('applies the Rs. 10,000 floor when the proportionate formula would pay less', () => {
    // 50% of 15,000 * (10/25) = Rs. 3,000, floored to Rs. 10,000.
    const result = upsAssuredPayout(15_000, 10)
    expect(result.eligible).toBe(true)
    expect(result.amount).toBe(10_000)
    expect(result.flooredByMinimum).toBe(true)
  })

  it('pays the full 50% of average basic after 25+ years, above the floor', () => {
    const result = upsAssuredPayout(100_000, 25)
    expect(result.amount).toBe(50_000)
    expect(result.flooredByMinimum).toBe(false)
  })

  it('is proportionate between 10 and 25 years', () => {
    const result = upsAssuredPayout(100_000, 20)
    expect(result.amount).toBe(40_000) // 50% * 100,000 * 20/25
  })
})

describe('upsLumpSum', () => {
  it('is (1/10) x (basic + DA) per completed half-year', () => {
    expect(upsLumpSum(100_000, 60)).toBe(600_000)
  })
})

describe('NPS and GPF projections', () => {
  it('compounds a fixed monthly contribution, growing corpus over time', () => {
    const corpus = projectNpsCorpus({
      monthlyBasicPlusDa: 100_000,
      employeeRatePercent: 10,
      employerRatePercent: 14,
      months: 120,
      annualReturnPercent: 8,
    })
    expect(corpus).toBeGreaterThan(24_000 * 120) // more than the raw contributions, from compounding
  })

  it('projects GPF balance forward at the notified rate', () => {
    const balance = projectGpfBalance({ monthlyContribution: 10_000, months: 12, annualRatePercent: 7.1 })
    expect(balance).toBeGreaterThan(120_000)
  })
})

describe('currentGpfRate', () => {
  it('picks the latest rate on or before the given date', () => {
    expect(currentGpfRate(facts, '2026-05-01')).toBe(7.1)
    expect(currentGpfRate(facts, '2020-08-01')).toBe(7.1)
  })
})
