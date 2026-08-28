import { describe, expect, it } from 'vitest'

import { trainerActHintsForJob } from './actHints'

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
