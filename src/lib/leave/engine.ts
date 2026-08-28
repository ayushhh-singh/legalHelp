/**
 * The leave calculator. Pure: no React, no Dexie, no clock of its own —
 * every function takes `asOf` as an argument, the way `src/lib/pay/engine.ts`
 * takes its datasets as arguments.
 *
 * This is a reference estimate, not a service book. Real Earned Leave and
 * Half Pay Leave credit posts twice a year, on 1 January and 1 July, at 15
 * and 10 days respectively (Rules 26 and 29) — this engine instead accrues
 * both at the equivalent monthly rate (2.5 and 20/12 days per completed
 * calendar month of service) so a balance can be asked for on any date, not
 * only the two posting dates. The two are mathematically identical at every
 * half-year boundary; between boundaries this shows the accruing balance a
 * half-yearly posting would not yet reflect. `compareIsoDate`/`completedMonths`
 * come from `src/lib/istDay.ts`.
 */

import { completedMonths, compareIsoDate, monthOf, yearOf } from '@/lib/istDay'

import {
  CL_ENTITLEMENT_PER_YEAR,
  COMMUTED_LEAVE_DEBIT_FACTOR,
  EL_CREDIT_PER_MONTH,
  EL_ENCASHMENT_MAX_DAYS,
  EL_MAX_ACCUMULATION,
  HPL_CREDIT_PER_MONTH,
  RH_ENTITLEMENT_PER_YEAR,
} from './rules'

import type { IsoDate } from '@/lib/istDay'
import type { LeaveBalances, LeaveInput } from './types'

/** Days credited toward Earned Leave since joining, uncapped — the balance is capped, not the credit. */
export function elCredited(doj: IsoDate, asOf: IsoDate): number {
  return completedMonths(doj, asOf) * EL_CREDIT_PER_MONTH
}

export function hplCredited(doj: IsoDate, asOf: IsoDate): number {
  return completedMonths(doj, asOf) * HPL_CREDIT_PER_MONTH
}

/**
 * Casual Leave and Restricted Holidays lapse every calendar year and are not
 * accumulated. In the year an officer joins, the entitlement is pro-rated by
 * the whole months remaining in that year, inclusive of the month of joining
 * — the same "completed month" convention the DoPT instructions use for a
 * mid-year joiner's Casual Leave, rounded to the nearest whole day.
 */
function proRatedYearEntitlement(doj: IsoDate, asOf: IsoDate, perYear: number): number {
  if (compareIsoDate(doj, asOf) > 0) return 0
  if (yearOf(doj) < yearOf(asOf)) return perYear
  const monthsRemaining = 12 - monthOf(doj) + 1
  return Math.round((perYear * monthsRemaining) / 12)
}

export function calculateLeaveBalances(input: LeaveInput, asOf: IsoDate): LeaveBalances {
  const elCreditedDays = elCredited(input.doj, asOf)
  const elBalance = Math.min(EL_MAX_ACCUMULATION, Math.max(0, elCreditedDays - input.elTaken))

  const hplCreditedDays = hplCredited(input.doj, asOf)
  const hplBalance = Math.max(0, hplCreditedDays - input.hplTaken)

  const clEntitlement = proRatedYearEntitlement(input.doj, asOf, CL_ENTITLEMENT_PER_YEAR)
  const clBalance = Math.max(0, clEntitlement - input.clTakenThisYear)

  const rhEntitlement = proRatedYearEntitlement(input.doj, asOf, RH_ENTITLEMENT_PER_YEAR)
  const rhBalance = Math.max(0, rhEntitlement - input.rhTakenThisYear)

  return {
    asOf,
    el: {
      credited: elCreditedDays,
      taken: input.elTaken,
      balance: elBalance,
      encashable: Math.min(elBalance, EL_ENCASHMENT_MAX_DAYS),
    },
    hpl: {
      credited: hplCreditedDays,
      taken: input.hplTaken,
      balance: hplBalance,
      commutable: Math.floor(hplBalance / COMMUTED_LEAVE_DEBIT_FACTOR),
    },
    cl: { credited: clEntitlement, taken: input.clTakenThisYear, balance: clBalance },
    rh: { credited: rhEntitlement, taken: input.rhTakenThisYear, balance: rhBalance },
  }
}

/** Cash equivalent of leave salary — `(basic + DA) / 30 * days`, the standard encashment formula. */
export function cashEquivalent(basicPlusDa: number, days: number): number {
  return Math.round((basicPlusDa / 30) * days)
}
