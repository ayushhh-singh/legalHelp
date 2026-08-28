import { describe, expect, it } from 'vitest'

import {
  BENEFITS_ARE_INDICATIVE,
  computePrivate,
  DEFAULT_PRIVATE_INPUT,
  diffResults,
  governmentBenefits,
} from './compare'
import { computePay } from './engine'
import { scenarioForJob, toPayInput } from './scenario'

import { loadPayTables } from '@/test/payTables'

const tables = loadPayTables()
const DA = 60

const slipFor = (jobId: string) =>
  computePay(toPayInput(scenarioForJob(jobId, tables, { daRate: DA, cityId: 'delhi' })), tables)

describe('diffResults', () => {
  const acio = slipFor('ib-acio-ii-executive')
  const aso = slipFor('aso-css')
  const diff = diffResults(aso, acio)

  it('puts both posts on the same rows and subtracts', () => {
    expect(aso.basic).toBe(44_900)
    expect(acio.basic).toBe(44_900)
    expect(diff.gross.delta).toBe(acio.gross - aso.gross)
    expect(diff.net.delta).toBe(acio.netMonthly - aso.netMonthly)
  })

  it('keeps a line that only one of the two posts carries', () => {
    // The Assistant Section Officer draws no Special Security Allowance. The
    // row is the most interesting one on the page, so it must not be dropped.
    const ssa = diff.rows.find((row) => row.id === 'special-security-allowance-ib')
    expect(ssa).toBeDefined()
    expect(ssa?.a).toBe(0)
    expect(ssa?.b).toBe(8980)
    expect(ssa?.delta).toBe(8980)
  })

  it('leaves unpriced lines out of the comparison', () => {
    const capf = slipFor('capf-constable-gd')
    const rows = diffResults(capf, acio).rows.map((row) => row.id)
    expect(rows).not.toContain('ration-money-allowance')
  })
})

describe('computePrivate', () => {
  const result = computePrivate({ ...DEFAULT_PRIVATE_INPUT, annualCtc: 1_800_000, cityId: 'delhi' }, tables)

  it('does not treat a cost to company as cash', () => {
    expect(result.monthlyCtc).toBe(150_000)
    expect(result.basic).toBe(60_000) // 40% of the package
    expect(result.employerPf).toBe(7200) // 12% of basic
    expect(result.gratuityAccrual).toBe(2886) // 4.81% of basic
    expect(result.cashGross).toBe(150_000 - 7200 - 2886)
  })

  it('takes the employee’s own Provident Fund off the cash', () => {
    expect(result.employeePf).toBe(7200)
    expect(result.takeHome).toBe(result.cashGross - result.employeePf - result.tax)
  })

  it('states every assumption it made, in both languages', () => {
    expect(result.assumptions.length).toBeGreaterThanOrEqual(3)
    for (const assumption of result.assumptions) {
      expect(assumption.en.length).toBeGreaterThan(0)
      expect(assumption.hi.length).toBeGreaterThan(0)
      expect(assumption.hi).not.toBe(assumption.en)
    }
  })

  it('gives the old regime a House Rent Allowance exemption when rent is paid', () => {
    const renting = computePrivate(
      { ...DEFAULT_PRIVATE_INPUT, annualCtc: 1_800_000, cityId: 'delhi', rentPaidMonthly: 25_000 },
      tables,
    )
    expect(renting.taxComputation.old.exemptions[0]?.id).toBe('10-13a-hra')
    expect(renting.taxComputation.new.exemptions).toEqual([])
  })

  it('reads a package of nothing as nothing, rather than as NaN', () => {
    const empty = computePrivate(DEFAULT_PRIVATE_INPUT, tables)
    expect(empty.takeHome).toBe(0)
    expect(Number.isFinite(empty.tax)).toBe(true)
  })
})

describe('governmentBenefits', () => {
  it('carries a source for every benefit, and totals none of them', () => {
    const notes = governmentBenefits(slipFor('ib-acio-ii-executive'), tables)
    expect(notes.map((note) => note.id)).toContain('employer-pension')
    expect(notes.map((note) => note.id)).toContain('leave-travel-concession')
    for (const note of notes) {
      expect(note.body.hi.length).toBeGreaterThan(0)
      expect(note.source?.url).toMatch(/^https:\/\//)
    }
    expect(BENEFITS_ARE_INDICATIVE.hi.length).toBeGreaterThan(0)
  })

  it('omits the Government contribution row under the General Provident Fund', () => {
    const gpf = computePay(
      { level: '7', daRate: DA, pensionScheme: 'gpf', group: 'B', regime: 'auto', cityId: 'delhi' },
      tables,
    )
    const notes = governmentBenefits(gpf, tables)
    expect(notes.map((note) => note.id)).not.toContain('employer-pension')
  })
})
