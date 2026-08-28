import { describe, expect, it } from 'vitest'

import {
  addDays,
  addMonths,
  addYears,
  compareIsoDate,
  completedMonths,
  completedYears,
  dayOfMonth,
  diffDays,
  IST_OFFSET_MINUTES,
  isIsoDate,
  istDay,
  lastDayOfMonth,
  monthOf,
  yearOf,
} from './istDay'

/**
 * `src/lib/istDay.ts` is the calendar arithmetic behind the holiday, leave and
 * pension tools. Its own callers' suites exercise the paths those tools happen
 * to take; this file covers the module directly, and pins the two properties
 * it exists for — a fixed +05:30 offset with a half-open day boundary, and a
 * round-trip date validation rather than a pattern match.
 *
 * ADR-026 is why this is a separate file from `src/lib/srs/day.test.ts` rather
 * than a shared one: the two modules are deliberately not coupled.
 */

describe('istDay — the day boundary', () => {
  it('is a fixed +05:30, which is exact rather than approximate', () => {
    expect(IST_OFFSET_MINUTES).toBe(330)
  })

  it('puts 18:29:59.999Z in the day that is ending and 18:30:00.000Z in the next', () => {
    // Midnight IST is 18:30 UTC the previous day. Both edges are pinned so a
    // review — or a holiday, or a leave day — lands in exactly one day.
    expect(istDay('2026-08-28T18:29:59.999Z')).toBe('2026-08-28')
    expect(istDay('2026-08-28T18:30:00.000Z')).toBe('2026-08-29')
  })

  it('accepts a Date, an ISO string and an epoch millisecond count alike', () => {
    const instant = Date.UTC(2026, 7, 28, 18, 30, 0)
    expect(istDay(new Date(instant))).toBe('2026-08-29')
    expect(istDay('2026-08-28T18:30:00.000Z')).toBe('2026-08-29')
    expect(istDay(instant)).toBe('2026-08-29')
  })

  it('crosses the year boundary on the same rule', () => {
    expect(istDay('2025-12-31T18:29:59.999Z')).toBe('2025-12-31')
    expect(istDay('2025-12-31T18:30:00.000Z')).toBe('2026-01-01')
  })
})

describe('isIsoDate — a round trip, not a pattern', () => {
  it('accepts a real date', () => {
    expect(isIsoDate('2026-08-29')).toBe(true)
    expect(isIsoDate('2024-02-29')).toBe(true) // a leap year
  })

  it('rejects 2026-02-31, which Date.parse happily reads as 3 March', () => {
    // This is the whole reason the check is a round trip. `new Date('2026-02-31')`
    // is a valid Date object, so a pattern match plus a parse would pass it.
    expect(new Date('2026-02-31').getTime()).not.toBeNaN()
    expect(isIsoDate('2026-02-31')).toBe(false)
  })

  it('rejects a non-leap 29 February', () => {
    expect(isIsoDate('2026-02-29')).toBe(false)
    expect(isIsoDate('2025-02-29')).toBe(false)
  })

  it('rejects an out-of-range month or day', () => {
    expect(isIsoDate('2026-13-01')).toBe(false)
    expect(isIsoDate('2026-00-10')).toBe(false)
    expect(isIsoDate('2026-04-31')).toBe(false)
  })

  it('rejects anything not shaped YYYY-MM-DD, timestamps included', () => {
    expect(isIsoDate('2026-8-29')).toBe(false)
    expect(isIsoDate('29-08-2026')).toBe(false)
    expect(isIsoDate('2026-08-29T00:00:00.000Z')).toBe(false)
    expect(isIsoDate('')).toBe(false)
    expect(isIsoDate('not a date')).toBe(false)
  })
})

describe('istDay — adding', () => {
  it('adds and subtracts days across a month and a year end', () => {
    expect(addDays('2026-08-29', 1)).toBe('2026-08-30')
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29')
    expect(addDays('2026-08-29', 0)).toBe('2026-08-29')
  })

  it('adds years, and lands 29 February on 1 March in a common year', () => {
    expect(addYears('2026-08-29', 60)).toBe('2086-08-29')
    expect(addYears('2026-08-29', -1)).toBe('2025-08-29')
    // JavaScript's own overflow, kept deliberately: 2024-02-29 + 1 year has no
    // 29 February to land on, so it rolls forward. `superannuationDate()` in
    // src/lib/pension/engine.ts subtracts a day afterwards, which absorbs it.
    expect(addYears('2024-02-29', 1)).toBe('2025-03-01')
  })

  it('adds months, rolling a 31st into a short month', () => {
    expect(addMonths('2026-08-29', 1)).toBe('2026-09-29')
    expect(addMonths('2026-01-31', 1)).toBe('2026-03-03')
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15')
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-15')
  })
})

describe('istDay — comparing and measuring', () => {
  it('orders ISO strings, which is already chronological order', () => {
    expect(compareIsoDate('2026-08-28', '2026-08-29')).toBe(-1)
    expect(compareIsoDate('2026-08-29', '2026-08-29')).toBe(0)
    expect(compareIsoDate('2026-08-30', '2026-08-29')).toBe(1)
    expect(compareIsoDate('2025-12-31', '2026-01-01')).toBe(-1)
  })

  it('counts whole days between two dates, signed', () => {
    expect(diffDays('2026-08-29', '2026-08-30')).toBe(1)
    expect(diffDays('2026-08-30', '2026-08-29')).toBe(-1)
    expect(diffDays('2026-08-29', '2026-08-29')).toBe(0)
    expect(diffDays('2026-01-01', '2027-01-01')).toBe(365)
    expect(diffDays('2024-01-01', '2025-01-01')).toBe(366)
  })

  it('splits a date into its parts', () => {
    expect(yearOf('2026-08-29')).toBe(2026)
    expect(monthOf('2026-08-29')).toBe(8)
    expect(dayOfMonth('2026-08-29')).toBe(29)
    // Leading zeros must not be read as octal.
    expect(monthOf('2026-09-08')).toBe(9)
    expect(dayOfMonth('2026-09-08')).toBe(8)
  })

  it('finds the last day of a month, February and December included', () => {
    expect(lastDayOfMonth('2026-08-01')).toBe('2026-08-31')
    expect(lastDayOfMonth('2026-08-31')).toBe('2026-08-31')
    expect(lastDayOfMonth('2026-02-10')).toBe('2026-02-28')
    expect(lastDayOfMonth('2024-02-10')).toBe('2024-02-29')
    expect(lastDayOfMonth('2026-04-15')).toBe('2026-04-30')
    expect(lastDayOfMonth('2026-12-01')).toBe('2026-12-31')
  })
})

describe('istDay — completed months and years', () => {
  it('counts a month only once the day of month is reached', () => {
    expect(completedMonths('2026-01-15', '2026-02-14')).toBe(0)
    expect(completedMonths('2026-01-15', '2026-02-15')).toBe(1)
    expect(completedMonths('2026-01-15', '2026-02-16')).toBe(1)
    expect(completedMonths('2026-01-15', '2027-01-15')).toBe(12)
  })

  it('is zero when the second date is before the first', () => {
    expect(completedMonths('2026-08-29', '2026-01-01')).toBe(0)
    expect(completedYears('2026-08-29', '2020-01-01')).toBe(0)
  })

  it('is zero for the same day, not one', () => {
    expect(completedMonths('2026-08-29', '2026-08-29')).toBe(0)
    expect(completedYears('2026-08-29', '2026-08-29')).toBe(0)
  })

  it('counts whole years as twelve completed months', () => {
    expect(completedYears('1966-08-29', '2026-08-28')).toBe(59)
    expect(completedYears('1966-08-29', '2026-08-29')).toBe(60)
    expect(completedYears('2000-02-29', '2026-02-28')).toBe(25)
  })
})
