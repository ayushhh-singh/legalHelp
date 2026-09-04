import { describe, expect, it } from 'vitest'

import { trainerActHintsForJob, trainerActHintsForProfile } from './actHints'

import { examProfileSchema } from '@/schemas/exam'
import { readFromRoot } from '@/test/paths'

/**
 * The REAL committed profiles, not a stub.
 *
 * CLAUDE.md's own note from the session that built exam mode: "a stub of a
 * dataset type is a stub of every field the code happens to read". `actsOf`
 * walks papers -> units -> coverage, and a hand-made object is a claim about
 * that shape rather than a reading of it.
 */
const profile = (id: string) =>
  examProfileSchema.parse(JSON.parse(readFromRoot(`data/exams/profiles/${id}.json`)) as unknown)

describe('trainerActHintsForJob', () => {
  it('makes no change for an ordinary post — every rule book stays enabled', () => {
    const hint = trainerActHintsForJob({ organisation: 'posts' })
    expect(hint.acts).toEqual([])
    expect(hint.note).toBeUndefined()
  })

  it('narrows to Conduct and OSA for an intelligence or enforcement organisation', () => {
    expect(trainerActHintsForJob({ organisation: 'ib' }).acts).toEqual(
      expect.arrayContaining(['ccs-conduct', 'osa']),
    )
  })

  it('leaves OSA out for an organisation with no such link', () => {
    const hint = trainerActHintsForJob({ organisation: 'kvs' })
    expect(hint.acts).not.toContain('osa')
    expect(hint.note).toBeUndefined()
  })

  it('adds the RTI s.24 note for the brief’s own worked example, IB', () => {
    const hint = trainerActHintsForJob({ organisation: 'ib' })
    expect(hint.note?.en).toMatch(/Second Schedule/)
    expect(hint.note?.hi).toMatch(/दूसरी अनुसूची/)
  })

  it('adds the RTI s.24 note for NIA too', () => {
    expect(trainerActHintsForJob({ organisation: 'nia' }).note).toBeDefined()
  })

  it('does not add the RTI note for an enforcement org outside the two named ones', () => {
    const hint = trainerActHintsForJob({ organisation: 'cbi' })
    expect(hint.acts).toContain('osa')
    expect(hint.note).toBeUndefined()
  })

  it('never returns a duplicate act id', () => {
    const hint = trainerActHintsForJob({ organisation: 'ib' })
    expect(new Set(hint.acts).size).toBe(hint.acts.length)
  })
})

describe('trainerActHintsForProfile', () => {
  it('takes the acts from the examination’s own reference list', () => {
    // css-so-ldce's units point at the rule books this app holds; the ones it
    // does not hold are `{ external: true }` and contribute nothing.
    const hint = trainerActHintsForProfile(profile('css-so-ldce'))
    expect(hint.acts.length).toBeGreaterThan(0)
    expect(hint.acts).toEqual([...hint.acts].sort())
    expect(new Set(hint.acts).size).toBe(hint.acts.length)
    expect(hint.note).toBeDefined()
  })

  it('names only rule books this app actually carries', () => {
    // An act id that resolves to nothing would narrow the Trainer to an empty
    // catalogue — the reader sees no cards and nothing says why.
    const known = new Set(
      (JSON.parse(readFromRoot('data/rules/index.json')) as { acts: { id: string }[] }).acts.map(
        (act) => act.id,
      ),
    )
    for (const id of ['css-so-ldce', 'ib-so-ldce', 'railway-so-ldce']) {
      for (const act of trainerActHintsForProfile(profile(id)).acts) {
        expect(known, `${id} maps an act data/rules does not have: ${act}`).toContain(act)
      }
    }
  })

  it('never maps the Official Secrets Act, because no notification puts it on a syllabus', () => {
    /*
      ADR-044 §8. `trainerActHintsForJob` DOES switch OSA on for an Intelligence
      Bureau officer, and that is a guess about their work which the note says
      is changeable. Putting it on a syllabus would be a claim about an
      examination, and Category VIII's reference list does not name it — so the
      profile-derived hint must not produce it either.
    */
    for (const id of ['css-so-ldce', 'ib-so-ldce', 'railway-so-ldce']) {
      expect(trainerActHintsForProfile(profile(id)).acts).not.toContain('osa')
    }
  })

  it('makes no change when every unit is external', () => {
    /*
      `[]` means "leave actsEnabled alone", never "enable nothing" — an empty
      allowlist is this app's own default for "every rule book"
      (src/lib/srs/types.ts), so returning `[]` here is the safe answer and
      returning it as a NARROWING would leave the reader with no cards at all.
    */
    const base = profile('css-so-ldce')
    const external = {
      ...base,
      papers: base.papers.map((paper) => ({
        ...paper,
        units: paper.units.map((unit) => ({ ...unit, coverage: { external: true as const } })),
      })),
    }
    const hint = trainerActHintsForProfile(external)
    expect(hint.acts).toEqual([])
    expect(hint.note).toBeUndefined()
  })

  it('says the acts came from the examination, in both languages', () => {
    const hint = trainerActHintsForProfile(profile('css-so-ldce'))
    expect(hint.note?.en).toMatch(/examination/i)
    expect(hint.note?.hi).toMatch(/परीक्षा/)
  })
})
