import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { computePay } from './engine'
import { nearestTen, percentOf, rupees } from './rounding'

import { loadPayTables } from '@/test/payTables'

/**
 * Property-based tests for the money.
 *
 * The golden slips in `engine.test.ts` assert particular figures worked out
 * from the orders. This file asserts the things that must hold for EVERY input,
 * which is a different kind of claim and catches a different kind of defect:
 * an off-by-one in a rounding rule shows up as a golden test that is one rupee
 * out, but a rounding rule that is not monotonic, or a pay slip whose lines do
 * not add up to its own gross, shows up only over a range of inputs.
 *
 * fast-check shrinks a failure to its smallest reproducing case and prints the
 * seed, so a counterexample here is a bug report rather than a hint. Runs are
 * capped modestly because `computePay` reads the real 1.2 MB of tables.
 */

/** Rupee figures a pay slip can actually contain — a paisa is not a unit here. */
const money = () => fc.double({ min: 0, max: 5_000_000, noNaN: true, noDefaultInfinity: true })

/** Percentages the orders actually state, plus the ends of the range. */
const rate = () => fc.double({ min: 0, max: 200, noNaN: true, noDefaultInfinity: true })

describe('rupees — the DA order’s own rounding rule', () => {
  it('always returns a whole number', () => {
    fc.assert(
      fc.property(money(), (value) => {
        expect(Number.isInteger(rupees(value))).toBe(true)
      }),
    )
  })

  it('never moves a figure by half a rupee or more', () => {
    fc.assert(
      fc.property(money(), (value) => {
        expect(Math.abs(rupees(value) - value)).toBeLessThanOrEqual(0.5)
      }),
    )
  })

  it('is monotonic: a larger amount never rounds to a smaller rupee figure', () => {
    fc.assert(
      fc.property(money(), money(), (a, b) => {
        const [low, high] = a <= b ? [a, b] : [b, a]
        expect(rupees(low)).toBeLessThanOrEqual(rupees(high))
      }),
    )
  })

  it('is idempotent — rounding a rounded figure changes nothing', () => {
    fc.assert(
      fc.property(money(), (value) => {
        expect(rupees(rupees(value))).toBe(rupees(value))
      }),
    )
  })

  it('rounds half up, which is what "50 paise and above" says', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000 }), (whole) => {
        expect(rupees(whole + 0.5)).toBe(whole + 1)
        expect(rupees(whole + 0.49)).toBe(whole)
      }),
    )
  })

  it('answers 0 for anything that is not a finite number, never NaN', () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(rupees(value)).toBe(0)
      expect(nearestTen(value)).toBe(0)
    }
  })
})

describe('percentOf', () => {
  it('is a whole number of rupees for every amount and rate', () => {
    fc.assert(
      fc.property(money(), rate(), (amount, pct) => {
        expect(Number.isInteger(percentOf(amount, pct))).toBe(true)
      }),
    )
  })

  it('is monotonic in the rate at a fixed amount', () => {
    fc.assert(
      fc.property(money(), rate(), rate(), (amount, r1, r2) => {
        const [low, high] = r1 <= r2 ? [r1, r2] : [r2, r1]
        expect(percentOf(amount, low)).toBeLessThanOrEqual(percentOf(amount, high))
      }),
    )
  })

  it('is monotonic in the amount at a fixed rate', () => {
    fc.assert(
      fc.property(money(), money(), rate(), (a, b, pct) => {
        const [low, high] = a <= b ? [a, b] : [b, a]
        expect(percentOf(low, pct)).toBeLessThanOrEqual(percentOf(high, pct))
      }),
    )
  })

  it('is nothing at a nil rate and the whole amount at 100 per cent', () => {
    fc.assert(
      fc.property(money(), (amount) => {
        expect(percentOf(amount, 0)).toBe(0)
        expect(percentOf(amount, 100)).toBe(rupees(amount))
      }),
    )
  })

  it('rounds once, at the line — never accumulating a paisa across two calls', () => {
    // A DDO applies the rule line by line. Splitting a rate in two and adding
    // the halves is therefore allowed to differ by at most a rupee from
    // applying it once; more than that would mean the rule is being applied at
    // the wrong granularity somewhere.
    fc.assert(
      fc.property(money(), rate(), (amount, pct) => {
        const once = percentOf(amount, pct)
        const twice = percentOf(amount, pct / 2) * 2
        expect(Math.abs(once - twice)).toBeLessThanOrEqual(1)
      }),
    )
  })
})

describe('nearestTen — section 288A', () => {
  it('always returns a multiple of ten', () => {
    fc.assert(
      fc.property(money(), (value) => {
        expect(nearestTen(value) % 10).toBe(0)
      }),
    )
  })

  it('never moves a figure by five rupees or more', () => {
    fc.assert(
      fc.property(money(), (value) => {
        expect(Math.abs(nearestTen(value) - value)).toBeLessThanOrEqual(5)
      }),
    )
  })

  it('is monotonic and idempotent', () => {
    fc.assert(
      fc.property(money(), money(), (a, b) => {
        const [low, high] = a <= b ? [a, b] : [b, a]
        expect(nearestTen(low)).toBeLessThanOrEqual(nearestTen(high))
        expect(nearestTen(nearestTen(low))).toBe(nearestTen(low))
      }),
    )
  })

  it('is a different rule from `rupees` and must stay one', () => {
    // Collapsing the two would hide that one comes from a DA order and the
    // other from the Income-tax Act. 1,234 is the smallest witness.
    expect(rupees(1234)).toBe(1234)
    expect(nearestTen(1234)).toBe(1230)
  })
})

describe('computePay — invariants that hold for every scenario', () => {
  const tables = loadPayTables()
  const levels = tables.matrix.levels.map((level) => level.level)

  /** Any cell of any Level, at any notified-or-plausible DA rate. */
  const scenario = () =>
    fc.record({
      level: fc.constantFrom(...levels),
      cellIndex: fc.integer({ min: 0, max: 39 }),
      daRate: fc.integer({ min: 0, max: 125 }),
      cityId: fc.constantFrom('delhi', 'pune', 'shimla', null),
      pensionScheme: fc.constantFrom('nps' as const, 'ups' as const, 'gpf' as const),
      group: fc.constantFrom('A' as const, 'B' as const, 'C' as const),
      regime: fc.constantFrom('auto' as const, 'new' as const, 'old' as const),
      quarters: fc.boolean(),
      npa: fc.boolean(),
      runningStaff: fc.boolean(),
    })

  const runs = { numRuns: 120 }

  it('never produces a non-finite or negative figure anywhere on the slip', () => {
    fc.assert(
      fc.property(scenario(), (input) => {
        const result = computePay(input, tables)
        for (const line of result.lines) {
          expect(Number.isFinite(line.amount), `${line.id} is not finite`).toBe(true)
          expect(line.amount, `${line.id} is negative`).toBeGreaterThanOrEqual(0)
          expect(Number.isInteger(line.amount), `${line.id} carries a paisa`).toBe(true)
        }
        expect(Number.isFinite(result.gross)).toBe(true)
        expect(Number.isFinite(result.netMonthly)).toBe(true)
      }),
      runs,
    )
  })

  it('adds up: gross is exactly the sum of its own earning lines', () => {
    fc.assert(
      fc.property(scenario(), (input) => {
        const result = computePay(input, tables)
        const earnings = result.lines
          .filter((line) => line.kind !== 'deduction')
          .reduce((sum, line) => sum + line.amount, 0)
        expect(result.gross).toBe(earnings)
      }),
      runs,
    )
  })

  it('adds up: the monthly net is gross less exactly the deduction lines', () => {
    fc.assert(
      fc.property(scenario(), (input) => {
        const result = computePay(input, tables)
        const deductions = result.lines
          .filter((line) => line.kind === 'deduction')
          .reduce((sum, line) => sum + line.amount, 0)
        expect(result.deductions.total).toBe(deductions)
        expect(result.netMonthly).toBe(result.gross - deductions)
      }),
      runs,
    )
  })

  it('is monotonic in the DA rate — more DA is never less pay', () => {
    fc.assert(
      fc.property(scenario(), fc.integer({ min: 1, max: 40 }), (input, bump) => {
        const lower = computePay(input, tables)
        const higher = computePay({ ...input, daRate: input.daRate + bump }, tables)
        expect(higher.da).toBeGreaterThanOrEqual(lower.da)
        expect(higher.gross).toBeGreaterThanOrEqual(lower.gross)
      }),
      runs,
    )
  })

  it('is monotonic along a Level’s own column — a later cell is never less basic', () => {
    fc.assert(
      fc.property(scenario(), (input) => {
        const here = computePay(input, tables)
        const next = computePay({ ...input, cellIndex: input.cellIndex + 1 }, tables)
        expect(next.basic).toBeGreaterThanOrEqual(here.basic)
        expect(next.gross).toBeGreaterThanOrEqual(here.gross)
      }),
      runs,
    )
  })

  it('pays no House Rent Allowance to an officer in government accommodation', () => {
    fc.assert(
      fc.property(scenario(), (input) => {
        const result = computePay({ ...input, quarters: true }, tables)
        expect(result.hra).toBe(0)
      }),
      runs,
    )
  })

  it('picks the cheaper regime when asked to choose, never a dearer one', () => {
    fc.assert(
      fc.property(scenario(), (input) => {
        const auto = computePay({ ...input, regime: 'auto' }, tables)
        const asNew = computePay({ ...input, regime: 'new' }, tables)
        const asOld = computePay({ ...input, regime: 'old' }, tables)
        expect(auto.deductions.tax).toBe(Math.min(asNew.deductions.tax, asOld.deductions.tax))
      }),
      runs,
    )
  })

  it('is deterministic — the same input twice gives the same slip', () => {
    fc.assert(
      fc.property(scenario(), (input) => {
        const first = computePay(input, tables)
        const second = computePay(input, tables)
        expect(second.gross).toBe(first.gross)
        expect(second.netMonthly).toBe(first.netMonthly)
        expect(second.lines.map((line) => [line.id, line.amount])).toEqual(
          first.lines.map((line) => [line.id, line.amount]),
        )
      }),
      runs,
    )
  })
})
