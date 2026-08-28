import { istDay, istDayEnd, istDayStart } from './day'
import { createCard, gradeCard } from './engine'
import { buildQueue, dueCount, dueLaterToday, usageForDay } from './queue'
import { dayStats, weakAreas } from './stats'
import {
  buildExport,
  emptyTrainerData,
  mergeTrainerData,
  parseTrainerExport,
  sortTrainerData,
  trainerSettingsSchema,
  type TrainerData,
  type TrainerExport,
} from './transfer'
import { DEFAULT_TRAINER_SETTINGS, TRAINER_SETTINGS_ID } from './types'

import { db } from '@/db'

import type { IstDay } from './day'
import type { DayStats, WeakArea, WeakAreaInput } from './stats'
import type { Grade, QueueItem, ReviewLogRow, SrsCardRow, StreakRow, TrainerSettings } from './types'
import type { Card } from '@/modules/trainer/schema'

/**
 * The Dexie half. Every function above this file is pure; this is the only one
 * that touches storage, and it does so on the device and nowhere else.
 *
 * ## Why the catalogue is an argument, everywhere
 *
 * Nothing here imports `data/rules`. It is ~4 MB and belongs behind the
 * Trainer route's lazy import, exactly as the statute and the pay tables are
 * (ADR-013, ADR-018) — importing it in `src/lib/srs` would put it into whatever
 * chunk imports the scheduler. So every function that needs to know which act a
 * card belongs to, or whether it is approved, takes the cards it is to work
 * over. The caller has them already; it just showed one to the reader.
 *
 * There is no React in this directory, and `src/lib/srs/purity.test.ts` asserts
 * it. A hook over these functions belongs in `src/modules/trainer`.
 */

// ------------------------------------------------------------------- settings

/**
 * A settings row is untrusted input — it was written by whatever release the
 * reader last ran. Anything that does not parse falls back to the default for
 * that field rather than making the Trainer unopenable.
 */
export async function loadSettings(): Promise<TrainerSettings> {
  const row = await db.trainerSettings.get(TRAINER_SETTINGS_ID)
  if (!row) return { ...DEFAULT_TRAINER_SETTINGS }

  // Field by field rather than a rest spread: the schema is `strictObject`, so
  // the row's own `id` would be rejected along with anything else it carries.
  const parsed = trainerSettingsSchema.safeParse({
    dailyNew: row.dailyNew,
    dailyReviewCap: row.dailyReviewCap,
    desiredRetention: row.desiredRetention,
    actsEnabled: row.actsEnabled,
  })
  return parsed.success ? parsed.data : { ...DEFAULT_TRAINER_SETTINGS }
}

export async function saveSettings(patch: Partial<TrainerSettings>): Promise<TrainerSettings> {
  const next = { ...(await loadSettings()), ...patch }
  const parsed = trainerSettingsSchema.safeParse(next)
  const settings = parsed.success ? parsed.data : { ...DEFAULT_TRAINER_SETTINGS }

  await db.trainerSettings.put({ id: TRAINER_SETTINGS_ID, ...settings })
  return settings
}

// ---------------------------------------------------------------------- queue

const statesByQId = async (): Promise<Map<string, SrsCardRow>> =>
  new Map((await db.srsCards.toArray()).map((row) => [row.qId, row]))

/**
 * The day's queue: due reviews first, then new cards up to `dailyNew`.
 *
 * `acts` overrides `actsEnabled` for this call; omitting both means every act
 * in the catalogue. Only the current IST day's log is read, because that is all
 * the two caps depend on.
 */
export async function getDueQueue(
  catalogue: readonly Card[],
  now: Date,
  acts?: readonly string[],
): Promise<QueueItem[]> {
  const [settings, states, logs] = await Promise.all([loadSettings(), statesByQId(), logsForDay(istDay(now))])

  return buildQueue({ cards: catalogue, states, now, settings, logs, ...(acts ? { acts } : {}) })
}

/** Cards due at `now`, ignoring both caps — the honest size of the backlog. */
export async function getDueCount(
  catalogue: readonly Card[],
  now: Date,
  acts?: readonly string[],
): Promise<number> {
  const states = await statesByQId()
  const enabled = acts ?? (await loadSettings()).actsEnabled
  return dueCount({ cards: catalogue, states, now, acts: enabled })
}

// --------------------------------------------------------------------- review

export interface ReviewInput {
  /** The cards the queue was built from — needed to decide the day is done. */
  catalogue: readonly Card[]
  qId: string
  grade: Grade
  now: Date
  /** Card shown to grade pressed. */
  durationMs?: number
}

export interface ReviewResult {
  card: SrsCardRow
  log: ReviewLogRow
  streak: StreakRow
  /** Cards the queue would offer right now, after the grade. */
  remaining: number
  /** Cards not due this second that come back before IST midnight. */
  pendingLater: number
}

/**
 * Grade a card, and write all three consequences in one transaction.
 *
 * The schedule row, the log row and the day's streak row are one fact about one
 * moment. Writing them separately would let a reload between two of the writes
 * leave a card rescheduled with no record of why, which is precisely the state
 * from which `stats.ts` cannot tell the truth.
 *
 * **`goalMet` is "the day's work is finished", not a card count.** There is no
 * arbitrary target in `TrainerSettings` and there should not be: the day's work
 * is what the schedule asked for, which is a different number every day. It is
 * met when nothing is due now *and* nothing more will fall due before IST
 * midnight — the second clause is what stops `Again` on the last card, which
 * puts it back in a minute, from being counted as a finished day.
 *
 * A reader who has spent `dailyReviewCap` has finished too, learning steps
 * pending or not: the cap is their own instruction about what a day means, and
 * a goal the reader has forbidden themselves to reach is not a goal.
 */
export async function reviewCard(input: ReviewInput): Promise<ReviewResult> {
  const { catalogue, qId, grade, now } = input
  const settings = await loadSettings()
  const day = istDay(now)

  return db.transaction('rw', db.srsCards, db.reviewLog, db.streaks, async () => {
    const existing = await db.srsCards.get(qId)
    const before = existing ?? createCard(qId, now)

    const { card, log } = gradeCard(before, grade, now, {
      desiredRetention: settings.desiredRetention,
      ...(input.durationMs === undefined ? {} : { durationMs: input.durationMs }),
    })

    await db.srsCards.put(card)
    await db.reviewLog.put(log)

    const states = new Map((await db.srsCards.toArray()).map((row) => [row.qId, row]))
    const logs = await logsForDay(day)
    const remaining = buildQueue({ cards: catalogue, states, now, settings, logs }).length
    // The same act scope the queue was built with. Without it, a card left on a
    // learning step in a book the reader has since switched away from holds the
    // day open for ever — the queue is empty, everything they asked for is
    // done, and the goal can never be met.
    const pendingLater = dueLaterToday({
      cards: catalogue,
      states,
      now,
      acts: settings.actsEnabled,
    })
    const capSpent = usageForDay(logs, now).reviewed >= settings.dailyReviewCap

    const held = await db.streaks.get(day)
    const streak: StreakRow = {
      date: day,
      reviewed: (held?.reviewed ?? 0) + 1,
      // Once a day's goal is met it stays met: a reader who clears the queue
      // and then chooses to keep going must not lose the day by turning up an
      // extra card that FSRS put back an hour later.
      goalMet: (held?.goalMet ?? false) || (remaining === 0 && (capSpent || pendingLater === 0)),
    }
    await db.streaks.put(streak)

    return { card, log, streak, remaining, pendingLater }
  })
}

/**
 * Put a card back to never-seen. The review log is **not** touched — it is
 * evidence, and `stats.ts` reports on what the reader actually did.
 */
export async function forgetCard(qId: string): Promise<void> {
  await db.srsCards.delete(qId)
}

// ---------------------------------------------------------------------- stats

/**
 * One IST day's reviews, off the `at` index.
 *
 * A range query rather than `toArray().filter(...)`, for two reasons that both
 * bite. `reviewLog` is append-only and grows for as long as the reader uses the
 * app — a year of ten cards a day is 3,650 rows, and the queue is rebuilt after
 * **every** grade, so the scan was reading the whole history to find the
 * handful of rows belonging to today. And the filter had to parse every stored
 * timestamp to do it, so a single unreadable `at` threw `RangeError` out of
 * `getDueQueue` and took the trainer with it — while the pure layer
 * (`usageForDay`, `dayStats`) tolerated the same row and carried on. A row
 * outside the range is now simply outside the range.
 *
 * This works because `transfer.ts` will not admit a timestamp that is not in
 * `toISOString` form: IndexedDB orders strings by code unit, which is
 * chronological order only while every value has the same shape.
 */
const logsForDay = (day: IstDay): Promise<ReviewLogRow[]> =>
  db.reviewLog
    .where('at')
    .between(istDayStart(day).toISOString(), istDayEnd(day).toISOString(), true, false)
    .toArray()

export async function statsForDay(
  catalogue: readonly Card[],
  now: Date,
  day?: IstDay,
  acts?: readonly string[],
): Promise<DayStats> {
  // One day off the index. `weakAreasFor` below is the query that genuinely
  // wants the whole history, and it is the only one.
  const [states, logs] = await Promise.all([statesByQId(), logsForDay(day ?? istDay(now))])
  return dayStats({
    cards: catalogue,
    states,
    logs,
    now,
    ...(day ? { day } : {}),
    ...(acts ? { acts } : {}),
  })
}

export async function weakAreasFor(
  catalogue: readonly Card[],
  options: Omit<WeakAreaInput, 'cards' | 'logs'> = {},
): Promise<WeakArea[]> {
  return weakAreas({ cards: catalogue, logs: await db.reviewLog.toArray(), ...options })
}

export const allStreaks = (): Promise<StreakRow[]> => db.streaks.toArray()

// ------------------------------------------------------------ export / import

const readAll = async (): Promise<TrainerData> =>
  sortTrainerData({
    srsCards: await db.srsCards.toArray(),
    reviewLog: await db.reviewLog.toArray(),
    streaks: await db.streaks.toArray(),
    trainerSettings: await loadSettings(),
  })

/** Everything the Trainer knows about this reader, as a plain JSON object. */
export const exportTrainer = async (exportedAt: Date): Promise<TrainerExport> =>
  buildExport(await readAll(), exportedAt)

export interface ImportSummary {
  cardsBefore: number
  cardsAfter: number
  /** Log rows the backup held that the device did not. */
  reviewsAdded: number
  streakDaysAfter: number
}

/**
 * Merge a backup into the device. Never a wholesale replace — see
 * `mergeTrainerData` for the per-table rules and why they are what they are.
 *
 * `payload` is whatever the reader handed us: a parsed object, or the text of
 * a file. It is validated before a single row is written.
 */
export async function importTrainer(payload: unknown): Promise<ImportSummary> {
  const incoming = parseTrainerExport(payload)

  return db.transaction(
    'rw',
    db.srsCards,
    db.reviewLog,
    db.streaks,
    db.trainerSettings,
    async (): Promise<ImportSummary> => {
      const current = await readAll()
      const merged = mergeTrainerData(current, {
        srsCards: incoming.srsCards,
        reviewLog: incoming.reviewLog,
        streaks: incoming.streaks,
        trainerSettings: incoming.trainerSettings,
      })

      // Cleared rather than bulk-put over: the merge has already decided what
      // survives, and a row the merge dropped must not linger underneath it.
      await Promise.all([db.srsCards.clear(), db.reviewLog.clear(), db.streaks.clear()])
      await db.srsCards.bulkPut(merged.srsCards)
      await db.reviewLog.bulkPut(merged.reviewLog)
      await db.streaks.bulkPut(merged.streaks)
      await db.trainerSettings.put({ id: TRAINER_SETTINGS_ID, ...merged.trainerSettings })

      return {
        cardsBefore: current.srsCards.length,
        cardsAfter: merged.srsCards.length,
        reviewsAdded: merged.reviewLog.length - current.reviewLog.length,
        streakDaysAfter: merged.streaks.length,
      }
    },
  )
}

/** "Start the Trainer over" — the schedule, the log and the streaks. */
export async function resetTrainer(): Promise<void> {
  await db.transaction('rw', db.srsCards, db.reviewLog, db.streaks, async () => {
    await Promise.all([db.srsCards.clear(), db.reviewLog.clear(), db.streaks.clear()])
  })
}

export { emptyTrainerData }
