import { describe, expect, it } from 'vitest'

import { buildPlan, cardScore, daysUntil, MAX_PLAN_DAYS, nextActions, readinessFor } from './index'

import type { SrsCardRow } from '@/lib/srs'
import { makeMcqs, makeProfile, reviewRow, statesOf } from '@/test/exam-fixtures'

/**
 * The edge-case pass over Session 32's pure layer.
 *
 * Every test here was confirmed to FAIL against the committed code before its
 * fix was written — the standard `src/lib/srs/edge.test.ts` and
 * `src/lib/study/edge.test.ts` set, and the reason `network.sentinel`'s own
 * story is told three times in CLAUDE.md.
 *
 * The pattern this pass found is the one ADR-039's addendum named and this
 * module repeated: the DATA was distrusted and the DEVICE was not. A profile is
 * schema-parsed, a coverage entry is resolved in both directions and a card is
 * checked for a key — while a row out of IndexedDB, which is untrusted input
 * like any other, was read as though this app had written it that minute.
 */

const NOW = new Date('2026-09-04T06:00:00.000Z')

const profile = makeProfile([
  {
    id: 'p1',
    marks: 150,
    units: [
      { id: 'a', weight: 0.5, acts: ['ccs-conduct'] },
      { id: 'b', weight: 0.5, acts: null },
    ],
  },
])
const catalogue = makeMcqs('ccs-conduct', 8)

describe('daysUntil is exact, or says it does not know', () => {
  it('counts a decade correctly rather than saturating at its own walk limit', () => {
    // The first version walked `addIstDays` up to 366 × 5 and returned the LIMIT
    // when it ran out — so a date ten years away reported 1,830 days, and so did
    // a date five years away, and so did a string that is not a date at all.
    // 3,653 and not 3,652: 2028, 2032 and 2036 are leap years. Worked out from
    // the calendar rather than from the code, which is the point of the test.
    expect(daysUntil('2036-09-04', NOW)).toBe(3653)
    expect(daysUntil('2027-09-04', NOW)).toBe(365)
  })

  it('returns null for a value that is not an IST calendar day', () => {
    // It used to return 1,830 — indistinguishable from a real five-year window,
    // which is how a corrupt row becomes a plausible-looking number on screen.
    for (const bad of ['not-a-day', '2027-02-31', '2027-2-1', '', '04.09.2026']) {
      expect(daysUntil(bad, NOW), bad).toBeNull()
    }
  })

  it('is the ONE answer to "how many days" — the screen no longer has its own', () => {
    // `ExamHubPage` had its own inline `Date.parse` arithmetic, which was exact
    // where this was saturating: two code paths answering one question and
    // disagreeing about it, which is the family `src/lib/srs/edge.test.ts`
    // found five of.
    expect(daysUntil('2026-09-05', NOW)).toBe(1)
    expect(daysUntil('2026-09-04', NOW)).toBe(0)
    expect(daysUntil('2026-09-01', NOW)).toBe(-3)
  })
})

describe('a corrupt schedule row cannot poison a readiness figure', () => {
  const corrupt = (over: Partial<SrsCardRow>): SrsCardRow => ({ ...reviewRow('ccs-conduct-q1', 10), ...over })

  it('scores a row with a non-finite stability as unheld rather than as NaN', () => {
    // `Math.min(1, NaN / 21)` is NaN, and NaN propagated through the mean all
    // the way to `overall` — which rendered as "NaN% ready".
    for (const stability of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const score = cardScore(corrupt({ stability }))
      expect(Number.isFinite(score), String(stability)).toBe(true)
      expect(score).toBeGreaterThanOrEqual(0)
      expect(score).toBeLessThanOrEqual(1)
    }
  })

  it('gives a negative stability no more credit than a card in learning', () => {
    // It used to score 0.50 — more than a card the reader has actually met
    // once, from a number that cannot occur in a schedule this app wrote.
    expect(cardScore(corrupt({ stability: -5 }))).toBeLessThanOrEqual(cardScore(corrupt({ stability: 0 })))
    expect(cardScore(corrupt({ stability: -5 }))).toBeGreaterThanOrEqual(0)
  })

  it('keeps every readiness figure finite when a row is corrupt', () => {
    const states = statesOf([corrupt({ stability: Number.NaN })])
    const readiness = readinessFor({ profile, catalogue, states, now: NOW })
    expect(Number.isFinite(readiness.overall)).toBe(true)
    for (const unit of readiness.units) {
      expect(Number.isFinite(unit.ready), unit.key).toBe(true)
      expect(Number.isFinite(unit.mastery), unit.key).toBe(true)
      expect(Number.isFinite(unit.gapMarks), unit.key).toBe(true)
    }
  })
})

describe('nextActions can actually reach every kind it declares', () => {
  const held = statesOf(catalogue.map((card) => reviewRow(card.id, 60)))

  const actionsWith = (targetDate: string) => {
    const readiness = readinessFor({ profile, catalogue, states: held, now: NOW, targetDate })
    return nextActions({ ...readiness, profile }).map((action) => action.kind)
  }

  it('offers a mock from the elapsed fraction it can work out ITSELF', () => {
    /*
      The defect this replaces is the one CLAUDE.md names most often. The
      library's own composition was fixed so `take-mock` had a slot; the hub
      then called it with `elapsedFraction: null` on every render, so the branch
      was dead from the only place it is called.

      `nextActions` derives the fraction now — it already has `daysRemaining`,
      and the caller passing a number it could compute itself was the whole
      mistake. An explicit `elapsedFraction` still wins where one is given.
    */
    expect(actionsWith('2026-09-06')).toContain('take-mock')
  })

  it('still does not offer one on the first day of a long window', () => {
    // A mock sat before anything is learnt measures nothing but morale.
    expect(actionsWith('2027-09-04')).not.toContain('take-mock')
  })
})

describe('buildPlan refuses what it cannot plan', () => {
  const plan = (targetDate: string) =>
    buildPlan({ profile, catalogue, states: new Map(), now: NOW, targetDate })

  it('draws nothing for a target date that is not a calendar day', () => {
    // It used to draw the full 400 days: `'not-a-day' < '2026-09-04'` is false
    // as a string, so the expiry guard passed, and `daysUntil` then saturated.
    for (const bad of ['not-a-day', '2027-02-31', '']) {
      const built = plan(bad)
      expect(built.days, bad).toEqual([])
      expect(built.unreadableDate, bad).toBe(true)
    }
  })

  it('reports a window it had to cut short rather than just stopping', () => {
    // A date ten years out silently produced 400 days ending in 2027 while
    // `to` still read 2036 — a plan that stops with nothing saying why.
    const built = plan('2036-09-04')
    expect(built.days).toHaveLength(MAX_PLAN_DAYS)
    expect(built.truncated).toBe(true)
    expect(built.days.at(-1)?.day).toBe(built.to)
  })

  it('does not claim truncation on a window that fits', () => {
    const built = plan('2026-12-01')
    expect(built.truncated).toBe(false)
    expect(built.days.at(-1)?.day).toBe('2026-12-01')
  })

  it('is still expired for a date in the past', () => {
    const built = plan('2020-01-01')
    expect(built.expired).toBe(true)
    expect(built.unreadableDate).toBe(false)
  })
})
