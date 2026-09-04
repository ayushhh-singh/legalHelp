import { describe, expect, it } from 'vitest'

import { cardScore, daysUntil, nextActions, readinessFor, STABILITY_TARGET_DAYS } from './readiness'

import type { SrsCardRow } from '@/lib/srs'
import { learningRow, makeMcqs, makeProfile, reviewRow, statesOf } from '@/test/exam-fixtures'
import { makeCard } from '@/test/rules-cards'

const NOW = new Date('2026-09-04T06:00:00.000Z')

const profile = makeProfile([
  {
    id: 'p1',
    marks: 100,
    units: [
      { id: 'conduct', weight: 0.6, acts: ['ccs-conduct'] },
      { id: 'outside', weight: 0.4, acts: null },
    ],
  },
])

const catalogue = makeMcqs('ccs-conduct', 4)

describe('cardScore', () => {
  it('is 0 for a card with no row and for one that has never been graded', () => {
    expect(cardScore(undefined)).toBe(0)
    expect(cardScore({ ...reviewRow('a', 10), reps: 0 })).toBe(0)
  })

  it('gives part credit to a card in hand but not held', () => {
    const score = cardScore(learningRow('a'))
    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThan(0.6)
  })

  it('scores a relearning card exactly as a learning one', () => {
    // A lapsed card is back in hand rather than held. Scoring it ABOVE a card
    // met for the first time would let a reader raise their readiness by
    // forgetting things, which is the one direction this number must not move.
    const learning = learningRow('a')
    const relearning: SrsCardRow = { ...learning, state: 'relearning', reps: 6, lapses: 2 }
    expect(cardScore(relearning)).toBe(cardScore(learning))
  })

  it('rises with stability inside review state and saturates at the target', () => {
    const low = cardScore(reviewRow('a', 1))
    const mid = cardScore(reviewRow('a', STABILITY_TARGET_DAYS / 2))
    const at = cardScore(reviewRow('a', STABILITY_TARGET_DAYS))
    const beyond = cardScore(reviewRow('a', STABILITY_TARGET_DAYS * 10))
    expect(low).toBeLessThan(mid)
    expect(mid).toBeLessThan(at)
    expect(at).toBe(1)
    expect(beyond).toBe(1)
  })

  it('never exceeds 1 or falls below 0 for any state', () => {
    for (const state of ['new', 'learning', 'review', 'relearning'] as const) {
      for (const stability of [0, 0.01, 5, 21, 1000]) {
        const score = cardScore({ ...reviewRow('a', stability), state })
        expect(score).toBeGreaterThanOrEqual(0)
        expect(score).toBeLessThanOrEqual(1)
      }
    }
  })
})

describe('readinessFor', () => {
  it('is 0 across the board on a device that has never studied', () => {
    const readiness = readinessFor({ profile, catalogue, states: new Map(), now: NOW })
    expect(readiness.overall).toBe(0)
    expect(readiness.unseenCards).toBe(4)
    expect(readiness.units.map((unit) => unit.ready)).toEqual([0, 0])
  })

  it('reaches 1 when every approved card is held and every card is approved', () => {
    const states = statesOf(catalogue.map((card) => reviewRow(card.id, STABILITY_TARGET_DAYS)))
    const readiness = readinessFor({ profile, catalogue, states, now: NOW })
    expect(readiness.overall).toBe(1)
    expect(readiness.unseenCards).toBe(0)
  })

  it('caps a unit below 1 when some of its cards are not approved', () => {
    // The whole reason `ready` is mastery TIMES coverage. Four approved of six:
    // a reader who has held all four is two-thirds ready on the unit, not fully.
    const withUnapproved = [
      ...catalogue,
      makeCard({ id: 'x', act: 'ccs-conduct', rule: '9', reviewState: 'needs-hindi' }),
      makeCard({ id: 'y', act: 'ccs-conduct', rule: '10', reviewState: 'unreviewed' }),
    ]
    const states = statesOf(catalogue.map((card) => reviewRow(card.id, STABILITY_TARGET_DAYS)))
    const readiness = readinessFor({ profile, catalogue: withUnapproved, states, now: NOW })
    const conduct = readiness.units[0]!
    expect(conduct.mastery).toBe(1)
    expect(conduct.coverage).toBeCloseTo(4 / 6, 10)
    expect(conduct.ready).toBeCloseTo(4 / 6, 10)
  })

  it('divides by the MAPPED marks, and reports the share separately', () => {
    // Over the whole paper the figure could never reach 1 and the caveat would
    // be hidden inside the number, where nobody can read it.
    const states = statesOf(catalogue.map((card) => reviewRow(card.id, STABILITY_TARGET_DAYS)))
    const readiness = readinessFor({ profile, catalogue, states, now: NOW })
    expect(readiness.overall).toBe(1)
    expect(readiness.mappedMarksShare).toBeCloseTo(0.6, 10)
  })

  it('marks the external unit as external and gives it no cards', () => {
    const readiness = readinessFor({ profile, catalogue, states: new Map(), now: NOW })
    const outside = readiness.units[1]!
    expect(outside.external).toBe(true)
    expect(outside.servedCards).toBe(0)
    expect(outside.coverage).toBe(0)
  })

  it('is MONOTONIC: advancing any card can never lower any figure', () => {
    /*
      The property the whole screen rests on. Walked over every card in turn,
      through the real progression a card takes — unseen, learning, review at
      rising stability — asserting that neither the unit bar nor the overall
      figure ever falls.

      Written as a walk rather than as two hand-built maps because a two-point
      comparison passes against a scoring function that dips in the middle,
      which is exactly what a `relearning` tier below `learning` would have done.
    */
    const ladder: (id: string) => (SrsCardRow | undefined)[] = (id) => [
      undefined,
      learningRow(id),
      reviewRow(id, 1),
      reviewRow(id, 7),
      reviewRow(id, STABILITY_TARGET_DAYS),
      reviewRow(id, 90),
    ]

    const states = new Map<string, SrsCardRow>()
    let previousOverall = readinessFor({ profile, catalogue, states, now: NOW }).overall
    let previousUnit = 0

    for (const card of catalogue) {
      for (const row of ladder(card.id)) {
        if (row) states.set(card.id, row)
        else states.delete(card.id)
        const readiness = readinessFor({ profile, catalogue, states, now: NOW })
        expect(readiness.overall).toBeGreaterThanOrEqual(previousOverall - 1e-12)
        expect(readiness.units[0]!.ready).toBeGreaterThanOrEqual(previousUnit - 1e-12)
        previousOverall = readiness.overall
        previousUnit = readiness.units[0]!.ready
      }
    }
    expect(previousOverall).toBe(1)
  })

  it('reports no days remaining when no target date has been chosen', () => {
    expect(readinessFor({ profile, catalogue, states: new Map(), now: NOW }).daysRemaining).toBeNull()
  })
})

describe('daysUntil', () => {
  // 06:00Z on the 4th is 11:30 IST on the 4th.
  it('is 0 on the day itself', () => {
    expect(daysUntil('2026-09-04', NOW)).toBe(0)
  })

  it('counts whole IST days forward', () => {
    expect(daysUntil('2026-09-05', NOW)).toBe(1)
    expect(daysUntil('2026-10-04', NOW)).toBe(30)
  })

  it('goes negative once the day has passed', () => {
    expect(daysUntil('2026-09-01', NOW)).toBe(-3)
  })

  it('reads the IST day and not the UTC one either side of the boundary', () => {
    // 18:29:59.999Z is 23:59:59.999 IST on the same day; one millisecond later
    // is the next IST day, and an examination "tomorrow" becomes "today".
    const lateIst = new Date('2026-09-04T18:29:59.999Z')
    const nextIst = new Date('2026-09-04T18:30:00.000Z')
    expect(daysUntil('2026-09-05', lateIst)).toBe(1)
    expect(daysUntil('2026-09-05', nextIst)).toBe(0)
  })
})

describe('nextActions', () => {
  const wide = makeProfile([
    {
      id: 'p1',
      marks: 300,
      units: [
        { id: 'heavy', weight: 0.5, acts: ['gfr'] },
        { id: 'light', weight: 0.2, acts: ['posh'] },
        { id: 'middle', weight: 0.2, acts: ['rti'] },
        { id: 'outside', weight: 0.1, acts: null },
      ],
    },
  ])
  const wideCatalogue = [...makeMcqs('gfr', 4), ...makeMcqs('posh', 4), ...makeMcqs('rti', 4)]

  const actionsFor = (states: Map<string, SrsCardRow>, elapsed: number | null = 0) => {
    const readiness = readinessFor({
      profile: wide,
      catalogue: wideCatalogue,
      states,
      now: NOW,
      targetDate: '2026-12-01',
    })
    return nextActions({ ...readiness, profile: wide, elapsedFraction: elapsed })
  }

  it('returns at most three', () => {
    expect(actionsFor(new Map())).toHaveLength(3)
  })

  it('ranks by marks at stake, not by accuracy', () => {
    // `heavy` is 150 marks and `light` is 60. Both untouched, so both are at
    // zero accuracy — and the one worth two and a half times as much comes
    // first, which is the whole point of ranking on `gapMarks`.
    const [first] = actionsFor(new Map())
    expect(first?.unitId).toBe('heavy')
  })

  it('says "meet new cards" while any are unseen and "drill" once none are', () => {
    expect(actionsFor(new Map())[0]?.kind).toBe('meet-new-cards')
    const seen = statesOf(wideCatalogue.map((card) => reviewRow(card.id, 1)))
    expect(actionsFor(seen)[0]?.kind).toBe('drill-weak-unit')
  })

  it('asks for a target date first when there is none', () => {
    const readiness = readinessFor({ profile: wide, catalogue: wideCatalogue, states: new Map(), now: NOW })
    const actions = nextActions({ ...readiness, profile: wide })
    expect(actions[0]?.kind).toBe('set-target-date')
  })

  it('does not suggest a mock on day one, and does once there is something to measure', () => {
    // A mock sat before anything is learnt measures nothing but morale.
    const held = statesOf(wideCatalogue.map((card) => reviewRow(card.id, STABILITY_TARGET_DAYS)))
    expect(actionsFor(held, 0).map((a) => a.kind)).not.toContain('take-mock')
    expect(actionsFor(held, 0.8).map((a) => a.kind)).toContain('take-mock')
  })

  it('names the part of the syllabus this app cannot help with, once there is room', () => {
    const held = statesOf(wideCatalogue.map((card) => reviewRow(card.id, STABILITY_TARGET_DAYS)))
    const actions = actionsFor(held, 0)
    const outside = actions.find((action) => action.kind === 'read-outside')
    expect(outside?.count).toBe(30)
  })

  it('carries the act to open on a unit-shaped action, and null on the others', () => {
    const actions = actionsFor(new Map())
    expect(actions[0]?.actId).toBe('gfr')
    const readiness = readinessFor({ profile: wide, catalogue: wideCatalogue, states: new Map(), now: NOW })
    expect(nextActions({ ...readiness, profile: wide })[0]?.actId).toBeNull()
  })

  it('is stable: the same inputs give the same three, in the same order', () => {
    const states = statesOf([reviewRow('gfr-q1', 30), reviewRow('posh-q1', 30)])
    expect(actionsFor(states)).toEqual(actionsFor(states))
  })
})
