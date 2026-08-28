import { nearestTen, rupees } from './rounding'
import type { Bilingual, Regime } from './tables'

import type { TaxYear } from '@/modules/pay/schema'

/**
 * Income tax on salary, old regime against new.
 *
 * Every rate, slab, limit and section number is read from `data/pay/tax.json`.
 * The only numbers written here are the two the statute expresses as a
 * relationship rather than a figure — the 50/40 per cent split in Rule 2A for
 * the House Rent Allowance exemption, and the 10 per cent of salary it is
 * reduced by — and both are named in the exemption record's own description.
 *
 * Three things this does that a slab loop alone does not, and each one is the
 * difference between a plausible figure and the right one:
 *
 *  1. **Marginal relief on the section 87A rebate.** Without it the new regime
 *     shows a cliff — ₹12,00,000 of income pays nothing and ₹12,00,100 pays
 *     ₹61,515. The proviso caps the tax at the amount by which income exceeds
 *     the ceiling, so the real figure is ₹100.
 *  2. **Marginal relief on surcharge**, on the same principle at each band edge.
 *     Central government pay reaches the first band only at the very top of the
 *     matrix, which is exactly where nobody would notice it was wrong.
 *  3. **Section 288A**, which rounds total income to the nearest ten rupees
 *     before the slabs are applied.
 */

export type AgeBand = 'below-60' | '60-to-80' | '80-and-above'

export interface TaxInput {
  /** Annual salary taxable under this regime, before exemption or deduction. */
  taxableSalary: number
  /** Annual House Rent Allowance actually received. */
  hraReceived: number
  /** Rule 2A "salary": basic pay plus Dearness Allowance, annual. */
  salaryForHra: number
  /** Annual rent actually paid. Zero means no exemption is available. */
  rentPaid: number
  /** Posted in an X-class city: Rule 2A allows 50 per cent rather than 40. */
  metro: boolean
  /** The Government's pension contribution for the year — section 80CCD(2). */
  employerPension: number
  /** The employee's own pension contribution — section 80CCD(1), old only. */
  employeePension: number
  section80c: number
  section80ccd1b: number
  section80d: number
  homeLoanInterest: number
  ageBand: AgeBand
}

export interface TaxLine {
  id: string
  label: Bilingual
  section: string
  amount: number
  /** What the figure was capped to, where a statutory limit bound. */
  limit?: number
}

export interface TaxResult {
  regime: Regime
  regimeName: Bilingual
  grossSalary: number
  exemptions: TaxLine[]
  standardDeduction: number
  deductions: TaxLine[]
  taxableIncome: number
  slabTax: number
  rebate: number
  rebateSection: string
  /** Relief under the proviso to section 87A, where the rebate just lapsed. */
  marginalRelief: number
  surcharge: number
  surchargeRate: number
  cess: number
  cessRate: number
  cessName: Bilingual
  /** Tax payable for the year, rounded to the rupee. */
  total: number
  /** One month's instalment of it — what appears on the pay slip. */
  monthly: number
}

export interface TaxComparison {
  old: TaxResult
  new: TaxResult
  /** The regime that costs less. Ties go to the new one, which is the default. */
  recommended: Regime
  saving: number
}

const EMPTY: Bilingual = { en: '', hi: '' }

/** Rule 2A: 50 per cent of salary in the four metros, 40 per cent elsewhere. */
const HRA_METRO_SHARE = 50
const HRA_OTHER_SHARE = 40
/** Rule 2A limb two: rent paid over ten per cent of salary. */
const HRA_RENT_FLOOR_SHARE = 10

/**
 * The exemption under section 10(13A) read with Rule 2A — the least of three
 * figures, and available only under the old regime.
 */
export function hraExemption(input: TaxInput): number {
  if (input.rentPaid <= 0 || input.hraReceived <= 0) return 0
  const overTenPercent = input.rentPaid - (input.salaryForHra * HRA_RENT_FLOOR_SHARE) / 100
  if (overTenPercent <= 0) return 0
  const share = ((input.metro ? HRA_METRO_SHARE : HRA_OTHER_SHARE) * input.salaryForHra) / 100
  return rupees(Math.min(input.hraReceived, overTenPercent, share))
}

/** Tax on an income by a set of slabs. Exact; the caller rounds. */
export function slabTaxOn(
  income: number,
  slabs: ReadonlyArray<{ from: number; to: number | null; rate: number }>,
): number {
  let tax = 0
  for (const slab of slabs) {
    const top = slab.to ?? Number.POSITIVE_INFINITY
    const inBand = Math.min(income, top) - slab.from
    if (inBand > 0) tax += (inBand * slab.rate) / 100
  }
  return tax
}

function slabsFor(regime: TaxYear['regimes'][number], ageBand: AgeBand) {
  const banded = regime.slabs.filter((slab) => slab.ageBand === ageBand)
  // The new regime has no age bands at all, so an empty filter means "all of
  // them" rather than "no tax". A silent zero here would be the worst possible
  // failure mode of this whole module.
  const chosen = banded.length > 0 ? banded : regime.slabs.filter((slab) => !slab.ageBand)
  return [...chosen].sort((a, b) => a.from - b.from)
}

/** The surcharge rate on a total income, for one regime. */
function surchargeRateFor(tax: TaxYear, regime: Regime, income: number): { rate: number; from: number } {
  const bands = tax.surcharge.bands
    .filter((band) => band.regimes.includes(regime))
    .filter((band) => income > band.from)
    .sort((a, b) => a.from - b.from)
  const band = bands[bands.length - 1]
  return band ? { rate: band.rate, from: band.from } : { rate: 0, from: 0 }
}

const cap = (amount: number, limit: number | null | undefined): number =>
  limit == null ? Math.max(0, amount) : Math.min(Math.max(0, amount), limit)

/**
 * The ceiling on the section 80CCD(2) deduction for a Central Government
 * employee, as `data/pay/nps.json` states it: "the employer's contribution up
 * to 14 per cent of salary is deductible separately".
 */
const EMPLOYER_PENSION_DEDUCTION_SHARE = 14

function provision(tax: TaxYear, id: string) {
  return [...tax.deductions, ...tax.exemptions].find((entry) => entry.id === id)
}

/**
 * @param regimeId Which regime to compute under.
 *
 * The caller decides what `taxableSalary` contains: an allowance the data marks
 * `taxable: false` never reaches this function at all, because an exempt
 * allowance is not income rather than income with a deduction against it.
 */
export function computeTaxUnder(regimeId: Regime, input: TaxInput, tax: TaxYear): TaxResult {
  const regime = tax.regimes.find((entry) => entry.id === regimeId)
  if (!regime) {
    throw new Error(`data/pay/tax.json carries no "${regimeId}" regime`)
  }
  const old = regimeId === 'old'

  const exemptions: TaxLine[] = []
  if (old) {
    const rule = provision(tax, '10-13a-hra')
    const amount = hraExemption(input)
    if (amount > 0) {
      exemptions.push({
        id: '10-13a-hra',
        label: rule?.name ?? EMPTY,
        section: rule?.section1961 ?? '10(13A)',
        amount,
      })
    }
  }

  const grossSalary = rupees(input.taxableSalary)
  const afterExemption = grossSalary - exemptions.reduce((sum, line) => sum + line.amount, 0)

  const deductions: TaxLine[] = []
  const standardDeduction = Math.min(regime.standardDeduction, Math.max(afterExemption, 0))
  const push = (id: string, amount: number, limit?: number | null) => {
    if (amount <= 0) return
    const rule = provision(tax, id)
    deductions.push({
      id,
      label: rule?.name ?? EMPTY,
      section: rule?.section1961 ?? id,
      amount: rupees(amount),
      ...(limit == null ? {} : { limit }),
    })
  }

  /**
   * Section 80CCD(2) survives in both regimes — it is the one deduction a
   * salaried reader keeps after opting into the new one, and for a Government
   * employee it is worth 14 per cent of pay. `nps.json` states the ceiling as
   * "up to 14 per cent of salary", so a Unified Pension Scheme subscriber whose
   * employer pays 18.5 deducts 14, not 18.5.
   */
  const ccd2Rule = provision(tax, '80ccd2')
  const ccd2Ceiling = rupees((input.salaryForHra * EMPLOYER_PENSION_DEDUCTION_SHARE) / 100)
  const ccd2 = Math.min(input.employerPension, ccd2Ceiling, ...(ccd2Rule?.limit ? [ccd2Rule.limit] : []))
  push('80ccd2', ccd2, ccd2Ceiling)

  if (old) {
    // 80C, 80CCC and 80CCD(1) share one ceiling — section 80CCE. The employee's
    // own pension contribution goes in first because it is automatic; whatever
    // headroom is left is what a declared 80C investment can use.
    const ccdRule = provision(tax, '80ccd1')
    const cRule = provision(tax, '80c')
    const ceiling = cRule?.limit ?? 150_000
    const ccd1 = cap(input.employeePension, Math.min(ccdRule?.limit ?? ceiling, ceiling))
    push('80ccd1', ccd1, ceiling)
    push('80c', cap(input.section80c, ceiling - ccd1), ceiling - ccd1)

    const ccd1bRule = provision(tax, '80ccd1b')
    push('80ccd1b', cap(input.section80ccd1b, ccd1bRule?.limit), ccd1bRule?.limit)

    const dRule = provision(tax, '80d')
    push('80d', cap(input.section80d, dRule?.limit), dRule?.limit)

    const loanRule = provision(tax, '24b-home-loan-interest')
    push('24b-home-loan-interest', cap(input.homeLoanInterest, loanRule?.limit), loanRule?.limit)
  }

  const deducted = deductions.reduce((sum, line) => sum + line.amount, 0)
  const taxableIncome = nearestTen(Math.max(0, afterExemption - standardDeduction - deducted))

  const slabTax = slabTaxOn(taxableIncome, slabsFor(regime, input.ageBand))

  // Section 87A. `incomeCeiling` is on total income, not on tax.
  let rebate = 0
  let marginalRelief = 0
  if (taxableIncome <= regime.rebate.incomeCeiling) {
    rebate = Math.min(slabTax, regime.rebate.maxRebate)
  } else if (regimeId === 'new') {
    // The proviso: tax cannot exceed the amount by which income crosses the
    // ceiling. Without this a hundred rupees of extra income costs sixty-one
    // thousand in tax, which no reader would believe and no DDO would deduct.
    const excess = taxableIncome - regime.rebate.incomeCeiling
    marginalRelief = Math.max(0, slabTax - excess)
  }

  const afterRebate = Math.max(0, slabTax - rebate - marginalRelief)

  const { rate: surchargeRate, from: surchargeFrom } = surchargeRateFor(tax, regimeId, taxableIncome)
  let surcharge = (afterRebate * surchargeRate) / 100
  if (surchargeRate > 0) {
    // The same relief at the band edge: tax plus surcharge cannot exceed the
    // tax at the threshold plus the whole of the income above it.
    const atThreshold = slabTaxOn(surchargeFrom, slabsFor(regime, input.ageBand))
    const ceiling = atThreshold + (taxableIncome - surchargeFrom)
    surcharge = Math.max(0, Math.min(surcharge, ceiling - afterRebate))
  }

  const cess = ((afterRebate + surcharge) * tax.cess.rate) / 100
  const total = rupees(afterRebate + surcharge + cess)

  return {
    regime: regimeId,
    regimeName: regime.name,
    grossSalary,
    exemptions,
    standardDeduction,
    deductions,
    taxableIncome,
    slabTax: rupees(slabTax),
    rebate: rupees(rebate),
    rebateSection: regime.rebate.section,
    marginalRelief: rupees(marginalRelief),
    surcharge: rupees(surcharge),
    surchargeRate,
    cess: rupees(cess),
    cessRate: tax.cess.rate,
    cessName: tax.cess.name,
    total,
    monthly: rupees(total / 12),
  }
}

export function compareRegimes(input: TaxInput, tax: TaxYear): TaxComparison {
  const oldRegime = computeTaxUnder('old', input, tax)
  const newRegime = computeTaxUnder('new', input, tax)
  return {
    old: oldRegime,
    new: newRegime,
    // A tie goes to the new regime: it is the statutory default, so choosing it
    // costs the officer nothing and choosing the other needs an election.
    recommended: oldRegime.total < newRegime.total ? 'old' : 'new',
    saving: Math.abs(oldRegime.total - newRegime.total),
  }
}
