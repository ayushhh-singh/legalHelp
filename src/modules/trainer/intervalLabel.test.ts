import { describe, expect, it } from 'vitest'

import { intervalLabel } from './intervalLabel'

const NOW = new Date('2026-08-28T12:00:00.000Z')
const plus = (ms: number): string => new Date(NOW.getTime() + ms).toISOString()

describe('intervalLabel', () => {
  it('reads minutes under an hour', () => {
    expect(intervalLabel(plus(30_000), NOW, 'en')).toBe('<1 m')
    expect(intervalLabel(plus(8 * 60_000), NOW, 'en')).toBe('8 m')
  })

  it('reads hours under a day', () => {
    expect(intervalLabel(plus(3 * 3_600_000), NOW, 'en')).toBe('3 h')
  })

  it('reads days under ten', () => {
    expect(intervalLabel(plus(3 * 86_400_000), NOW, 'en')).toBe('3 d')
  })

  it('reads weeks between ten and forty-five days', () => {
    expect(intervalLabel(plus(21 * 86_400_000), NOW, 'en')).toBe('3 w')
  })

  it('reads months up to a year', () => {
    expect(intervalLabel(plus(90 * 86_400_000), NOW, 'en')).toBe('3 mo')
  })

  it('reads years past a year', () => {
    expect(intervalLabel(plus(400 * 86_400_000), NOW, 'en')).toBe('1 y')
  })

  it('renders the Hindi unit', () => {
    expect(intervalLabel(plus(3 * 86_400_000), NOW, 'hi')).toBe('3 दि')
  })
})
