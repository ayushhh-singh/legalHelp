import { describe, expect, it } from 'vitest'

import { actsOf, cardMatches, cardsForUnit, coverageOf, mappedMarksShare, splitByCoverage } from './coverage'
import { paperUnits, totalDurationMinutes, totalMarks } from './types'

import { makeMcqs, makeProfile, makeUnit } from '@/test/exam-fixtures'
import { makeCard } from '@/test/rules-cards'

const profile = makeProfile([
  {
    id: 'p1',
    marks: 100,
    units: [
      { id: 'conduct', weight: 0.5, acts: ['ccs-conduct'] },
      { id: 'outside', weight: 0.5, acts: null },
    ],
  },
  {
    id: 'p2',
    marks: 200,
    units: [{ id: 'leave', weight: 1, acts: ['ccs-leave'] }],
  },
])

describe('cardMatches', () => {
  it('matches a card of a named act', () => {
    const unit = makeUnit({ id: 'u', weight: 1, acts: ['ccs-conduct'] })
    expect(cardMatches(unit.coverage, makeCard({ id: 'a', act: 'ccs-conduct' }))).toBe(true)
    expect(cardMatches(unit.coverage, makeCard({ id: 'b', act: 'gfr' }))).toBe(false)
  })

  it('matches nothing at all for an external unit', () => {
    const unit = makeUnit({ id: 'u', weight: 1, acts: null })
    expect(cardMatches(unit.coverage, makeCard({ id: 'a', act: 'ccs-conduct' }))).toBe(false)
  })

  it('narrows to particular rule RECORDS when `rules` is present', () => {
    // The capability no committed profile uses yet, because every notification
    // found names a whole rule book. Exercised here so it is not a code path
    // that has never once run — CLAUDE.md's "wired up and cannot fire" family.
    const unit = makeUnit({
      id: 'u',
      weight: 1,
      acts: ['ccs-conduct'],
      rules: ['ccs-conduct-rule-3'],
    })
    expect(cardMatches(unit.coverage, makeCard({ id: 'a', act: 'ccs-conduct', rule: '3' }))).toBe(true)
    expect(cardMatches(unit.coverage, makeCard({ id: 'b', act: 'ccs-conduct', rule: '11' }))).toBe(false)
  })

  it('narrows on `ruleRef.textId` and not on the printed rule number', () => {
    // `card.rule` is what the book prints — "11A", "F.R. 17" — and is not an id.
    // A `rules` list holding printed numbers would silently match nothing.
    const unit = makeUnit({ id: 'u', weight: 1, acts: ['fr-sr'], rules: ['17'] })
    expect(cardMatches(unit.coverage, makeCard({ id: 'a', act: 'fr-sr', rule: '17' }))).toBe(false)
  })
})

describe('cardsForUnit', () => {
  const catalogue = [
    ...makeMcqs('ccs-conduct', 4),
    makeCard({ id: 'ccs-conduct-x', act: 'ccs-conduct', rule: '9', reviewState: 'needs-hindi' }),
    makeCard({ id: 'ccs-conduct-y', act: 'ccs-conduct', rule: '10', reviewState: 'rejected' }),
    ...makeMcqs('gfr', 2),
  ]

  it('separates approved cards from every card in the unit', () => {
    const unit = makeUnit({ id: 'u', weight: 1, acts: ['ccs-conduct'] })
    const cards = cardsForUnit(unit, catalogue)
    expect(cards.served).toHaveLength(4)
    expect(cards.total).toBe(6)
    expect(cards.acts).toEqual(['ccs-conduct'])
  })

  it('returns nothing for an external unit without walking the catalogue', () => {
    const unit = makeUnit({ id: 'u', weight: 1, acts: null })
    expect(cardsForUnit(unit, catalogue)).toEqual({ served: [], total: 0, acts: [] })
  })

  it('reports coverage as the approved share, not as one or nothing', () => {
    // Four approved of six is the honest figure: a reader who has learnt every
    // card this app can ask about the Conduct Rules has not learnt the Conduct
    // Rules, and the readiness bar is mastery times THIS.
    const unit = makeUnit({ id: 'u', weight: 1, acts: ['ccs-conduct'] })
    expect(coverageOf(unit, catalogue)).toBeCloseTo(4 / 6, 10)
  })

  it('is 0 for a unit whose acts have no cards at all', () => {
    const unit = makeUnit({ id: 'u', weight: 1, acts: ['posh'] })
    expect(coverageOf(unit, catalogue)).toBe(0)
  })

  it('is 0 for an external unit rather than null or undefined', () => {
    // Not left out: it is a real part of the examination the reader is really
    // not being helped with, and a figure that excluded it would be a claim
    // about a smaller examination than the one they are sitting.
    expect(coverageOf(makeUnit({ id: 'u', weight: 1, acts: null }), catalogue)).toBe(0)
  })

  it('collects the acts of a unit that names more than one, sorted', () => {
    const unit = makeUnit({ id: 'u', weight: 1, acts: ['ol-rules', 'ol-act'] })
    expect(cardsForUnit(unit, catalogue).acts).toEqual(['ol-act', 'ol-rules'])
  })
})

describe('walking a profile', () => {
  it('flattens every unit of every paper with its marks', () => {
    const units = paperUnits(profile)
    expect(units.map((entry) => entry.key)).toEqual(['p1:conduct', 'p1:outside', 'p2:leave'])
    expect(units.map((entry) => entry.marks)).toEqual([50, 50, 200])
  })

  it('adds up the papers rather than trusting a stored total', () => {
    expect(totalMarks(profile)).toBe(300)
    expect(totalDurationMinutes(profile)).toBe(240)
  })

  it('lists the acts the profile draws on, sorted, external units skipped', () => {
    expect(actsOf(profile)).toEqual(['ccs-conduct', 'ccs-leave'])
  })

  it('splits mapped units from external ones', () => {
    const { mapped, external } = splitByCoverage(profile)
    expect(mapped.map((entry) => entry.key)).toEqual(['p1:conduct', 'p2:leave'])
    expect(external.map((entry) => entry.key)).toEqual(['p1:outside'])
  })

  it('reports the share of the examination it holds anything for', () => {
    // 50 of Paper I plus all 200 of Paper II, over 300.
    expect(mappedMarksShare(profile)).toBeCloseTo(250 / 300, 10)
  })

  it('reports 0 for a profile that maps nothing', () => {
    const nothing = makeProfile([{ id: 'p', units: [{ id: 'u', weight: 1, acts: null }] }])
    expect(mappedMarksShare(nothing)).toBe(0)
    expect(actsOf(nothing)).toEqual([])
  })
})
