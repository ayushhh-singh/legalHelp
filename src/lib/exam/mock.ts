import { cardsForUnit } from './coverage'
import { paperUnits, type PaperUnit } from './types'

import { compareStrings } from '@/lib/srs'
import type { ExamPaper, ExamProfile } from '@/schemas/exam'
import type { Card } from '@/modules/trainer/schema'

/**
 * Weighted mock papers: the draw, the answer sheet, and the marking.
 *
 * Pure and deterministic. A paper is a function of `(profile, paperId, seed,
 * catalogue, count)`, so a reader who reloads mid-paper gets the paper back
 * rather than a new one — the property `src/lib/study/quiz.ts` needed for the
 * same reason, solved the same way.
 *
 * ## A generated paper is not a past paper, and never claims to be
 *
 * Every question here is one of this project's own cards, drawn from the acts
 * the syllabus names. No question paper of any examination is in this
 * repository and none ever will be. The screen labels the paper "generated"
 * and the mark is a practice figure, not a prediction — `mock.ts` reports what
 * it could not draw (`shortfall`, `skippedPapers`) precisely so the screen can
 * say how much of the real paper it is standing in for.
 *
 * ## Only objective papers
 *
 * A noting-and-drafting paper has no key. `drawPaper` refuses a paper whose
 * `objective` is false rather than inventing a marking scheme for it, and the
 * profile's own subjective papers are reported in `skippedPapers` so the reader
 * is told which part of the examination this mock is silent about.
 */

/** Kinds with one right answer. The same three `src/lib/study/quiz.ts` draws. */
export const MOCK_KINDS: readonly Card['kind'][] = ['mcq', 'trueFalse', 'scenario']

const isMockKind = (card: Card): boolean => MOCK_KINDS.includes(card.kind)

/** FNV-1a, 32-bit. `src/lib/study/quiz.ts`'s, for the reason its comment gives. */
function hash(text: string): number {
  let value = 2166136261
  for (let at = 0; at < text.length; at += 1) {
    value ^= text.charCodeAt(at)
    value = Math.imul(value, 16777619)
  }
  return value >>> 0
}

export interface MockQuestion {
  card: Card
  /** `<paperId>:<unitId>` — which syllabus unit this question is standing for. */
  unitKey: string
  unitId: string
}

export interface UnitShortfall {
  unitKey: string
  unitId: string
  /** How many the weights asked for. */
  wanted: number
  /** How many there were. */
  drawn: number
  /** True where the unit is external — the app was never going to have any. */
  external: boolean
}

export interface MockPaper {
  profileId: string
  paper: ExamPaper
  seed: string
  questions: MockQuestion[]
  /** Marks one question is worth: `paper.marks / questions.length`. */
  marksPerQuestion: number
  /** Units the draw could not fill, and by how much. Rendered, never swallowed. */
  shortfall: UnitShortfall[]
  /** Subjective papers of the same profile, which cannot be mocked at all. */
  skippedPapers: string[]
}

export interface DrawInput {
  profile: ExamProfile
  paperId: string
  catalogue: readonly Card[]
  /** Questions wanted. The draw returns fewer when the cards are not there. */
  count: number
  /** Any string; an ISO instant at the press is what the screen passes. */
  seed: string
}

/**
 * Largest-remainder apportionment of `count` questions across the paper's units.
 *
 * The obvious `Math.round(count * weight)` per unit is wrong in a way that is
 * easy to miss: ten units at 0.1 and a count of 25 rounds to 3 each and asks 30
 * questions on a 25-question paper. Largest remainder gives exactly `count`,
 * and the tie-break on the unit key keeps it deterministic.
 */
export function apportionQuestions(units: readonly PaperUnit[], count: number): Map<string, number> {
  const out = new Map<string, number>()
  if (count <= 0 || units.length === 0) return out

  const exact = units.map((entry) => ({ key: entry.key, share: entry.unit.weight * count }))
  let assigned = 0
  for (const entry of exact) {
    const floor = Math.floor(entry.share)
    out.set(entry.key, floor)
    assigned += floor
  }
  const remainders = [...exact].sort(
    (a, b) => b.share - Math.floor(b.share) - (a.share - Math.floor(a.share)) || compareStrings(a.key, b.key),
  )
  let at = 0
  while (assigned < count && remainders.length > 0) {
    const entry = remainders[at % remainders.length]!
    out.set(entry.key, (out.get(entry.key) ?? 0) + 1)
    assigned += 1
    at += 1
  }
  return out
}

export function drawPaper(input: DrawInput): MockPaper | null {
  const paper = input.profile.papers.find((candidate) => candidate.id === input.paperId)
  if (!paper || !paper.objective) return null

  const units = paperUnits(input.profile).filter((entry) => entry.paper.id === paper.id)
  const wanted = apportionQuestions(units, Math.max(0, Math.floor(input.count)))

  const questions: MockQuestion[] = []
  const shortfall: UnitShortfall[] = []
  const used = new Set<string>()

  for (const entry of units) {
    const target = wanted.get(entry.key) ?? 0
    const cards = cardsForUnit(entry.unit, input.catalogue)
    const external = !Array.isArray(entry.unit.coverage)

    // Shuffled deterministically by `hash(seed:cardId)` rather than sliced off
    // the catalogue's own order, which is rule order — taking the first five
    // would ask about the first five rules of the Conduct Rules every time.
    const pool = cards.served
      .filter(isMockKind)
      .filter((card) => !used.has(card.id))
      .map((card) => ({ card, order: hash(`${input.seed}:${card.id}`) }))
      .sort((a, b) => a.order - b.order || compareStrings(a.card.id, b.card.id))
      .slice(0, target)

    for (const { card } of pool) {
      used.add(card.id)
      questions.push({ card, unitKey: entry.key, unitId: entry.unit.id })
    }
    if (pool.length < target) {
      shortfall.push({
        unitKey: entry.key,
        unitId: entry.unit.id,
        wanted: target,
        drawn: pool.length,
        external,
      })
    }
  }

  // The paper is presented in the units' own order — a real paper is sectioned,
  // and a reader who has just answered six questions on the Leave Rules is in
  // the Leave Rules. Only the draw WITHIN a unit is shuffled.
  return {
    profileId: input.profile.id,
    paper,
    seed: input.seed,
    questions,
    marksPerQuestion: questions.length === 0 ? 0 : paper.marks / questions.length,
    shortfall,
    skippedPapers: input.profile.papers.filter((candidate) => !candidate.objective).map((c) => c.id),
  }
}

/* ------------------------------------------------------------------ *
 * The answer sheet
 * ------------------------------------------------------------------ */

/** One row. `answer` is an option index; `null` is a genuine blank. */
export interface AnswerRow {
  answer: number | null
  flagged: boolean
}

export const emptyAnswers = (count: number): AnswerRow[] =>
  Array.from({ length: count }, () => ({ answer: null, flagged: false }))

export const blankCount = (rows: readonly AnswerRow[]): number =>
  rows.filter((row) => row.answer === null).length

export const flaggedIndices = (rows: readonly AnswerRow[]): number[] =>
  rows.reduce<number[]>((out, row, index) => (row.flagged ? [...out, index] : out), [])

/**
 * The next question worth going back to: the first flagged one, else the first
 * blank one, else null.
 *
 * Flagged before blank deliberately. A reader flags a question they answered
 * and doubted; a blank is one they skipped. With five minutes left, the doubted
 * answer is the one worth the visit — a blank is worth nothing and costs
 * nothing, and a wrong one costs a third of a mark.
 */
export function nextToRevisit(rows: readonly AnswerRow[], from = -1): number | null {
  const after = (predicate: (row: AnswerRow) => boolean): number | null => {
    for (let at = from + 1; at < rows.length; at += 1) if (predicate(rows[at]!)) return at
    for (let at = 0; at <= from && at < rows.length; at += 1) if (predicate(rows[at]!)) return at
    return null
  }
  return after((row) => row.flagged) ?? after((row) => row.answer === null)
}

/* ------------------------------------------------------------------ *
 * Marking
 * ------------------------------------------------------------------ */

export interface UnitResult {
  unitKey: string
  unitId: string
  asked: number
  correct: number
  wrong: number
  blank: number
  /** Correct over ASKED, 0-1. 0 where nothing was asked. */
  accuracy: number
  /** The unit's share of the paper, from the profile. */
  weight: number
  /** Share of the questions actually asked. Compare against `weight`. */
  askedShare: number
}

export interface MockResult {
  questions: number
  correct: number
  wrong: number
  blank: number
  /** Marks earned before the penalty. */
  rawMarks: number
  /** Marks deducted for wrong answers. Always ≥ 0. */
  penalty: number
  /** `rawMarks - penalty`, floored at 0 — a paper is not marked below nothing. */
  marks: number
  /** The paper's own maximum, so the screen never has to reach for the profile. */
  maxMarks: number
  /** `marks / maxMarks`, 0-1. */
  fraction: number
  /** Whether `paper.qualifyingMarks` was met. Null where the notification fixes none. */
  qualified: boolean | null
  units: UnitResult[]
}

/**
 * Mark a drawn paper against an answer sheet.
 *
 * Three rules, all of them the notification's rather than this app's:
 *
 *  - a wrong answer costs `negativeMarking` × the marks assigned to the
 *    question — one third, in the fetched Appendix;
 *  - **a blank costs nothing**, which is the rule a candidate's whole
 *    guess-or-leave-it decision turns on and the one an implementation is most
 *    likely to get wrong by treating "not correct" as "wrong";
 *  - the total is floored at zero rather than reported negative.
 */
export function markPaper(paper: MockPaper, rows: readonly AnswerRow[]): MockResult {
  const penaltyRate = paper.paper.negativeMarking ?? 0

  let correct = 0
  let wrong = 0
  let blank = 0
  const byUnit = new Map<string, UnitResult>()

  paper.questions.forEach((question, index) => {
    const row = rows[index]
    const bucket =
      byUnit.get(question.unitKey) ??
      ({
        unitKey: question.unitKey,
        unitId: question.unitId,
        asked: 0,
        correct: 0,
        wrong: 0,
        blank: 0,
        accuracy: 0,
        weight: 0,
        askedShare: 0,
      } satisfies UnitResult)
    bucket.asked += 1

    // A card with no `answerIndex` cannot be marked. `MOCK_KINDS` is exactly the
    // three kinds that carry one, so this is unreachable through `drawPaper` —
    // it is here because `markPaper` is exported and a caller could hand it a
    // paper built some other way, and marking an unmarkable question as wrong
    // would take a third of a mark off the reader for the app's mistake.
    const key = question.card.answerIndex
    if (row === undefined || row.answer === null || key === undefined) {
      blank += 1
      bucket.blank += 1
    } else if (row.answer === key) {
      correct += 1
      bucket.correct += 1
    } else {
      wrong += 1
      bucket.wrong += 1
    }
    byUnit.set(question.unitKey, bucket)
  })

  const weights = new Map(paper.paper.units.map((unit) => [`${paper.paper.id}:${unit.id}`, unit.weight]))
  const units = [...byUnit.values()]
    .map((unit) => ({
      ...unit,
      accuracy: unit.asked === 0 ? 0 : unit.correct / unit.asked,
      weight: weights.get(unit.unitKey) ?? 0,
      askedShare: paper.questions.length === 0 ? 0 : unit.asked / paper.questions.length,
    }))
    .sort((a, b) => compareStrings(a.unitKey, b.unitKey))

  const rawMarks = correct * paper.marksPerQuestion
  const penalty = wrong * penaltyRate * paper.marksPerQuestion
  const marks = Math.max(0, rawMarks - penalty)

  return {
    questions: paper.questions.length,
    correct,
    wrong,
    blank,
    rawMarks,
    penalty,
    marks,
    maxMarks: paper.paper.marks,
    fraction: paper.paper.marks === 0 ? 0 : marks / paper.paper.marks,
    qualified: paper.paper.qualifyingMarks === undefined ? null : marks >= paper.paper.qualifyingMarks,
    units,
  }
}

/** Every question the reader got wrong — what "add these to my review deck" takes. */
export function wrongCards(paper: MockPaper, rows: readonly AnswerRow[]): Card[] {
  return paper.questions
    .filter((question, index) => {
      const row = rows[index]
      const key = question.card.answerIndex
      return row !== undefined && row.answer !== null && key !== undefined && row.answer !== key
    })
    .map((question) => question.card)
}
