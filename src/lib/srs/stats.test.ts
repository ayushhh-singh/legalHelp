import { describe, expect, it } from 'vitest'

import { createCard, gradeCard } from './engine'
import { dayStats, weakAreas } from './stats'

import { makeAct, makeCard } from '@/test/rules-cards'

import type { Grade, ReviewLogRow, SrsCardRow, SrsState } from './types'

const T0 = new Date('2026-03-02T09:00:00.000Z') // 14:30 IST, 2 March
const DAY = '2026-03-02'

let sequence = 0

function entry(
  qId: string,
  grade: Grade,
  at: string,
  stateBefore: SrsState = 'review',
  retrievability: number | null = 0.9,
): ReviewLogRow {
  sequence += 1
  return {
    id: `${qId}#${sequence}#${at}`,
    qId,
    grade,
    at,
    durationMs: 1_000,
    stateBefore,
    elapsed: 1,
    retrievability,
  }
}

const states = (rows: readonly SrsCardRow[]) => new Map(rows.map((row) => [row.qId, row]))

function seen(qId: string, due: Date): SrsCardRow {
  const at = new Date(T0.getTime() - 86_400_000)
  return { ...gradeCard(createCard(qId, at), 'Good', at).card, due: due.toISOString(), state: 'review' }
}

describe('dayStats', () => {
  const cards = makeAct('a', 10)

  it('reports an empty day without dividing by zero', () => {
    const stats = dayStats({ cards, states: states([]), logs: [], now: T0 })

    expect(stats).toMatchObject({
      day: DAY,
      due: 0,
      reviewed: 0,
      newIntroduced: 0,
      lapses: 0,
      accuracy: 0,
      retentionEstimate: null,
      predictedRetention: null,
      durationMs: 0,
    })
  })

  it('counts the day work and its accuracy', () => {
    const logs = [
      entry('a-1', 'Good', '2026-03-02T04:00:00.000Z'),
      entry('a-2', 'Again', '2026-03-02T04:01:00.000Z'),
      entry('a-3', 'Easy', '2026-03-02T04:02:00.000Z'),
      entry('a-4', 'Good', '2026-03-02T04:03:00.000Z', 'new', null),
    ]
    const stats = dayStats({ cards, states: states([]), logs, now: T0 })

    expect(stats.reviewed).toBe(4)
    expect(stats.lapses).toBe(1)
    expect(stats.accuracy).toBe(0.75)
    expect(stats.newIntroduced).toBe(1)
    expect(stats.durationMs).toBe(4_000)
  })

  it('measures retention over review-state cards only, and accuracy over all of them', () => {
    const logs = [
      // Two learnt cards, one of them lost.
      entry('a-1', 'Good', '2026-03-02T04:00:00.000Z', 'review', 0.92),
      entry('a-2', 'Again', '2026-03-02T04:01:00.000Z', 'review', 0.88),
      // Two cards still in learning — they say nothing about retention.
      entry('a-3', 'Good', '2026-03-02T04:02:00.000Z', 'learning', 0.99),
      entry('a-4', 'Good', '2026-03-02T04:03:00.000Z', 'learning', 0.99),
    ]
    const stats = dayStats({ cards, states: states([]), logs, now: T0 })

    expect(stats.retentionEstimate).toBe(0.5)
    expect(stats.accuracy).toBe(0.75)
    expect(stats.predictedRetention).toBeCloseTo((0.92 + 0.88 + 0.99 + 0.99) / 4, 10)
  })

  it('leaves a new card out of the predicted-retention average', () => {
    const logs = [
      entry('a-1', 'Good', '2026-03-02T04:00:00.000Z', 'review', 0.8),
      entry('a-2', 'Good', '2026-03-02T04:01:00.000Z', 'new', null),
    ]
    // A new card scored as 0 would drag this to 0.4 and mis-state the schedule.
    expect(dayStats({ cards, states: states([]), logs, now: T0 }).predictedRetention).toBe(0.8)
  })

  it('splits the log on the IST midnight, not the UTC one', () => {
    const logs = [
      entry('a-1', 'Good', '2026-03-01T18:20:00.000Z'), // 23:50 IST, 1 March
      entry('a-2', 'Good', '2026-03-01T18:40:00.000Z'), // 00:10 IST, 2 March
      entry('a-3', 'Good', '2026-03-02T04:00:00.000Z'), // 09:30 IST, 2 March
    ]

    expect(dayStats({ cards, states: states([]), logs, now: T0, day: '2026-03-01' }).reviewed).toBe(1)
    expect(dayStats({ cards, states: states([]), logs, now: T0, day: '2026-03-02' }).reviewed).toBe(2)
  })

  it('counts what is outstanding by the close of the day', () => {
    const rows = [
      seen('a-1', new Date('2026-03-02T05:00:00.000Z')), // due during the day
      seen('a-2', new Date('2026-03-02T18:00:00.000Z')), // due at 23:30 IST, still the 2nd
      seen('a-3', new Date('2026-03-03T05:00:00.000Z')), // tomorrow
    ]
    expect(dayStats({ cards, states: states(rows), logs: [], now: T0 }).due).toBe(2)
  })

  it('reports one act at a time when asked', () => {
    const both = [...makeAct('conduct', 3), ...makeAct('cca', 3)]
    const logs = [
      entry('conduct-1', 'Good', '2026-03-02T04:00:00.000Z'),
      entry('cca-1', 'Again', '2026-03-02T04:01:00.000Z'),
    ]

    expect(dayStats({ cards: both, states: states([]), logs, now: T0, acts: ['cca'] })).toMatchObject({
      reviewed: 1,
      lapses: 1,
      accuracy: 0,
    })
    expect(dayStats({ cards: both, states: states([]), logs, now: T0, acts: ['conduct'] })).toMatchObject({
      reviewed: 1,
      lapses: 0,
      accuracy: 1,
    })
  })
})

describe('weakAreas', () => {
  const cards = [
    makeCard({ id: 'conduct-a', act: 'conduct', rule: '3' }),
    makeCard({ id: 'conduct-b', act: 'conduct', rule: '3' }),
    makeCard({ id: 'conduct-c', act: 'conduct', rule: '11' }),
    makeCard({ id: 'conduct-d', act: 'conduct', rule: '18' }),
    makeCard({ id: 'cca-a', act: 'cca', rule: '14' }),
  ]

  const at = (n: number) => `2026-03-02T04:${String(n).padStart(2, '0')}:00.000Z`

  it('ranks rules by lapse rate, worst first', () => {
    const logs = [
      // Rule 3: three of four lost.
      entry('conduct-a', 'Again', at(1), 'review'),
      entry('conduct-a', 'Again', at(2), 'review'),
      entry('conduct-b', 'Again', at(3), 'review'),
      entry('conduct-b', 'Good', at(4), 'review'),
      // Rule 11: one of two.
      entry('conduct-c', 'Again', at(5), 'review'),
      entry('conduct-c', 'Good', at(6), 'review'),
      // Rule 18: clean.
      entry('conduct-d', 'Good', at(7), 'review'),
    ]

    const ranked = weakAreas({ cards, logs })
    expect(ranked.map((area) => area.key)).toEqual(['conduct:3', 'conduct:11', 'conduct:18'])
    expect(ranked[0]).toMatchObject({ act: 'conduct', rule: '3', reviews: 4, lapses: 3, rate: 0.75 })
    expect(ranked[0]?.citation).toEqual({ en: 'Rule 3', hi: 'नियम 3' })
    expect(ranked.at(-1)).toMatchObject({ rule: '18', rate: 0 })
  })

  it('breaks a tie on the weight of evidence, so the ranking is not arbitrary', () => {
    const logs = [
      // Rule 11: one lapse in two. Rule 3: two lapses in four. Same rate.
      entry('conduct-c', 'Again', at(1), 'review'),
      entry('conduct-c', 'Good', at(2), 'review'),
      entry('conduct-a', 'Again', at(3), 'review'),
      entry('conduct-a', 'Good', at(4), 'review'),
      entry('conduct-b', 'Again', at(5), 'review'),
      entry('conduct-b', 'Good', at(6), 'review'),
    ]

    const ranked = weakAreas({ cards, logs })
    expect(ranked.map((area) => area.rate)).toEqual([0.5, 0.5])
    expect(ranked.map((area) => area.key)).toEqual(['conduct:3', 'conduct:11'])
  })

  it('is stable whatever order the log arrives in', () => {
    const logs = [
      entry('conduct-a', 'Again', at(1), 'review'),
      entry('conduct-c', 'Again', at(2), 'review'),
      entry('cca-a', 'Again', at(3), 'review'),
    ]
    const forwards = weakAreas({ cards, logs }).map((area) => area.key)
    const backwards = weakAreas({ cards, logs: [...logs].reverse() }).map((area) => area.key)

    expect(forwards).toEqual(backwards)
    expect(forwards).toEqual(['cca:14', 'conduct:11', 'conduct:3'])
  })

  it('can be asked for the book rather than the rule', () => {
    const logs = [
      entry('conduct-a', 'Again', at(1), 'review'),
      entry('conduct-c', 'Good', at(2), 'review'),
      entry('cca-a', 'Again', at(3), 'review'),
    ]
    const ranked = weakAreas({ cards, logs, by: 'act' })

    expect(ranked.map((area) => area.key)).toEqual(['cca', 'conduct'])
    expect(ranked[0]).toMatchObject({ act: 'cca', rule: null, citation: null, rate: 1 })
    expect(ranked[1]).toMatchObject({ reviews: 2, lapses: 1, rate: 0.5 })
  })

  it('holds back a group with too little evidence to rank', () => {
    const logs = [
      entry('conduct-a', 'Again', at(1), 'review'),
      entry('conduct-c', 'Again', at(2), 'review'),
      entry('conduct-c', 'Again', at(3), 'review'),
    ]
    expect(weakAreas({ cards, logs, minReviews: 2 }).map((area) => area.key)).toEqual(['conduct:11'])
  })

  it('can look at the recent past only', () => {
    const logs = [
      entry('conduct-a', 'Again', '2026-01-01T04:00:00.000Z', 'review'),
      entry('conduct-c', 'Again', at(5), 'review'),
    ]
    const recent = weakAreas({ cards, logs, since: new Date('2026-02-01T00:00:00.000Z') })

    expect(recent.map((area) => area.key)).toEqual(['conduct:11'])
  })

  it('ignores a review of a card the catalogue no longer serves', () => {
    // A card the authoring pipeline rejected between two releases. Its history
    // stays in the log as evidence; it must not be ranked as a weak rule.
    const logs = [entry('gone-1', 'Again', at(1), 'review'), entry('conduct-a', 'Good', at(2), 'review')]
    expect(weakAreas({ cards, logs }).map((area) => area.key)).toEqual(['conduct:3'])
  })
})
