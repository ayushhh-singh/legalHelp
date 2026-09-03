import { describe, expect, it } from 'vitest'

import {
  NUMBER_TOKENS,
  expandNumber,
  newPattern,
  nextSequence,
  previewNumber,
  validatePattern,
  type NumberPattern,
} from './numbering'

const pattern = (over: Partial<NumberPattern> = {}): NumberPattern => ({
  ...newPattern({ id: 'p1', at: '2026-09-03T00:00:00.000Z', year: 2026 }),
  name: 'Establishment',
  file: 'A-11011',
  section: 'Estt.',
  ...over,
})

describe('expandNumber', () => {
  it('substitutes every one of the six tokens', () => {
    const result = expandNumber({
      pattern: '{FILE}/{SEQ}/{YEAR}-{SECTION} ({YY}, {TYPE})',
      file: 'A-11011',
      section: 'Estt.',
      type: 'O.M.',
      seq: 7,
      seqPad: 1,
      year: 2026,
    })
    expect(result.number).toBe('A-11011/7/2026-Estt. (26, O.M.)')
    expect(result.unknownTokens).toEqual([])
  })

  it('pads the serial', () => {
    expect(expandNumber({ ...base(), seq: 7, seqPad: 3 }).number).toBe('007')
    expect(expandNumber({ ...base(), seq: 1234, seqPad: 3 }).number).toBe('1234')
  })

  it('reports an unknown token ONCE and leaves it in the text', () => {
    const result = expandNumber({ ...base(), pattern: '{SEQNO}/{SEQNO}/{SEQ}' })
    expect(result.unknownTokens).toEqual(['SEQNO'])
    expect(result.number).toContain('{SEQNO}')
  })

  it('two-digit {YY} pads a year below 2010', () => {
    expect(expandNumber({ ...base(), pattern: '{YY}', year: 2007 }).number).toBe('07')
  })

  function base() {
    return { pattern: '{SEQ}', file: 'A', section: 'S', type: 'T', seq: 1, seqPad: 1, year: 2026 }
  }
})

describe('nextSequence', () => {
  it('counts on within the same year', () => {
    expect(nextSequence({ resetPolicy: 'yearly', seq: 4, seqYear: 2026 }, 2026)).toBe(5)
  })

  it('restarts at 1 in a new year when the policy says yearly', () => {
    expect(nextSequence({ resetPolicy: 'yearly', seq: 412, seqYear: 2025 }, 2026)).toBe(1)
  })

  it('keeps counting across a year when the policy is never', () => {
    expect(nextSequence({ resetPolicy: 'never', seq: 412, seqYear: 2025 }, 2026)).toBe(413)
  })

  it('restarts going BACKWARDS too — a document dated into last year', () => {
    // The year is the DOCUMENT's, not the day the button was pressed, so a
    // document dated 2025 issued in 2026 gets 2025's series.
    expect(nextSequence({ resetPolicy: 'yearly', seq: 9, seqYear: 2026 }, 2025)).toBe(1)
  })
})

describe('previewNumber', () => {
  it('is the same arithmetic the issue path runs', () => {
    const p = pattern({ pattern: '{FILE}/{SEQ}/{YEAR}-{SECTION}', seq: 4, seqYear: 2026 })
    expect(previewNumber(p, 'O.M.', 2026).number).toBe('A-11011/5/2026-Estt.')
    expect(previewNumber(p, 'O.M.', 2027).number).toBe('A-11011/1/2027-Estt.')
  })
})

describe('validatePattern', () => {
  it('accepts a well-formed one', () => {
    expect(validatePattern('A-11011/{SEQ}/{YEAR}-{SECTION}')).toEqual([])
  })

  it('reports an empty pattern and stops there', () => {
    const issues = validatePattern('   ')
    expect(issues).toHaveLength(1)
    expect(issues[0]?.code).toBe('empty')
  })

  it('warns when there is no {SEQ} — CSMOP 9.2(vi) wants a serial', () => {
    const issues = validatePattern('A-11011/{YEAR}-{SECTION}')
    expect(issues.map((issue) => issue.code)).toEqual(['no-seq'])
    expect(issues[0]?.message.en).toContain('9.2(vi)')
  })

  it('names every unknown token, in both languages', () => {
    const issues = validatePattern('{SEQ}/{NONSENSE}/{ALSOBAD}')
    expect(issues.map((issue) => issue.token)).toEqual(['NONSENSE', 'ALSOBAD'])
    expect(issues[0]?.message.hi).toContain('{NONSENSE}')
    for (const token of NUMBER_TOKENS) expect(issues[0]?.message.en).toContain(`{${token}}`)
  })
})

describe('newPattern', () => {
  it('starts at zero so the FIRST issue is 1', () => {
    const p = newPattern({ id: 'p', at: '2026-09-03T00:00:00.000Z', year: 2026 })
    expect(p.seq).toBe(0)
    expect(nextSequence(p, 2026)).toBe(1)
    expect(p.lastIssued).toBeNull()
  })
})
