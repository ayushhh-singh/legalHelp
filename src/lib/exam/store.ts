import type { ExamChoiceRow } from './types'

import { db } from '@/db'
import { isIstDay, type IstDay } from '@/lib/srs'

/**
 * The exam layer's storage — the ONE file in `src/lib/exam` that opens the
 * database, the split `src/lib/srs` and `src/lib/study` both draw.
 *
 * It stores CHOICES: which examination, which day, how many minutes. It does
 * not store a plan, and `src/lib/exam/plan.ts` says why — a plan is a function
 * of the schedule, and the schedule moves every time a card is graded.
 *
 * Nothing here leaves the device, and nothing here is about anybody's
 * employment: a profile id names a public examination and the date is the
 * reader's own.
 */

const iso = (at: Date): string => at.toISOString()

/**
 * The one the reader is preparing for, or `null`.
 *
 * `null` and not `undefined`: `useLiveQuery` reports "still asking" with
 * `undefined`, and a screen that cannot tell that apart from "nothing chosen"
 * bounces the reader back to the picker on the first render after they choose
 * one. That is the defect ADR-039's addendum records costing the Library a
 * whole session, and it is fixed here rather than in each caller.
 */
export async function activeExamChoice(): Promise<ExamChoiceRow | null> {
  const rows = await db.examChoices.where('active').equals(1).toArray()
  if (rows[0]) return rows[0]
  // `where('active').equals(1)` cannot match a boolean — IndexedDB has no
  // boolean key type, so `true` is not indexable and Dexie stores it as an
  // unindexed value. The scan below is what actually answers; the query above
  // is kept because a future migration to a 0/1 column would make it the fast
  // path and this one the fallback, and because the table holds at most a
  // handful of rows either way.
  const all = await db.examChoices.toArray()
  return all.find((row) => row.active) ?? null
}

/**
 * Choose an examination, keeping whatever the reader had already typed for it.
 *
 * Switching profiles does NOT clear the other rows' dates. A reader who looks
 * at a second profile and comes back should find their own target date where
 * they left it — the row is theirs, and `active` is the only thing a switch
 * changes.
 */
export async function setActiveExam(profileId: string, now = new Date()): Promise<ExamChoiceRow> {
  return db.transaction('rw', db.examChoices, async () => {
    const at = iso(now)
    const rows = await db.examChoices.toArray()
    for (const row of rows) {
      if (row.id !== profileId && row.active) {
        await db.examChoices.put({ ...row, active: false, updatedAt: at })
      }
    }
    const existing = rows.find((row) => row.id === profileId)
    const next: ExamChoiceRow = existing
      ? { ...existing, active: true, updatedAt: at }
      : {
          id: profileId,
          targetDate: null,
          dailyMinutes: null,
          active: true,
          createdAt: at,
          updatedAt: at,
        }
    await db.examChoices.put(next)
    return next
  })
}

/**
 * Set (or clear) the examination date.
 *
 * A value that is not an IST calendar day is REFUSED rather than clamped — the
 * posture `src/lib/study/types.ts#isConfidence` takes, for the same reason:
 * clamping would put a date on the record that the reader never gave, and every
 * figure on the readiness screen is counted from this one.
 */
export async function setTargetDate(
  profileId: string,
  targetDate: IstDay | null,
  now = new Date(),
): Promise<ExamChoiceRow | null> {
  if (targetDate !== null && !isIstDay(targetDate)) return null
  const existing = await db.examChoices.get(profileId)
  if (!existing) return null
  const next: ExamChoiceRow = { ...existing, targetDate, updatedAt: iso(now) }
  await db.examChoices.put(next)
  return next
}

/** Minutes a day, or `null` to fall back to the Session 28 study goal. */
export async function setDailyMinutes(
  profileId: string,
  minutes: number | null,
  now = new Date(),
): Promise<ExamChoiceRow | null> {
  if (minutes !== null && (!Number.isFinite(minutes) || minutes <= 0)) return null
  const existing = await db.examChoices.get(profileId)
  if (!existing) return null
  const next: ExamChoiceRow = {
    ...existing,
    dailyMinutes: minutes === null ? null : Math.round(minutes),
    updatedAt: iso(now),
  }
  await db.examChoices.put(next)
  return next
}

/** Stop preparing for anything. The rows stay; only the flag is cleared. */
export async function clearActiveExam(now = new Date()): Promise<void> {
  await db.transaction('rw', db.examChoices, async () => {
    const at = iso(now)
    for (const row of await db.examChoices.toArray()) {
      if (row.active) await db.examChoices.put({ ...row, active: false, updatedAt: at })
    }
  })
}

/**
 * Forget one examination entirely — the row and the date with it.
 *
 * The difference from `clearActiveExam` is deliberate and the two are labelled
 * differently on screen. "Change examination", on the hub, clears the flag and
 * keeps the row, so a reader who looks at a second profile and comes back finds
 * their own date where they left it. "Stop preparing", in Settings, means what
 * it says: the row goes, and nothing on the device records which departmental
 * examination this officer was preparing for.
 */
export async function forgetExam(profileId: string): Promise<void> {
  await db.examChoices.delete(profileId)
}
