import { describe, expect, it } from 'vitest'

import { CHECKLIST_GROUPS, checklistFor } from './checklist'

import { makeProfile } from '@/test/exam-fixtures'

const full = makeProfile([
  { id: 'p1', negativeMarking: 1 / 3, units: [{ id: 'a', weight: 1, acts: ['rti'] }] },
  { id: 'p2', objective: false, units: [{ id: 'b', weight: 1, acts: null }] },
])

const objectiveOnly = makeProfile([
  { id: 'p1', negativeMarking: 1 / 3, units: [{ id: 'a', weight: 1, acts: ['rti'] }] },
])

const noPenalty = makeProfile([{ id: 'p1', units: [{ id: 'a', weight: 1, acts: ['rti'] }] }])

const ids = (profile: Parameters<typeof checklistFor>[0]) => checklistFor(profile).map((item) => item.id)

describe('checklistFor', () => {
  it('always carries what the notification makes unconditional', () => {
    for (const profile of [full, objectiveOnly, noPenalty]) {
      expect(ids(profile)).toEqual(
        expect.arrayContaining([
          'admission-certificate',
          'photo-id',
          'prohibited-articles',
          'all-papers',
          'venue-and-time',
          'confirm-circular',
        ]),
      )
    }
  })

  it('warns about the medium only where there is a subjective paper', () => {
    // The most expensive item on the list: the option is exercised on the
    // application form, it is FINAL, and a paper written in the other medium is
    // not evaluated at all. Showing it on a wholly objective examination would
    // be warning about a rule that does not apply there.
    expect(ids(full)).toContain('medium-is-final')
    expect(ids(objectiveOnly)).not.toContain('medium-is-final')
  })

  it('ties the handwriting and numerals items to the subjective paper too', () => {
    for (const id of ['international-numerals', 'legible-handwriting']) {
      expect(ids(full)).toContain(id)
      expect(ids(objectiveOnly)).not.toContain(id)
    }
  })

  it('omits the negative-marking pair where no paper carries a penalty', () => {
    expect(ids(objectiveOnly)).toContain('negative-marking')
    expect(ids(objectiveOnly)).toContain('blank-costs-nothing')
    expect(ids(noPenalty)).not.toContain('negative-marking')
    expect(ids(noPenalty)).not.toContain('blank-costs-nothing')
  })

  it('states the penalty as "one in N", which is what a candidate reasons in', () => {
    const item = checklistFor(objectiveOnly).find((entry) => entry.id === 'negative-marking')
    expect(item?.params.oneIn).toBe(3)
    expect(item?.params.papers).toBe(1)
  })

  it('counts the papers and the total writing time from the profile', () => {
    const items = checklistFor(full)
    expect(items.find((item) => item.id === 'all-papers')?.params.papers).toBe(2)
    expect(items.find((item) => item.id === 'venue-and-time')?.params.minutes).toBe(240)
  })

  it('puts every item in one of the three declared groups', () => {
    for (const item of checklistFor(full)) {
      expect(CHECKLIST_GROUPS).toContain(item.group)
    }
  })

  it('gives every item a unique id, so a rendered list has stable keys', () => {
    const list = ids(full)
    expect(new Set(list).size).toBe(list.length)
  })

  it('holds no reader-facing text — the i18n catalogue does', () => {
    // Pure, so there is no `useT` here and any sentence written into this file
    // would be single-language by construction.
    for (const item of checklistFor(full)) {
      expect(Object.keys(item)).toEqual(['id', 'group', 'params'])
    }
  })
})
