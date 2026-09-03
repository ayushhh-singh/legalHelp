import type { FeynmanAttemptRow } from './types'

/**
 * The Feynman box: explain the rule in your own words, then read it back
 * against the text and mark yourself.
 *
 * There is NO MARKING here and there is not meant to be. What the reader wrote
 * is stored exactly as typed, and the three grades are their own answers to
 * three questions this file states. An automatic score would be a number about
 * string similarity dressed up as a number about understanding, and the AI tier
 * — where the reader has turned it on — adds one grounded COMMENT, never a mark.
 */

/**
 * The three prompts, in order, and the order `FeynmanAttemptRow.grades` is in.
 *
 * They are three because a statutory provision has three parts an officer has
 * to hold at once — what it requires, of whom, and where it stops — and because
 * self-assessment against one open question ("did you get it?") is worth
 * nothing. Splitting it is what makes "partial" a usable answer.
 */
export const FEYNMAN_PROMPTS = ['requires', 'appliesTo', 'limit'] as const
export type FeynmanPrompt = (typeof FEYNMAN_PROMPTS)[number]

export const FEYNMAN_GRADES = ['missed', 'partial', 'got-it'] as const
export type FeynmanGrade = (typeof FEYNMAN_GRADES)[number]

export const isFeynmanGrade = (value: unknown): value is FeynmanGrade =>
  typeof value === 'string' && (FEYNMAN_GRADES as readonly string[]).includes(value)

/**
 * A stored row is untrusted input like any other. A `grades` array of the wrong
 * length, or carrying a value this release does not know, is normalised to
 * `missed` rather than thrown away — an attempt is the reader's own writing and
 * losing it because a grade did not parse would be the wrong trade entirely.
 */
export function normaliseGrades(value: unknown): FeynmanGrade[] {
  const given = Array.isArray(value) ? value : []
  return FEYNMAN_PROMPTS.map((_, at) => (isFeynmanGrade(given[at]) ? given[at] : 'missed'))
}

/** An attempt with nothing written in it is not an attempt. */
export const isSubmittable = (body: string): boolean => body.trim().length >= 10

export interface FeynmanScore {
  /** 0-2 per prompt: missed 0, partial 1, got it 2. */
  points: number
  max: number
  /** How many prompts were marked `missed`. What the reader should re-read. */
  missed: FeynmanPrompt[]
}

const POINTS: Readonly<Record<FeynmanGrade, number>> = { missed: 0, partial: 1, 'got-it': 2 }

export function scoreAttempt(grades: readonly FeynmanGrade[]): FeynmanScore {
  const normalised = normaliseGrades(grades)
  return {
    points: normalised.reduce((total, grade) => total + POINTS[grade], 0),
    max: FEYNMAN_PROMPTS.length * 2,
    missed: FEYNMAN_PROMPTS.filter((_, at) => normalised[at] === 'missed'),
  }
}

/**
 * The confidence a self-graded attempt implies, for the chapter deck.
 *
 * Deliberately more conservative than `confidenceFromQuiz`: a quiz is evidence
 * and a self-grade is an opinion, so nothing here reaches 4. A reader who wants
 * to tell the deck they know a chapter cold can rate it directly.
 */
export function confidenceFromAttempt(grades: readonly FeynmanGrade[]): 1 | 2 | 3 {
  const { points, max } = scoreAttempt(grades)
  if (points >= max - 1) return 3
  if (points >= Math.ceil(max / 2)) return 2
  return 1
}

/** The most recent attempt on one unit, or `null`. Pure; the caller supplies the rows. */
export function latestAttempt(rows: readonly FeynmanAttemptRow[]): FeynmanAttemptRow | null {
  if (rows.length === 0) return null
  return rows.reduce((latest, row) => (row.at > latest.at ? row : latest))
}
