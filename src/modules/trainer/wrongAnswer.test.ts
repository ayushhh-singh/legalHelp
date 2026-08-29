import { describe, expect, it } from 'vitest'

import { activeWrongAnswerFor } from './wrongAnswer'

describe('activeWrongAnswerFor', () => {
  const record = { qId: 'q1', due: '2026-08-01T00:00:00.000Z', picked: 'a', correctText: 'b' }

  it('is active when the card and its due both still match', () => {
    const current = { qId: 'q1', srs: { due: '2026-08-01T00:00:00.000Z' } }
    expect(activeWrongAnswerFor(record, current)).toEqual(record)
  })

  it('is null once the card has been graded and comes back with a new due', () => {
    // The exact "Again comes straight back a minute later" case: same qId,
    // but grading rewrote srsCards.due, so this is a fresh, unanswered
    // presentation — not the one the record was about.
    const current = { qId: 'q1', srs: { due: '2026-08-01T00:01:00.000Z' } }
    expect(activeWrongAnswerFor(record, current)).toBeNull()
  })

  it('is null for a different card entirely', () => {
    const current = { qId: 'q2', srs: { due: '2026-08-01T00:00:00.000Z' } }
    expect(activeWrongAnswerFor(record, current)).toBeNull()
  })

  it('is null when there is no current card, or no recorded answer', () => {
    expect(activeWrongAnswerFor(record, null)).toBeNull()
    expect(activeWrongAnswerFor(null, { qId: 'q1', srs: null })).toBeNull()
  })

  it('matches a brand new card (srs still null) against a record captured with due null', () => {
    const brandNew = { qId: 'q1', due: null, picked: 'a', correctText: 'b' }
    expect(activeWrongAnswerFor(brandNew, { qId: 'q1', srs: null })).toEqual(brandNew)
  })

  it('is null once a first-ever review gives the same card a real due', () => {
    const brandNew = { qId: 'q1', due: null, picked: 'a', correctText: 'b' }
    expect(activeWrongAnswerFor(brandNew, { qId: 'q1', srs: { due: '2026-08-01T00:01:00.000Z' } })).toBeNull()
  })
})
