import { describe, expect, it } from 'vitest'

import {
  countWords,
  formatDate,
  itemMarker,
  paraMarker,
  parseDate,
  toAsciiDigits,
  toDevanagariDigits,
} from './format'

describe('digits', () => {
  it('converts both ways and leaves everything else alone', () => {
    expect(toDevanagariDigits('28.08.2026')).toBe('२८.०८.२०२६')
    expect(toAsciiDigits('२८.०८.२०२६')).toBe('28.08.2026')
    expect(toDevanagariDigits('अनुभाग 8')).toBe('अनुभाग ८')
    expect(toAsciiDigits(toDevanagariDigits('A-11011/2/2026-Estt.'))).toBe('A-11011/2/2026-Estt.')
  })
})

describe('parseDate', () => {
  it('accepts what a date input produces and what an officer types', () => {
    expect(parseDate('2026-08-28')).toEqual({ year: 2026, month: 8, day: 28 })
    expect(parseDate('28.08.2026')).toEqual({ year: 2026, month: 8, day: 28 })
    expect(parseDate('28-08-2026')).toEqual({ year: 2026, month: 8, day: 28 })
    expect(parseDate('28/08/2026')).toEqual({ year: 2026, month: 8, day: 28 })
    expect(parseDate('8.8.2026')).toEqual({ year: 2026, month: 8, day: 8 })
    expect(parseDate('२८.०८.२०२६')).toEqual({ year: 2026, month: 8, day: 28 })
  })

  it('rejects a day that does not exist rather than rolling it forward', () => {
    // new Date(2026, 1, 31) is 3 March. A document dated "31.02.2026" is a
    // typo, and silently printing 03.03.2026 would hide it.
    expect(parseDate('31.02.2026')).toBeNull()
    expect(parseDate('2026-02-31')).toBeNull()
    expect(parseDate('29.02.2024')).toEqual({ year: 2024, month: 2, day: 29 })
    expect(parseDate('29.02.2026')).toBeNull()
  })

  it('rejects what is not a date at all', () => {
    expect(parseDate('')).toBeNull()
    expect(parseDate('next Tuesday')).toBeNull()
    expect(parseDate('28.08.26')).toBeNull()
    expect(parseDate('13.13.2026')).toBeNull()
  })
})

describe('formatDate', () => {
  it('prints dd.mm.yyyy in both languages', () => {
    expect(formatDate('2026-08-28', 'en')).toBe('28.08.2026')
    expect(formatDate('2026-08-28', 'hi')).toBe('28.08.2026')
    expect(formatDate('8.8.2026', 'en')).toBe('08.08.2026')
  })

  it('uses Devanagari digits only in Hindi and only when asked', () => {
    expect(formatDate('2026-08-28', 'hi', true)).toBe('२८.०८.२०२६')
    expect(formatDate('2026-08-28', 'en', true)).toBe('28.08.2026')
  })

  it('returns an unparseable value untouched, for the issue list to report', () => {
    expect(formatDate('next Tuesday', 'en')).toBe('next Tuesday')
  })
})

describe('markers', () => {
  it('numbers list items, and switches script only in Hindi', () => {
    expect(itemMarker('ordinal', 0, 'en')).toBe('1. ')
    expect(itemMarker('ordinal', 2, 'hi', true)).toBe('३. ')
    expect(itemMarker('ordinal', 2, 'en', true)).toBe('3. ')
    expect(itemMarker('roman', 3, 'en')).toBe('(iv) ')
    expect(itemMarker('bullet', 0, 'en')).toBe('• ')
    expect(itemMarker('none', 0, 'en')).toBe('')
  })

  it('leaves an unnumbered paragraph unmarked', () => {
    expect(paraMarker(null, 'en')).toBe('')
    expect(paraMarker(2, 'en')).toBe('2. ')
    expect(paraMarker(2, 'hi', true)).toBe('२. ')
  })
})

describe('countWords', () => {
  it('counts across newlines and ignores runs of space', () => {
    expect(countWords('one  two\nthree')).toBe(3)
    expect(countWords('   ')).toBe(0)
    expect(countWords('अनुरोध है कि')).toBe(3)
  })
})
