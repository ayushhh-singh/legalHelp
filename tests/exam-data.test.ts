import { readdirSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  actsOf,
  cardsForUnit,
  coverageOf,
  mappedMarksShare,
  paperUnits,
  readinessFor,
  totalMarks,
} from '@/lib/exam'
import { cardScore, STABILITY_TARGET_DAYS } from '@/lib/exam'
import type { SrsCardRow } from '@/lib/srs'
import { examIndexSchema, examProfileSchema, isExternal, type ExamProfile } from '@/schemas/exam'
import { isServed, rulesCardsSchema, rulesIndexSchema, type Card } from '@/modules/trainer/schema'
import { reviewRow } from '@/test/exam-fixtures'
import { fromRoot, readFromRoot } from '@/test/paths'

/**
 * The committed bytes of `data/exams`, read off disk — the arrangement every
 * other dataset suite in this repository uses, and the reason it is here rather
 * than beside `src/lib/exam`: this is a test of the artefact, not of the code.
 *
 * Two assertions carry the weight.
 *
 * The first is the POINTER, the claim `tests/library-data.test.ts` makes about
 * a work and `tests/library-aids.test.ts` makes about an aid: **every coverage
 * entry resolves**. An act a profile names must be an act `data/rules` has, and
 * a `rules` list must name rule records that act actually holds. A syllabus
 * unit pointing at nothing renders a bar the reader can never move and reports
 * nothing at all.
 *
 * The second is the BOUNDARY, and it is the reason this module exists at all.
 * A profile may hold public syllabus structure over public law and nothing
 * else. The tests below check the shape of that promise from the outside: every
 * external unit says what to study instead and holds no act; the Intelligence
 * Bureau's standing orders are named and empty; and `verify: false` is claimed
 * only where the pattern was read from a document this repository fetched and
 * hashed.
 */

const PROFILES_DIR = 'data/exams/profiles'

const readJson = <T>(path: string): T => JSON.parse(readFromRoot(path)) as T

const profileIds = readdirSync(fromRoot(PROFILES_DIR))
  .filter((name) => name.endsWith('.json'))
  .map((name) => name.replace(/\.json$/, ''))
  .sort()

const profiles = new Map<string, ExamProfile>(
  profileIds.map((id) => [id, readJson<ExamProfile>(`${PROFILES_DIR}/${id}.json`)]),
)
const all = [...profiles.values()]

const index = examIndexSchema.parse(readJson<unknown>('data/exams/index.json'))
const rulesIndex = rulesIndexSchema.parse(readJson<unknown>('data/rules/index.json'))

/** Every rule record id one act holds — what a `rules` narrowing must resolve into. */
const ruleIdsOf = (actId: string): Set<string> => {
  const act = rulesIndex.acts.find((entry) => entry.id === actId)
  if (!act) return new Set()
  const text = readJson<{ rules: { id: string }[] }>(`data/rules/${act.text}`)
  return new Set(text.rules.map((rule) => rule.id))
}

/** The committed catalogue for one act. */
const cardsOf = (actId: string): Card[] => {
  const act = rulesIndex.acts.find((entry) => entry.id === actId)
  if (!act) return []
  return rulesCardsSchema.parse(readJson<unknown>(`data/rules/${act.cards}`)).cards
}

describe('the files this suite reads', () => {
  it('found the profiles, rather than silently asserting over nothing', () => {
    expect(profileIds.length).toBeGreaterThanOrEqual(3)
    expect(profileIds).toContain('css-so-ldce')
  })
})

describe('every profile validates', () => {
  it.each(profileIds)('%s parses against the zod schema', (id) => {
    // `strictObject` throughout, so a key the schema does not know about is a
    // failure rather than a silent strip — the arrangement ADR-016's addendum
    // records for every dataset here.
    expect(() => examProfileSchema.parse(profiles.get(id))).not.toThrow()
  })

  it.each(profileIds)('%s knows its own id', (id) => {
    expect(profiles.get(id)?.id).toBe(id)
  })

  it('is indexed completely, and the index counts agree with the profiles', () => {
    expect(index.profiles.map((entry) => entry.id).sort()).toEqual(profileIds)
    for (const entry of index.profiles) {
      const profile = profiles.get(entry.id)!
      const units = paperUnits(profile)
      expect(entry.file).toBe(`profiles/${entry.id}.json`)
      expect(entry.paperCount).toBe(profile.papers.length)
      expect(entry.totalMarks).toBe(totalMarks(profile))
      expect(entry.mappedUnits).toBe(units.filter((u) => !isExternal(u.unit.coverage)).length)
      expect(entry.externalUnits).toBe(units.filter((u) => isExternal(u.unit.coverage)).length)
      expect(entry.verify).toBe(profile.verify)
      expect(entry.name).toEqual(profile.name)
      expect(entry.organisation).toEqual(profile.organisation)
    }
  })
})

describe('every coverage entry resolves', () => {
  it.each(profileIds)('%s names only acts data/rules actually has', (id) => {
    const known = new Set(rulesIndex.acts.map((act) => act.id))
    for (const act of actsOf(profiles.get(id)!)) {
      expect(known, `${id} points at ${act}`).toContain(act)
    }
  })

  it.each(profileIds)('%s narrows only to rule records those acts hold', (id) => {
    for (const { unit } of paperUnits(profiles.get(id)!)) {
      if (isExternal(unit.coverage)) continue
      for (const ref of unit.coverage) {
        if (!ref.rules) continue
        const known = ruleIdsOf(ref.act)
        for (const ruleId of ref.rules) {
          expect(known, `${id}/${unit.id} points at ${ref.act}#${ruleId}`).toContain(ruleId)
        }
      }
    }
  })

  it.each(profileIds)('%s has approved cards behind every mapped unit', (id) => {
    // The other direction of the pointer: a unit that resolves to an act with
    // nothing approved in it is a bar the reader can never move, and the
    // readiness screen would report 0 for ever with no explanation.
    const profile = profiles.get(id)!
    const catalogue = actsOf(profile).flatMap(cardsOf)
    for (const { unit } of paperUnits(profile)) {
      if (isExternal(unit.coverage)) continue
      const cards = cardsForUnit(unit, catalogue)
      expect(cards.served.length, `${id}/${unit.id} has no approved card`).toBeGreaterThan(0)
    }
  })
})

describe('the weights', () => {
  it.each(profileIds)("%s's units sum to exactly 1 in every paper", (id) => {
    for (const paper of profiles.get(id)!.papers) {
      const sum = paper.units.reduce((total, unit) => total + unit.weight, 0)
      expect(sum, `${id}/${paper.id}`).toBeCloseTo(1, 6)
    }
  })

  it.each(profileIds)('%s states how its weights were arrived at, in both languages', (id) => {
    // The one number here no notification supplies. `weightBasis` is required
    // by the schema and rendered on the profile, so the apportionment is never
    // presented as the Commission's.
    const basis = profiles.get(id)!.weightBasis
    expect(basis.en.length).toBeGreaterThan(40)
    expect(basis.hi).toMatch(/[ऀ-ॿ]/)
  })
})

describe('the boundary', () => {
  it.each(profileIds)('%s names what to study instead for every external unit', (id) => {
    for (const { unit } of paperUnits(profiles.get(id)!)) {
      if (!isExternal(unit.coverage)) continue
      expect(unit.coverage.note?.en, `${id}/${unit.id}`).toBeTruthy()
      expect(unit.coverage.note?.hi, `${id}/${unit.id}`).toMatch(/[ऀ-ॿ]/)
    }
  })

  it('leaves the Intelligence Bureau standing orders named and empty', () => {
    // The boundary as data, and the worked example of it: a candidate who does
    // not know the document is on the syllabus is worse off, so it is NAMED —
    // and this app holds no departmental manual or internally circulated
    // material, so it is EMPTY.
    const ib = profiles.get('ib-so-ldce')!
    const unit = paperUnits(ib).find((entry) => entry.unit.id === 'intelligence-bureau-standing-orders')
    expect(unit, 'the unit is on the syllabus').toBeTruthy()
    expect(isExternal(unit!.unit.coverage)).toBe(true)
  })

  it('never maps a railway rule book on to the CCS rule book of the same shape', () => {
    // The Railway Services (Conduct) Rules 1966 and the Railway Servants (D&A)
    // Rules 1968 are close in shape to the CCS rules and different in text.
    // Mapping one on to the other would send a candidate to the wrong rule book
    // with the app telling them it was the right one.
    const railway = profiles.get('railway-so-ldce')!
    for (const id of ['railway-services-conduct-rules', 'railway-servants-discipline-and-appeal-rules']) {
      const unit = paperUnits(railway).find((entry) => entry.unit.id === id)!
      expect(isExternal(unit.unit.coverage), id).toBe(true)
    }
    expect(actsOf(railway)).not.toContain('ccs-conduct')
    expect(actsOf(railway)).not.toContain('ccs-cca')
  })

  it('claims verify:false only where the notification was fetched and hashed', () => {
    for (const profile of all) {
      if (profile.verify) continue
      expect(profile.patternSource.fetchedAt, profile.id).toBeTruthy()
      expect(profile.patternSource.sha256, profile.id).toMatch(/^[0-9a-f]{64}$/)
    }
  })

  it('cites a source URL on every profile', () => {
    for (const profile of all) {
      expect(profile.patternSource.url, profile.id).toMatch(/^https:\/\//)
      expect(profile.patternSource.name.length, profile.id).toBeGreaterThan(20)
    }
  })

  it('is honest on the profile card about how little it holds for the railway one', () => {
    // Two mapped units against eleven external. The picker renders both numbers
    // so a reader sees the ratio BEFORE choosing, not after.
    const railway = index.profiles.find((entry) => entry.id === 'railway-so-ldce')!
    expect(railway.mappedUnits).toBeLessThan(railway.externalUnits)
    expect(mappedMarksShare(profiles.get('railway-so-ldce')!)).toBeLessThan(0.35)
  })
})

describe('every profile can actually be used', () => {
  it.each(profileIds)('%s has at least one objective paper to mock', (id) => {
    expect(profiles.get(id)!.papers.some((paper) => paper.objective)).toBe(true)
  })

  it.each(profileIds)('%s carries a penalty on its objective papers and none elsewhere', (id) => {
    for (const paper of profiles.get(id)!.papers) {
      if (paper.objective) expect(paper.negativeMarking, `${id}/${paper.id}`).toBeGreaterThan(0)
      else expect(paper.negativeMarking, `${id}/${paper.id}`).toBeUndefined()
    }
  })

  it.each(profileIds)('%s is fully bilingual on every string a reader sees', (id) => {
    const profile = profiles.get(id)!
    const bilinguals = [
      profile.name,
      profile.organisation,
      profile.eligibilityNote,
      profile.weightBasis,
      profile.disclaimer,
      ...profile.papers.flatMap((paper) => [paper.name, ...paper.units.map((unit) => unit.name)]),
    ]
    for (const value of bilinguals) {
      expect(value.en.length, id).toBeGreaterThan(0)
      expect(value.hi, id).toMatch(/[ऀ-ॿ]/)
    }
  })
})

describe('readiness over the real committed catalogue', () => {
  const profile = profiles.get('css-so-ldce')!
  const catalogue = actsOf(profile).flatMap(cardsOf)
  const NOW = new Date('2026-09-04T06:00:00.000Z')

  it('is 0 on a device that has never studied, and reports the caveat', () => {
    const readiness = readinessFor({ profile, catalogue, states: new Map(), now: NOW })
    expect(readiness.overall).toBe(0)
    expect(readiness.servedCards).toBeGreaterThan(100)
    /*
      The caveat, as a number, and asserted exactly rather than bounded because
      the exact figure is the honest headline: 30 marks of Paper I (the RTI Act,
      one of its five heads) plus 120 of Paper II (eight of its ten reference
      books) out of 500 — **three tenths of the examination**. Paper III, 200
      marks of noting and drafting, is none of it.

      A reader who saw "you are 100% ready" without this beside it would be
      reading a figure about 30% of the paper they are sitting.
    */
    expect(readiness.mappedMarksShare).toBeCloseTo(0.3, 10)
  })

  it('is MONOTONIC in mastery over the real catalogue', () => {
    /*
      The property the readiness screen rests on: improving any card can never
      lower any bar. Walked over the committed cards in chunks, each step
      advancing a slice of them one rung up `cardScore`'s ladder, asserting that
      neither the overall figure nor any unit bar ever falls.

      Over the real catalogue rather than a fixture, because the fixture cannot
      catch the thing that would actually break this — a unit whose coverage
      overlaps another's, so that advancing a card moves two bars at once.
    */
    const ladder = (id: string): SrsCardRow[] => [
      { ...reviewRow(id, 1), state: 'learning', reps: 1 },
      reviewRow(id, 1),
      reviewRow(id, 7),
      reviewRow(id, STABILITY_TARGET_DAYS),
    ]

    const served = catalogue.filter(isServed)
    const states = new Map<string, SrsCardRow>()
    let previous = readinessFor({ profile, catalogue, states, now: NOW })

    for (let rung = 0; rung < 4; rung += 1) {
      for (let at = 0; at < served.length; at += 50) {
        for (const card of served.slice(at, at + 50)) states.set(card.id, ladder(card.id)[rung]!)
        const next = readinessFor({ profile, catalogue, states, now: NOW })
        expect(next.overall).toBeGreaterThanOrEqual(previous.overall - 1e-12)
        next.units.forEach((unit, i) => {
          expect(unit.ready, unit.key).toBeGreaterThanOrEqual(previous.units[i]!.ready - 1e-12)
        })
        previous = next
      }
    }
    expect(previous.overall).toBeGreaterThan(0)
  })

  it('caps every unit below 1 exactly where the app has unapproved cards', () => {
    for (const { unit } of paperUnits(profile)) {
      if (isExternal(unit.coverage)) continue
      const cards = cardsForUnit(unit, catalogue)
      const expected = cards.total === 0 ? 0 : cards.served.length / cards.total
      expect(coverageOf(unit, catalogue), unit.id).toBeCloseTo(expected, 10)
      expect(cardScore(undefined)).toBe(0)
    }
  })
})
