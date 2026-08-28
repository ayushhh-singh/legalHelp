import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { clampRetention, createCard, gradeCard, previewGrades, retrievability } from './engine'
import { GRADES, MAX_DESIRED_RETENTION, MIN_DESIRED_RETENTION, type Grade, type SrsCardRow } from './types'

/**
 * Property-based tests for the scheduler.
 *
 * `engine.test.ts` and `edge.test.ts` assert particular schedules against a
 * frozen clock — a golden interval for a given history. This file asserts the
 * things that must hold for EVERY history, and the one that matters most is
 * **grade monotonicity**: over any card in any state, at any retention setting,
 *
 *     Again ≤ Hard ≤ Good ≤ Easy
 *
 * in the interval each button produces. A reader learns the four buttons as an
 * ordered scale, and a scheduler that ever inverts two of them is teaching them
 * something false about their own collection. FSRS itself guarantees this, but
 * `src/lib/srs/engine.ts` is a translation layer over it — a swapped entry in
 * `RATING`, a `toRow`/`toFsrsCard` field crossed over, or a lost
 * `learningSteps` would break the ordering without breaking any single golden
 * interval, and this is the shape of test that catches that.
 *
 * Everything runs against an explicit `now`. `purity.test.ts` already forbids
 * this directory from reading a clock; these tests pass one in, which is the
 * same discipline from the caller's side.
 *
 * Fuzz is off (ADR-025), so every property here is deterministic: the same card
 * graded the same way at the same instant gives the same due date on every run.
 * That is what makes an interval comparison a legitimate assertion rather than
 * a flaky one.
 */

const START = new Date('2026-08-29T04:00:00.000Z')

const MINUTE = 60_000
const DAY = 86_400_000

const dueMs = (row: SrsCardRow) => new Date(row.due).getTime()

/** A card put through an arbitrary history, so states other than `new` are reached. */
const cardWithHistory = () =>
  fc.array(fc.constantFrom<Grade>(...GRADES), { minLength: 0, maxLength: 8 }).map((grades) => {
    let row = createCard('ccs-conduct-rule-3', START)
    let at = START
    for (const grade of grades) {
      row = gradeCard(row, grade, at).card
      // Advance to whenever the card next falls due, so the next grade is
      // given at a realistic elapsed time rather than all at one instant.
      at = new Date(Math.max(at.getTime() + MINUTE, dueMs(row)))
    }
    return { row, at }
  })

const retention = () => fc.double({ min: MIN_DESIRED_RETENTION, max: MAX_DESIRED_RETENTION, noNaN: true })

describe('gradeCard — the grades are an ordered scale', () => {
  it('never schedules Again later than Hard, Hard later than Good, or Good later than Easy', () => {
    fc.assert(
      fc.property(cardWithHistory(), retention(), ({ row, at }, desiredRetention) => {
        const preview = previewGrades(row, at, desiredRetention)
        const dues = GRADES.map((grade) => dueMs(preview[grade]))
        for (let i = 1; i < dues.length; i += 1) {
          expect(dues[i]!, `${GRADES[i]} came before ${GRADES[i - 1]}`).toBeGreaterThanOrEqual(dues[i - 1]!)
        }
      }),
      { numRuns: 200 },
    )
  })

  it('never gives a lower stability for a better grade', () => {
    fc.assert(
      fc.property(cardWithHistory(), retention(), ({ row, at }, desiredRetention) => {
        const preview = previewGrades(row, at, desiredRetention)
        const stabilities = GRADES.map((grade) => preview[grade].stability)
        for (let i = 1; i < stabilities.length; i += 1) {
          expect(stabilities[i]!).toBeGreaterThanOrEqual(stabilities[i - 1]!)
        }
      }),
      { numRuns: 200 },
    )
  })

  it('never gives a higher difficulty for a better grade', () => {
    // Difficulty runs the other way: Again is the hardest reading of the card.
    fc.assert(
      fc.property(cardWithHistory(), retention(), ({ row, at }, desiredRetention) => {
        const preview = previewGrades(row, at, desiredRetention)
        const difficulties = GRADES.map((grade) => preview[grade].difficulty)
        for (let i = 1; i < difficulties.length; i += 1) {
          expect(difficulties[i]!).toBeLessThanOrEqual(difficulties[i - 1]!)
        }
      }),
      { numRuns: 200 },
    )
  })
})

describe('gradeCard — invariants of the stored row', () => {
  it('always advances reps by exactly one and never decreases lapses', () => {
    fc.assert(
      fc.property(cardWithHistory(), fc.constantFrom<Grade>(...GRADES), ({ row, at }, grade) => {
        const { card } = gradeCard(row, grade, at)
        expect(card.reps).toBe(row.reps + 1)
        expect(card.lapses).toBeGreaterThanOrEqual(row.lapses)
        expect(card.lapses - row.lapses).toBeLessThanOrEqual(1)
      }),
      { numRuns: 200 },
    )
  })

  it('keeps difficulty inside FSRS’s own 1-10 range and stability positive', () => {
    fc.assert(
      fc.property(cardWithHistory(), fc.constantFrom<Grade>(...GRADES), ({ row, at }, grade) => {
        const { card } = gradeCard(row, grade, at)
        expect(card.difficulty).toBeGreaterThanOrEqual(1)
        expect(card.difficulty).toBeLessThanOrEqual(10)
        expect(card.stability).toBeGreaterThan(0)
        expect(Number.isFinite(card.stability)).toBe(true)
      }),
      { numRuns: 200 },
    )
  })

  it('never schedules a card into the past', () => {
    fc.assert(
      fc.property(cardWithHistory(), fc.constantFrom<Grade>(...GRADES), ({ row, at }, grade) => {
        const { card } = gradeCard(row, grade, at)
        expect(dueMs(card)).toBeGreaterThanOrEqual(at.getTime())
      }),
      { numRuns: 200 },
    )
  })

  it('stores every timestamp in exactly the shape toISOString() produces', () => {
    // `reviewLog.at` is a Dexie index that store.ts range-queries, and
    // IndexedDB orders strings by code unit — lexicographic order is
    // chronological order only for this one shape. A `+05:30` offset or a bare
    // `Z` without milliseconds is valid ISO-8601 and sorts into the wrong day.
    fc.assert(
      fc.property(cardWithHistory(), fc.constantFrom<Grade>(...GRADES), ({ row, at }, grade) => {
        const { card, log } = gradeCard(row, grade, at)
        for (const stamp of [card.due, card.lastReview, log.at]) {
          if (stamp == null) continue
          expect(stamp).toBe(new Date(stamp).toISOString())
        }
      }),
      { numRuns: 200 },
    )
  })

  it('is deterministic — fuzz is off, so the same grade at the same instant repeats', () => {
    fc.assert(
      fc.property(cardWithHistory(), fc.constantFrom<Grade>(...GRADES), ({ row, at }, grade) => {
        expect(gradeCard(row, grade, at).card).toEqual(gradeCard(row, grade, at).card)
      }),
      { numRuns: 200 },
    )
  })

  it('clamps a clock that has gone backwards to the card’s own last review', () => {
    fc.assert(
      fc.property(
        cardWithHistory(),
        fc.constantFrom<Grade>(...GRADES),
        fc.integer({ min: 1, max: 400 }),
        ({ row, at }, grade, daysBack) => {
          const backwards = new Date(at.getTime() - daysBack * DAY)
          const { card, log } = gradeCard(row, grade, backwards)
          // Never a negative elapsed time handed to FSRS, and never a due date
          // before the review that produced it.
          expect(log.elapsed).toBeGreaterThanOrEqual(0)
          expect(dueMs(card)).toBeGreaterThanOrEqual(new Date(log.at).getTime())
        },
      ),
      { numRuns: 200 },
    )
  })

  it('records the state the card was in when it was asked, not the state it moved to', () => {
    fc.assert(
      fc.property(cardWithHistory(), fc.constantFrom<Grade>(...GRADES), ({ row, at }, grade) => {
        const { log } = gradeCard(row, grade, at)
        // Retention cannot be measured from the card rows: grading a card
        // overwrites the state it was in. `stateBefore` is why it can be.
        expect(log.stateBefore).toBe(row.state)
        expect(log.id).toBe(`${row.qId}#${row.reps + 1}#${log.at}`)
      }),
      { numRuns: 200 },
    )
  })
})

describe('retrievability', () => {
  it('is null for a card that has never been graded, never zero', () => {
    // Zero is a different claim — "certainly forgotten" rather than "never
    // learnt" — and averaging it into a retention figure drags it to nothing.
    expect(retrievability(createCard('q', START), START)).toBeNull()
  })

  it('is a probability, and never rises as the card is left longer unseen', () => {
    fc.assert(
      fc.property(
        cardWithHistory(),
        fc.integer({ min: 0, max: 720 }),
        fc.integer({ min: 1, max: 720 }),
        ({ row, at }, first, extra) => {
          fc.pre(row.reps > 0)
          const earlier = retrievability(row, new Date(at.getTime() + first * DAY))
          const later = retrievability(row, new Date(at.getTime() + (first + extra) * DAY))
          expect(earlier).not.toBeNull()
          expect(later).not.toBeNull()
          expect(earlier!).toBeGreaterThanOrEqual(0)
          expect(earlier!).toBeLessThanOrEqual(1)
          expect(later!).toBeLessThanOrEqual(earlier!)
        },
      ),
      { numRuns: 200 },
    )
  })
})

describe('clampRetention', () => {
  it('always returns a value FSRS will accept', () => {
    fc.assert(
      fc.property(fc.double({ noDefaultInfinity: false, noNaN: false }), (value) => {
        const clamped = clampRetention(value)
        expect(clamped).toBeGreaterThanOrEqual(MIN_DESIRED_RETENTION)
        expect(clamped).toBeLessThanOrEqual(MAX_DESIRED_RETENTION)
        expect(Number.isFinite(clamped)).toBe(true)
      }),
    )
  })

  it('is idempotent, so a stored setting does not drift on every read', () => {
    fc.assert(
      fc.property(fc.double({ noDefaultInfinity: false, noNaN: false }), (value) => {
        expect(clampRetention(clampRetention(value))).toBe(clampRetention(value))
      }),
    )
  })

  it('rounds to three places, so the scheduler cache has a finite set of keys', () => {
    fc.assert(
      fc.property(fc.double({ min: 0.7, max: 0.99, noNaN: true }), (value) => {
        // 0.9 and 0.9000000001 are the same request and must not become two
        // entries in a map that nothing ever evicts.
        expect(Math.round(clampRetention(value) * 1000)).toBe(clampRetention(value) * 1000)
      }),
    )
  })

  it('falls back to 0.9 rather than throwing on a corrupt settings row', () => {
    // Every non-finite value takes the same route, including both infinities:
    // the guard is `Number.isFinite`, which is false for all three, so none of
    // them reaches the clamp. A corrupt row must not make the trainer
    // unopenable, and it must not silently become the extreme setting either.
    expect(clampRetention(Number.NaN)).toBe(0.9)
    expect(clampRetention(Number.POSITIVE_INFINITY)).toBe(0.9)
    expect(clampRetention(Number.NEGATIVE_INFINITY)).toBe(0.9)
    // A finite value outside the range is a different case, and IS clamped.
    expect(clampRetention(5)).toBe(MAX_DESIRED_RETENTION)
    expect(clampRetention(-5)).toBe(MIN_DESIRED_RETENTION)
  })
})
