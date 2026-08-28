import { describe, expect, it } from 'vitest'

import { COMMENCEMENT_DATE, eraForOffenceDate, isValidDate, todayInIndia } from './dateRule'

/**
 * The boundary is the test.
 *
 * An offence on 30 June 2024 is tried under the IPC; one on 1 July 2024 is
 * tried under the BNS. Everything else in this module is a lookup; this is the
 * one place where being one day out changes which body of law applies, so the
 * two days either side of commencement are asserted directly rather than
 * through a range.
 */

describe('eraForOffenceDate', () => {
  it('is 1 July 2024, the day all three Sanhitas came into force', () => {
    expect(COMMENCEMENT_DATE).toBe('2024-07-01')
  })

  it.each([
    ['1860-01-01', 'old'],
    ['2024-06-29', 'old'],
    ['2024-06-30', 'old'],
    ['2024-07-01', 'new'],
    ['2024-07-02', 'new'],
    ['2026-08-28', 'new'],
  ])('%s falls under the %s law', (date, era) => {
    expect(eraForOffenceDate(date)).toBe(era)
  })

  it('treats the day of commencement itself as the NEW law', () => {
    // BNSS 531(2)(a) saves the repealed Acts for offences committed *before*
    // commencement. An offence on the day itself is under the Sanhitas.
    expect(eraForOffenceDate('2024-06-30')).toBe('old')
    expect(eraForOffenceDate(COMMENCEMENT_DATE)).toBe('new')
  })

  it('answers "I do not know" rather than guessing', () => {
    // null is a third answer, and the UI has to render it as one: with no date,
    // the app must not imply it knows which code applies.
    expect(eraForOffenceDate(null)).toBeNull()
    expect(eraForOffenceDate(undefined)).toBeNull()
    expect(eraForOffenceDate('')).toBeNull()
    expect(eraForOffenceDate('not a date')).toBeNull()
    expect(eraForOffenceDate('01-07-2024')).toBeNull()
    expect(eraForOffenceDate('2024-7-1')).toBeNull()
  })

  it('rejects a date that does not exist', () => {
    // A deep link can carry anything; the date picker cannot produce this.
    expect(eraForOffenceDate('2024-02-31')).toBeNull()
    expect(eraForOffenceDate('2023-02-29')).toBeNull()
    expect(eraForOffenceDate('2024-13-01')).toBeNull()
  })

  it('accepts a leap day in a leap year', () => {
    expect(eraForOffenceDate('2024-02-29')).toBe('old')
  })

  it('does not shift the boundary by a time zone', () => {
    // The whole reason this compares strings: `new Date('2024-07-01')` is UTC
    // midnight, which is 05:30 on 1 July in Asia/Kolkata — and reading it back
    // as a local date in a western time zone gives 30 June, the wrong answer on
    // exactly the day that matters.
    const asDate = new Date('2024-07-01')
    expect(asDate.getUTCDate()).toBe(1)
    expect(eraForOffenceDate('2024-07-01')).toBe('new')
    expect(eraForOffenceDate('2024-06-30')).toBe('old')
  })
})

describe('isValidDate', () => {
  it('requires a zero-padded ISO date', () => {
    expect(isValidDate('2024-07-01')).toBe(true)
    expect(isValidDate('2024-7-01')).toBe(false)
    expect(isValidDate('20240701')).toBe(false)
    expect(isValidDate('2024-07-01T00:00:00Z')).toBe(false)
  })
})

describe('todayInIndia', () => {
  it('formats as YYYY-MM-DD', () => {
    expect(todayInIndia()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(isValidDate(todayInIndia())).toBe(true)
  })

  it('reads the clock in Asia/Kolkata, not on the device', () => {
    // 22:00 UTC on 30 June is 03:30 on 1 July in India. A device in London
    // would call this 30 June and apply the wrong code.
    expect(todayInIndia(new Date('2024-06-30T22:00:00Z'))).toBe('2024-07-01')
    expect(todayInIndia(new Date('2024-06-30T17:00:00Z'))).toBe('2024-06-30')
  })

  it('agrees with the era rule on the boundary it produces', () => {
    expect(eraForOffenceDate(todayInIndia(new Date('2024-06-30T22:00:00Z')))).toBe('new')
    expect(eraForOffenceDate(todayInIndia(new Date('2024-06-30T17:00:00Z')))).toBe('old')
  })
})
