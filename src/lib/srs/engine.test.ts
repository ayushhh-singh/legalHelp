import { describe, expect, it } from 'vitest'

import { clampRetention, createCard, gradeCard, previewGrades, retrievability } from './engine'
import { GRADES, MAX_DESIRED_RETENTION, MIN_DESIRED_RETENTION, type Grade, type SrsCardRow } from './types'

/**
 * A frozen clock throughout. Every assertion here is a claim about the schedule
 * produced by a named grade at a named instant, which is only a claim at all
 * because fuzz is off — see the note at the top of `engine.ts`.
 */
const T0 = new Date('2026-01-01T09:00:00.000Z')

const at = (iso: string) => new Date(iso)
const dueMs = (row: SrsCardRow) => Date.parse(row.due)
const intervalMs = (row: SrsCardRow, from: Date) => dueMs(row) - from.getTime()

/** Grade a card repeatedly, each time at the instant it fell due. */
function drill(row: SrsCardRow, grades: readonly Grade[], start: Date): SrsCardRow[] {
  const history: SrsCardRow[] = []
  let card = row
  let now = start
  for (const grade of grades) {
    card = gradeCard(card, grade, now).card
    history.push(card)
    now = at(card.due)
  }
  return history
}

describe('createCard', () => {
  it('makes a card that is new, unseen and due immediately', () => {
    const card = createCard('ccs-conduct-rule-3', T0)

    expect(card).toEqual({
      qId: 'ccs-conduct-rule-3',
      due: T0.toISOString(),
      stability: 0,
      difficulty: 0,
      elapsed: 0,
      scheduled: 0,
      reps: 0,
      lapses: 0,
      state: 'new',
      lastReview: null,
      lastGrade: null,
      learningSteps: 0,
    })
  })

  it('is plain JSON — it survives a stringify unchanged', () => {
    const card = createCard('x', T0)
    expect(JSON.parse(JSON.stringify(card))).toEqual(card)
  })
})

describe('gradeCard', () => {
  it('advances a new card into learning and records the first review', () => {
    const { card, log } = gradeCard(createCard('q1', T0), 'Good', T0, { durationMs: 4_200 })

    expect(card.state).toBe('learning')
    expect(card.reps).toBe(1)
    expect(card.lastGrade).toBe('Good')
    expect(card.lastReview).toBe(T0.toISOString())
    expect(dueMs(card)).toBeGreaterThan(T0.getTime())

    expect(log).toEqual({
      id: `q1#1#${T0.toISOString()}`,
      qId: 'q1',
      grade: 'Good',
      at: T0.toISOString(),
      durationMs: 4_200,
      // The state the reader was shown, not the state it is in now.
      stateBefore: 'new',
      elapsed: 0,
      // A card with no memory yet has no chance-of-recall to predict.
      retrievability: null,
    })
  })

  it('is deterministic — the same card graded the same way twice agrees', () => {
    const card = createCard('q1', T0)
    expect(gradeCard(card, 'Good', T0)).toEqual(gradeCard(card, 'Good', T0))
  })

  it('orders the four grades monotonically at every stage of a card life', () => {
    let card = createCard('q1', T0)
    let now = T0

    // New, learning, and then four points along the review schedule.
    for (let step = 0; step < 6; step += 1) {
      const preview = previewGrades(card, now)
      const dues = GRADES.map((grade) => dueMs(preview[grade]))

      expect(dues, `grades out of order at step ${step} (state ${card.state}): ${dues.join(' ')}`).toEqual(
        [...dues].sort((a, b) => a - b),
      )

      card = gradeCard(card, 'Good', now).card
      now = at(card.due)
    }
  })

  it('grows the interval on repeated Good, and never shrinks it', () => {
    let card = createCard('q1', T0)
    let now = T0
    const intervals: number[] = []

    for (let step = 0; step < 8; step += 1) {
      const next = gradeCard(card, 'Good', now).card
      intervals.push(intervalMs(next, now))
      card = next
      now = at(card.due)
    }

    for (let i = 1; i < intervals.length; i += 1) {
      expect(
        intervals[i],
        `interval shrank at review ${i + 1}: ${intervals.join(' ')}`,
      ).toBeGreaterThanOrEqual(intervals[i - 1]!)
    }
    // Eight passes take the card from minutes to months.
    expect(intervals.at(-1)!).toBeGreaterThan(90 * 86_400_000)
  })

  it('Easy grows the interval further than Good, and Good further than Hard', () => {
    // Three passes puts the card into review state, where the four grades are
    // genuinely four different intervals rather than learning steps.
    const [, , mature] = drill(createCard('q1', T0), ['Good', 'Good', 'Good'], T0)
    expect(mature!.state).toBe('review')

    const now = at(mature!.due)
    const preview = previewGrades(mature!, now)

    expect(intervalMs(preview.Easy, now)).toBeGreaterThan(intervalMs(preview.Good, now))
    expect(intervalMs(preview.Good, now)).toBeGreaterThan(intervalMs(preview.Hard, now))
    expect(intervalMs(preview.Hard, now)).toBeGreaterThan(intervalMs(preview.Again, now))
    expect(preview.Easy.stability).toBeGreaterThan(preview.Good.stability)
  })

  it('Again on a learnt card resets it to relearning, counts a lapse and reschedules in minutes', () => {
    const [, , mature] = drill(createCard('q1', T0), ['Good', 'Good', 'Good'], T0)
    expect(mature!.state).toBe('review')
    expect(mature!.lapses).toBe(0)
    const wasScheduled = mature!.scheduled
    expect(wasScheduled).toBeGreaterThan(1)

    const now = at(mature!.due)
    const { card, log } = gradeCard(mature!, 'Again', now)

    expect(card.state).toBe('relearning')
    expect(card.lapses).toBe(1)
    expect(card.lastGrade).toBe('Again')
    // Back within the hour, not in a fortnight.
    expect(intervalMs(card, now)).toBeLessThanOrEqual(60 * 60_000)
    expect(card.stability).toBeLessThan(mature!.stability)

    // The log keeps the state the reader was shown — 'review', not 'relearning'.
    expect(log.stateBefore).toBe('review')
    expect(log.retrievability).toBeGreaterThan(0)
  })

  it('brings a relearnt card back to review, keeping the lapse on its record', () => {
    const [, , mature] = drill(createCard('q1', T0), ['Good', 'Good', 'Good'], T0)
    const lapsed = gradeCard(mature!, 'Again', at(mature!.due)).card
    const recovered = gradeCard(lapsed, 'Good', at(lapsed.due)).card

    expect(recovered.state).toBe('review')
    expect(recovered.lapses).toBe(1)
  })

  it('keeps the (re)learning step, which is what lets a card graduate after a reload', () => {
    const first = gradeCard(createCard('q1', T0), 'Good', T0).card
    expect(first.learningSteps).toBe(1)

    // A reload: the row goes out through JSON and comes back.
    const reloaded = JSON.parse(JSON.stringify(first)) as SrsCardRow
    const second = gradeCard(reloaded, 'Good', at(reloaded.due)).card

    // Step 2 of `1m, 10m` graduates. A row that forgot its step would be sent
    // round the first minute again and never leave learning.
    expect(second.state).toBe('review')
    expect(second.scheduled).toBeGreaterThanOrEqual(1)
  })

  it('gives every review a distinct, reproducible id', () => {
    let card = createCard('q1', T0)
    let now = T0
    const ids: string[] = []

    for (const grade of ['Good', 'Again', 'Good', 'Easy'] as const) {
      const result = gradeCard(card, grade, now)
      ids.push(result.log.id)
      card = result.card
      now = at(card.due)
    }

    expect(new Set(ids).size).toBe(ids.length)
    expect(ids[0]).toBe(`q1#1#${T0.toISOString()}`)
  })

  it('clamps a clock that has gone backwards to the card own last review', () => {
    const first = gradeCard(createCard('q1', T0), 'Good', T0).card
    const backwards = new Date(T0.getTime() - 86_400_000)

    const { card, log } = gradeCard(first, 'Good', backwards)

    expect(log.at).toBe(first.lastReview)
    expect(dueMs(card)).toBeGreaterThanOrEqual(Date.parse(first.lastReview!))
  })

  it('records the time taken as a whole non-negative number of milliseconds', () => {
    expect(gradeCard(createCard('q1', T0), 'Good', T0, { durationMs: 12.6 }).log.durationMs).toBe(13)
    expect(gradeCard(createCard('q1', T0), 'Good', T0, { durationMs: -5 }).log.durationMs).toBe(0)
    expect(gradeCard(createCard('q1', T0), 'Good', T0).log.durationMs).toBe(0)
  })
})

describe('desired retention', () => {
  it('shortens every interval as the reader asks for more retention', () => {
    const [, , mature] = drill(createCard('q1', T0), ['Good', 'Good', 'Good'], T0)
    const now = at(mature!.due)

    const relaxed = gradeCard(mature!, 'Good', now, { desiredRetention: 0.8 }).card
    const standard = gradeCard(mature!, 'Good', now, { desiredRetention: 0.9 }).card
    const strict = gradeCard(mature!, 'Good', now, { desiredRetention: 0.97 }).card

    expect(relaxed.scheduled).toBeGreaterThan(standard.scheduled)
    expect(standard.scheduled).toBeGreaterThan(strict.scheduled)
  })

  it('clamps a corrupt setting rather than letting it throw the trainer open', () => {
    expect(clampRetention(0.9)).toBe(0.9)
    expect(clampRetention(0)).toBe(MIN_DESIRED_RETENTION)
    expect(clampRetention(1)).toBe(MAX_DESIRED_RETENTION)
    expect(clampRetention(-3)).toBe(MIN_DESIRED_RETENTION)
    expect(clampRetention(Number.NaN)).toBe(0.9)

    expect(() => gradeCard(createCard('q1', T0), 'Good', T0, { desiredRetention: 0 })).not.toThrow()
  })
})

describe('retrievability', () => {
  it('is null for a card with no memory yet', () => {
    expect(retrievability(createCard('q1', T0), T0)).toBeNull()
  })

  it('falls as a learnt card is left alone', () => {
    const [, , mature] = drill(createCard('q1', T0), ['Good', 'Good', 'Good'], T0)
    const onTime = retrievability(mature!, at(mature!.due))!
    const late = retrievability(mature!, new Date(dueMs(mature!) + 60 * 86_400_000))!

    expect(onTime).toBeGreaterThan(0.85)
    expect(onTime).toBeLessThanOrEqual(1)
    expect(late).toBeLessThan(onTime)
  })
})
