import type { PayLine, PayResult } from './engine'
import { percentOf, rupees } from './rounding'
import { compareRegimes, type TaxComparison } from './tax'
import {
  cityFor,
  hraClassFor,
  type Bilingual,
  type CityClass,
  type PaySource,
  type PayTables,
  type Regime,
} from './tables'

/**
 * Two comparisons, and they are not the same kind of thing.
 *
 * `diffResults` compares two GOVERNMENT pay slips, both produced by the same
 * engine from the same orders. Every figure on both sides is sourced, so the
 * difference between them is sourced too.
 *
 * `comparePrivate` compares a government pay slip against a private cost to
 * company, and there is no order behind the private side. A CTC is a single
 * number that different employers break up differently, so every step from it
 * to a take-home is an assumption. This module makes each of those assumptions
 * an INPUT with a stated default rather than a constant buried in a formula,
 * and returns them alongside the answer so the card can show its working. It
 * states no opinion about which is better; the brief asks for numbers and a
 * sentence saying the value of the benefits is indicative, and that is all it
 * returns.
 */

/* ------------------------------------------------------------------ *
 * Two posts, side by side
 * ------------------------------------------------------------------ */

export interface DiffRow {
  id: string
  label: Bilingual
  kind: PayLine['kind']
  a: number
  b: number
  delta: number
}

export interface ScenarioDiff {
  rows: DiffRow[]
  gross: DiffRow
  deductions: DiffRow
  net: DiffRow
  annualCtc: DiffRow
  tax: DiffRow
}

const summaryRow = (id: string, label: Bilingual, kind: PayLine['kind'], a: number, b: number): DiffRow => ({
  id,
  label,
  kind,
  a,
  b,
  delta: b - a,
})

/**
 * Line-by-line, over the union of both slips.
 *
 * The union matters: a line that exists on one side and not the other — a
 * Special Security Allowance the other post does not carry — is the most
 * interesting row on the page, and an intersection would drop exactly those.
 */
export function diffResults(a: PayResult, b: PayResult): ScenarioDiff {
  const order: string[] = []
  const byId = new Map<string, { label: Bilingual; kind: PayLine['kind']; a: number; b: number }>()

  const collect = (result: PayResult, side: 'a' | 'b') => {
    for (const line of result.lines) {
      if (line.unpriced) continue
      const existing = byId.get(line.id)
      if (existing) existing[side] = line.amount
      else {
        order.push(line.id)
        byId.set(line.id, { label: line.label, kind: line.kind, a: 0, b: 0, [side]: line.amount })
      }
    }
  }
  collect(a, 'a')
  collect(b, 'b')

  const rows = order
    .map((id) => {
      const entry = byId.get(id)
      if (!entry) return null
      return { id, label: entry.label, kind: entry.kind, a: entry.a, b: entry.b, delta: entry.b - entry.a }
    })
    .filter((row): row is DiffRow => row !== null)

  return {
    rows,
    gross: summaryRow('gross', { en: 'Gross', hi: 'सकल' }, 'pay', a.gross, b.gross),
    deductions: summaryRow(
      'deductions',
      { en: 'Total deductions', hi: 'कुल कटौतियाँ' },
      'deduction',
      a.deductions.total,
      b.deductions.total,
    ),
    net: summaryRow('net', { en: 'Net pay', hi: 'निवल वेतन' }, 'pay', a.netMonthly, b.netMonthly),
    annualCtc: summaryRow(
      'annual-ctc',
      { en: 'Annual cost to Government', hi: 'सरकार पर वार्षिक व्यय' },
      'pay',
      a.annualCtc,
      b.annualCtc,
    ),
    tax: summaryRow('tax', { en: 'Income tax', hi: 'आयकर' }, 'deduction', a.deductions.tax, b.deductions.tax),
  }
}

/* ------------------------------------------------------------------ *
 * Private cost to company against government net pay
 * ------------------------------------------------------------------ */

/** Employees' Provident Fund: 12 per cent from each side, on basic pay. */
const EPF_RATE = 12
/** The Payment of Gratuity Act accrual most CTC statements carry: 15/26 ÷ 12. */
const GRATUITY_ACCRUAL_RATE = 4.81

export interface PrivateInput {
  annualCtc: number
  /** Share of the package that is basic pay. Everything else rides on this. */
  basicShare: number
  /** House Rent Allowance in the package, as a share of basic pay. */
  hraShare: number
  /** Whether the quoted CTC already includes the employer's PF and gratuity. */
  ctcIncludesEmployerContributions: boolean
  cityId: string | null
  rentPaidMonthly: number
  regime: Regime | 'auto'
  /** Professional tax, where the State levies one. Zero by default. */
  professionalTaxMonthly: number
}

export const DEFAULT_PRIVATE_INPUT: PrivateInput = {
  annualCtc: 0,
  basicShare: 40,
  hraShare: 40,
  ctcIncludesEmployerContributions: true,
  cityId: null,
  rentPaidMonthly: 0,
  regime: 'auto',
  professionalTaxMonthly: 0,
}

export interface PrivateResult {
  monthlyCtc: number
  basic: number
  hra: number
  employerPf: number
  gratuityAccrual: number
  /** What the employer actually pays out in cash each month. */
  cashGross: number
  employeePf: number
  professionalTax: number
  tax: number
  takeHome: number
  regime: Regime
  taxComputation: TaxComparison
  cityClass: CityClass
  /** Every assumption, spelled out, in both languages. */
  assumptions: Bilingual[]
}

export function computePrivate(input: PrivateInput, tables: PayTables): PrivateResult {
  const monthlyCtc = rupees(Math.max(0, input.annualCtc) / 12)
  const basic = percentOf(monthlyCtc, input.basicShare)
  const hra = percentOf(basic, input.hraShare)
  const employerPf = percentOf(basic, EPF_RATE)
  const gratuityAccrual = percentOf(basic, GRATUITY_ACCRUAL_RATE)
  const employeePf = percentOf(basic, EPF_RATE)

  // A CTC that includes the employer's own contributions is not cash. Taking it
  // as cash is the single most common error in a private-versus-government
  // comparison, and it flatters the private side by about a sixth of basic pay.
  const cashGross = input.ctcIncludesEmployerContributions
    ? Math.max(0, monthlyCtc - employerPf - gratuityAccrual)
    : monthlyCtc

  const cityClass = hraClassFor(cityFor(tables.cities, input.cityId))
  const professionalTax = rupees(Math.max(0, input.professionalTaxMonthly))

  const taxComputation = compareRegimes(
    {
      taxableSalary: cashGross * 12,
      hraReceived: hra * 12,
      salaryForHra: basic * 12,
      rentPaid: input.rentPaidMonthly * 12,
      metro: cityClass === 'X',
      // Section 80CCD(2) is for a pension scheme contribution. The employer's
      // Provident Fund share is exempt under Schedule IV instead, and is
      // already outside `cashGross` — counting it here would relieve it twice.
      employerPension: 0,
      employeePension: 0,
      section80c: employeePf * 12,
      section80ccd1b: 0,
      section80d: 0,
      homeLoanInterest: 0,
      ageBand: 'below-60',
    },
    tables.tax,
  )

  const regime: Regime = input.regime === 'auto' ? taxComputation.recommended : input.regime
  const tax = taxComputation[regime].monthly

  return {
    monthlyCtc,
    basic,
    hra,
    employerPf,
    gratuityAccrual,
    cashGross,
    employeePf,
    professionalTax,
    tax,
    takeHome: cashGross - employeePf - professionalTax - tax,
    regime,
    taxComputation,
    cityClass,
    assumptions: [
      {
        en: `Basic pay is taken as ${input.basicShare}% of the package and House Rent Allowance as ${input.hraShare}% of basic pay. Employers split a CTC differently; change either figure to match the offer.`,
        hi: `मूल वेतन को पैकेज का ${input.basicShare}% तथा मकान किराया भत्ता को मूल वेतन का ${input.hraShare}% माना गया है। नियोक्ता CTC का विभाजन भिन्न प्रकार से करते हैं; प्रस्ताव के अनुसार दोनों आँकड़े बदलें।`,
      },
      {
        en: `Provident Fund is ${EPF_RATE}% of basic pay from each side, and gratuity accrues at ${GRATUITY_ACCRUAL_RATE}% of basic pay.`,
        hi: `भविष्य निधि दोनों ओर से मूल वेतन का ${EPF_RATE}% है, तथा उपदान मूल वेतन के ${GRATUITY_ACCRUAL_RATE}% की दर से संचित होता है।`,
      },
      input.ctcIncludesEmployerContributions
        ? {
            en: 'The quoted package is treated as including the employer’s Provident Fund and gratuity, so neither is counted as cash.',
            hi: 'उद्धृत पैकेज में नियोक्ता की भविष्य निधि तथा उपदान सम्मिलित माना गया है, अतः दोनों को नकद नहीं गिना गया।',
          }
        : {
            en: 'The quoted package is treated as cash, with the employer’s Provident Fund and gratuity payable over and above it.',
            hi: 'उद्धृत पैकेज को नकद माना गया है, तथा नियोक्ता की भविष्य निधि एवं उपदान इसके अतिरिक्त देय हैं।',
          },
    ],
  }
}

/* ------------------------------------------------------------------ *
 * What the government side carries that a CTC does not
 * ------------------------------------------------------------------ */

export interface BenefitNote {
  id: string
  label: Bilingual
  /** Rupees a month where the datasets carry a figure; null where they do not. */
  monthly: number | null
  body: Bilingual
  source?: PaySource
  verify: boolean
}

/**
 * The benefits, from the datasets, with a figure only where there is one.
 *
 * This deliberately does not total them. Adding an "annual value of CGHS" to a
 * net pay would be an opinion dressed as arithmetic — the master context's rule
 * is that nothing is styled to look more certain than it is, and the value of a
 * lifetime health scheme to a particular officer is not a number this app has.
 */
export function governmentBenefits(result: PayResult, tables: PayTables): BenefitNote[] {
  const upsRules = tables.ups.scheme.rules
  const notes: BenefitNote[] = []

  // Under the General Provident Fund there IS no Government contribution — the
  // pension beside it is a defined benefit rather than a corpus — so the row is
  // absent rather than zero. A ₹0 row would read as "the Government pays
  // nothing towards your pension", which is the opposite of the truth.
  if (result.pensionScheme !== 'gpf') {
    const pension = result.pensionScheme === 'ups' ? tables.ups : tables.nps
    notes.push({
      id: 'employer-pension',
      label: { en: 'Government’s pension contribution', hi: 'सरकार का पेंशन अंशदान' },
      monthly: result.employerPension,
      body: pension.scheme.summary,
      source: pension.scheme.source,
      verify: pension.scheme.verify,
    })
  }

  notes.push(
    {
      id: 'ups-assurance',
      label: tables.ups.scheme.name,
      monthly: null,
      body: upsRules.find((rule) => rule.key === 'qualifying-service')?.body ?? tables.ups.scheme.summary,
      source: tables.ups.scheme.source,
      verify: tables.ups.scheme.verify,
    },
    {
      id: 'cghs',
      label: tables.cghs.scheme.name,
      monthly: result.deductions.cghs,
      body: tables.cghs.scheme.summary,
      source: tables.cghs.scheme.source,
      verify: tables.cghs.scheme.verify,
    },
    {
      id: 'cgegis',
      label: tables.cgegis.scheme.name,
      monthly: result.deductions.cgegis,
      body: tables.cgegis.scheme.summary,
      source: tables.cgegis.scheme.source,
      verify: tables.cgegis.scheme.verify,
    },
  )

  const ltc = tables.allowances.allowances.find((allowance) => allowance.id === 'leave-travel-concession')
  if (ltc) {
    notes.push({
      id: ltc.id,
      label: ltc.name,
      monthly: null,
      body: ltc.appliesTo,
      source: ltc.source,
      verify: ltc.verify,
    })
  }

  return notes
}

/** The sentence that must appear beside the benefits, in both languages. */
export const BENEFITS_ARE_INDICATIVE: Bilingual = {
  en: 'The value of these benefits is indicative. They are not added to net pay, because their worth to a particular officer is not a figure this app has.',
  hi: 'इन लाभों का मूल्य केवल सांकेतिक है। इन्हें निवल वेतन में नहीं जोड़ा गया है, क्योंकि किसी विशेष अधिकारी के लिए इनका मूल्य ऐसा आँकड़ा नहीं है जो इस ऐप के पास हो।',
}
