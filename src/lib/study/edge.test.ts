import { describe, expect, it } from 'vitest'

import { studyStreak } from './analytics'

import { currentStreak } from '@/lib/srs'
import type { LibraryProgressRow } from '@/db'

/**
 * An edge-case pass over `src/lib/study`, after the commit.
 *
 * Every test here was confirmed to FAIL against the committed code before its
 * fix was written.
 */

const NOW = new Date('2026-09-03T06:00:00.000Z') // 11:30 IST on 3 September
const day = (istDate: string): LibraryProgressRow =>
  ({ at: `${istDate}T06:00:00.000Z` }) as LibraryProgressRow

const streakOf = (progress: LibraryProgressRow[]) =>
  studyStreak({ now: NOW, sessions: [], progress, reviewLog: [], chapterLog: [], attempts: [] })

describe('the study streak must not disagree with the Trainer’s about the same reader', () => {
  /**
   * `src/lib/srs/day.ts#currentStreak` — the same app, one screen away — starts
   * its walk from YESTERDAY when today has not been met yet:
   *
   *     let day = met.has(today) ? today : addIstDays(today, -1)
   *
   * `studyStreak` started from today unconditionally, so a reader with thirty
   * consecutive days saw **0** on `/study/progress` every morning until they
   * studied, while `/study/practise` showed 30 at the same moment. That is not a
   * conservative reading of the same fact — it destroys the fact. The screen
   * already has a separate line for "nothing studied today yet"
   * (`library.study.review.noStreak`), so the two statements never needed to be
   * carried by one number.
   */
  it('keeps counting yesterday’s run before today’s first study', () => {
    expect(streakOf([day('2026-09-02'), day('2026-09-01'), day('2026-08-31')])).toBe(3)
  })

  it('counts today when today has been studied', () => {
    expect(streakOf([day('2026-09-03'), day('2026-09-02')])).toBe(2)
  })

  it('is zero when the run ended before yesterday', () => {
    expect(streakOf([day('2026-09-01'), day('2026-08-31')])).toBe(0)
  })

  it('agrees with the Trainer’s streak on the same run of days', () => {
    const days = ['2026-09-02', '2026-09-01', '2026-08-31']
    const trainer = currentStreak(
      days.map((date) => ({ date, goalMet: true, reviewed: 1 })),
      NOW,
    )
    expect(streakOf(days.map(day))).toBe(trainer)
  })

  it('still returns zero when nothing has ever been studied', () => {
    expect(streakOf([])).toBe(0)
  })
})
