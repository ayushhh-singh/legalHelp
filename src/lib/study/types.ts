import type { ChapterCardRow, ChapterLogRow, FeynmanAttemptRow, StudyGoalRow, StudySessionRow } from '@/db'
import type { Grade } from '@/lib/srs'

/**
 * The study layer's vocabulary.
 *
 * `src/lib/study` is the second pure library in this app built over
 * `src/lib/srs`, and the rule it inherits is the one `src/lib/srs/purity.test.ts`
 * states: no React, no dataset import, no clock of its own, and storage in
 * `store.ts` alone. `study/purity.test.ts` asserts the same thing over this
 * directory, for the same reason — the first thing anyone writes over a library
 * like this is a hook.
 *
 * The row shapes themselves live in `src/db` beside every other stored shape and
 * are re-exported here as types, exactly as `src/lib/srs/types.ts` treats the
 * trainer's four tables.
 */
export type { ChapterCardRow, ChapterLogRow, FeynmanAttemptRow, StudyGoalRow, StudySessionRow }

/**
 * What a reader says after reading a chapter, and the FSRS grade it maps to.
 *
 * The brief asks for a 1-4 confidence rating, and 1-4 is exactly the shape of
 * FSRS's four grades — so this is a relabelling rather than a translation. What
 * the labels do is stop the reader having to think in the trainer's vocabulary:
 * "I could not use this" is a thing an officer can answer about a chapter they
 * have just read, and "Again" is not.
 */
export const CONFIDENCE_LEVELS = [1, 2, 3, 4] as const
export type Confidence = (typeof CONFIDENCE_LEVELS)[number]

/** 1 → Again, 2 → Hard, 3 → Good, 4 → Easy. In order, and total over 1-4. */
export const CONFIDENCE_GRADES: Readonly<Record<Confidence, Grade>> = {
  1: 'Again',
  2: 'Hard',
  3: 'Good',
  4: 'Easy',
}

/**
 * A value out of the address bar or out of a stored row is untrusted. Anything
 * that is not 1, 2, 3 or 4 is not clamped to the nearest — it is refused, and
 * the caller decides. Clamping a confidence would put a rating on the record
 * that the reader never gave.
 */
export const isConfidence = (value: unknown): value is Confidence =>
  value === 1 || value === 2 || value === 3 || value === 4

/** Why a chapter card was graded. Kept on the log so a rating stays explainable. */
export type ChapterGradeReason = ChapterLogRow['reason']

/** One chapter of one work, as the revision deck sees it. */
export interface Chapter {
  /** `"<workId>:<nodeId>"` — the `ChapterCardRow` primary key. */
  id: string
  workId: string
  nodeId: string
  number: string
  heading: { en: string; hi: string }
  /** Every unit under this node, flattened. Never empty. */
  unitIds: readonly string[]
}

/** A chapter that is due, with the row that says so. `null` for a new one. */
export interface DueChapter {
  chapter: Chapter
  card: ChapterCardRow | null
}
