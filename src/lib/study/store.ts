import { chapterIdFor, createChapterCard, rateChapter } from './chapters'
import { normaliseGrades, type FeynmanGrade } from './feynman'
import { clampPomodoro, endSession, type PomodoroConfig } from './sessions'
import type {
  Chapter,
  ChapterCardRow,
  ChapterLogRow,
  Confidence,
  FeynmanAttemptRow,
  StudyGoalRow,
  StudySessionRow,
} from './types'

import { db } from '@/db'

/**
 * The study layer's storage — the ONE file in `src/lib/study` that opens the
 * database, the split `src/lib/srs` and `src/lib/library` both draw.
 *
 * Nothing here leaves the device. A row is a work id, a node id, a timestamp
 * and a number — plus, in one place, the reader's own writing, which is the
 * most identifying thing in this app and is exactly why it is in IndexedDB and
 * nowhere else.
 */

const iso = (at: Date): string => at.toISOString()

/* ------------------------------------------------------------------ *
 * The chapter deck
 * ------------------------------------------------------------------ */

export const chapterCardsFor = (workId: string): Promise<ChapterCardRow[]> =>
  db.chapterCards.where('workId').equals(workId).toArray()

export const allChapterCards = (): Promise<ChapterCardRow[]> => db.chapterCards.toArray()

export const chapterLogFor = (workId: string): Promise<ChapterLogRow[]> =>
  db.chapterLog.where('workId').equals(workId).toArray()

export const allChapterLog = (): Promise<ChapterLogRow[]> => db.chapterLog.toArray()

export interface RateChapterInput {
  chapter: Chapter
  confidence: Confidence
  reason?: ChapterLogRow['reason']
  desiredRetention?: number
  now?: Date
}

/**
 * Record a confidence rating on a chapter, and reschedule it.
 *
 * The card and the log are written in ONE transaction, for the reason
 * `src/lib/srs/store.ts#reviewCard` gives: the log records the state the card
 * was in when the reader was asked, and a half-written pair would leave a
 * schedule with no evidence behind it.
 *
 * A chapter with no card yet gets one here rather than at read time — creating
 * it on arrival would fill the table with rows for chapters nobody has rated.
 */
export async function rateChapterCard(input: RateChapterInput): Promise<ChapterCardRow> {
  const now = input.now ?? new Date()
  const id = chapterIdFor(input.chapter.workId, input.chapter.nodeId)

  return db.transaction('rw', db.chapterCards, db.chapterLog, async () => {
    const existing = (await db.chapterCards.get(id)) ?? createChapterCard(input.chapter, now)
    const { card, log } = rateChapter(existing, input.confidence, now, {
      ...(input.reason ? { reason: input.reason } : {}),
      ...(input.desiredRetention === undefined ? {} : { desiredRetention: input.desiredRetention }),
    })
    await db.chapterCards.put(card)
    await db.chapterLog.put(log)
    return card
  })
}

/** Drop one chapter's schedule and its history — the "start this chapter again" action. */
export async function forgetChapter(cardId: string): Promise<void> {
  await db.transaction('rw', db.chapterCards, db.chapterLog, async () => {
    await db.chapterCards.delete(cardId)
    const logs = await db.chapterLog.where('cardId').equals(cardId).primaryKeys()
    await db.chapterLog.bulkDelete(logs)
  })
}

/* ------------------------------------------------------------------ *
 * Feynman attempts
 * ------------------------------------------------------------------ */

export const attemptsFor = (workId: string, unitId: string): Promise<FeynmanAttemptRow[]> =>
  db.feynmanAttempts.where('[workId+unitId]').equals([workId, unitId]).toArray()

export const attemptsInWork = (workId: string): Promise<FeynmanAttemptRow[]> =>
  db.feynmanAttempts.where('workId').equals(workId).toArray()

export const allAttempts = (): Promise<FeynmanAttemptRow[]> => db.feynmanAttempts.toArray()

export interface SaveAttemptInput {
  workId: string
  unitId: string
  body: string
  grades: readonly FeynmanGrade[]
  comment?: string
  now?: Date
}

/**
 * Store one attempt. Returns `null` for an empty one rather than writing a row
 * nobody wrote — the same posture `saveNote` takes in the annotations layer.
 *
 * The body is stored EXACTLY as typed. It is never trimmed into shape, never
 * normalised, and never sent anywhere.
 */
export async function saveAttempt(input: SaveAttemptInput): Promise<FeynmanAttemptRow | null> {
  if (!input.body.trim()) return null
  const now = input.now ?? new Date()
  const row: FeynmanAttemptRow = {
    id: `${input.workId}:${input.unitId}:${now.getTime().toString(36)}`,
    workId: input.workId,
    unitId: input.unitId,
    body: input.body,
    grades: normaliseGrades(input.grades),
    at: iso(now),
    ...(input.comment ? { comment: input.comment } : {}),
  }
  await db.feynmanAttempts.put(row)
  return row
}

export const deleteAttempt = (id: string): Promise<void> => db.feynmanAttempts.delete(id)

/* ------------------------------------------------------------------ *
 * Sessions
 * ------------------------------------------------------------------ */

export const allSessions = (): Promise<StudySessionRow[]> => db.studySessions.toArray()

/** The session that is still running, or `null`. There is at most one. */
export async function runningSession(): Promise<StudySessionRow | null> {
  const rows = await db.studySessions.toArray()
  const open = rows.filter((row) => row.endedAt === null)
  if (open.length === 0) return null
  // Newest wins. More than one open row means a previous tab was closed without
  // ending its session; the older ones are closed below rather than left to
  // accumulate, because `runningSession` is what the timer renders from.
  return open.reduce((latest, row) => (row.startedAt > latest.startedAt ? row : latest))
}

export interface StartSessionInput {
  workId: string
  nodeId?: string | null
  mode: StudySessionRow['mode']
  config?: PomodoroConfig
  now?: Date
}

/**
 * Start a session, closing any that was left running.
 *
 * Closing the old one is not tidying: a session with no end never enters the
 * weekly review (`weeklyReview` counts ended sessions only), so a reader who
 * closed a tab last week would otherwise lose that time entirely AND see a
 * timer claiming to have been running for days.
 */
export async function startSession(input: StartSessionInput): Promise<StudySessionRow> {
  const now = input.now ?? new Date()
  const config = clampPomodoro(input.config)

  return db.transaction('rw', db.studySessions, async () => {
    for (const row of await db.studySessions.filter((session) => session.endedAt === null).toArray()) {
      const { row: closed, keep } = endSession(row, now, config)
      if (keep) await db.studySessions.put(closed)
      else await db.studySessions.delete(row.id)
    }

    const row: StudySessionRow = {
      id: `${input.workId}:${now.getTime().toString(36)}`,
      workId: input.workId,
      nodeId: input.nodeId ?? null,
      mode: input.mode,
      startedAt: iso(now),
      endedAt: null,
      minutes: 0,
      pomodoros: 0,
    }
    await db.studySessions.put(row)
    return row
  })
}

/** Stop a session. `null` when it produced under a minute and was discarded. */
export async function stopSession(
  id: string,
  now = new Date(),
  config?: PomodoroConfig,
): Promise<StudySessionRow | null> {
  const row = await db.studySessions.get(id)
  if (!row || row.endedAt !== null) return null
  const { row: closed, keep } = endSession(row, now, clampPomodoro(config))
  if (!keep) {
    await db.studySessions.delete(id)
    return null
  }
  await db.studySessions.put(closed)
  return closed
}

/* ------------------------------------------------------------------ *
 * Goals
 * ------------------------------------------------------------------ */

export const allGoals = (): Promise<StudyGoalRow[]> => db.studyGoals.toArray()

export const goalFor = (workId: string): Promise<StudyGoalRow | undefined> => db.studyGoals.get(workId)

/**
 * Save a goal, or delete it where it now asks for nothing.
 *
 * A goal with no minutes and no units is not stored as a row of zeroes: it
 * would appear on the weekly review as a target that can never be met, and
 * clearing both fields is how a reader says they no longer want one.
 */
export async function saveGoal(
  workId: string,
  patch: { minutesPerWeek?: number | null; unitsPerWeek?: number | null },
  now = new Date(),
): Promise<StudyGoalRow | null> {
  const clean = (value: number | null | undefined): number | undefined => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
    const rounded = Math.round(value)
    return rounded > 0 ? rounded : undefined
  }
  const minutesPerWeek = clean(patch.minutesPerWeek)
  const unitsPerWeek = clean(patch.unitsPerWeek)

  if (minutesPerWeek === undefined && unitsPerWeek === undefined) {
    await db.studyGoals.delete(workId)
    return null
  }

  const row: StudyGoalRow = {
    id: workId,
    ...(minutesPerWeek === undefined ? {} : { minutesPerWeek }),
    ...(unitsPerWeek === undefined ? {} : { unitsPerWeek }),
    updatedAt: iso(now),
  }
  await db.studyGoals.put(row)
  return row
}
