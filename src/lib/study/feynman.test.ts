import { describe, expect, it } from 'vitest'

import {
  confidenceFromAttempt,
  FEYNMAN_GRADES,
  FEYNMAN_PROMPTS,
  isFeynmanGrade,
  isSubmittable,
  latestAttempt,
  normaliseGrades,
  scoreAttempt,
} from './feynman'
import type { FeynmanAttemptRow } from './types'

const attempt = (id: string, at: string): FeynmanAttemptRow => ({
  id,
  workId: 'w',
  unitId: 'u',
  body: 'text',
  grades: ['got-it', 'got-it', 'got-it'],
  at,
})

describe('the prompts', () => {
  it('has three, in the order a provision has to be held in', () => {
    expect(FEYNMAN_PROMPTS).toEqual(['requires', 'appliesTo', 'limit'])
  })

  it('has three grades', () => {
    expect(FEYNMAN_GRADES).toEqual(['missed', 'partial', 'got-it'])
  })
})

describe('isFeynmanGrade', () => {
  it.each([
    ['missed', true],
    ['partial', true],
    ['got-it', true],
    ['gotit', false],
    ['', false],
    [3, false],
    [null, false],
    [undefined, false],
  ])('%o → %s', (value, expected) => {
    expect(isFeynmanGrade(value)).toBe(expected)
  })
})

describe('normaliseGrades', () => {
  it('returns one grade per prompt', () => {
    expect(normaliseGrades(['got-it', 'partial', 'missed'])).toEqual(['got-it', 'partial', 'missed'])
  })

  it('pads a short array rather than throwing the attempt away', () => {
    expect(normaliseGrades(['got-it'])).toEqual(['got-it', 'missed', 'missed'])
  })

  it('truncates a long one', () => {
    expect(normaliseGrades(['got-it', 'got-it', 'got-it', 'got-it'])).toHaveLength(3)
  })

  it('replaces a value this release does not know', () => {
    // An attempt is the reader's own writing. Losing it because a grade did not
    // parse would be the wrong trade entirely.
    expect(normaliseGrades(['excellent', 'partial', null])).toEqual(['missed', 'partial', 'missed'])
  })

  it('survives anything that is not an array at all', () => {
    expect(normaliseGrades(undefined)).toEqual(['missed', 'missed', 'missed'])
    expect(normaliseGrades('got-it')).toEqual(['missed', 'missed', 'missed'])
  })
})

describe('isSubmittable', () => {
  it('refuses an empty or near-empty attempt', () => {
    expect(isSubmittable('')).toBe(false)
    expect(isSubmittable('   ')).toBe(false)
    expect(isSubmittable('too short')).toBe(false)
  })

  it('accepts a real one', () => {
    expect(isSubmittable('Every officer must maintain absolute integrity.')).toBe(true)
  })
})

describe('scoreAttempt', () => {
  it('scores 0, 1 and 2 per prompt out of six', () => {
    expect(scoreAttempt(['missed', 'partial', 'got-it'])).toEqual({
      points: 3,
      max: 6,
      missed: ['requires'],
    })
  })

  it('names every prompt the reader missed, in order', () => {
    expect(scoreAttempt(['missed', 'got-it', 'missed']).missed).toEqual(['requires', 'limit'])
  })

  it('scores a full attempt at the maximum', () => {
    expect(scoreAttempt(['got-it', 'got-it', 'got-it']).points).toBe(6)
  })

  it('normalises before scoring, so a corrupt row scores rather than throwing', () => {
    expect(scoreAttempt([] as never)).toEqual({ points: 0, max: 6, missed: [...FEYNMAN_PROMPTS] })
  })
})

describe('confidenceFromAttempt', () => {
  it('never reaches 4 — a self-grade is an opinion, not evidence', () => {
    expect(confidenceFromAttempt(['got-it', 'got-it', 'got-it'])).toBe(3)
  })

  it('maps a strong attempt to 3, a middling one to 2 and a weak one to 1', () => {
    expect(confidenceFromAttempt(['got-it', 'got-it', 'partial'])).toBe(3)
    expect(confidenceFromAttempt(['partial', 'partial', 'partial'])).toBe(2)
    expect(confidenceFromAttempt(['missed', 'missed', 'partial'])).toBe(1)
    expect(confidenceFromAttempt(['missed', 'missed', 'missed'])).toBe(1)
  })
})

describe('latestAttempt', () => {
  it('returns null when there are none', () => {
    expect(latestAttempt([])).toBeNull()
  })

  it('picks the newest by timestamp, not by array order', () => {
    const rows = [
      attempt('a', '2026-09-01T00:00:00.000Z'),
      attempt('b', '2026-09-03T00:00:00.000Z'),
      attempt('c', '2026-09-02T00:00:00.000Z'),
    ]
    expect(latestAttempt(rows)?.id).toBe('b')
  })
})
