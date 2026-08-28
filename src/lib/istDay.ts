/**
 * IST calendar-date arithmetic for the Utilities module (holidays, leave,
 * pension). A sibling of `src/lib/srs/day.ts` rather than a shared import
 * from it: that file's own purity test enumerates every file in its
 * directory by name and asserts what each one may and may not do, so a
 * second module reaching into it would couple two unrelated features through
 * a test that exists to police the Trainer's own file list, not this one's.
 * The logic worth keeping is a few pure functions; duplicating those costs
 * less than the coupling would.
 *
 * `IST_OFFSET_MINUTES` is a fixed +05:30, not `Intl.DateTimeFormat` — India
 * has observed no daylight saving since 1945, so one statutory offset is
 * exact, not an approximation, and a fixed offset keeps every function here
 * pure and testable against a frozen clock.
 */

export const IST_OFFSET_MINUTES = 330

/** `YYYY-MM-DD`. */
export type IsoDate = string

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** The IST calendar date containing an instant. */
export function istDay(at: Date | string | number = Date.now()): IsoDate {
  const instant = at instanceof Date ? at : new Date(at)
  const shifted = new Date(instant.getTime() + IST_OFFSET_MINUTES * 60_000)
  return shifted.toISOString().slice(0, 10)
}

/**
 * `2026-02-31` parses in JavaScript as 3 March 2026. Validate a stored day
 * string with a round trip, never with a pattern alone.
 */
export function isIsoDate(value: string): value is IsoDate {
  if (!ISO_DATE.test(value)) return false
  // The regex already guarantees three numeric groups; the destructuring
  // defaults are only to satisfy `noUncheckedIndexedAccess` on a mapped
  // array, never actually reached.
  const [y = NaN, m = NaN, d = NaN] = value.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}

function toUtcDate(day: IsoDate): Date {
  const [y = NaN, m = NaN, d = NaN] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

function fromUtcDate(date: Date): IsoDate {
  return date.toISOString().slice(0, 10)
}

export function addDays(day: IsoDate, n: number): IsoDate {
  const date = toUtcDate(day)
  date.setUTCDate(date.getUTCDate() + n)
  return fromUtcDate(date)
}

/** Add whole calendar years, keeping the day-of-month where the target month allows it. */
export function addYears(day: IsoDate, n: number): IsoDate {
  const date = toUtcDate(day)
  date.setUTCFullYear(date.getUTCFullYear() + n)
  return fromUtcDate(date)
}

export function addMonths(day: IsoDate, n: number): IsoDate {
  const date = toUtcDate(day)
  date.setUTCMonth(date.getUTCMonth() + n)
  return fromUtcDate(date)
}

/** `-1` if `a` is before `b`, `0` if equal, `1` if after — plain ISO string compare is already correct. */
export function compareIsoDate(a: IsoDate, b: IsoDate): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** Whole calendar days from `a` to `b` (positive when `b` is later). */
export function diffDays(a: IsoDate, b: IsoDate): number {
  const ms = toUtcDate(b).getTime() - toUtcDate(a).getTime()
  return Math.round(ms / 86_400_000)
}

export function yearOf(day: IsoDate): number {
  return Number(day.slice(0, 4))
}

export function monthOf(day: IsoDate): number {
  return Number(day.slice(5, 7))
}

export function dayOfMonth(day: IsoDate): number {
  return Number(day.slice(8, 10))
}

/** The last day of the calendar month containing `day`. */
export function lastDayOfMonth(day: IsoDate): IsoDate {
  const y = yearOf(day)
  const m = monthOf(day)
  // Day 0 of next month is the last day of this one.
  const date = new Date(Date.UTC(y, m, 0))
  return fromUtcDate(date)
}

/** Whole completed calendar months from `a` to `b` (0 if `b` is before `a`). */
export function completedMonths(a: IsoDate, b: IsoDate): number {
  if (compareIsoDate(b, a) < 0) return 0
  let months = (yearOf(b) - yearOf(a)) * 12 + (monthOf(b) - monthOf(a))
  if (dayOfMonth(b) < dayOfMonth(a)) months -= 1
  return Math.max(0, months)
}

/** Whole completed years from `a` to `b` (0 if `b` is before `a`). */
export function completedYears(a: IsoDate, b: IsoDate): number {
  return Math.floor(completedMonths(a, b) / 12)
}
