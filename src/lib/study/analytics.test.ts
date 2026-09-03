import { describe, expect, it } from 'vitest'

import {
  coverageOf,
  goalProgress,
  studyStreak,
  summariseCoverage,
  weeklyReview,
  WEEK_DAYS,
  windowStart,
  windowStartInstant,
  type WeeklyInput,
} from './analytics'
import type { ChapterLogRow, FeynmanAttemptRow, StudyGoalRow, StudySessionRow } from './types'

import type { LibraryHighlightRow, LibraryNoteRow, LibraryProgressRow } from '@/db'
import type { ReviewLogRow } from '@/lib/srs'

/**
 * The weekly review and the coverage heat-map, against a frozen clock.
 *
 * The window is an IST window and the boundary cases are pinned deliberately:
 * `src/lib/srs/day.test.ts` pins the same edges at 18:29:59.999Z and
 * 18:30:00.000Z, and a summary screen that put a day's work in the wrong week
 * would be wrong in a way nobody would notice.
 */

// 3 September 2026, 11:30 IST.
const NOW = new Date('2026-09-03T06:00:00.000Z')

const empty: Omit<WeeklyInput, 'now'> = {
  sessions: [],
  progress: [],
  reviewLog: [],
  chapterLog: [],
  attempts: [],
}

const session = (over: Partial<StudySessionRow>): StudySessionRow => ({
  id: 's',
  workId: 'rti',
  nodeId: null,
  mode: 'free',
  startedAt: '2026-09-02T06:00:00.000Z',
  endedAt: '2026-09-02T07:00:00.000Z',
  minutes: 60,
  pomodoros: 0,
  ...over,
})

const progress = (at: string, unitId = 'u1'): LibraryProgressRow => ({
  id: `rti:${unitId}`,
  workId: 'rti',
  unitId,
  at,
  secondsRead: 60,
})

const review = (at: string, qId = 'c1'): ReviewLogRow => ({
  id: `${qId}#1#${at}`,
  qId,
  grade: 'Good',
  at,
  durationMs: 1000,
  stateBefore: 'new',
  elapsed: 0,
  retrievability: null,
})

const chapterLog = (at: string): ChapterLogRow => ({
  id: `c#1#${at}`,
  cardId: 'rti:ch-1',
  workId: 'rti',
  grade: 'Good',
  at,
  stateBefore: 'new',
  reason: 'confidence',
})

const attempt = (at: string): FeynmanAttemptRow => ({
  id: `a-${at}`,
  workId: 'rti',
  unitId: 'u1',
  body: 'text',
  grades: ['got-it', 'got-it', 'got-it'],
  at,
})

describe('the window', () => {
  it('is seven IST days ending today', () => {
    expect(WEEK_DAYS).toBe(7)
    expect(windowStart(NOW)).toBe('2026-08-28')
  })

  it('begins at the first millisecond of the first IST day', () => {
    // 28 August 2026, 00:00 IST is 27 August 18:30 UTC.
    expect(windowStartInstant(NOW)).toBe('2026-08-27T18:30:00.000Z')
  })

  it('honours a different window length', () => {
    expect(windowStart(NOW, 1)).toBe('2026-09-03')
    expect(windowStart(NOW, 30)).toBe('2026-08-05')
  })
})

describe('weeklyReview', () => {
  it('reports zeroes on a device with no history rather than NaN', () => {
    const review = weeklyReview({ now: NOW, ...empty })
    expect(review).toMatchObject({
      minutes: 0,
      unitsRead: 0,
      cardsReviewed: 0,
      chaptersRevised: 0,
      streak: 0,
    })
    expect(review.minutesByWork).toEqual({})
  })

  it('sums minutes over ended sessions and splits them by work', () => {
    const result = weeklyReview({
      now: NOW,
      ...empty,
      sessions: [
        session({ id: 'a', workId: 'rti', minutes: 30 }),
        session({ id: 'b', workId: 'posh', minutes: 45 }),
        session({ id: 'c', workId: 'rti', minutes: 15 }),
      ],
    })
    expect(result.minutes).toBe(90)
    expect(result.minutesByWork).toEqual({ rti: 45, posh: 45 })
  })

  it('ignores a session that is still running', () => {
    // `endSession` is what writes `minutes`. Counting a running session would
    // make the total move while the reader watched it.
    const result = weeklyReview({
      now: NOW,
      ...empty,
      sessions: [session({ endedAt: null, minutes: 999 })],
    })
    expect(result.minutes).toBe(0)
  })

  it('excludes a session that ended before the window', () => {
    const result = weeklyReview({
      now: NOW,
      ...empty,
      sessions: [session({ endedAt: '2026-08-20T06:00:00.000Z' })],
    })
    expect(result.minutes).toBe(0)
  })

  it('includes work on the first IST day of the window and excludes the instant before it', () => {
    const inside = weeklyReview({ now: NOW, ...empty, progress: [progress('2026-08-27T18:30:00.000Z')] })
    const outside = weeklyReview({ now: NOW, ...empty, progress: [progress('2026-08-27T18:29:59.999Z')] })
    expect(inside.unitsRead).toBe(1)
    expect(outside.unitsRead).toBe(0)
  })

  it('counts cards, chapters and attempts from their own logs', () => {
    const result = weeklyReview({
      now: NOW,
      ...empty,
      reviewLog: [review('2026-09-01T06:00:00.000Z'), review('2026-09-02T06:00:00.000Z', 'c2')],
      chapterLog: [chapterLog('2026-09-02T06:00:00.000Z')],
      attempts: [attempt('2026-09-03T05:00:00.000Z')],
    })
    expect(result.cardsReviewed).toBe(2)
    expect(result.chaptersRevised).toBe(1)
    expect(result.feynmanAttempts).toBe(1)
  })
})

describe('studyStreak', () => {
  it('is zero when nothing happened today', () => {
    expect(studyStreak({ now: NOW, ...empty, progress: [progress('2026-09-02T06:00:00.000Z')] })).toBe(0)
  })

  it('counts consecutive IST days ending today', () => {
    expect(
      studyStreak({
        now: NOW,
        ...empty,
        progress: [
          progress('2026-09-03T05:00:00.000Z'),
          progress('2026-09-02T05:00:00.000Z', 'u2'),
          progress('2026-09-01T05:00:00.000Z', 'u3'),
        ],
      }),
    ).toBe(3)
  })

  it('breaks on a missed day', () => {
    expect(
      studyStreak({
        now: NOW,
        ...empty,
        progress: [progress('2026-09-03T05:00:00.000Z'), progress('2026-09-01T05:00:00.000Z', 'u2')],
      }),
    ).toBe(1)
  })

  it('counts any of the four kinds of study, not only sessions', () => {
    // Wider than the Trainer's own streak, which counts a day the queue was
    // emptied. This is a claim about turning up.
    expect(studyStreak({ now: NOW, ...empty, reviewLog: [review('2026-09-03T05:00:00.000Z')] })).toBe(1)
    expect(studyStreak({ now: NOW, ...empty, chapterLog: [chapterLog('2026-09-03T05:00:00.000Z')] })).toBe(1)
    expect(studyStreak({ now: NOW, ...empty, attempts: [attempt('2026-09-03T05:00:00.000Z')] })).toBe(1)
    expect(
      studyStreak({ now: NOW, ...empty, sessions: [session({ endedAt: '2026-09-03T05:00:00.000Z' })] }),
    ).toBe(1)
  })

  it('survives an unreadable timestamp instead of throwing out of the screen', () => {
    expect(() =>
      studyStreak({
        now: NOW,
        ...empty,
        progress: [progress('not a date'), progress('2026-09-03T05:00:00.000Z', 'u2')],
      }),
    ).not.toThrow()
    expect(
      studyStreak({
        now: NOW,
        ...empty,
        progress: [progress('not a date'), progress('2026-09-03T05:00:00.000Z', 'u2')],
      }),
    ).toBe(1)
  })
})

describe('goalProgress', () => {
  const goal = (over: Partial<StudyGoalRow>): StudyGoalRow => ({
    id: 'rti',
    updatedAt: NOW.toISOString(),
    ...over,
  })
  const week = weeklyReview({ now: NOW, ...empty, sessions: [session({ workId: 'rti', minutes: 90 })] })

  it('measures minutes against the target', () => {
    const progress = goalProgress(goal({ minutesPerWeek: 180 }), week, 0)
    expect(progress.minutesDone).toBe(90)
    expect(progress.fraction).toBe(0.5)
    expect(progress.met).toBe(false)
  })

  it('averages only the targets that were SET', () => {
    // A goal of "180 minutes a week" with no unit target must not read as half
    // done because the units half of a target nobody asked for is empty.
    expect(goalProgress(goal({ minutesPerWeek: 90 }), week, 0).fraction).toBe(1)
    expect(goalProgress(goal({ minutesPerWeek: 90 }), week, 0).met).toBe(true)
  })

  it('averages both when both are set', () => {
    const progress = goalProgress(goal({ minutesPerWeek: 90, unitsPerWeek: 10 }), week, 5)
    expect(progress.fraction).toBe(0.75)
    expect(progress.met).toBe(false)
  })

  it('never exceeds 1 on an over-achieved target', () => {
    expect(goalProgress(goal({ minutesPerWeek: 30 }), week, 0).fraction).toBe(1)
  })

  it('reports null and never "met" for a goal that sets nothing', () => {
    const progress = goalProgress(goal({}), week, 0)
    expect(progress.fraction).toBeNull()
    expect(progress.met).toBe(false)
  })

  it('ignores a zero or negative target', () => {
    expect(goalProgress(goal({ minutesPerWeek: 0 }), week, 0).minutesTarget).toBeNull()
    expect(goalProgress(goal({ minutesPerWeek: -5 }), week, 0).minutesTarget).toBeNull()
  })
})

describe('coverageOf', () => {
  const highlight = (unitId: string): LibraryHighlightRow => ({
    id: `h-${unitId}`,
    workId: 'rti',
    unitId,
    lang: 'en',
    start: 0,
    end: 5,
    quote: 'text',
    colour: 'marigold',
    createdAt: NOW.toISOString(),
  })
  const note = (unitId: string): LibraryNoteRow => ({
    id: `n-${unitId}`,
    workId: 'rti',
    unitId,
    body: 'note',
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  })

  const base = {
    unitIds: ['u1', 'u2', 'u3', 'u4'],
    progress: [
      progress(NOW.toISOString(), 'u1'),
      { ...progress(NOW.toISOString(), 'u2'), markedReadAt: NOW.toISOString() },
    ],
    highlights: [highlight('u2')],
    notes: [note('u3')],
    cardUnits: new Map([['c1', 'u1']]),
    reviewLog: [review(NOW.toISOString(), 'c1')],
  }

  it('reports the three states independently', () => {
    const units = coverageOf(base)
    expect(units.find((unit) => unit.unitId === 'u1')).toMatchObject({
      read: true,
      annotated: false,
      quizzed: true,
    })
    expect(units.find((unit) => unit.unitId === 'u2')).toMatchObject({
      read: true,
      annotated: true,
      quizzed: false,
    })
    expect(units.find((unit) => unit.unitId === 'u3')).toMatchObject({
      read: false,
      annotated: true,
      quizzed: false,
    })
    expect(units.find((unit) => unit.unitId === 'u4')).toMatchObject({
      read: false,
      annotated: false,
      quizzed: false,
    })
  })

  it('distinguishes "opened" from "the reader said they had read it"', () => {
    const units = coverageOf(base)
    expect(units.find((unit) => unit.unitId === 'u1')?.markedRead).toBe(false)
    expect(units.find((unit) => unit.unitId === 'u2')?.markedRead).toBe(true)
  })

  it('scores depth 0-3 without counting markedRead twice', () => {
    expect(coverageOf(base).find((unit) => unit.unitId === 'u2')?.depth).toBe(2)
    expect(coverageOf(base).find((unit) => unit.unitId === 'u4')?.depth).toBe(0)
  })

  it('ignores a review log entry for a card whose unit is unknown', () => {
    const units = coverageOf({ ...base, cardUnits: new Map(), reviewLog: [review(NOW.toISOString(), 'c1')] })
    expect(units.every((unit) => !unit.quizzed)).toBe(true)
  })

  it('returns one row per unit, in the order given', () => {
    expect(coverageOf(base).map((unit) => unit.unitId)).toEqual(base.unitIds)
  })

  it('summarises, and names the read-but-never-quizzed gap', () => {
    expect(summariseCoverage(coverageOf(base))).toEqual({
      total: 4,
      read: 2,
      markedRead: 1,
      annotated: 2,
      quizzed: 1,
      readNotQuizzed: 1,
      untouched: 1,
    })
  })
})
