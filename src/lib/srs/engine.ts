import {
  createEmptyCard,
  fsrs,
  Rating,
  State,
  type Card as FsrsCard,
  type FSRS,
  type Grade as FsrsGrade,
} from 'ts-fsrs'

import {
  MAX_DESIRED_RETENTION,
  MIN_DESIRED_RETENTION,
  type Grade,
  type ReviewLogRow,
  type SrsCardRow,
  type SrsState,
} from './types'

/**
 * The scheduler. Pure: no React, no Dexie, no dataset, no clock of its own —
 * every function here is told what time it is.
 *
 * This is a thin, deliberate layer over `ts-fsrs`. It exists to do four things
 * the library does not do for us:
 *
 *  1. translate between the library's working `Card` and the plain JSON row
 *     that goes on the device (`types.ts` says why the row is plain);
 *  2. write the review log at the moment the state is still the pre-review one,
 *     because retention is not recoverable afterwards;
 *  3. hold `request_retention` where the reader's setting can reach it;
 *  4. keep fuzz off — see below.
 *
 * ## Fuzz is off, on purpose
 *
 * FSRS can scatter each interval by a few per cent so that a large collection's
 * daily load flattens out. Sahayak turns it off. The cost of leaving it on is
 * that the same card, graded the same way at the same instant, gets a different
 * due date on each run — which makes the export/import round trip untestable,
 * makes a golden schedule impossible to assert, and makes two devices holding
 * the same review history disagree about the schedule. The benefit it buys is
 * load balancing across a collection of tens of thousands of cards; the whole
 * served corpus here is 571. Determinism is worth more than that.
 */

/** The four grades, as ts-fsrs numbers. `Rating.Manual` is never produced. */
const RATING: Record<Grade, FsrsGrade> = {
  Again: Rating.Again,
  Hard: Rating.Hard,
  Good: Rating.Good,
  Easy: Rating.Easy,
}

const STATE_NAME: Record<State, SrsState> = {
  [State.New]: 'new',
  [State.Learning]: 'learning',
  [State.Review]: 'review',
  [State.Relearning]: 'relearning',
}

const STATE_VALUE: Record<SrsState, State> = {
  new: State.New,
  learning: State.Learning,
  review: State.Review,
  relearning: State.Relearning,
}

const iso = (at: Date): string => at.toISOString()

/**
 * A reader's setting arrives from IndexedDB, which is untrusted input like any
 * other stored row, and FSRS throws outside `(0, 1]`. Clamped rather than
 * rejected: a corrupt settings row must not make the trainer unopenable.
 */
export const clampRetention = (value: number): number =>
  Number.isFinite(value) ? Math.min(MAX_DESIRED_RETENTION, Math.max(MIN_DESIRED_RETENTION, value)) : 0.9

/**
 * One `FSRS` instance per retention, built once. The instance is immutable and
 * holds no per-card state, so sharing it across calls is safe; building one per
 * grade would re-derive the interval modifier on every button press.
 */
const schedulers = new Map<number, FSRS>()

function schedulerFor(desiredRetention: number): FSRS {
  const retention = clampRetention(desiredRetention)
  let scheduler = schedulers.get(retention)
  if (!scheduler) {
    scheduler = fsrs({ request_retention: retention, enable_fuzz: false })
    schedulers.set(retention, scheduler)
  }
  return scheduler
}

function toFsrsCard(row: SrsCardRow): FsrsCard {
  const card: FsrsCard = {
    due: new Date(row.due),
    stability: row.stability,
    difficulty: row.difficulty,
    elapsed_days: row.elapsed,
    scheduled_days: row.scheduled,
    learning_steps: row.learningSteps,
    reps: row.reps,
    lapses: row.lapses,
    state: STATE_VALUE[row.state],
  }
  if (row.lastReview) card.last_review = new Date(row.lastReview)
  return card
}

function toRow(qId: string, card: FsrsCard, lastGrade: Grade | null): SrsCardRow {
  return {
    qId,
    due: iso(card.due),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed: card.elapsed_days,
    scheduled: card.scheduled_days,
    reps: card.reps,
    lapses: card.lapses,
    state: STATE_NAME[card.state],
    lastReview: card.last_review ? iso(card.last_review) : null,
    lastGrade,
    learningSteps: card.learning_steps,
  }
}

/**
 * A card the reader has never seen. Due immediately: a new card is not waiting
 * for a date, it is waiting for the reader, and `queue.ts` is what decides how
 * many of them the day may have.
 */
export const createCard = (qId: string, now: Date): SrsCardRow => toRow(qId, createEmptyCard(now), null)

/**
 * What FSRS believes the chance of recall is, right now.
 *
 * Null for a card in `new` state: retrievability is a function of a memory, and
 * a card that has never been graded has not made one. FSRS would answer 0,
 * which is a different claim — "certainly forgotten" rather than "never learnt"
 * — and averaging that into a retention figure drags it towards nothing.
 */
export function retrievability(row: SrsCardRow, now: Date, desiredRetention = 0.9): number | null {
  if (row.state === 'new' || row.reps === 0) return null
  return schedulerFor(desiredRetention).get_retrievability(toFsrsCard(row), now, false)
}

export interface GradeOptions {
  /** The reader's `desiredRetention`. Clamped; see `clampRetention`. */
  desiredRetention?: number
  /** Card shown to grade pressed. Recorded, never used for scheduling. */
  durationMs?: number
}

export interface GradeResult {
  card: SrsCardRow
  log: ReviewLogRow
}

/**
 * Grade a card, and produce both the new schedule and the log entry.
 *
 * The two come back together because they cannot be derived from one another:
 * the log records the state the card was in when the reader was asked, and
 * grading destroys it. `store.ts` writes both in one transaction.
 *
 * `Again` on a card in `review` sends it to `relearning` with a step measured
 * in minutes and increments `lapses` — that is FSRS's own rescheduling of a
 * lapse, and nothing here second-guesses it.
 *
 * A `now` earlier than the card's own last review is clamped forward to it. A
 * device clock that has gone backwards should not be able to hand FSRS a
 * negative elapsed time.
 */
export function gradeCard(row: SrsCardRow, grade: Grade, now: Date, options: GradeOptions = {}): GradeResult {
  const lastReview = row.lastReview ? Date.parse(row.lastReview) : null
  const at = lastReview !== null && now.getTime() < lastReview ? new Date(lastReview) : now

  const scheduler = schedulerFor(options.desiredRetention ?? 0.9)
  const before = toFsrsCard(row)
  const predicted = retrievability(row, at, options.desiredRetention ?? 0.9)

  const { card, log } = scheduler.next(before, at, RATING[grade])
  const next = toRow(row.qId, card, grade)

  return {
    card: next,
    log: {
      // `reps` is post-increment and unique per card, so the id is stable
      // across an export and an import and can never collide with itself.
      id: `${row.qId}#${next.reps}#${iso(at)}`,
      qId: row.qId,
      grade,
      at: iso(at),
      durationMs: Math.max(0, Math.round(options.durationMs ?? 0)),
      stateBefore: row.state,
      elapsed: log.elapsed_days,
      retrievability: predicted,
    },
  }
}

/**
 * What each of the four buttons would do, without doing it — for the "1m / 8m /
 * 3d / 12d" hints printed on the grade buttons.
 */
export function previewGrades(row: SrsCardRow, now: Date, desiredRetention = 0.9): Record<Grade, SrsCardRow> {
  return {
    Again: gradeCard(row, 'Again', now, { desiredRetention }).card,
    Hard: gradeCard(row, 'Hard', now, { desiredRetention }).card,
    Good: gradeCard(row, 'Good', now, { desiredRetention }).card,
    Easy: gradeCard(row, 'Easy', now, { desiredRetention }).card,
  }
}
