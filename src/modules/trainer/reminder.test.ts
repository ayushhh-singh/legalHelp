import { describe, expect, it } from 'vitest'

import { DEFAULT_REMINDER_SETTING, localDay, shouldRemind } from './reminder'

/**
 * `shouldRemind`/`localDay` deliberately read the device's LOCAL clock (see
 * `reminder.ts`'s module note), so every fixture here is built with the
 * local-time `Date` constructor rather than a UTC ISO string — the same
 * function read the same way regardless of which time zone runs the suite.
 */
const local = (y: number, m: number, d: number, hour = 0, minute = 0): Date =>
  new Date(y, m - 1, d, hour, minute)

describe('localDay', () => {
  it('reads the device-local calendar day', () => {
    expect(localDay(local(2026, 1, 1, 23, 30))).toBe('2026-01-01')
  })
})

describe('shouldRemind', () => {
  const setting = { ...DEFAULT_REMINDER_SETTING, enabled: true, hour: 19, minute: 0 }

  it('is false while disabled', () => {
    expect(shouldRemind({ ...setting, enabled: false }, local(2026, 8, 28, 20, 0))).toBe(false)
  })

  it('is false before the target time', () => {
    expect(shouldRemind(setting, local(2026, 8, 28, 13, 0))).toBe(false)
  })

  it('is true at or after the target time', () => {
    expect(shouldRemind(setting, local(2026, 8, 28, 19, 0))).toBe(true)
    expect(shouldRemind(setting, local(2026, 8, 28, 20, 30))).toBe(true)
  })

  it('is false again once it has already fired today', () => {
    const firedToday = { ...setting, lastShownDate: localDay(local(2026, 8, 28, 19, 0)) }
    expect(shouldRemind(firedToday, local(2026, 8, 28, 20, 0))).toBe(false)
  })

  it('is true again the next day', () => {
    const firedYesterday = { ...setting, lastShownDate: '2026-08-27' }
    expect(shouldRemind(firedYesterday, local(2026, 8, 28, 19, 30))).toBe(true)
  })
})
