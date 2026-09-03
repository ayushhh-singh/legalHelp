import { describe, expect, it } from 'vitest'

import {
  buildChapterQuiz,
  cardsForChapter,
  confidenceFromQuiz,
  markQuiz,
  quizSizeFor,
  QUIZ_KINDS,
  QUIZ_LENGTH,
} from './quiz'
import type { Chapter } from './types'

import { cardSchema, isServed, type Card } from '@/modules/trainer/schema'

const chapter: Chapter = {
  id: 'w:ch',
  workId: 'w',
  nodeId: 'ch',
  number: 'I',
  heading: { en: 'One', hi: 'एक' },
  unitIds: ['u1', 'u2', 'u3'],
}

/**
 * A card fixture built here rather than through `@/test/rules-cards`, because
 * that helper builds `rule` cards and this file is about the three kinds a quiz
 * can grade. Every card is parsed through `cardSchema` so a fixture cannot
 * drift from the shape the Trainer will actually be handed — the same guarantee
 * `src/test/rules-cards.ts` gives its own.
 */
const card = (over: Partial<Card> & Pick<Card, 'id'>): Card =>
  cardSchema.parse({
    act: 'test-act',
    rule: '1',
    kind: 'mcq',
    front: { en: 'Front?', hi: 'प्रश्न?' },
    back: { en: 'Back.', hi: 'उत्तर।' },
    options: [
      { en: 'A', hi: 'क' },
      { en: 'B', hi: 'ख' },
    ],
    answerIndex: 1,
    ruleRef: { textId: 'u1', citation: { en: 'Rule 1', hi: 'नियम 1' } },
    difficulty: 'medium',
    reviewed: true,
    reviewState: 'approved',
    version: '1.0.0',
    source: { name: 'Test', url: 'https://example.gov.in/test' },
    ...over,
  })

const mcq = (id: string, unitId: string, over: Partial<Card> = {}): Card =>
  card({ id, ruleRef: { textId: unitId, citation: { en: 'Rule 1', hi: 'नियम 1' } }, ...over })

describe('cardsForChapter', () => {
  it('matches on ruleRef.textId — the join between the Library and the Trainer', () => {
    const cards = [mcq('a', 'u1'), mcq('b', 'elsewhere'), mcq('c', 'u3')]
    expect(cardsForChapter(chapter, cards).map((card) => card.id)).toEqual(['a', 'c'])
  })

  it('returns nothing for a chapter whose units no card cites', () => {
    expect(cardsForChapter({ ...chapter, unitIds: ['nope'] }, [mcq('a', 'u1')])).toEqual([])
  })
})

describe('quizSizeFor', () => {
  it('counts only the kinds a quiz can grade', () => {
    const cards = [
      mcq('a', 'u1'),
      card({
        id: 'b',
        kind: 'rule',
        options: undefined,
        answerIndex: undefined,
        ruleRef: { textId: 'u1', citation: { en: 'x', hi: 'य' } },
      }),
      card({
        id: 'c',
        kind: 'cloze',
        options: undefined,
        answerIndex: undefined,
        ruleRef: { textId: 'u2', citation: { en: 'x', hi: 'य' } },
      }),
    ]
    // A rule-flip or cloze card is open recall with nothing for a timed test to
    // silently mark right or wrong — the same reason the mock test excludes them.
    expect(quizSizeFor(chapter, cards)).toBe(1)
  })

  it('rejects a card whose answerIndex points past its own options', () => {
    // `cardSchema` checks that `answerIndex` is a non-negative integer and that
    // `options` has 2-5 entries, but it cannot see across the two fields — so
    // an index of 5 against two options parses clean and would grade every
    // answer wrong. A negative index is NOT tested here because the schema does
    // refuse that one, and a test for a state the data cannot be in asserts
    // nothing.
    expect(quizSizeFor(chapter, [mcq('a', 'u1', { answerIndex: 5 })])).toBe(0)
  })

  it('rejects a card of a quiz kind with no options at all', () => {
    const broken = { ...mcq('a', 'u1') }
    delete (broken as { options?: unknown }).options
    expect(quizSizeFor(chapter, [broken])).toBe(0)
  })

  it('names the three kinds the mock test uses, and no more', () => {
    expect([...QUIZ_KINDS].sort()).toEqual(['mcq', 'scenario', 'trueFalse'])
  })
})

describe('buildChapterQuiz', () => {
  const pool = Array.from({ length: 20 }, (_, at) => mcq(`c-${at}`, 'u1'))

  it('never asks more than QUIZ_LENGTH', () => {
    expect(buildChapterQuiz(chapter, pool, 'seed').length).toBe(QUIZ_LENGTH)
  })

  it('is stable for one seed — a reload asks the same questions', () => {
    const once = buildChapterQuiz(chapter, pool, 'seed').map((card) => card.id)
    const twice = buildChapterQuiz(chapter, pool, 'seed').map((card) => card.id)
    expect(once).toEqual(twice)
  })

  it('differs between seeds — a second attempt is a second set', () => {
    const first = buildChapterQuiz(chapter, pool, 'a').map((card) => card.id)
    const second = buildChapterQuiz(chapter, pool, 'b').map((card) => card.id)
    expect(first).not.toEqual(second)
  })

  it('does not simply take the first eight of the catalogue', () => {
    // Slicing would ask about the first eight rules of the chapter every time
    // and never about the rest.
    const chosen = buildChapterQuiz(chapter, pool, 'seed').map((card) => card.id)
    expect(chosen).not.toEqual(pool.slice(0, QUIZ_LENGTH).map((card) => card.id))
  })

  it('returns everything it has when the pool is smaller than the quiz', () => {
    expect(buildChapterQuiz(chapter, pool.slice(0, 3), 'seed').length).toBe(3)
  })

  it('returns nothing for a limit of zero or less', () => {
    expect(buildChapterQuiz(chapter, pool, 'seed', 0)).toEqual([])
    expect(buildChapterQuiz(chapter, pool, 'seed', -5)).toEqual([])
  })

  it('never repeats a card within one quiz', () => {
    const ids = buildChapterQuiz(chapter, pool, 'seed').map((card) => card.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('is served-only by construction — the caller filters, and this asserts it', () => {
    // `isServed` is the ONE predicate that decides what a reader sees. This
    // file never re-implements it; the assertion is that a quiz built from a
    // served catalogue contains only served cards.
    const served = pool.filter(isServed)
    expect(served.length).toBe(pool.length)
    for (const card of buildChapterQuiz(chapter, served, 'seed')) expect(isServed(card)).toBe(true)
  })
})

describe('markQuiz', () => {
  const cards = [mcq('a', 'u1'), mcq('b', 'u1'), mcq('c', 'u1')]

  it('marks a chosen option against the card’s own answerIndex', () => {
    const outcome = markQuiz(
      cards,
      new Map([
        ['a', 1],
        ['b', 0],
        ['c', 1],
      ]),
    )
    expect(outcome.right).toBe(2)
    expect(outcome.total).toBe(3)
    expect(outcome.wrong).toEqual(['b'])
  })

  it('treats a skipped question as wrong, not as absent', () => {
    const outcome = markQuiz(cards, new Map([['a', 1]]))
    expect(outcome.total).toBe(3)
    expect(outcome.right).toBe(1)
    expect(outcome.wrong).toEqual(['b', 'c'])
    expect(outcome.answers[1]?.chosen).toBeNull()
  })

  it('reports zero accuracy for an empty quiz rather than NaN', () => {
    const outcome = markQuiz([], new Map())
    expect(outcome.accuracy).toBe(0)
    expect(Number.isNaN(outcome.accuracy)).toBe(false)
  })

  it('never marks a null choice correct, even where answerIndex is missing', () => {
    const broken = { ...mcq('x', 'u1') }
    delete (broken as { answerIndex?: unknown }).answerIndex
    expect(markQuiz([broken], new Map([['x', null]])).right).toBe(0)
  })
})

describe('confidenceFromQuiz', () => {
  const outcome = (right: number, total: number) => ({
    answers: [],
    right,
    total,
    accuracy: total === 0 ? 0 : right / total,
    wrong: [],
  })

  it('maps everything right to 4', () => {
    expect(confidenceFromQuiz(outcome(8, 8))).toBe(4)
  })

  it('maps a clear majority to 3, half to 2 and worse to 1', () => {
    expect(confidenceFromQuiz(outcome(6, 8))).toBe(3)
    expect(confidenceFromQuiz(outcome(4, 8))).toBe(2)
    expect(confidenceFromQuiz(outcome(3, 8))).toBe(1)
    expect(confidenceFromQuiz(outcome(0, 8))).toBe(1)
  })

  it('rates nothing on an empty quiz — no evidence, no rating', () => {
    expect(confidenceFromQuiz(outcome(0, 0))).toBeNull()
  })
})
