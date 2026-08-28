import { z } from 'zod'

import { isIstDay } from './day'
import { compareStrings, DEFAULT_TRAINER_SETTINGS, GRADES } from './types'

import type { ReviewLogRow, SrsCardRow, StreakRow, TrainerSettings } from './types'

/**
 * Backup and restore for everything the Trainer knows about a reader.
 *
 * ADR-001 accepted, at the time, that "clearing browser data destroys user
 * state" and recorded that "a backup/export feature is owed". This is that
 * feature for the Trainer's four tables. It is also the only way two devices
 * can ever share a review history, because there is no account and no server —
 * a fact this file has to take seriously rather than route around, which is why
 * the merge below is symmetric and idempotent instead of a plain overwrite.
 *
 * The file is plain JSON. It contains schedule state and a review log; it
 * contains no card text, because the cards are in the build.
 */

/** Bump only for a shape change an older reader could not read. */
export const TRAINER_EXPORT_VERSION = 1

/**
 * An instant, in exactly the form `Date.prototype.toISOString` produces.
 *
 * The round trip is the check, and a looser one is not good enough for two
 * separate reasons. JavaScript's date parser is lenient about an overflowing
 * day of the month, so `2026-02-31T00:00:00.000Z` parses — as the 3rd of March
 * — and a plain `Date.parse` test would wave it through under a date that does
 * not exist. And `reviewLog.at` is a Dexie **index** that `store.ts` range-
 * queries on: IndexedDB compares strings by code unit, so lexicographic order
 * is chronological order only while every value has this one shape. A row
 * written as `2026-03-02T09:00:00Z`, or with a `+05:30` offset, would sort into
 * the wrong place and quietly fall outside the day it belongs to.
 *
 * Every timestamp this app writes comes from `toISOString()`, so the only file
 * this rejects is one that was edited by hand.
 */
const isoInstant = z.string().refine((value) => {
  const at = new Date(value)
  return !Number.isNaN(at.getTime()) && at.toISOString() === value
}, 'not a canonical UTC instant')

/** A day that exists — see `day.ts#isIstDay` for why the pattern is not enough. */
const istDayString = z.string().refine(isIstDay, 'not a real calendar day')
const gradeSchema = z.enum(GRADES)
const stateSchema = z.enum(['new', 'learning', 'review', 'relearning'])

/**
 * `strictObject` throughout, for the reason ADR-016's addendum records: plain
 * `z.object` strips a key it does not know about, so a row written by a newer
 * release would come in silently missing a field and be reported by nothing.
 * An import is untrusted input — it is a file the reader chose off a disk.
 */
export const srsCardRowSchema = z.strictObject({
  qId: z.string().min(1),
  due: isoInstant,
  stability: z.number().finite(),
  difficulty: z.number().finite(),
  elapsed: z.number().finite(),
  scheduled: z.number().finite(),
  reps: z.number().int().min(0),
  lapses: z.number().int().min(0),
  state: stateSchema,
  lastReview: isoInstant.nullable(),
  lastGrade: gradeSchema.nullable(),
  learningSteps: z.number().int().min(0),
})

export const reviewLogRowSchema = z.strictObject({
  id: z.string().min(1),
  qId: z.string().min(1),
  grade: gradeSchema,
  at: isoInstant,
  durationMs: z.number().int().min(0),
  stateBefore: stateSchema,
  elapsed: z.number().finite(),
  retrievability: z.number().min(0).max(1).nullable(),
})

export const streakRowSchema = z.strictObject({
  date: istDayString,
  reviewed: z.number().int().min(0),
  goalMet: z.boolean(),
})

export const trainerSettingsSchema = z.strictObject({
  dailyNew: z.number().int().min(0),
  dailyReviewCap: z.number().int().min(0),
  desiredRetention: z.number().gt(0).lte(1),
  actsEnabled: z.array(z.string().min(1)),
})

export const trainerExportSchema = z.strictObject({
  app: z.literal('sahayak'),
  kind: z.literal('trainer'),
  version: z.number().int().min(1),
  exportedAt: isoInstant,
  srsCards: z.array(srsCardRowSchema),
  reviewLog: z.array(reviewLogRowSchema),
  streaks: z.array(streakRowSchema),
  trainerSettings: trainerSettingsSchema,
})

export type TrainerExport = z.infer<typeof trainerExportSchema>

/** The four tables, without the envelope. */
export interface TrainerData {
  srsCards: SrsCardRow[]
  reviewLog: ReviewLogRow[]
  streaks: StreakRow[]
  trainerSettings: TrainerSettings
}

// ------------------------------------------------------------------- ordering

/**
 * Every list is sorted before it is written, and that is load-bearing rather
 * than tidy: a round trip has to come back **equal**, and Dexie makes no promise
 * about the order a `toArray()` comes back in.
 */
export function sortTrainerData(data: TrainerData): TrainerData {
  return {
    srsCards: [...data.srsCards].sort((a, b) => compareStrings(a.qId, b.qId)),
    reviewLog: [...data.reviewLog].sort((a, b) => compareStrings(a.at, b.at) || compareStrings(a.id, b.id)),
    streaks: [...data.streaks].sort((a, b) => compareStrings(a.date, b.date)),
    trainerSettings: data.trainerSettings,
  }
}

export function buildExport(data: TrainerData, exportedAt: Date): TrainerExport {
  return {
    app: 'sahayak',
    kind: 'trainer',
    version: TRAINER_EXPORT_VERSION,
    exportedAt: exportedAt.toISOString(),
    ...sortTrainerData(data),
  }
}

// ---------------------------------------------------------------------- merge

/** When a card was last graded. Never graded sorts before every real review. */
const lastReviewMs = (row: SrsCardRow): number =>
  row.lastReview === null ? Number.NEGATIVE_INFINITY : Date.parse(row.lastReview)

/**
 * Merge an incoming backup into what is on the device.
 *
 * Pure, symmetric in effect and idempotent: importing the same file twice
 * changes nothing the second time, and importing A into B gives the same result
 * as importing B into A. That is what makes this usable as the only sync two
 * devices will ever have.
 *
 *  - **`srsCards`, by `qId`: the later review wins.** Not "the later export" —
 *    a device exported yesterday can still hold the newer review of a
 *    particular card, and a whole-file precedence would throw it away. A tie on
 *    the timestamp is broken by `reps`, so a card graded twice in the same
 *    millisecond keeps the longer history; a tie on both keeps what is on the
 *    device, so an import is never gratuitously destructive.
 *  - **`reviewLog`, by `id`: union.** The log is append-only evidence, and the
 *    id is `<qId>#<reps>#<at>`, so the same review carries the same id on both
 *    devices and cannot be double-counted.
 *  - **`streaks`, by `date`: the higher count, and `goalMet` if either met it.**
 *    A day's work done across two devices was still that day's work.
 *  - **`trainerSettings`: the incoming file wins.** Settings are a preference,
 *    not a history; a reader importing a backup is asking for the settings in
 *    it. There is nothing in a settings row to merge.
 */
export function mergeTrainerData(current: TrainerData, incoming: TrainerData): TrainerData {
  const cards = new Map(current.srsCards.map((row) => [row.qId, row]))
  for (const row of incoming.srsCards) {
    const held = cards.get(row.qId)
    if (!held) {
      cards.set(row.qId, row)
      continue
    }
    const delta = lastReviewMs(row) - lastReviewMs(held)
    if (delta > 0 || (delta === 0 && row.reps > held.reps)) cards.set(row.qId, row)
  }

  const logs = new Map(current.reviewLog.map((row) => [row.id, row]))
  for (const row of incoming.reviewLog) if (!logs.has(row.id)) logs.set(row.id, row)

  const streaks = new Map(current.streaks.map((row) => [row.date, row]))
  for (const row of incoming.streaks) {
    const held = streaks.get(row.date)
    streaks.set(
      row.date,
      held
        ? {
            date: row.date,
            reviewed: Math.max(held.reviewed, row.reviewed),
            goalMet: held.goalMet || row.goalMet,
          }
        : row,
    )
  }

  return sortTrainerData({
    srsCards: [...cards.values()],
    reviewLog: [...logs.values()],
    streaks: [...streaks.values()],
    trainerSettings: incoming.trainerSettings,
  })
}

export class TrainerImportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TrainerImportError'
  }
}

/**
 * Parse a file the reader chose. Throws `TrainerImportError` with a sentence a
 * UI can print — never a raw zod issue tree, and never a partial object.
 */
export function parseTrainerExport(input: unknown): TrainerExport {
  const value = typeof input === 'string' ? safeParseJson(input) : input
  const parsed = trainerExportSchema.safeParse(value)

  if (!parsed.success) {
    const first = parsed.error.issues[0]
    const at = first && first.path.length > 0 ? ` at ${first.path.join('.')}` : ''
    throw new TrainerImportError(`This is not a Sahayak trainer backup${at}.`)
  }
  if (parsed.data.version > TRAINER_EXPORT_VERSION) {
    throw new TrainerImportError(
      `This backup was written by a newer version of Sahayak (format ${parsed.data.version}).`,
    )
  }
  return parsed.data
}

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    throw new TrainerImportError('This file is not valid JSON.')
  }
}

/** The tables an empty device holds — the identity element for the merge. */
export const emptyTrainerData = (): TrainerData => ({
  srsCards: [],
  reviewLog: [],
  streaks: [],
  trainerSettings: { ...DEFAULT_TRAINER_SETTINGS },
})
