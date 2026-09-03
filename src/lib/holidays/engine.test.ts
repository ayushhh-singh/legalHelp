import { describe, expect, it } from 'vitest'

import { findHoliday, upcoming, validatePicks } from './engine'
import { toIcs } from './ics'

import type { HolidaysDataset } from './types'

const dataset: HolidaysDataset = {
  version: '1.0.0',
  generatedAt: '2026-08-29T00:00:00Z',
  disclaimer: { en: 'x', hi: 'x' },
  year: 2026,
  source: { name: 'Test', url: 'https://example.com' },
  fetchedAt: '2026-08-29T00:00:00Z',
  verify: true,
  delegationNote: { en: 'x', hi: 'x' },
  gazetted: [
    {
      id: 'republic-day',
      name: { en: 'Republic Day', hi: 'गणतंत्र दिवस' },
      date: '2026-01-26',
      day: 'Monday',
    },
    {
      id: 'independence-day',
      name: { en: 'Independence Day', hi: 'स्वतंत्रता दिवस' },
      date: '2026-08-15',
      day: 'Saturday',
    },
    { id: 'christmas-day', name: { en: 'Christmas Day', hi: 'क्रिसमस' }, date: '2026-12-25', day: 'Friday' },
  ],
  restricted: [
    { id: 'holi', name: { en: 'Holi', hi: 'होली' }, date: '2026-03-04', day: 'Wednesday' },
    { id: 'diwali', name: { en: 'Diwali', hi: 'दिवाली' }, date: '2026-11-08', day: 'Sunday' },
    {
      id: 'christmas-eve',
      name: { en: 'Christmas Eve', hi: 'क्रिसमस की पूर्व संध्या' },
      date: '2026-12-24',
      day: 'Thursday',
    },
  ],
}

describe('upcoming', () => {
  it('merges gazetted holidays with only the picked restricted ones, nearest first', () => {
    const result = upcoming(dataset, '2026-08-16', new Set(['diwali']), 5)
    expect(result.map((h) => h.id)).toEqual(['diwali', 'christmas-day'])
  })

  it('excludes a restricted holiday that was not picked', () => {
    const result = upcoming(dataset, '2026-08-16', new Set(), 5)
    expect(result.map((h) => h.id)).toEqual(['christmas-day'])
  })

  it('excludes dates before today, keeps a date equal to today', () => {
    const result = upcoming(dataset, '2026-08-15', new Set(), 5)
    expect(result.map((h) => h.id)).toEqual(['independence-day', 'christmas-day'])
  })

  it('respects the limit', () => {
    const result = upcoming(dataset, '2026-01-01', new Set(['holi', 'diwali', 'christmas-eve']), 2)
    expect(result).toHaveLength(2)
  })
})

describe('validatePicks', () => {
  it('accepts up to two known restricted ids', () => {
    expect(validatePicks(dataset, ['holi', 'diwali'])).toEqual({ ok: true })
    expect(validatePicks(dataset, [])).toEqual({ ok: true })
  })

  it('rejects a third pick', () => {
    expect(validatePicks(dataset, ['holi', 'diwali', 'christmas-eve'])).toEqual({
      ok: false,
      reason: 'too-many',
    })
  })

  it('rejects an id that is not in the restricted list', () => {
    expect(validatePicks(dataset, ['not-a-holiday'])).toEqual({ ok: false, reason: 'unknown-id' })
  })

  it('rejects a gazetted id passed as a restricted pick', () => {
    expect(validatePicks(dataset, ['republic-day'])).toEqual({ ok: false, reason: 'unknown-id' })
  })
})

describe('findHoliday', () => {
  it('finds a gazetted or a restricted holiday by id', () => {
    expect(findHoliday(dataset, 'republic-day')?.name.en).toBe('Republic Day')
    expect(findHoliday(dataset, 'holi')?.name.en).toBe('Holi')
    expect(findHoliday(dataset, 'nope')).toBeUndefined()
  })
})

describe('toIcs', () => {
  const ics = toIcs(dataset)

  it('is a well-formed VCALENDAR with CRLF line endings', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true)
    expect(ics).toContain('VERSION:2.0\r\n')
  })

  it('has exactly one VEVENT per gazetted holiday, none for restricted', () => {
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(dataset.gazetted.length)
    // "Holi" (restricted) is deliberately not asserted absent as a bare substring:
    // the PRODID line itself is "Sahayak//Holiday Calendar", which contains it.
    expect(ics).not.toContain('UID:holi-2026@sahayak')
    expect(ics).not.toContain('UID:diwali-2026@sahayak')
  })

  it('gives every event a unique UID and an all-day DTSTART', () => {
    const uids = [...ics.matchAll(/UID:([^\r\n]+)/g)].map((m) => m[1])
    expect(new Set(uids).size).toBe(uids.length)
    expect(ics).toContain('DTSTART;VALUE=DATE:20260126')
  })

  it('escapes a comma or semicolon in a summary', () => {
    const withPunctuation: HolidaysDataset = {
      ...dataset,
      gazetted: [{ id: 'x', name: { en: 'A, B; C', hi: 'x' }, date: '2026-01-01', day: 'Thursday' }],
    }
    expect(toIcs(withPunctuation)).toContain('A\\, B\\; C')
  })
})
