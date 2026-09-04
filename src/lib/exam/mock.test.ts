import { describe, expect, it } from 'vitest'

import {
  apportionQuestions,
  blankCount,
  drawPaper,
  emptyAnswers,
  flaggedIndices,
  markPaper,
  nextToRevisit,
  wrongCards,
  type AnswerRow,
  type MockPaper,
} from './mock'
import { paperUnits } from './types'

import { makeMcqs, makeProfile } from '@/test/exam-fixtures'
import { makeCard } from '@/test/rules-cards'

const profile = makeProfile([
  {
    id: 'p1',
    marks: 150,
    negativeMarking: 1 / 3,
    units: [
      { id: 'conduct', weight: 0.5, acts: ['ccs-conduct'] },
      { id: 'leave', weight: 0.3, acts: ['ccs-leave'] },
      { id: 'gfr', weight: 0.1, acts: ['gfr'] },
      { id: 'outside', weight: 0.1, acts: null },
    ],
  },
  { id: 'p2', marks: 200, objective: false, units: [{ id: 'writing', weight: 1, acts: null }] },
])

const catalogue = [...makeMcqs('ccs-conduct', 40), ...makeMcqs('ccs-leave', 40), ...makeMcqs('gfr', 40)]

const draw = (count = 30, seed = 'seed-1', cards = catalogue) =>
  drawPaper({ profile, paperId: 'p1', catalogue: cards, count, seed })

describe('apportionQuestions', () => {
  it('gives exactly the count asked for, never one more', () => {
    // `Math.round(count * weight)` per unit is the obvious version and it is
    // wrong: ten units at 0.1 with a count of 25 rounds to 3 each and asks 30
    // questions on a 25-question paper.
    const units = paperUnits(profile).filter((entry) => entry.paper.id === 'p1')
    for (const count of [1, 5, 7, 10, 13, 25, 30, 99]) {
      const shares = apportionQuestions(units, count)
      expect(
        [...shares.values()].reduce((a, b) => a + b, 0),
        `count ${count}`,
      ).toBe(count)
    }
  })

  it('is within tolerance of each unit’s weight', () => {
    const units = paperUnits(profile).filter((entry) => entry.paper.id === 'p1')
    const shares = apportionQuestions(units, 100)
    for (const entry of units) {
      expect(shares.get(entry.key)).toBeGreaterThanOrEqual(Math.floor(entry.unit.weight * 100))
      expect(shares.get(entry.key)).toBeLessThanOrEqual(Math.ceil(entry.unit.weight * 100))
    }
  })

  it('is deterministic and gives nothing for a count of zero', () => {
    const units = paperUnits(profile).filter((entry) => entry.paper.id === 'p1')
    expect(apportionQuestions(units, 30)).toEqual(apportionQuestions(units, 30))
    expect([...apportionQuestions(units, 0).values()]).toEqual([])
  })
})

describe('drawPaper', () => {
  it('refuses a subjective paper rather than inventing a marking scheme', () => {
    expect(drawPaper({ profile, paperId: 'p2', catalogue, count: 10, seed: 's' })).toBeNull()
  })

  it('refuses a paper id the profile does not have', () => {
    expect(drawPaper({ profile, paperId: 'p9', catalogue, count: 10, seed: 's' })).toBeNull()
  })

  it('draws within tolerance of the weights', () => {
    const paper = draw(30)!
    const asked = new Map<string, number>()
    for (const question of paper.questions) {
      asked.set(question.unitId, (asked.get(question.unitId) ?? 0) + 1)
    }
    // 0.5 / 0.3 / 0.1 of the 27 questions the mapped units can supply — the
    // external unit's three are a shortfall rather than a redistribution.
    expect(asked.get('conduct')).toBe(15)
    expect(asked.get('leave')).toBe(9)
    expect(asked.get('gfr')).toBe(3)
    expect(asked.get('outside')).toBeUndefined()
  })

  it('never repeats a card inside one paper', () => {
    for (const seed of ['a', 'b', 'c', 'd']) {
      const paper = draw(60, seed)!
      const ids = paper.questions.map((question) => question.card.id)
      expect(new Set(ids).size, `seed ${seed}`).toBe(ids.length)
    }
  })

  it('is reproducible for one seed and different across seeds', () => {
    // A reader who reloads mid-paper must get their paper back; two attempts
    // must not be the same paper.
    const ids = (seed: string) => draw(20, seed)!.questions.map((q) => q.card.id)
    expect(ids('seed-1')).toEqual(ids('seed-1'))
    expect(ids('seed-1')).not.toEqual(ids('seed-2'))
  })

  it('does not slice the catalogue’s own order', () => {
    // Card order in `data/rules` is rule order, so taking the first five would
    // ask about the first five rules of the Conduct Rules every single time.
    const first = draw(5, 'x')!.questions.map((q) => q.card.id)
    const inOrder = catalogue
      .filter((c) => c.act === 'ccs-conduct')
      .slice(0, 5)
      .map((c) => c.id)
    expect(first).not.toEqual(inOrder)
  })

  it('reports a shortfall rather than quietly asking fewer questions', () => {
    const thin = draw(30, 'seed-1', [...makeMcqs('ccs-conduct', 4), ...makeMcqs('ccs-leave', 40)])!
    const conduct = thin.shortfall.find((entry) => entry.unitId === 'conduct')
    expect(conduct).toEqual({
      unitKey: 'p1:conduct',
      unitId: 'conduct',
      wanted: 15,
      drawn: 4,
      external: false,
    })
  })

  it('marks an external unit’s shortfall as external', () => {
    const paper = draw(30)!
    const outside = paper.shortfall.find((entry) => entry.unitId === 'outside')
    expect(outside?.external).toBe(true)
    expect(outside?.drawn).toBe(0)
  })

  it('names the papers it cannot mock at all', () => {
    expect(draw(10)!.skippedPapers).toEqual(['p2'])
  })

  it('draws only cards with a single right answer', () => {
    const mixed = [
      ...makeMcqs('ccs-conduct', 5),
      makeCard({ id: 'rule-card', act: 'ccs-conduct', rule: '9' }),
    ]
    const paper = draw(30, 's', mixed)!
    expect(paper.questions.every((question) => question.card.answerIndex !== undefined)).toBe(true)
  })

  it('computes the marks a question is worth from the paper and the draw', () => {
    const paper = draw(30)!
    expect(paper.questions).toHaveLength(27)
    expect(paper.marksPerQuestion).toBeCloseTo(150 / 27, 10)
  })

  it('presents the paper in the units’ own order, sectioned like a real one', () => {
    const paper = draw(30)!
    const order = paper.questions.map((question) => question.unitId)
    expect(order).toEqual([...order].sort((a, b) => order.indexOf(a) - order.indexOf(b)))
    expect([...new Set(order)]).toEqual(['conduct', 'leave', 'gfr'])
  })
})

describe('the answer sheet', () => {
  it('starts blank and unflagged', () => {
    const rows = emptyAnswers(4)
    expect(blankCount(rows)).toBe(4)
    expect(flaggedIndices(rows)).toEqual([])
  })

  it('lists flagged rows in order', () => {
    const rows: AnswerRow[] = [
      { answer: 1, flagged: true },
      { answer: null, flagged: false },
      { answer: 0, flagged: true },
    ]
    expect(flaggedIndices(rows)).toEqual([0, 2])
    expect(blankCount(rows)).toBe(1)
  })

  it('sends the reader to a flagged question before a blank one', () => {
    // A flag is a question they answered and doubted; a blank is one they
    // skipped. With five minutes left the doubted answer is the visit worth
    // making — a blank costs nothing and a wrong answer costs a third of a mark.
    const rows: AnswerRow[] = [
      { answer: null, flagged: false },
      { answer: 2, flagged: true },
    ]
    expect(nextToRevisit(rows)).toBe(1)
  })

  it('wraps round to the start rather than stopping at the end', () => {
    const rows: AnswerRow[] = [
      { answer: 1, flagged: true },
      { answer: 1, flagged: false },
    ]
    expect(nextToRevisit(rows, 1)).toBe(0)
  })

  it('returns null when everything is answered and nothing is flagged', () => {
    expect(nextToRevisit([{ answer: 0, flagged: false }])).toBeNull()
  })
})

describe('markPaper', () => {
  /** A paper of `n` questions, all with key 0, worth `marks` in total. */
  // `null` and not `undefined` for "no penalty": passing `undefined` for an
  // argument with a default gets the DEFAULT, so a helper that used it would
  // silently test the penalised paper twice and report a pass either way.
  const paperOf = (n: number, marks = 150, negativeMarking: number | null = 1 / 3): MockPaper => {
    const cards = Array.from({ length: n }, (_, i) => ({
      ...makeMcqs('ccs-conduct', 1, i + 1)[0]!,
      answerIndex: 0,
    }))
    return {
      profileId: 'x',
      paper: {
        id: 'p1',
        name: { en: 'p', hi: 'p' },
        marks,
        durationMinutes: 120,
        objective: true,
        ...(negativeMarking === null ? {} : { negativeMarking }),
        units: [{ id: 'conduct', name: { en: 'c', hi: 'c' }, weight: 1, coverage: [{ act: 'ccs-conduct' }] }],
      },
      seed: 's',
      questions: cards.map((card) => ({ card, unitKey: 'p1:conduct', unitId: 'conduct' })),
      marksPerQuestion: marks / n,
      shortfall: [],
      skippedPapers: [],
    }
  }

  it('is the notification’s arithmetic: right earns, wrong costs a third, blank costs nothing', () => {
    // 30 questions on a 150-mark paper is 5 marks a question. Ten right is 50;
    // ten wrong costs 10 × (1/3) × 5 = 16.6667; ten blank costs nothing.
    const paper = paperOf(30)
    const rows: AnswerRow[] = [
      ...Array.from({ length: 10 }, () => ({ answer: 0, flagged: false })),
      ...Array.from({ length: 10 }, () => ({ answer: 1, flagged: false })),
      ...Array.from({ length: 10 }, () => ({ answer: null, flagged: false })),
    ]
    const result = markPaper(paper, rows)
    expect(result).toMatchObject({ correct: 10, wrong: 10, blank: 10, questions: 30 })
    expect(result.rawMarks).toBeCloseTo(50, 10)
    expect(result.penalty).toBeCloseTo(50 / 3, 10)
    expect(result.marks).toBeCloseTo(50 - 50 / 3, 10)
  })

  it('costs NOTHING for a blank, which is the rule an implementation gets wrong', () => {
    // "Not correct" is not "wrong". Treating a blank as wrong would take a
    // third of a mark off a candidate for the one decision the penalty exists
    // to make safe.
    const paper = paperOf(10)
    const allBlank = markPaper(paper, emptyAnswers(10))
    expect(allBlank.penalty).toBe(0)
    expect(allBlank.marks).toBe(0)
  })

  it('floors a badly wrong paper at zero rather than reporting a negative', () => {
    const paper = paperOf(10)
    const result = markPaper(
      paper,
      Array.from({ length: 10 }, () => ({ answer: 3, flagged: false })),
    )
    expect(result.rawMarks).toBe(0)
    expect(result.penalty).toBeCloseTo(50, 10)
    expect(result.marks).toBe(0)
  })

  it('applies no penalty at all where the paper prescribes none', () => {
    const paper = paperOf(10, 100, null)
    const result = markPaper(
      paper,
      Array.from({ length: 10 }, () => ({ answer: 3, flagged: false })),
    )
    expect(result.penalty).toBe(0)
    expect(result.marks).toBe(0)
  })

  it('gives full marks for a full paper', () => {
    const paper = paperOf(30)
    const result = markPaper(
      paper,
      Array.from({ length: 30 }, () => ({ answer: 0, flagged: false })),
    )
    expect(result.marks).toBeCloseTo(150, 10)
    expect(result.fraction).toBeCloseTo(1, 10)
  })

  it('treats a question with no key as blank rather than as wrong', () => {
    // Unreachable through `drawPaper`, which draws only keyed kinds — and it is
    // guarded because taking a third of a mark off the reader for the app's
    // own mistake is the wrong direction to fail in.
    const paper = paperOf(2)
    const unkeyed: MockPaper = {
      ...paper,
      questions: paper.questions.map((question, i) =>
        i === 0 ? { ...question, card: { ...question.card, answerIndex: undefined } } : question,
      ),
    }
    const result = markPaper(unkeyed, [
      { answer: 0, flagged: false },
      { answer: 0, flagged: false },
    ])
    expect(result).toMatchObject({ correct: 1, wrong: 0, blank: 1 })
  })

  it('reports per-unit accuracy beside the unit’s own weight', () => {
    const result = markPaper(draw(30)!, [
      ...Array.from({ length: 15 }, (_, i) => ({ answer: i < 10 ? 0 : 9, flagged: false })),
      ...emptyAnswers(12),
    ])
    const conduct = result.units.find((unit) => unit.unitId === 'conduct')!
    expect(conduct.asked).toBe(15)
    expect(conduct.weight).toBe(0.5)
    expect(conduct.askedShare).toBeCloseTo(15 / 27, 10)
    expect(conduct.accuracy).toBeGreaterThan(0)
  })

  it('reports qualification only where the notification fixes a figure', () => {
    expect(markPaper(paperOf(10), emptyAnswers(10)).qualified).toBeNull()
  })

  it('handles a sheet shorter than the paper without throwing', () => {
    const result = markPaper(paperOf(5), [{ answer: 0, flagged: false }])
    expect(result).toMatchObject({ correct: 1, blank: 4, wrong: 0 })
  })
})

describe('wrongCards', () => {
  it('returns the ones answered wrongly, and never a blank', () => {
    const paper = draw(30)!
    const rows: AnswerRow[] = paper.questions.map((question, i) => {
      if (i < 3) return { answer: ((question.card.answerIndex ?? 0) + 1) % 4, flagged: false }
      if (i < 6) return { answer: null, flagged: false }
      return { answer: question.card.answerIndex ?? 0, flagged: false }
    })
    const wrong = wrongCards(paper, rows)
    expect(wrong).toHaveLength(3)
    expect(wrong.map((card) => card.id)).toEqual(paper.questions.slice(0, 3).map((q) => q.card.id))
  })
})
