import type { StreakRow } from './types'

/**
 * Day boundaries, in Indian Standard Time.
 *
 * A streak has to break at a boundary the reader recognises, and for an app
 * written for officers of the Government of India that boundary is midnight
 * IST — not midnight wherever the device happens to think it is. An officer on
 * a course abroad, or one whose laptop clock is set to UTC, must not lose a
 * streak for reviewing at nine in the evening.
 *
 * IST is implemented as a **fixed offset of +05:30** rather than through
 * `Intl.DateTimeFormat`, and that is exact rather than an approximation: India
 * has observed no daylight saving since 1945, and IST is a single statutory
 * offset for the whole country. There is no rule for a timezone database to
 * carry that this constant does not already state. The fixed offset is also
 * what makes every function here pure and testable against a frozen clock.
 */

/** +05:30. See the note above: this is exact, not a simplification. */
export const IST_OFFSET_MINUTES = 330

const MS_PER_MINUTE = 60_000
const MS_PER_DAY = 86_400_000
const IST_OFFSET_MS = IST_OFFSET_MINUTES * MS_PER_MINUTE

/** `YYYY-MM-DD`. */
export type IstDay = string

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

const msOf = (at: Date | string | number): number =>
  typeof at === 'number' ? at : typeof at === 'string' ? Date.parse(at) : at.getTime()

/** The IST calendar date an instant falls on. */
export function istDay(at: Date | string | number): IstDay {
  const ms = msOf(at)
  if (Number.isNaN(ms)) throw new RangeError(`Not an instant: ${String(at)}`)
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10)
}

/** The instant an IST day begins — 00:00:00.000 IST, as UTC. */
export function istDayStart(day: IstDay): Date {
  if (!DAY_PATTERN.test(day)) throw new RangeError(`Not an IST day: ${day}`)
  const ms = Date.parse(`${day}T00:00:00.000Z`)
  if (Number.isNaN(ms)) throw new RangeError(`Not an IST day: ${day}`)
  return new Date(ms - IST_OFFSET_MS)
}

/**
 * The instant an IST day ends, **exclusive** — it is the next day's start.
 * Every window in this library is `[start, end)`, so no review can land in two
 * days or in neither.
 */
export const istDayEnd = (day: IstDay): Date => new Date(istDayStart(day).getTime() + MS_PER_DAY)

/** `n` days later (or earlier) on the IST calendar. */
export const addIstDays = (day: IstDay, n: number): IstDay =>
  istDay(istDayStart(day).getTime() + n * MS_PER_DAY + IST_OFFSET_MS)

/** Whether an instant falls inside an IST day's `[start, end)` window. */
export function withinIstDay(at: Date | string | number, day: IstDay): boolean {
  const ms = msOf(at)
  return ms >= istDayStart(day).getTime() && ms < istDayEnd(day).getTime()
}

/**
 * Consecutive days ending at `now`, counting back over days whose goal was met.
 *
 * Today is allowed to be unfinished: a reader who has a nine-day streak and has
 * not sat down yet this morning still has a nine-day streak, and loses it only
 * once today has passed unmet. So the count starts at today if today's goal is
 * met, and at yesterday otherwise.
 *
 * @param rows every `streaks` row; order does not matter
 */
export function currentStreak(rows: readonly StreakRow[], now: Date | string | number): number {
  const met = new Set(rows.filter((row) => row.goalMet).map((row) => row.date))
  const today = istDay(now)

  let day = met.has(today) ? today : addIstDays(today, -1)
  let streak = 0
  while (met.has(day)) {
    streak += 1
    day = addIstDays(day, -1)
  }
  return streak
}

/** The longest run of goal-met days ever recorded. */
export function longestStreak(rows: readonly StreakRow[]): number {
  const met = [...new Set(rows.filter((row) => row.goalMet).map((row) => row.date))].sort()

  let best = 0
  let run = 0
  let previous: string | null = null
  for (const day of met) {
    run = previous !== null && addIstDays(previous, 1) === day ? run + 1 : 1
    previous = day
    if (run > best) best = run
  }
  return best
}
