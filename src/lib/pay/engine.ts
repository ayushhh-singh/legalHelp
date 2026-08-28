import { percentOf, rupees } from './rounding'
import {
  allowanceFor,
  cellPay,
  cghsFor,
  cgegisFor,
  cityFor,
  clampCell,
  contributionRate,
  hraClassFor,
  inTaAnnexure,
  levelFor,
  levelRank,
  type Bilingual,
  type CityClass,
  type Group,
  type PayLevelId,
  type PaySource,
  type PayTables,
  type PensionScheme,
  type Regime,
} from './tables'
import { compareRegimes, type TaxComparison, type AgeBand } from './tax'

import type { Allowance, AllowanceRate } from '@/modules/pay/schema'

/**
 * The pay calculation. Pure: no React, no Dexie, no dataset import, no clock.
 *
 * Everything it knows comes from `tables` — the eleven files under `data/pay`,
 * each carrying the order it was read from. Four figures are written here
 * rather than read, and each one is a number the orders express as a
 * relationship rather than as a field:
 *
 *  - `NPA_PAY_CEILING`, the ₹2,37,500 cap on basic pay plus Non-Practising
 *    Allowance, which `allowances.json` states as a sentence in `conditions`.
 *  - `TWO_CHILD_LIMIT`, likewise a condition on Children Education Allowance.
 *  - `TA_HIGHER_PAY_THRESHOLD`, the ₹24,200 above which a Level 1 or 2 employee
 *    draws Transport Allowance at the Level 3-8 rate; it is in the rate's own
 *    `when` text.
 *  - `MONTHS`, which is twelve.
 *
 * ## The three bases, and why there are three
 *
 * "Basic pay" is not one quantity once an officer is a doctor or a loco pilot:
 *
 *  - **DA base** = cell pay + running-staff pay element + Non-Practising
 *    Allowance. NPA is counted as pay for Dearness Allowance in terms.
 *  - **HRA base** = cell pay + running-staff pay element, and NOT NPA — the
 *    House Rent Allowance order says "basic pay excludes Non-Practising
 *    Allowance, Military Service Pay and every other type of pay".
 *  - **Percentage-allowance base** = cell pay alone. The 30 per cent pay element
 *    of Running Allowance is reckoned as pay for Dearness Allowance, House Rent
 *    Allowance and pension — those three — and not for every allowance that
 *    happens to be expressed as a percentage.
 *
 * Collapsing them into one number is the single most tempting simplification
 * here and it mis-states a medical officer's pay slip in both directions at once.
 */

const MONTHS = 12

/**
 * Basic pay plus Non-Practising Allowance may not exceed the average of the
 * Apex Level (₹2,25,000) and the Cabinet Secretary's pay (₹2,50,000).
 * `data/pay/allowances.json` carries the sentence; there is no field for it.
 */
const NPA_PAY_CEILING = 237_500

/** Children Education Allowance and Hostel Subsidy: two children, no more. */
const TWO_CHILD_LIMIT = 2

/** Levels 1 and 2 drawing this or more take the Level 3-8 Transport Allowance. */
const TA_HIGHER_PAY_THRESHOLD = 24_200

/* ------------------------------------------------------------------ *
 * Input
 * ------------------------------------------------------------------ */

export interface AllowanceChoice {
  id: string
  enabled: boolean
  /**
   * Which rate to draw. Either a full key from the dataset
   * (`"r1h3:level-8-and-below"`) or just its family (`"r1h3"`) — the engine
   * appends the band that matches the reader's Level.
   */
  rateKey?: string
  /** Override the rate's own figure: a percentage, or rupees per month. */
  rate?: number
  /** Per-child allowances. Defaults from `dependents`. */
  units?: number
}

export interface OldRegimeDeclarations {
  rentPaidMonthly?: number
  section80c?: number
  section80ccd1b?: number
  section80d?: number
  homeLoanInterest?: number
}

export interface PayInput {
  level: PayLevelId
  /** Zero-based. Cell 1 of the printed matrix is index 0. */
  cellIndex?: number
  /** Overrides the cell. For a reader who knows their basic and not their cell. */
  basic?: number
  cityId?: string | null
  /** Overrides the city's own class. Used by the private-vs-government panel. */
  cityClass?: CityClass
  daRate: number
  hraEnabled?: boolean
  /** Government accommodation. House Rent Allowance is then not admissible. */
  quarters?: boolean
  allowances?: readonly AllowanceChoice[]
  pensionScheme: PensionScheme
  /** General Provident Fund subscription, per cent of basic pay. */
  gpfRate?: number
  group: Group
  dependents?: { children?: number; hostellers?: number }
  /** `'auto'` picks whichever regime costs less. */
  regime: Regime | 'auto'
  otherDeductions?: number
  /** Medical officer: Non-Practising Allowance, which counts as pay for DA. */
  npa?: boolean
  /** Railway running staff: the 30 per cent pay element. */
  runningStaff?: boolean
  ageBand?: AgeBand
  oldRegime?: OldRegimeDeclarations
}

/* ------------------------------------------------------------------ *
 * Output
 * ------------------------------------------------------------------ */

export type PayLineKind = 'pay' | 'allowance' | 'deduction'

export interface PayLine {
  /** Stable across a recalculation — `explainPayLine` looks a line up by it. */
  id: string
  kind: PayLineKind
  label: Bilingual
  amount: number
  /**
   * How the figure was reached, as an expression over `inputs`. Deliberately
   * language-neutral: the popover renders it beside the numbers rather than
   * translating it, so there is one string to keep true rather than two.
   */
  formula: string
  inputs: Record<string, number | string | boolean>
  source?: PaySource
  /** True where no official order was read for the figure (ADR-016). */
  verify: boolean
  taxable: boolean
  taxSection?: string | null
  conditions: Bilingual[]
  note?: Bilingual | null
  /** More than one rate is admissible and the reader has not chosen. */
  needsChoice?: boolean
  /** The rates the reader may choose between, when `needsChoice`. */
  choices?: Array<{ key: string; when: Bilingual }>
  /** The order publishes no figure this calculator can use. */
  unpriced?: boolean
}

export interface PayDeductions {
  pension: number
  pensionLabel: Bilingual
  cghs: number
  cgegis: number
  tax: number
  other: number
  total: number
}

export interface PayResult {
  level: PayLevelId
  cellIndex: number
  basic: number
  gradePay: number | null
  /** 30 per cent of basic, for railway running staff. Zero otherwise. */
  payElement: number
  npa: number
  daBase: number
  hraBase: number
  cityId: string | null
  cityClass: CityClass
  da: number
  daRate: number
  hra: number
  hraRate: number
  /** True where the floor in the order beat the percentage. */
  hraFloorApplied: boolean
  ta: number
  daOnTa: number
  allowancesBreakdown: PayLine[]
  gross: number
  deductions: PayDeductions
  netMonthly: number
  pensionScheme: PensionScheme
  /** The Government's own pension contribution — cost to it, not to the officer. */
  employerPension: number
  annualCtc: number
  taxComputation: TaxComparison
  regime: Regime
  /** Every line, pay and deduction alike, for the info popovers. */
  lines: PayLine[]
  warnings: Bilingual[]
  /** True where any line in the slip rests on an unconfirmed figure. */
  verify: boolean
}

/* ------------------------------------------------------------------ *
 * Rate selection
 * ------------------------------------------------------------------ */

/**
 * A key segment that names a band of Levels, e.g. `level-9-and-above`,
 * `level-3-to-8`, `level-1-to-2-pay-24200`.
 *
 * Matched exactly rather than by prefix, because
 * `level-14-and-above-in-lieu-of-car` is the NAME of an option — the allowance
 * drawn instead of an official car — and not a band. Reading it as a band would
 * hand every Level 14 officer ₹15,750 they did not ask for.
 */
const LEVEL_BAND = /^level-(\d+|13a)(?:-and-(above|below)|-to-(\d+|13a))(?:-pay-(\d+))?$/

interface LevelBand {
  low: number
  high: number
  minPay: number
}

function parseLevelBand(segment: string): LevelBand | null {
  const match = LEVEL_BAND.exec(segment)
  if (!match) return null
  const [, first = '', direction, upper, minPay] = match
  const low = levelRank(first === '13a' ? '13A' : first)
  if (!Number.isFinite(low)) return null
  if (direction === 'above') return { low, high: Number.POSITIVE_INFINITY, minPay: Number(minPay ?? 0) }
  if (direction === 'below') return { low: Number.NEGATIVE_INFINITY, high: low, minPay: Number(minPay ?? 0) }
  const high = levelRank(upper === '13a' ? '13A' : (upper ?? ''))
  if (!Number.isFinite(high)) return null
  return { low, high, minPay: Number(minPay ?? 0) }
}

interface ParsedKey {
  /** Everything that is not a Level band, joined — the rate's identity. */
  family: string
  band: LevelBand | null
}

function parseRateKey(key: string | null | undefined): ParsedKey {
  const segments = (key ?? '').split(':').filter(Boolean)
  const families: string[] = []
  let band: LevelBand | null = null
  for (const segment of segments) {
    const parsed = parseLevelBand(segment)
    if (parsed && !band) band = parsed
    else families.push(segment)
  }
  return { family: families.join(':'), band }
}

const bandMatches = (band: LevelBand | null, level: PayLevelId, basic: number): boolean => {
  if (!band) return true
  const rank = levelRank(level)
  return rank >= band.low && rank <= band.high && basic >= band.minPay
}

/**
 * The family the engine falls back to when a reader has picked nothing.
 *
 * Where the dataset names a rate `standard` it means exactly that — the normal
 * case, with the other rates as variations on it (a differently abled child,
 * double rate). Where it does not, the rates are genuinely alternatives that
 * turn on facts this calculator has no way to know: which cell of the Risk and
 * Hardship Matrix a posting falls in, whether a deputation involved a change of
 * station, which uniform an officer wears. Guessing one of those produces a
 * confident wrong figure, so the engine returns nothing and asks.
 */
const DEFAULT_FAMILY = 'standard'

interface ResolvedRate {
  rate: AllowanceRate | undefined
  needsChoice: boolean
  choices: Array<{ key: string; when: Bilingual }>
}

function resolveRate(
  allowance: Allowance,
  chosenKey: string | undefined,
  level: PayLevelId,
  basic: number,
): ResolvedRate {
  const admissible = allowance.rates.filter((rate) => bandMatches(parseRateKey(rate.key).band, level, basic))
  const pool = admissible.length > 0 ? admissible : allowance.rates
  const choices = dedupeFamilies(pool)

  if (chosenKey) {
    const exact = pool.find((rate) => rate.key === chosenKey)
    if (exact) return { rate: exact, needsChoice: false, choices }
    const byFamily = pool.find((rate) => parseRateKey(rate.key).family === chosenKey)
    if (byFamily) return { rate: byFamily, needsChoice: false, choices }
  }

  const standard = pool.find((rate) => parseRateKey(rate.key).family === DEFAULT_FAMILY)
  if (standard) return { rate: standard, needsChoice: false, choices }

  if (choices.length <= 1) return { rate: pool[0], needsChoice: false, choices }
  return { rate: undefined, needsChoice: true, choices }
}

function dedupeFamilies(rates: readonly AllowanceRate[]): Array<{ key: string; when: Bilingual }> {
  const seen = new Set<string>()
  const out: Array<{ key: string; when: Bilingual }> = []
  for (const rate of rates) {
    const { family } = parseRateKey(rate.key)
    if (seen.has(family)) continue
    seen.add(family)
    out.push({ key: family || (rate.key ?? ''), when: rate.when })
  }
  return out
}

/**
 * The rate actually payable today, as against the rate the order printed.
 *
 * Most fixed allowances state their 2017 figure and go up by 25 per cent each
 * time Dearness Allowance crosses 50 per cent, which happened on 01.01.2024.
 * `daLinked.timesApplied` counts how often that has happened. A calculator that
 * renders ₹2,250 for Children Education Allowance is a quarter short of what
 * the officer is paid.
 *
 * Percentages are never uplifted — a percentage of pay indexes itself. What
 * gets uplifted on a percentage rate is its CEILING, which is why the Deputation
 * (Duty) Allowance cap of ₹4,500 is really ₹5,625 today.
 */
function indexFactor(allowance: Allowance): number {
  if (allowance.daLinked.kind !== 'quarter-per-fifty') return 1
  return 1.25 ** allowance.daLinked.timesApplied
}

const isRupeeMeasure = (measure: AllowanceRate['measure']): boolean =>
  measure === 'rupees-per-month' || measure === 'rupees-per-year' || measure === 'rupees-per-day'

/* ------------------------------------------------------------------ *
 * The calculation
 * ------------------------------------------------------------------ */

const HRA_ID = 'house-rent-allowance'
const TA_ID = 'transport-allowance'
const DA_ID = 'dearness-allowance'
const NPA_ID = 'non-practising-allowance'
const RUNNING_ID = 'running-allowance-railways'
const CEA_ID = 'children-education-allowance'
const HOSTEL_ID = 'hostel-subsidy'

/** Handled by name in the body of `computePay`, never by the generic loop. */
const HANDLED_SEPARATELY = new Set([HRA_ID, TA_ID, DA_ID, NPA_ID, RUNNING_ID])

function lineFrom(
  allowance: Allowance,
  amount: number,
  formula: string,
  inputs: Record<string, number | string | boolean>,
  extra: Partial<PayLine> = {},
): PayLine {
  return {
    id: allowance.id,
    kind: 'allowance',
    label: allowance.name,
    amount,
    formula,
    inputs,
    source: allowance.source,
    verify: allowance.verify,
    taxable: allowance.taxable,
    taxSection: allowance.taxSection ?? null,
    conditions: allowance.conditions,
    note: allowance.note ?? null,
    ...extra,
  }
}

export function computePay(input: PayInput, tables: PayTables): PayResult {
  const warnings: Bilingual[] = []
  const level = levelFor(tables.matrix, input.level) ? input.level : (tables.matrix.levels[0]?.level ?? '1')
  if (level !== input.level) {
    warnings.push({
      en: `Level ${input.level} is not in the pay matrix; Level ${level} was used instead.`,
      hi: `लेवल ${input.level} वेतन मैट्रिक्स में नहीं है; इसके स्थान पर लेवल ${level} का प्रयोग किया गया।`,
    })
  }
  const matrixLevel = levelFor(tables.matrix, level)
  const cellIndex = clampCell(tables.matrix, level, input.cellIndex ?? 0)
  const cellBasic = cellPay(tables.matrix, level, cellIndex) ?? matrixLevel?.entryPay ?? 0
  const basic = rupees(input.basic && input.basic > 0 ? input.basic : cellBasic)

  /**
   * De-duplicated by id, LAST ONE WINS, and the deduplicated list is what the
   * loop below walks.
   *
   * A duplicated id is not hypothetical: `PayScenario` is stored in IndexedDB
   * and carried in a URL, and either can be written by an older release or by
   * hand. Walking the raw array emitted two lines for the same allowance and
   * added it to the gross twice — a Level 7 officer's Special Security
   * Allowance counted at ₹17,960 rather than ₹8,980, with both lines showing
   * the right figure and nothing on screen to say the total was wrong.
   */
  const choices = new Map((input.allowances ?? []).map((choice) => [choice.id, choice]))
  const selected = [...choices.values()]
  const isOn = (id: string) => choices.get(id)?.enabled === true
  /**
   * Clamped at nil. A negative rate produced a NEGATIVE Dearness Allowance that
   * flowed into the gross, the pension base and the taxable salary — a pay slip
   * that looked ordinary and was wrong in five places. There has never been a
   * negative rate of DA and the field cannot produce one; a hand-edited URL can.
   */
  const daRate = Number.isFinite(input.daRate) ? Math.max(0, input.daRate) : 0

  const lines: PayLine[] = []
  const allowanceLines: PayLine[] = []

  /* ---------------------------------------------------------------- *
   * Basic, and the two things that are added to it before anything else
   * ---------------------------------------------------------------- */

  lines.push({
    id: 'basic',
    kind: 'pay',
    label: { en: 'Basic pay', hi: 'मूल वेतन' },
    amount: basic,
    formula: 'basic = pay matrix[level][cell]',
    inputs: { level, cell: cellIndex + 1, basic },
    source: matrixLevel?.source,
    verify: matrixLevel?.verify ?? true,
    taxable: true,
    conditions: [],
    note: matrixLevel?.note ?? null,
  })

  const npaAllowance = allowanceFor(tables.allowances, NPA_ID)
  let npa = 0
  if ((input.npa || isOn(NPA_ID)) && npaAllowance) {
    const { rate } = resolveRate(npaAllowance, choices.get(NPA_ID)?.rateKey, level, basic)
    const percent = choices.get(NPA_ID)?.rate ?? rate?.value ?? 0
    const uncapped = percentOf(basic, percent)
    npa = Math.max(0, Math.min(uncapped, NPA_PAY_CEILING - basic))
    if (npa < uncapped) {
      warnings.push({
        en: `Non-Practising Allowance was capped: basic pay plus NPA may not exceed ₹${NPA_PAY_CEILING.toLocaleString('en-IN')}.`,
        hi: `अव्यवसाय भत्ता सीमित किया गया: मूल वेतन तथा अव्यवसाय भत्ता मिलाकर ₹${NPA_PAY_CEILING.toLocaleString('en-IN')} से अधिक नहीं हो सकता।`,
      })
    }
    const line = lineFrom(npaAllowance, npa, 'npa = min(basic × rate%, 237500 − basic)', {
      basic,
      rate: percent,
      ceiling: NPA_PAY_CEILING,
    })
    lines.push(line)
    allowanceLines.push(line)
  }

  const runningAllowance = allowanceFor(tables.allowances, RUNNING_ID)
  let payElement = 0
  if (input.runningStaff && runningAllowance) {
    const rate = runningAllowance.rates.find((entry) => entry.key === 'pay-element')
    payElement = percentOf(basic, rate?.value ?? 0)
    warnings.push({
      en: 'Only the 30 per cent pay element of Running Allowance is shown. Kilometreage Allowance is notified per 100 kilometres by the Railway Board and is not included.',
      hi: 'रनिंग भत्ते का केवल 30 प्रतिशत वेतन-अंश दर्शाया गया है। किलोमीटरेज भत्ता रेलवे बोर्ड द्वारा प्रति 100 किलोमीटर अधिसूचित होता है और इसमें सम्मिलित नहीं है।',
    })
    const line = lineFrom(runningAllowance, payElement, 'payElement = basic × 30%', {
      basic,
      rate: rate?.value ?? 0,
    })
    lines.push(line)
    allowanceLines.push(line)
  }

  const daBase = basic + payElement + npa
  const hraBase = basic + payElement

  /* ---------------------------------------------------------------- *
   * Dearness Allowance
   * ---------------------------------------------------------------- */

  const daAllowance = allowanceFor(tables.allowances, DA_ID)
  const da = percentOf(daBase, daRate)
  const daLine: PayLine = {
    id: DA_ID,
    kind: 'allowance',
    label: daAllowance?.name ?? { en: 'Dearness Allowance', hi: 'महँगाई भत्ता' },
    amount: da,
    formula: 'da = (basic + payElement + npa) × daRate%',
    inputs: { basic, payElement, npa, daRate },
    source: daAllowance?.source,
    verify: daAllowance?.verify ?? true,
    taxable: true,
    taxSection: null,
    conditions: daAllowance?.conditions ?? [],
    note: daAllowance?.note ?? null,
  }
  lines.push(daLine)

  /* ---------------------------------------------------------------- *
   * House Rent Allowance
   * ---------------------------------------------------------------- */

  const city = cityFor(tables.cities, input.cityId)
  const cityClass: CityClass = input.cityClass ?? hraClassFor(city)
  const hraAllowance = allowanceFor(tables.allowances, HRA_ID)
  const hraRateRecord = hraAllowance?.rates.find((rate) => rate.key === cityClass)
  const hraRate = hraRateRecord?.value ?? 0
  const hraFloor = hraRateRecord?.floor ?? 0
  const hraWanted = input.hraEnabled !== false && !input.quarters
  const hraUnfloored = percentOf(hraBase, hraRate)
  const hra = hraWanted ? Math.max(hraUnfloored, hraFloor) : 0
  const hraFloorApplied = hraWanted && hraFloor > hraUnfloored

  if (input.quarters) {
    warnings.push({
      en: 'House Rent Allowance is not admissible to an employee provided with Government accommodation.',
      hi: 'सरकारी आवास प्राप्त कर्मचारी को मकान किराया भत्ता देय नहीं है।',
    })
  }
  if (city?.delhiRateProtected) {
    warnings.push({
      en: `${city.name.en} is classified '${city.class}' but is paid House Rent Allowance at Delhi ('X') rates by the special orders continued in para 6 of the 2017 order.`,
      hi: `${city.name.hi} '${city.class}' श्रेणी में है, किंतु 2017 के आदेश के पैरा 6 में जारी विशेष आदेशों के अंतर्गत दिल्ली ('X') दरों पर मकान किराया भत्ता देय है।`,
    })
  }

  if (hraAllowance) {
    const line = lineFrom(hraAllowance, hra, 'hra = max((basic + payElement) × rate%, floor)', {
      basic,
      payElement,
      cityClass,
      rate: hraRate,
      floor: hraFloor,
      quarters: Boolean(input.quarters),
    })
    lines.push(line)
  }

  /* ---------------------------------------------------------------- *
   * Transport Allowance, and the Dearness Allowance on it
   * ---------------------------------------------------------------- */

  const taAllowance = allowanceFor(tables.allowances, TA_ID)
  const taEnabled = choices.get(TA_ID)?.enabled !== false
  const taKey = transportKey(level, basic, inTaAnnexure(city) && cityClass !== 'Z')
  const taRate = taAllowance?.rates.find((rate) => rate.key === taKey)
  const ta = taEnabled ? rupees(choices.get(TA_ID)?.rate ?? taRate?.value ?? 0) : 0
  // Transport Allowance is fully indexed: Dearness Allowance is payable on it
  // at the same rate as on pay, and is shown as its own line because that is
  // how it appears on a pay slip.
  const daOnTa = percentOf(ta, daRate)

  if (taAllowance) {
    const line = lineFrom(taAllowance, ta, 'ta = rate for (level band, city band)', {
      level,
      basic,
      band: taKey,
      cityClass,
    })
    lines.push(line)
    const companion: PayLine = {
      ...line,
      id: 'da-on-ta',
      label: { en: 'DA on Transport Allowance', hi: 'परिवहन भत्ते पर महँगाई भत्ता' },
      amount: daOnTa,
      formula: 'daOnTa = ta × daRate%',
      inputs: { ta, daRate },
    }
    lines.push(companion)
  }

  /* ---------------------------------------------------------------- *
   * Everything else the reader switched on
   * ---------------------------------------------------------------- */

  for (const choice of selected) {
    if (!choice.enabled) continue
    if (HANDLED_SEPARATELY.has(choice.id)) continue
    const allowance = allowanceFor(tables.allowances, choice.id)
    if (!allowance) continue
    if (allowance.status !== 'current') {
      warnings.push({
        en: `${allowance.name.en} has been ${allowance.status} and is not payable separately.`,
        hi: `${allowance.name.hi} ${allowance.status === 'subsumed' ? 'समाहित' : 'समाप्त'} कर दिया गया है और अलग से देय नहीं है।`,
      })
      continue
    }

    const line = allowanceLine(allowance, choice, {
      level,
      basic,
      da,
      daRate,
      dependents: input.dependents,
      warnings,
    })
    lines.push(line)
    allowanceLines.push(line)
    if (line.companion) {
      lines.push(line.companion)
      allowanceLines.push(line.companion)
      delete line.companion
    }
  }

  /* ---------------------------------------------------------------- *
   * Gross
   * ---------------------------------------------------------------- */

  const otherAllowances = allowanceLines.reduce((sum, line) => sum + line.amount, 0)
  const gross = basic + da + hra + ta + daOnTa + otherAllowances

  /* ---------------------------------------------------------------- *
   * Deductions
   * ---------------------------------------------------------------- */

  const pensionBase = daBase + da
  const pension = pensionContribution(input.pensionScheme, pensionBase, basic, input.gpfRate, tables)
  const cghs = cghsFor(tables.cghs, level)
  const cgegis = cgegisFor(tables.cgegis, input.group)
  const other = rupees(Math.max(0, input.otherDeductions ?? 0))

  /* ---------------------------------------------------------------- *
   * Income tax
   * ---------------------------------------------------------------- */

  // An allowance the data marks `taxable: false` is exempt under section 10(14)
  // and is not income at all — it never enters the figure the slabs are applied
  // to, rather than entering it and being deducted out again.
  const taxableMonthly =
    basic +
    da +
    hra +
    (taAllowance?.taxable === false ? 0 : ta + daOnTa) +
    allowanceLines.filter((line) => line.taxable).reduce((sum, line) => sum + line.amount, 0)

  const taxComputation = compareRegimes(
    {
      taxableSalary: taxableMonthly * MONTHS,
      hraReceived: hra * MONTHS,
      salaryForHra: (daBase + da) * MONTHS,
      rentPaid: (input.oldRegime?.rentPaidMonthly ?? 0) * MONTHS,
      metro: cityClass === 'X',
      employerPension: pension.employer * MONTHS,
      employeePension: pension.employee * MONTHS,
      section80c: input.oldRegime?.section80c ?? 0,
      section80ccd1b: input.oldRegime?.section80ccd1b ?? 0,
      section80d: input.oldRegime?.section80d ?? 0,
      homeLoanInterest: input.oldRegime?.homeLoanInterest ?? 0,
      ageBand: input.ageBand ?? 'below-60',
    },
    tables.tax,
  )

  const regime: Regime = input.regime === 'auto' ? taxComputation.recommended : input.regime
  const tax = taxComputation[regime].monthly

  const deductions: PayDeductions = {
    pension: pension.employee,
    pensionLabel: pension.label,
    cghs: cghs?.amount ?? 0,
    cgegis: cgegis?.amount ?? 0,
    tax,
    other,
    total: pension.employee + (cghs?.amount ?? 0) + (cgegis?.amount ?? 0) + tax + other,
  }

  lines.push(
    {
      id: 'pension',
      kind: 'deduction',
      label: pension.label,
      amount: pension.employee,
      formula: pension.formula,
      inputs: pension.inputs,
      source: pension.source,
      verify: pension.verify,
      taxable: false,
      conditions: [],
    },
    {
      id: 'cghs',
      kind: 'deduction',
      label: tables.cghs.scheme.name,
      amount: cghs?.amount ?? 0,
      formula: 'cghs = rate for level',
      inputs: { level, slab: cghs?.label.en ?? '' },
      source: tables.cghs.scheme.source,
      verify: tables.cghs.scheme.verify,
      taxable: false,
      conditions: [],
    },
    {
      id: 'cgegis',
      kind: 'deduction',
      label: tables.cgegis.scheme.name,
      amount: cgegis?.amount ?? 0,
      formula: 'cgegis = units × 15, by group of post',
      inputs: { group: input.group, slab: cgegis?.label.en ?? '' },
      source: tables.cgegis.scheme.source,
      verify: tables.cgegis.scheme.verify,
      taxable: false,
      conditions: [],
    },
    {
      id: 'tax',
      kind: 'deduction',
      label: { en: 'Income tax', hi: 'आयकर' },
      amount: tax,
      formula: 'tax = annual tax under the chosen regime ÷ 12',
      inputs: { regime, annual: taxComputation[regime].total },
      verify: tables.tax.regimes.some((entry) => entry.id === regime && entry.verify),
      taxable: false,
      conditions: [],
    },
  )

  const netMonthly = gross - deductions.total

  return {
    level,
    cellIndex,
    basic,
    gradePay: matrixLevel?.gradePay ?? null,
    payElement,
    npa,
    daBase,
    hraBase,
    cityId: input.cityId ?? null,
    cityClass,
    da,
    daRate,
    hra,
    hraRate,
    hraFloorApplied,
    ta,
    daOnTa,
    allowancesBreakdown: allowanceLines,
    gross,
    deductions,
    netMonthly,
    pensionScheme: input.pensionScheme,
    employerPension: pension.employer,
    annualCtc: (gross + pension.employer) * MONTHS,
    taxComputation,
    regime,
    lines,
    warnings,
    verify: lines.some((line) => line.amount > 0 && line.verify),
  }
}

/* ------------------------------------------------------------------ *
 * Pieces
 * ------------------------------------------------------------------ */

/**
 * The Transport Allowance rate key for a Level, a basic pay and a city.
 *
 * The ₹24,200 rule is the one that catches people: a Level 1 or 2 employee who
 * has climbed past that figure moves onto the Level 3-8 rate, which is double.
 */
export function transportKey(level: PayLevelId, basic: number, annexureCity: boolean): string {
  const place = annexureCity ? 'annexure-cities' : 'other'
  const rank = levelRank(level)
  if (rank >= 9) return `level-9-and-above:${place}`
  if (rank >= 3) return `level-3-to-8:${place}`
  if (basic >= TA_HIGHER_PAY_THRESHOLD) return `level-1-to-2-pay-24200:${place}`
  return `level-1-to-2:${place}`
}

interface AllowanceContext {
  level: PayLevelId
  basic: number
  da: number
  daRate: number
  dependents: PayInput['dependents']
  warnings: Bilingual[]
}

type PayLineWithCompanion = PayLine & { companion?: PayLine }

function allowanceLine(
  allowance: Allowance,
  choice: AllowanceChoice,
  ctx: AllowanceContext,
): PayLineWithCompanion {
  const { rate, needsChoice, choices } = resolveRate(allowance, choice.rateKey, ctx.level, ctx.basic)

  if (needsChoice || !rate) {
    return lineFrom(allowance, 0, 'rate not chosen', { level: ctx.level }, { needsChoice: true, choices })
  }

  const factor = indexFactor(allowance)
  const units = unitsFor(allowance, choice, ctx)
  const stated = choice.rate ?? rate.value

  if (stated == null || rate.measure === 'formula' || rate.measure === 'not-a-money-value') {
    return lineFrom(
      allowance,
      0,
      rate.expression ?? 'no rate published in the order',
      { level: ctx.level, measure: rate.measure },
      { unpriced: true },
    )
  }

  const uplift = isRupeeMeasure(rate.measure) ? factor : 1
  const ceiling = rate.ceiling == null ? null : rupees(rate.ceiling * factor)
  const floor = rate.floor == null ? null : rupees(rate.floor * factor)

  let amount: number
  let formula: string
  const inputs: Record<string, number | string | boolean> = {
    rate: stated,
    measure: rate.measure,
    daUplift: factor,
  }

  switch (rate.measure) {
    case 'percent-of-basic-pay':
      amount = percentOf(ctx.basic, stated)
      formula = 'amount = basic × rate%'
      inputs.basic = ctx.basic
      break
    case 'percent-of-basic-pay-plus-da':
      amount = percentOf(ctx.basic + ctx.da, stated)
      formula = 'amount = (basic + da) × rate%'
      inputs.basic = ctx.basic
      inputs.da = ctx.da
      break
    case 'rupees-per-month':
      amount = rupees(stated * uplift * units)
      formula = units === 1 ? 'amount = rate × daUplift' : 'amount = rate × daUplift × units'
      inputs.units = units
      break
    case 'rupees-per-year':
      amount = rupees((stated * uplift * units) / MONTHS)
      formula = 'amount = rate × daUplift × units ÷ 12'
      inputs.units = units
      break
    default:
      // rupees-per-day and rupees-per-hour need a count of days or hours that
      // no pay slip carries. Shown, and not priced.
      return lineFrom(
        allowance,
        0,
        `rate is stated per ${rate.measure === 'rupees-per-day' ? 'day' : 'hour'}`,
        { rate: stated, measure: rate.measure },
        { unpriced: true },
      )
  }

  if (ceiling != null && amount > ceiling) {
    amount = ceiling
    inputs.ceiling = ceiling
    formula += ', capped at ceiling'
  }
  if (floor != null && amount < floor) {
    amount = floor
    inputs.floor = floor
    formula += ', floored'
  }

  const line: PayLineWithCompanion = lineFrom(allowance, amount, formula, inputs)

  // A fully indexed allowance carries Dearness Allowance on top of it, at the
  // same rate as on pay. Transport Allowance is the one that matters; the rule
  // is written once, here, rather than special-cased for it.
  if (allowance.daLinked.kind === 'fully-indexed' && amount > 0) {
    line.companion = {
      ...line,
      id: `da-on-${allowance.id}`,
      label: { en: `DA on ${allowance.name.en}`, hi: `${allowance.name.hi} पर महँगाई भत्ता` },
      amount: percentOf(amount, ctx.daRate),
      formula: 'amount = allowance × daRate%',
      inputs: { allowance: amount, daRate: ctx.daRate },
    }
  }

  return line
}

function unitsFor(allowance: Allowance, choice: AllowanceChoice, ctx: AllowanceContext): number {
  if (choice.units != null) return Math.max(0, Math.trunc(choice.units))
  if (allowance.id === CEA_ID) return capChildren(ctx.dependents?.children ?? 0, ctx.warnings)
  if (allowance.id === HOSTEL_ID) return capChildren(ctx.dependents?.hostellers ?? 0, ctx.warnings)
  return 1
}

function capChildren(count: number, warnings: Bilingual[]): number {
  const wanted = Math.max(0, Math.trunc(count))
  if (wanted <= TWO_CHILD_LIMIT) return wanted
  warnings.push({
    en: 'Children Education Allowance and Hostel Subsidy are limited to two children.',
    hi: 'बाल शिक्षा भत्ता तथा छात्रावास अनुदान अधिकतम दो बच्चों तक सीमित है।',
  })
  return TWO_CHILD_LIMIT
}

interface PensionResult {
  employee: number
  employer: number
  label: Bilingual
  formula: string
  inputs: Record<string, number | string | boolean>
  source?: PaySource
  verify: boolean
}

/**
 * What leaves the pay slip, and what the Government puts in beside it.
 *
 * The Unified Pension Scheme is the one worth reading twice: the employee still
 * contributes 10 per cent, exactly as under the National Pension System, and
 * the Government contributes 18.5 — of which 10 goes to the individual corpus
 * and 8.5 to the pool that funds the assurance. Showing 18.5 as a DEDUCTION,
 * which is the obvious mistake, would take ₹6,000 a month off a Level 7 pay
 * slip that nobody is actually paying.
 */
function pensionContribution(
  scheme: PensionScheme,
  pensionBase: number,
  basic: number,
  gpfRate: number | undefined,
  tables: PayTables,
): PensionResult {
  if (scheme === 'gpf') {
    // The General Provident Fund has no Government contribution — the pension
    // it sits beside is a defined benefit, not a corpus. The subscription is
    // the subscriber's own choice, subject to a floor of 6 per cent of
    // emoluments, so it is an input rather than a rate in any dataset.
    const rate = Math.max(0, gpfRate ?? 6)
    return {
      employee: percentOf(basic, rate),
      employer: 0,
      label: { en: 'General Provident Fund', hi: 'सामान्य भविष्य निधि' },
      formula: 'gpf = basic × subscriptionRate%',
      inputs: { basic, rate },
      verify: true,
    }
  }

  const record = scheme === 'ups' ? tables.ups : tables.nps
  const employeeRate = contributionRate(record, 'employee') ?? 10
  const employerRate =
    scheme === 'ups'
      ? (contributionRate(record, 'government-total') ?? 18.5)
      : (contributionRate(record, 'government') ?? 14)

  return {
    employee: percentOf(pensionBase, employeeRate),
    employer: percentOf(pensionBase, employerRate),
    label: record.scheme.name,
    formula: 'contribution = (basic + payElement + npa + da) × rate%',
    inputs: { pensionBase, employeeRate, employerRate },
    source: record.scheme.source,
    verify: record.scheme.verify,
  }
}
