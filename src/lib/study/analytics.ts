import type { ChapterLogRow, FeynmanAttemptRow, StudyGoalRow, StudySessionRow } from './types'

import type { LibraryHighlightRow, LibraryNoteRow, LibraryProgressRow } from '@/db'
import { addIstDays, istDay, istDayStart, type IstDay } from '@/lib/srs'
import type { ReviewLogRow } from '@/lib/srs'

/**
 * The weekly review, and the coverage heat-map.
 *
 * Pure arithmetic over rows the caller has already read. Two things about it
 * are worth knowing before changing anything:
 *
 * 1. **The week is an IST week, and it uses `src/lib/srs/day.ts`.** Not a
 *    second copy of the offset reasoning — `src/lib/istDay.ts` exists as a
 *    deliberate second copy for the Utilities module (ADR-026) because
 *    `src/lib/srs/purity.test.ts` polices what may cross into that directory,
 *    and nothing polices what crosses OUT of it. This library already depends
 *    on `src/lib/srs` for the FSRS engine, so importing its day arithmetic adds
 *    no coupling that is not there.
 * 2. **The heat-map's three states are three different tables**, and a unit can
 *    be in any combination of them. "Read" is `libraryProgress`, "annotated" is
 *    a highlight or a note, and "quizzed" is a `reviewLog` row for a card whose
 *    `ruleRef.textId` is that unit — which is why the caller has to hand in the
 *    card-to-unit map rather than this file guessing at it.
 */

/** Days in a review window. Seven, and the brief asks for a weekly screen. */
export const WEEK_DAYS = 7

/** The IST day a window of `days` ending today begins on. */
export function windowStart(now: Date, days = WEEK_DAYS): IstDay {
  return addIstDays(istDay(now), -(days - 1))
}

/** ISO instant of the first millisecond of that window — what a range query needs. */
export function windowStartInstant(now: Date, days = WEEK_DAYS): string {
  return istDayStart(windowStart(now, days)).toISOString()
}

const within = (at: string, from: string): boolean => at >= from

export interface WeeklyReview {
  from: IstDay
  to: IstDay
  /** Focused minutes, summed over ENDED sessions only. */
  minutes: number
  /** Minutes per work id, for the bar chart. */
  minutesByWork: Record<string, number>
  /** Units opened for the first time in the window. */
  unitsRead: number
  /** Cards graded in the window, from the Trainer's own log. */
  cardsReviewed: number
  /** Chapter confidence ratings in the window. */
  chaptersRevised: number
  /** Feynman attempts written in the window. */
  feynmanAttempts: number
  /** Consecutive IST days ending today on which SOMETHING was studied. */
  streak: number
}

export interface WeeklyInput {
  now: Date
  sessions: readonly StudySessionRow[]
  progress: readonly LibraryProgressRow[]
  reviewLog: readonly ReviewLogRow[]
  chapterLog: readonly ChapterLogRow[]
  attempts: readonly FeynmanAttemptRow[]
  days?: number
}

/**
 * A day counts towards the streak if ANY of the four kinds of study happened on
 * it — a session, a unit opened, a card graded or a chapter rated.
 *
 * Deliberately wider than the Trainer's own streak, which counts a day on which
 * the review queue was emptied (`src/lib/srs/day.ts#currentStreak`). That is a
 * claim about finishing; this is a claim about turning up, and the two are
 * different questions a reader asks on different screens.
 */
export function studyStreak(input: Omit<WeeklyInput, 'days'>): number {
  const active = new Set<IstDay>()
  const add = (at: string) => {
    try {
      active.add(istDay(at))
    } catch {
      // An unreadable timestamp contributes nothing rather than throwing out of
      // a screen whose whole job is to summarise. Every row here comes from
      // IndexedDB, which is untrusted input like any other store.
    }
  }
  for (const session of input.sessions) if (session.endedAt) add(session.endedAt)
  for (const row of input.progress) add(row.at)
  for (const row of input.reviewLog) add(row.at)
  for (const row of input.chapterLog) add(row.at)
  for (const row of input.attempts) add(row.at)

  /*
    The walk starts from YESTERDAY when today has not been studied yet, which
    is the rule `src/lib/srs/day.ts#currentStreak` already follows one directory
    over.

    Starting from today unconditionally looked more conservative and was not: a
    reader with thirty consecutive days saw 0 on this screen every morning until
    they opened something, while `/learn` showed 30 at the same moment — two
    screens of one app contradicting each other about one reader for most of
    every day. The screen already says "nothing studied today yet" on its own
    line, so one number never had to carry both facts.
  */
  const today = istDay(input.now)
  let day = active.has(today) ? today : addIstDays(today, -1)
  let streak = 0
  while (active.has(day)) {
    streak += 1
    day = addIstDays(day, -1)
  }
  return streak
}

export function weeklyReview(input: WeeklyInput): WeeklyReview {
  const days = input.days ?? WEEK_DAYS
  const from = windowStart(input.now, days)
  const fromInstant = istDayStart(from).toISOString()

  const minutesByWork: Record<string, number> = {}
  let minutes = 0
  for (const session of input.sessions) {
    // An unended session has not produced a figure yet: `endSession` is what
    // writes `minutes`, and counting a running session here would make the
    // total move while the reader watched it.
    if (!session.endedAt || !within(session.endedAt, fromInstant)) continue
    minutes += session.minutes
    minutesByWork[session.workId] = (minutesByWork[session.workId] ?? 0) + session.minutes
  }

  return {
    from,
    to: istDay(input.now),
    minutes,
    minutesByWork,
    unitsRead: input.progress.filter((row) => within(row.at, fromInstant)).length,
    cardsReviewed: input.reviewLog.filter((row) => within(row.at, fromInstant)).length,
    chaptersRevised: input.chapterLog.filter((row) => within(row.at, fromInstant)).length,
    feynmanAttempts: input.attempts.filter((row) => within(row.at, fromInstant)).length,
    streak: studyStreak(input),
  }
}

/* ------------------------------------------------------------------ *
 * Goals
 * ------------------------------------------------------------------ */

export interface GoalProgress {
  workId: string
  minutesTarget: number | null
  minutesDone: number
  unitsTarget: number | null
  unitsDone: number
  /** 0-1 over whichever targets the goal actually sets. `null` when it sets none. */
  fraction: number | null
  met: boolean
}

/**
 * How a week is going against one work's goal.
 *
 * `fraction` averages only the targets that were SET. A goal of "180 minutes a
 * week" with no unit target must not read as half done because the units half
 * of a target nobody asked for is empty.
 */
export function goalProgress(
  goal: StudyGoalRow,
  review: WeeklyReview,
  unitsReadInWork: number,
): GoalProgress {
  const minutesTarget = goal.minutesPerWeek && goal.minutesPerWeek > 0 ? goal.minutesPerWeek : null
  const unitsTarget = goal.unitsPerWeek && goal.unitsPerWeek > 0 ? goal.unitsPerWeek : null
  const minutesDone = review.minutesByWork[goal.id] ?? 0

  const parts: number[] = []
  if (minutesTarget) parts.push(Math.min(1, minutesDone / minutesTarget))
  if (unitsTarget) parts.push(Math.min(1, unitsReadInWork / unitsTarget))

  return {
    workId: goal.id,
    minutesTarget,
    minutesDone,
    unitsTarget,
    unitsDone: unitsReadInWork,
    fraction: parts.length === 0 ? null : parts.reduce((a, b) => a + b, 0) / parts.length,
    met:
      (minutesTarget === null || minutesDone >= minutesTarget) &&
      (unitsTarget === null || unitsReadInWork >= unitsTarget) &&
      parts.length > 0,
  }
}

/* ------------------------------------------------------------------ *
 * The coverage heat-map
 * ------------------------------------------------------------------ */

export interface UnitCoverage {
  unitId: string
  read: boolean
  /** The reader said so, rather than merely having opened it. */
  markedRead: boolean
  annotated: boolean
  quizzed: boolean
  /** 0-3. What the heat-map paints. */
  depth: number
}

export interface CoverageInput {
  unitIds: readonly string[]
  progress: readonly LibraryProgressRow[]
  highlights: readonly LibraryHighlightRow[]
  notes: readonly LibraryNoteRow[]
  /** Card id → the unit its `ruleRef.textId` names. Built by the caller. */
  cardUnits: ReadonlyMap<string, string>
  reviewLog: readonly ReviewLogRow[]
}

/**
 * Read / annotated / quizzed, per unit.
 *
 * Three independent facts rather than a single score, because they are three
 * different kinds of engagement and collapsing them would hide the one an
 * officer preparing for an examination most needs to see: the rules they have
 * read and never once been asked about.
 */
export function coverageOf(input: CoverageInput): UnitCoverage[] {
  const read = new Set<string>()
  const markedRead = new Set<string>()
  for (const row of input.progress) {
    read.add(row.unitId)
    if (row.markedReadAt) markedRead.add(row.unitId)
  }

  const annotated = new Set<string>()
  for (const row of input.highlights) annotated.add(row.unitId)
  for (const row of input.notes) annotated.add(row.unitId)

  const quizzed = new Set<string>()
  for (const row of input.reviewLog) {
    const unit = input.cardUnits.get(row.qId)
    if (unit) quizzed.add(unit)
  }

  return input.unitIds.map((unitId) => {
    const flags = {
      read: read.has(unitId),
      markedRead: markedRead.has(unitId),
      annotated: annotated.has(unitId),
      quizzed: quizzed.has(unitId),
    }
    return {
      unitId,
      ...flags,
      depth: Number(flags.read) + Number(flags.annotated) + Number(flags.quizzed),
    }
  })
}

export interface CoverageSummary {
  total: number
  read: number
  markedRead: number
  annotated: number
  quizzed: number
  /** Read but never quizzed — the gap an examination candidate cares about. */
  readNotQuizzed: number
  untouched: number
}

export function summariseCoverage(units: readonly UnitCoverage[]): CoverageSummary {
  return {
    total: units.length,
    read: units.filter((unit) => unit.read).length,
    markedRead: units.filter((unit) => unit.markedRead).length,
    annotated: units.filter((unit) => unit.annotated).length,
    quizzed: units.filter((unit) => unit.quizzed).length,
    readNotQuizzed: units.filter((unit) => unit.read && !unit.quizzed).length,
    untouched: units.filter((unit) => unit.depth === 0).length,
  }
}
