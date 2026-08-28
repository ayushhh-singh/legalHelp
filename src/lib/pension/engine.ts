/**
 * Retirement and pension. Pure: no React, no Dexie, no clock of its own —
 * every function takes its dates and its `PensionFacts` as arguments, the
 * way `src/lib/pay/engine.ts` takes its datasets.
 */

import { addDays, addYears, completedMonths, lastDayOfMonth } from '@/lib/istDay'

import type { IsoDate } from '@/lib/istDay'
import type { PensionFacts } from './types'

/**
 * FR 56(a): a Government servant retires on the afternoon of the last day of
 * the month in which he attains the age of sixty years. A person is deemed
 * in law to attain an age on the day BEFORE the anniversary of their birth —
 * so someone born on the 1st of a month attains 60 on the last day of the
 * PRECEDING month, and retires at the end of that earlier month, not the one
 * their birthday falls in. Every other birth date attains 60 within its own
 * birth month and retires at that month's end.
 */
export function superannuationDate(dob: IsoDate): IsoDate {
  const sixtiethBirthday = addYears(dob, 60)
  const attainmentDate = addDays(sixtiethBirthday, -1)
  return lastDayOfMonth(attainmentDate)
}

/**
 * Qualifying service in completed six-monthly periods, per CCS (Pension)
 * Rules, 2021 Rule 45(4): a residual fraction of three months or more counts
 * as one further completed half-year.
 */
export function qualifyingHalfYears(doj: IsoDate, retirementDate: IsoDate): number {
  const months = completedMonths(doj, retirementDate)
  const halfYears = Math.floor(months / 6)
  const remainder = months % 6
  return remainder >= 3 ? halfYears + 1 : halfYears
}

/** The gratuity ceiling actually payable today, after the DA-linked 25% uplift(s). */
export function gratuityCeiling(facts: PensionFacts): number {
  const { baseCeiling, daLinked } = facts.gratuity
  if (daLinked.kind === 'not-applicable') return baseCeiling
  return Math.round(baseCeiling * 1.25 ** daLinked.timesApplied)
}

export interface GratuityResult {
  halfYears: number
  emoluments: number
  uncapped: number
  ceiling: number
  amount: number
  cappedByCeiling: boolean
  cappedByMultiplier: boolean
}

/** Retirement gratuity — Rule 45(1)(a): 1/4 emoluments per completed half-year, max 16.5x, capped at the ceiling. */
export function retirementGratuity(
  facts: PensionFacts,
  doj: IsoDate,
  retirementDate: IsoDate,
  lastEmoluments: number,
): GratuityResult {
  const halfYears = qualifyingHalfYears(doj, retirementDate)
  const byService = halfYears * facts.gratuity.fractionPerSixMonths * lastEmoluments
  const byMultiplier = facts.gratuity.maxMultiplier * lastEmoluments
  const uncapped = Math.min(byService, byMultiplier)
  const ceiling = gratuityCeiling(facts)
  const amount = Math.min(uncapped, ceiling)
  return {
    halfYears,
    emoluments: lastEmoluments,
    uncapped: Math.round(uncapped),
    ceiling,
    amount: Math.round(amount),
    cappedByMultiplier: byService > byMultiplier,
    cappedByCeiling: uncapped > ceiling,
  }
}

export function commutationFactor(facts: PensionFacts, ageNextBirthday: number): number | undefined {
  return facts.commutation.table.find((row) => row.ageNextBirthday === ageNextBirthday)?.factor
}

export interface CommutationResult {
  fraction: number
  monthlyAmountCommuted: number
  factor: number
  lumpSum: number
  reducedMonthlyPension: number
}

/** Commuted value = fraction commuted x 12 x the age-next-birthday factor, per the CCS Commutation Rules table. */
export function commuteePension(
  facts: PensionFacts,
  monthlyPension: number,
  ageNextBirthday: number,
  fraction: number = facts.commutation.maxFraction,
): CommutationResult | undefined {
  const factor = commutationFactor(facts, ageNextBirthday)
  if (factor === undefined) return undefined
  const monthlyAmountCommuted = monthlyPension * fraction
  const lumpSum = Math.round(monthlyAmountCommuted * 12 * factor)
  return {
    fraction,
    monthlyAmountCommuted: Math.round(monthlyAmountCommuted),
    factor,
    lumpSum,
    reducedMonthlyPension: Math.round(monthlyPension - monthlyAmountCommuted),
  }
}

export interface NpsProjectionInput {
  monthlyBasicPlusDa: number
  employeeRatePercent: number
  employerRatePercent: number
  months: number
  annualReturnPercent: number
  existingCorpus?: number
}

/**
 * A simplified compounding projection, held in today's rupees: it assumes
 * `monthlyBasicPlusDa` and the return rate stay constant for the whole
 * projection window rather than modelling future increments or Dearness
 * Allowance revisions. It is a reference estimate for that reason, not a
 * corpus forecast.
 */
export function projectNpsCorpus(input: NpsProjectionInput): number {
  const monthlyContribution =
    (input.monthlyBasicPlusDa * (input.employeeRatePercent + input.employerRatePercent)) / 100
  const monthlyRate = input.annualReturnPercent / 100 / 12
  let corpus = input.existingCorpus ?? 0
  for (let month = 0; month < input.months; month += 1) {
    corpus = corpus * (1 + monthlyRate) + monthlyContribution
  }
  return Math.round(corpus)
}

export interface GpfProjectionInput {
  monthlyContribution: number
  months: number
  annualRatePercent: number
  existingBalance?: number
}

/** Same simplified monthly-compounding approach as `projectNpsCorpus`, at the notified GPF rate. */
export function projectGpfBalance(input: GpfProjectionInput): number {
  const monthlyRate = input.annualRatePercent / 100 / 12
  let balance = input.existingBalance ?? 0
  for (let month = 0; month < input.months; month += 1) {
    balance = balance * (1 + monthlyRate) + input.monthlyContribution
  }
  return Math.round(balance)
}

export interface UpsPayoutResult {
  eligible: boolean
  amount: number
  flooredByMinimum: boolean
}

/**
 * UPS assured monthly payout: 50% of the last 12 months' average basic pay
 * after 25+ years of qualifying service, proportionate for 10-25 years, a
 * Rs. 10,000/month floor once eligible, and no payout below 10 years.
 */
export function upsAssuredPayout(avgLast12MonthsBasic: number, qualifyingYears: number): UpsPayoutResult {
  if (qualifyingYears < 10) return { eligible: false, amount: 0, flooredByMinimum: false }
  const raw =
    qualifyingYears >= 25
      ? 0.5 * avgLast12MonthsBasic
      : 0.5 * avgLast12MonthsBasic * (qualifyingYears / 25)
  const amount = Math.max(raw, 10_000)
  return { eligible: true, amount: Math.round(amount), flooredByMinimum: amount > raw }
}

/** UPS's additional lump sum on superannuation: (1/10) x (last basic + DA) per completed half-year. */
export function upsLumpSum(lastBasicPlusDa: number, halfYears: number): number {
  return Math.round((lastBasicPlusDa / 10) * halfYears)
}

export function currentGpfRate(facts: PensionFacts, asOf: IsoDate): number {
  const applicable = facts.gpf.rateHistory
    .filter((row) => row.effectiveFrom <= asOf)
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))[0]
  return applicable?.rate ?? facts.gpf.rateHistory[facts.gpf.rateHistory.length - 1]?.rate ?? 0
}
