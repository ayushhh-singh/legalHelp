import { describe, expect, it } from 'vitest'

import { computePay, transportKey, type PayInput } from './engine'
import { scenarioForJob, toPayInput, withAllowance } from './scenario'
import { daRateOn, latestNotifiedDa, projectedDa } from './tables'

import { loadPayTables } from '@/test/payTables'

/**
 * The golden pay slips.
 *
 * Every expected figure below was worked out from the orders first and written
 * here as a number, not read off a run of the code. That is the only way this
 * suite can catch a regression: a test that asserts whatever the engine
 * currently returns tests nothing at all. Where a figure is a rounding of
 * another, both are asserted, so a change to the rounding rule fails loudly
 * rather than shifting every number by a rupee.
 */

const tables = loadPayTables()

/** The rate in force from 01.01.2026 — DoE O.M. 1/1(i)/2026-E.II(B). */
const DA = 60

const base: PayInput = {
  level: '1',
  cellIndex: 0,
  daRate: DA,
  pensionScheme: 'nps',
  group: 'C',
  regime: 'auto',
}

describe('computePay — IB Assistant Central Intelligence Officer, Grade-II', () => {
  const scenario = scenarioForJob('ib-acio-ii-executive', tables, { daRate: DA, cityId: 'delhi' })
  const result = computePay(toPayInput(scenario), tables)

  it('starts at Level 7, cell 1 — ₹44,900 — with grade pay 4600', () => {
    expect(result.level).toBe('7')
    expect(result.basic).toBe(44_900)
    expect(result.gradePay).toBe(4600)
  })

  it('pays every standing line at the figures the orders give', () => {
    expect(result.da).toBe(26_940) // 60% of 44,900
    expect(result.hra).toBe(13_470) // 30% of 44,900, Delhi being 'X'
    expect(result.ta).toBe(3600) // Levels 3-8, a city in the annexure
    expect(result.daOnTa).toBe(2160) // 60% of 3,600 — TA is fully indexed
    expect(result.cityClass).toBe('X')
  })

  it('switches the Special Security Allowance on, because the post carries it', () => {
    const ssa = result.allowancesBreakdown.find((line) => line.id === 'special-security-allowance-ib')
    expect(ssa?.amount).toBe(8980) // 20% of basic pay
    expect(ssa?.source?.url).toContain('doe.gov.in')
  })

  it('adds up to a gross of ₹1,00,050', () => {
    expect(result.gross).toBe(100_050)
    expect(result.gross).toBe(44_900 + 26_940 + 13_470 + 3600 + 2160 + 8980)
  })

  it('deducts pension on basic plus DA, CGHS by Level and CGEGIS by Group', () => {
    expect(result.deductions.pension).toBe(7184) // 10% of (44,900 + 26,940)
    expect(result.deductions.cghs).toBe(650) // Levels 7-11
    expect(result.deductions.cgegis).toBe(60) // Group 'B' — four units
  })

  it('pays no income tax under the new regime, and picks it', () => {
    // 12,00,600 of salary, less 75,000 standard deduction and 1,20,691 under
    // 80CCD(2), is 10,04,910 — inside the ₹12,00,000 rebate ceiling.
    expect(result.taxComputation.new.taxableIncome).toBe(1_004_910)
    expect(result.taxComputation.new.total).toBe(0)
    expect(result.taxComputation.old.total).toBe(105_290)
    expect(result.taxComputation.recommended).toBe('new')
    expect(result.regime).toBe('new')
    expect(result.deductions.tax).toBe(0)
  })

  it('nets ₹92,156 a month and costs ₹13,21,296 a year', () => {
    expect(result.netMonthly).toBe(92_156)
    expect(result.netMonthly).toBe(100_050 - 7184 - 650 - 60)
    expect(result.employerPension).toBe(10_058) // 14% of 71,840
    expect(result.annualCtc).toBe(1_321_296)
  })

  it('says the figures need checking, because jobs.json is unconfirmed', () => {
    // ADR-016: 66 of 67 posts carry verify: true. The pay slip owes the reader
    // the same sentence the dataset carries.
    expect(result.verify).toBe(true)
  })
})

describe('computePay — CAPF Constable (General Duty) with Risk and Hardship Allowance', () => {
  const picked = scenarioForJob('capf-constable-gd', tables, { daRate: DA })
  const scenario = withAllowance(
    withAllowance(picked, 'risk-and-hardship-allowance', { enabled: true, rateKey: 'r1h3' }),
    'dress-allowance',
    { enabled: true, rateKey: 'other-staff' },
  )
  const result = computePay(toPayInput(scenario), tables)

  it('starts at Level 3, ₹21,700, in a Z-class place', () => {
    expect(result.level).toBe('3')
    expect(result.basic).toBe(21_700)
    expect(result.cityClass).toBe('Z')
    expect(result.hra).toBe(2170) // 10% of basic, above the ₹1,800 floor
    expect(result.ta).toBe(1800) // Levels 3-8, not an annexure city
  })

  it('raises the R1H3 cell by 25 per cent, because DA crossed 50 on 01.01.2024', () => {
    const rha = result.allowancesBreakdown.find((line) => line.id === 'risk-and-hardship-allowance')
    // The order prints ₹4,100 for Level 8 and below. The rate payable is that
    // figure raised once — daLinked.timesApplied is 1.
    expect(rha?.amount).toBe(5125)
    expect(rha?.inputs.daUplift).toBe(1.25)
    expect(rha?.taxable).toBe(false)
  })

  it('keeps the Risk and Hardship Allowance out of taxable income entirely', () => {
    // Exempt under section 10(14): it is not income, rather than income with a
    // deduction against it. 40,291 a month is the gross less the 5,125.
    expect(result.gross).toBe(45_416)
    expect(result.taxComputation.new.grossSalary).toBe(40_291 * 12)
  })

  it('prorates the annual Dress Allowance and indexes it too', () => {
    const dress = result.allowancesBreakdown.find((line) => line.id === 'dress-allowance')
    expect(dress?.amount).toBe(521) // (5,000 × 1.25) ÷ 12
  })

  it('shows Ration Money without pricing it, because no rate is published', () => {
    const ration = result.allowancesBreakdown.find((line) => line.id === 'ration-money-allowance')
    expect(ration?.unpriced).toBe(true)
    expect(ration?.amount).toBe(0)
  })

  it('asks rather than guesses where the reader has not chosen a cell', () => {
    const unchosen = computePay(
      toPayInput(withAllowance(picked, 'risk-and-hardship-allowance', { enabled: true })),
      tables,
    )
    const rha = unchosen.allowancesBreakdown.find((line) => line.id === 'risk-and-hardship-allowance')
    expect(rha?.needsChoice).toBe(true)
    expect(rha?.amount).toBe(0)
    expect(rha?.choices?.map((choice) => choice.key)).toContain('r1h3')
  })

  it('nets ₹41,664', () => {
    expect(result.deductions.pension).toBe(3472) // 10% of (21,700 + 13,020)
    expect(result.deductions.cghs).toBe(250) // Levels 1-5
    expect(result.deductions.cgegis).toBe(30) // Group 'C' — two units
    expect(result.deductions.tax).toBe(0)
    expect(result.netMonthly).toBe(41_664)
  })
})

describe('computePay — railway running staff', () => {
  const scenario = scenarioForJob('railway-loco-pilot', tables, { daRate: DA, cityId: 'delhi' })
  const result = computePay(toPayInput(scenario), tables)

  it('adds the 30 per cent pay element to the base for DA, HRA and pension', () => {
    expect(result.basic).toBe(35_400) // Level 6, cell 1
    expect(result.payElement).toBe(10_620) // 30% of basic
    expect(result.daBase).toBe(46_020)
    expect(result.hraBase).toBe(46_020)
    expect(result.da).toBe(27_612) // 60% of 46,020, not of 35,400
    expect(result.hra).toBe(13_806) // 30% of 46,020
    expect(result.deductions.pension).toBe(7363) // 10% of (46,020 + 27,612)
  })

  it('says in terms that the kilometreage part is not included', () => {
    expect(result.warnings.map((warning) => warning.en).join(' ')).toContain('Kilometreage')
  })
})

describe('computePay — the Transport Allowance bands', () => {
  it('pays Level 9 in a Z-class place at ₹3,600', () => {
    const result = computePay({ ...base, level: '9', group: 'A' }, tables)
    expect(result.basic).toBe(53_100)
    expect(result.ta).toBe(3600)
    expect(result.daOnTa).toBe(2160)
  })

  it('pays Level 9 in an annexure city at ₹7,200', () => {
    const result = computePay({ ...base, level: '9', group: 'A', cityId: 'greater-mumbai' }, tables)
    expect(result.ta).toBe(7200)
  })

  it('moves a Level 1 employee onto the Level 3-8 rate once pay reaches ₹24,200', () => {
    expect(transportKey('1', 24_100, true)).toBe('level-1-to-2:annexure-cities')
    expect(transportKey('1', 24_200, true)).toBe('level-1-to-2-pay-24200:annexure-cities')
    expect(transportKey('13A', 0, false)).toBe('level-9-and-above:other')
  })

  it('does not read "in lieu of a car" as a band of Levels', () => {
    // `level-14-and-above-in-lieu-of-car` is the name of an option, not a band.
    // Reading it as one would hand every Level 14 officer ₹15,750 unasked.
    const result = computePay({ ...base, level: '14', group: 'A', cityId: 'delhi' }, tables)
    expect(result.ta).toBe(7200)
  })
})

describe('computePay — House Rent Allowance', () => {
  it('applies the floor when the percentage falls below it', () => {
    const result = computePay({ ...base, basic: 10_000, cityId: 'delhi' }, tables)
    expect(result.hra).toBe(5400) // the 'X' floor, not 30% of 10,000
    expect(result.hraFloorApplied).toBe(true)
  })

  it('pays the four Delhi-rate towns at X rates although they are classified Y', () => {
    const result = computePay({ ...base, level: '7', cityId: 'noida' }, tables)
    expect(result.cityClass).toBe('X')
    expect(result.hra).toBe(13_470)
    expect(result.warnings.map((warning) => warning.en).join(' ')).toContain('Delhi')
  })

  it('pays nothing to an employee in Government accommodation', () => {
    const result = computePay({ ...base, level: '7', cityId: 'delhi', quarters: true }, tables)
    expect(result.hra).toBe(0)
    expect(result.warnings.map((warning) => warning.en).join(' ')).toContain('Government accommodation')
  })

  it('treats an unlisted place as Z, because Z is not a list', () => {
    const result = computePay({ ...base, level: '7', cityId: 'not-a-city' }, tables)
    expect(result.cityClass).toBe('Z')
    expect(result.hra).toBe(4490) // 10% of 44,900
  })
})

describe('computePay — Non-Practising Allowance', () => {
  it('counts NPA as pay for Dearness Allowance and not for House Rent Allowance', () => {
    const result = computePay({ ...base, level: '11', group: 'A', cityId: 'delhi', npa: true }, tables)
    expect(result.basic).toBe(67_700)
    expect(result.npa).toBe(13_540) // 20% of basic
    expect(result.daBase).toBe(81_240)
    expect(result.da).toBe(48_744) // 60% of 81,240
    expect(result.hraBase).toBe(67_700)
    expect(result.hra).toBe(20_310) // 30% of basic alone
  })

  it('caps basic plus NPA at ₹2,37,500', () => {
    const result = computePay({ ...base, basic: 225_000, level: '17', group: 'A', npa: true }, tables)
    expect(result.npa).toBe(12_500)
    expect(result.warnings.map((warning) => warning.en).join(' ')).toContain('2,37,500')
  })
})

describe('computePay — pension schemes', () => {
  const at = (scheme: 'nps' | 'ups' | 'gpf') =>
    computePay({ ...base, level: '7', pensionScheme: scheme, cityId: 'delhi' }, tables)

  it('takes 10 per cent from the officer and puts 14 per cent in, under NPS', () => {
    const result = at('nps')
    expect(result.deductions.pension).toBe(7184)
    expect(result.employerPension).toBe(10_058)
  })

  it('still takes only 10 per cent under UPS, although the Government pays 18.5', () => {
    const result = at('ups')
    expect(result.deductions.pension).toBe(7184)
    expect(result.employerPension).toBe(13_290) // 18.5% of 71,840
    expect(result.annualCtc).toBeGreaterThan(at('nps').annualCtc)
  })

  it('takes the subscriber’s own rate under GPF, and no Government contribution', () => {
    const result = at('gpf')
    expect(result.deductions.pension).toBe(2694) // the 6% floor, on basic pay
    expect(result.employerPension).toBe(0)
  })
})

describe('computePay — income tax, old regime against new', () => {
  const result = computePay(
    { ...base, level: '10', basic: 60_000, group: 'A', cityId: 'delhi', regime: 'auto' },
    tables,
  )

  it('grosses ₹1,25,520 a month on a ₹60,000 basic in Delhi', () => {
    expect(result.gross).toBe(125_520)
    expect(result.da).toBe(36_000)
    expect(result.hra).toBe(18_000)
    expect(result.ta).toBe(7200)
    expect(result.daOnTa).toBe(4320)
  })

  it('gives 80CCD(2) in both regimes and 80CCD(1) in the old one only', () => {
    const ids = (lines: Array<{ id: string }>) => lines.map((line) => line.id)
    expect(ids(result.taxComputation.new.deductions)).toEqual(['80ccd2'])
    expect(ids(result.taxComputation.old.deductions)).toEqual(['80ccd2', '80ccd1'])
  })

  it('costs ₹72,758 under the new regime and ₹1,73,085 under the old', () => {
    expect(result.taxComputation.new.taxableIncome).toBe(1_269_960)
    expect(result.taxComputation.new.total).toBe(72_758)
    expect(result.taxComputation.old.taxableIncome).toBe(1_179_760)
    expect(result.taxComputation.old.total).toBe(173_085)
    expect(result.taxComputation.recommended).toBe('new')
    expect(result.taxComputation.saving).toBe(100_327)
  })

  it('applies marginal relief where the section 87A rebate has just lapsed', () => {
    // Income of 12,69,960 is 69,960 over the ceiling, and the slab tax on it is
    // 70,494 — so the proviso caps the tax at the excess and gives back ₹534.
    expect(result.taxComputation.new.marginalRelief).toBe(534)
  })

  it('deducts a twelfth of the year’s tax each month', () => {
    expect(result.deductions.tax).toBe(Math.round(72_758 / 12))
  })

  it('gives the old regime the House Rent Allowance exemption, and the new one none', () => {
    const withRent = computePay(
      {
        ...base,
        level: '10',
        basic: 60_000,
        group: 'A',
        cityId: 'delhi',
        oldRegime: { rentPaidMonthly: 30_000 },
      },
      tables,
    )
    // Least of: HRA received 2,16,000; rent 3,60,000 less 10% of 11,52,000
    // salary = 2,44,800; 50% of salary = 5,76,000. The first limb binds.
    expect(withRent.taxComputation.old.exemptions[0]?.amount).toBe(216_000)
    expect(withRent.taxComputation.new.exemptions).toEqual([])
  })
})

describe('computePay — the Dearness Allowance series', () => {
  it('reads the rate in force on a date, skipping the frozen instalments', () => {
    expect(daRateOn(tables.da, '2021-01-01')?.rate).toBe(17)
    expect(daRateOn(tables.da, '2021-07-01')?.rate).toBe(31)
    expect(daRateOn(tables.da, '2026-01-01')?.rate).toBe(60)
  })

  it('never returns the projection unless it is asked for', () => {
    expect(daRateOn(tables.da, '2026-12-31')?.rate).toBe(60)
    expect(daRateOn(tables.da, '2026-12-31', { includeProjected: true })?.rate).toBe(63)
    expect(latestNotifiedDa(tables.da)?.rate).toBe(60)
    expect(projectedDa(tables.da)?.status).toBe('projected')
  })
})

describe('computePay — Children Education Allowance', () => {
  it('pays the indexed rate per child, up to two', () => {
    const scenario = withAllowance(
      { ...scenarioForJob('aso-css', tables, { daRate: DA, cityId: 'delhi' }), children: 3 },
      'children-education-allowance',
      { enabled: true },
    )
    const result = computePay(toPayInput(scenario), tables)
    const cea = result.allowancesBreakdown.find((line) => line.id === 'children-education-allowance')
    // ₹2,250 raised once by a quarter is ₹2,812.50, and two children of three.
    expect(cea?.amount).toBe(5625)
    expect(result.warnings.map((warning) => warning.en).join(' ')).toContain('two children')
  })
})

describe('computePay — input that did not come from the form', () => {
  /**
   * A scenario reaches the engine from three places a form does not control: a
   * URL somebody edited, an IndexedDB row written by an older release, and an
   * agent tool call. Each case below was probed against the engine and is
   * recorded here with what it actually did.
   */

  it('never pays a negative Dearness Allowance', () => {
    // A hand-edited `?da=-50` produced DA of −₹22,450, which flowed into the
    // gross, the pension base and the taxable salary — a slip that looked
    // ordinary and was wrong in five places.
    const result = computePay({ ...base, level: '7', daRate: -50 }, tables)
    expect(result.daRate).toBe(0)
    expect(result.da).toBe(0)
    expect(result.gross).toBeGreaterThan(0)
    expect(result.deductions.pension).toBe(4490) // 10% of basic alone
  })

  it('reads a rate that is not a number as nil rather than as NaN', () => {
    const result = computePay({ ...base, level: '7', daRate: Number.NaN }, tables)
    expect(result.da).toBe(0)
    expect(Number.isFinite(result.netMonthly)).toBe(true)
  })

  it('counts a duplicated allowance once', () => {
    // `PayScenario` travels through a URL and IndexedDB, so a duplicated id is
    // not hypothetical. Walking the raw list added the allowance to the gross
    // twice while both lines showed the right figure.
    const once = computePay(
      { ...base, level: '7', allowances: [{ id: 'special-security-allowance-ib', enabled: true }] },
      tables,
    )
    const twice = computePay(
      {
        ...base,
        level: '7',
        allowances: [
          { id: 'special-security-allowance-ib', enabled: true },
          { id: 'special-security-allowance-ib', enabled: true },
        ],
      },
      tables,
    )
    expect(twice.gross).toBe(once.gross)
    expect(twice.lines.filter((line) => line.id === 'special-security-allowance-ib')).toHaveLength(1)
  })

  it('lets the last entry for an allowance win, so a URL can override a default', () => {
    const result = computePay(
      {
        ...base,
        level: '7',
        allowances: [
          { id: 'special-security-allowance-ib', enabled: true },
          { id: 'special-security-allowance-ib', enabled: false },
        ],
      },
      tables,
    )
    expect(
      result.allowancesBreakdown.find((line) => line.id === 'special-security-allowance-ib'),
    ).toBeUndefined()
  })

  it('falls back to the cell rather than paying a negative basic', () => {
    expect(computePay({ ...base, level: '7', basic: -5000 }, tables).basic).toBe(44_900)
    expect(computePay({ ...base, level: '7', basic: 0 }, tables).basic).toBe(44_900)
  })

  it('names the Level it fell back to when the one asked for does not exist', () => {
    const result = computePay({ ...base, level: '99' }, tables)
    expect(result.level).toBe('1')
    expect(result.warnings.map((warning) => warning.en).join(' ')).toContain('not in the pay matrix')
  })

  it('ignores a negative deduction, a negative child count and a negative GPF rate', () => {
    const result = computePay(
      {
        ...base,
        level: '7',
        otherDeductions: -10_000,
        pensionScheme: 'gpf',
        gpfRate: -20,
        dependents: { children: -3 },
        allowances: [{ id: 'children-education-allowance', enabled: true }],
      },
      tables,
    )
    expect(result.deductions.other).toBe(0)
    expect(result.deductions.pension).toBe(0)
    expect(
      result.allowancesBreakdown.find((line) => line.id === 'children-education-allowance')?.amount,
    ).toBe(0)
  })

  it('charges tax on an income above every surcharge band without losing marginal relief', () => {
    const result = computePay({ ...base, level: '18', basic: 10_000_000, group: 'A' }, tables)
    expect(result.taxComputation.new.surchargeRate).toBe(25)
    expect(result.taxComputation.old.surchargeRate).toBe(37)
    // Tax cannot exceed the income it is charged on.
    expect(result.taxComputation.old.total).toBeLessThan(result.taxComputation.old.taxableIncome)
    expect(result.netMonthly).toBeLessThan(result.gross)
  })
})
