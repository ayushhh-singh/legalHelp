import { describe, expect, it } from 'vitest'

import {
  addIstDays,
  currentStreak,
  IST_OFFSET_MINUTES,
  istDay,
  istDayEnd,
  istDayStart,
  longestStreak,
  withinIstDay,
} from './day'

import type { StreakRow } from './types'

/** IST is UTC+05:30, so 18:30 UTC is the moment the next IST day begins. */
const IST_MIDNIGHT_UTC = '18:30:00.000Z'

const streak = (date: string, goalMet: boolean, reviewed = 1): StreakRow => ({ date, reviewed, goalMet })

describe('IST day boundaries', () => {
  it('is a fixed +05:30 offset', () => {
    expect(IST_OFFSET_MINUTES).toBe(330)
  })

  it('puts an evening review on the day the reader would call it', () => {
    // 23:50 IST on 1 March.
    expect(istDay(new Date(`2026-03-01T18:20:00.000Z`))).toBe('2026-03-01')
  })

  it('rolls over at 18:30 UTC, not at UTC midnight', () => {
    expect(istDay(new Date(`2026-03-01T${IST_MIDNIGHT_UTC}`))).toBe('2026-03-02')
    expect(istDay(new Date('2026-03-01T18:29:59.999Z'))).toBe('2026-03-01')
    // The hours between UTC midnight and 05:30 IST are still the same IST day.
    expect(istDay(new Date('2026-03-02T00:10:00.000Z'))).toBe('2026-03-02')
  })

  it('accepts an ISO string as readily as a Date', () => {
    expect(istDay('2026-03-01T18:20:00.000Z')).toBe('2026-03-01')
  })

  it('starts and ends a day on the same instants it assigns to it', () => {
    const start = istDayStart('2026-03-02')
    expect(start.toISOString()).toBe(`2026-03-01T${IST_MIDNIGHT_UTC}`)
    expect(istDay(start)).toBe('2026-03-02')

    const end = istDayEnd('2026-03-02')
    expect(end.toISOString()).toBe(`2026-03-02T${IST_MIDNIGHT_UTC}`)
    // The window is [start, end): the end instant belongs to the next day.
    expect(istDay(end)).toBe('2026-03-03')
  })

  it('claims every instant for exactly one day', () => {
    const at = '2026-03-01T18:29:59.999Z'
    expect(withinIstDay(at, '2026-03-01')).toBe(true)
    expect(withinIstDay(at, '2026-03-02')).toBe(false)
    expect(withinIstDay(`2026-03-01T${IST_MIDNIGHT_UTC}`, '2026-03-01')).toBe(false)
    expect(withinIstDay(`2026-03-01T${IST_MIDNIGHT_UTC}`, '2026-03-02')).toBe(true)
  })

  it('walks the calendar across a month and a leap day', () => {
    expect(addIstDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(addIstDays('2024-02-28', 1)).toBe('2024-02-29')
    expect(addIstDays('2026-12-31', 1)).toBe('2027-01-01')
  })

  it('rejects a value that is not a day or not an instant', () => {
    expect(() => istDayStart('1 March 2026')).toThrow(RangeError)
    expect(() => istDay('not a date')).toThrow(RangeError)
  })
})

describe('streak', () => {
  const now = new Date('2026-03-05T12:00:00.000Z') // 17:30 IST on 5 March

  it('counts consecutive met days back from today', () => {
    const rows = ['2026-03-03', '2026-03-04', '2026-03-05'].map((d) => streak(d, true))
    expect(currentStreak(rows, now)).toBe(3)
  })

  it('keeps the streak alive while today is still unfinished', () => {
    // Nothing today yet; yesterday and the day before were met.
    const rows = [streak('2026-03-03', true), streak('2026-03-04', true)]
    expect(currentStreak(rows, now)).toBe(2)
  })

  it('breaks on a day whose goal was not met', () => {
    const rows = [
      streak('2026-03-02', true),
      streak('2026-03-03', false, 4),
      streak('2026-03-04', true),
      streak('2026-03-05', true),
    ]
    expect(currentStreak(rows, now)).toBe(2)
  })

  it('survives IST midnight — a 23:50 and a 00:10 review are two days', () => {
    const rows = [
      streak(istDay('2026-03-04T18:20:00.000Z'), true), // 23:50 IST, 4 March
      streak(istDay('2026-03-04T18:40:00.000Z'), true), // 00:10 IST, 5 March
    ]
    expect(rows.map((row) => row.date)).toEqual(['2026-03-04', '2026-03-05'])
    expect(currentStreak(rows, new Date('2026-03-04T18:40:00.000Z'))).toBe(2)
  })

  it('does not count a day met on the far side of the device clock', () => {
    // A review at 00:10 IST on 5 March is NOT 4 March, so a reader who did
    // nothing on the 4th has a one-day streak, not two.
    const rows = [streak('2026-03-05', true)]
    expect(currentStreak(rows, now)).toBe(1)
  })

  it('is zero with no rows, and zero once a whole day has been missed', () => {
    expect(currentStreak([], now)).toBe(0)
    expect(currentStreak([streak('2026-03-03', true)], now)).toBe(0)
  })

  it('remembers the longest run ever recorded', () => {
    const rows = [
      streak('2026-01-01', true),
      streak('2026-01-02', true),
      streak('2026-01-03', true),
      streak('2026-01-04', false),
      streak('2026-03-04', true),
      streak('2026-03-05', true),
    ]
    expect(longestStreak(rows)).toBe(3)
    expect(currentStreak(rows, now)).toBe(2)
  })
})
