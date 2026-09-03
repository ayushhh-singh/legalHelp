import type { Chapter } from './types'

import type { Card } from '@/modules/trainer/schema'

/**
 * "Test me on this chapter" — a short quiz drawn from the cards this app
 * already ships.
 *
 * NOTHING IS GENERATED HERE. Every question is a card that came through the
 * four-stage pipeline in `docs/AUTHORING.md` and is `reviewState: 'approved'`,
 * and the ONE predicate that decides that is `isServed` in
 * `src/modules/trainer/schema.ts` — this file never re-implements it. A quiz
 * that invented a question would be a question no critic pass had read.
 *
 * The join is `ruleRef.textId`, which every one of the 2,807 cards carries and
 * which is a unit id in `data/rules/text/<act>.json` — the same ids a chapter's
 * `unitIds` are. That is the whole of the mapping between the Library's
 * structure and the Trainer's catalogue, and it is why a quiz is possible at
 * all without a second dataset.
 *
 * Pure, and it takes the catalogue as an argument: `data/rules/cards` is 1.1 MB
 * for the GFR alone, and the rule `src/lib/srs` states — every function is
 * handed the cards it works over — holds here for the same reason.
 */

/**
 * How many questions a chapter quiz asks. Short on purpose: the brief asks for
 * "a short quiz", and a chapter with sixty cards behind it should not become a
 * sixty-question examination the reader abandons half way.
 */
export const QUIZ_LENGTH = 8

/**
 * The kinds a quiz can grade.
 *
 * The same three the mock test draws from, and for the same reason CLAUDE.md
 * records: `answerIndex` is what makes an answer markable, and a rule-flip or
 * cloze card is open recall with nothing for a timed test to silently mark
 * right or wrong.
 */
export const QUIZ_KINDS: readonly Card['kind'][] = ['mcq', 'trueFalse', 'scenario']

const isQuizKind = (card: Card): boolean =>
  QUIZ_KINDS.includes(card.kind) &&
  typeof card.answerIndex === 'number' &&
  Array.isArray(card.options) &&
  card.options.length >= 2 &&
  card.answerIndex >= 0 &&
  card.answerIndex < card.options.length

/**
 * Every card in the catalogue whose rule falls inside this chapter.
 *
 * `served` is passed in rather than computed: the caller has already folded any
 * local review-queue decisions over the dataset
 * (`src/modules/trainer/reviewQueue.ts#effectiveCatalogue`), and re-filtering
 * here on `reviewState` alone would silently drop a card the reader themselves
 * approved.
 */
export function cardsForChapter(chapter: Chapter, served: readonly Card[]): Card[] {
  const units = new Set(chapter.unitIds)
  return served.filter((card) => units.has(card.ruleRef.textId))
}

/** How many gradable questions a chapter can offer. Drawn before the quiz is offered. */
export function quizSizeFor(chapter: Chapter, served: readonly Card[]): number {
  return cardsForChapter(chapter, served).filter(isQuizKind).length
}

/**
 * A deterministic 32-bit hash of a string.
 *
 * The quiz's order has to be stable for one (chapter, seed) pair — a reader who
 * reloads mid-quiz must get the same questions back — and it has to differ
 * between attempts. `Math.random()` gives neither, and `src/lib/srs/purity.test.ts`
 * bans it in the sibling library for the same reason: a schedule two devices
 * cannot reproduce is a schedule neither can export.
 */
function hash(text: string): number {
  let value = 2166136261
  for (let at = 0; at < text.length; at += 1) {
    value ^= text.charCodeAt(at)
    value = Math.imul(value, 16777619)
  }
  return value >>> 0
}

/**
 * The questions for one attempt at a chapter quiz.
 *
 * `seed` is the caller's — an ISO instant when the reader presses the button —
 * so two attempts on the same chapter ask different questions while one attempt
 * survives a reload. The cards are ordered by `hash(seed + card.id)`, which is
 * a deterministic shuffle rather than a slice of the catalogue's own order:
 * taking the first eight would ask about the first eight rules of the chapter
 * every time and never about the rest.
 */
export function buildChapterQuiz(
  chapter: Chapter,
  served: readonly Card[],
  seed: string,
  limit = QUIZ_LENGTH,
): Card[] {
  const pool = cardsForChapter(chapter, served).filter(isQuizKind)
  return [...pool]
    .map((card) => ({ card, order: hash(`${seed}:${card.id}`) }))
    .sort((a, b) => a.order - b.order || (a.card.id < b.card.id ? -1 : a.card.id > b.card.id ? 1 : 0))
    .slice(0, Math.max(0, limit))
    .map((entry) => entry.card)
}

export interface QuizAnswer {
  qId: string
  /** The option the reader chose, or `null` where they skipped. */
  chosen: number | null
  correct: boolean
}

export interface QuizOutcome {
  answers: QuizAnswer[]
  right: number
  total: number
  /** 0-1. Zero for an unanswered quiz rather than NaN. */
  accuracy: number
  /** The cards the reader got wrong — what "add to review deck" acts on. */
  wrong: string[]
}

/** Marks a completed quiz. Pure arithmetic over what the reader chose. */
export function markQuiz(cards: readonly Card[], chosen: ReadonlyMap<string, number | null>): QuizOutcome {
  const answers: QuizAnswer[] = cards.map((card) => {
    const pick = chosen.get(card.id) ?? null
    return { qId: card.id, chosen: pick, correct: pick !== null && pick === card.answerIndex }
  })
  const right = answers.filter((answer) => answer.correct).length
  return {
    answers,
    right,
    total: answers.length,
    accuracy: answers.length === 0 ? 0 : right / answers.length,
    wrong: answers.filter((answer) => !answer.correct).map((answer) => answer.qId),
  }
}

/**
 * The confidence a quiz result implies, for the chapter deck.
 *
 * Mapped rather than asked, because the reader has just answered eight
 * questions and asking them how confident they feel immediately afterwards
 * would collect an opinion where evidence is already in hand. The bands are
 * deliberately coarse: everything right is 4, a clear majority is 3, half is 2,
 * and worse than half is 1. `null` for an empty quiz — no evidence, no rating.
 */
export function confidenceFromQuiz(outcome: QuizOutcome): 1 | 2 | 3 | 4 | null {
  if (outcome.total === 0) return null
  if (outcome.right === outcome.total) return 4
  if (outcome.accuracy >= 0.75) return 3
  if (outcome.accuracy >= 0.5) return 2
  return 1
}
