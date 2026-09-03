import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useGlossarySuggest } from './useGlossarySuggest'
import type { Glossary, GlossaryTerm } from './schema'

function term(en: string, hi: string): GlossaryTerm {
  return {
    id: en.toLowerCase().replace(/\s+/g, '-'),
    category: 'designation',
    en,
    hi,
    source: { name: 'Test source', url: 'https://rajbhasha.gov.in/x' },
    fetchedAt: '2026-08-28T00:00:00Z',
    verify: true,
  }
}

const GLOSSARY: Glossary = {
  version: '1.0.0',
  generatedAt: '2026-08-28T00:00:00Z',
  disclaimer: { en: 'Reference only.', hi: 'केवल संदर्भ के लिए।' },
  terms: [term('Under Secretary', 'अवर सचिव'), term('Secretary', 'सचिव'), term('e-Office', 'ई-कार्यालय')],
}

describe('useGlossarySuggest', () => {
  it('returns nothing for null glossary or empty text', () => {
    expect(renderHook(() => useGlossarySuggest('Under Secretary', null)).result.current).toEqual([])
    expect(renderHook(() => useGlossarySuggest('', GLOSSARY)).result.current).toEqual([])
  })

  it('finds a known English term inside a sentence, at the right offsets', () => {
    const text = 'Please forward this to the Under Secretary for approval.'
    const { result } = renderHook(() => useGlossarySuggest(text, GLOSSARY))
    expect(result.current).toHaveLength(1)
    const [match] = result.current
    expect(match?.term.hi).toBe('अवर सचिव')
    expect(text.slice(match?.start, match?.end)).toBe('Under Secretary')
  })

  it('prefers the longer overlapping term — "Under Secretary" over "Secretary"', () => {
    const { result } = renderHook(() => useGlossarySuggest('The Under Secretary signed it.', GLOSSARY))
    expect(result.current.map((m) => m.matchedText)).toEqual(['Under Secretary'])
  })

  it('still finds the shorter term on its own', () => {
    const { result } = renderHook(() => useGlossarySuggest('The Secretary signed it.', GLOSSARY))
    expect(result.current.map((m) => m.matchedText)).toEqual(['Secretary'])
  })

  it('does not match a term as a substring of an unrelated word', () => {
    const { result } = renderHook(() => useGlossarySuggest('Secretariat building', GLOSSARY))
    expect(result.current).toEqual([])
  })

  it('is case-insensitive', () => {
    const { result } = renderHook(() => useGlossarySuggest('under secretary', GLOSSARY))
    expect(result.current.map((m) => m.term.hi)).toEqual(['अवर सचिव'])
  })

  it('matches a hyphenated term without spilling into a longer word', () => {
    const { result } = renderHook(() => useGlossarySuggest('Send the e-Office link.', GLOSSARY))
    expect(result.current.map((m) => m.matchedText)).toEqual(['e-Office'])
  })

  it('finds every occurrence, in order, without overlap', () => {
    const { result } = renderHook(() =>
      useGlossarySuggest('Secretary spoke to the Under Secretary and then another Secretary.', GLOSSARY),
    )
    expect(result.current.map((m) => m.matchedText)).toEqual(['Secretary', 'Under Secretary', 'Secretary'])
  })

  it('does not match a term glued to a digit — a reference number, not the word', () => {
    // "Panel2" and "Secretary-2024" are file/reference numbers an officer
    // might actually type; treating either as the English word would offer
    // to splice Hindi into a code, not a sentence.
    const panel: Glossary = { ...GLOSSARY, terms: [...GLOSSARY.terms, term('Panel', 'पैनल')] }
    expect(renderHook(() => useGlossarySuggest('See Panel2 for the list.', panel)).result.current).toEqual([])
    expect(renderHook(() => useGlossarySuggest('Ref: Secretary-2024/estt.', panel)).result.current).toEqual(
      [],
    )
  })

  it('still matches a term immediately followed by punctuation', () => {
    const { result } = renderHook(() => useGlossarySuggest("the Secretary's approval, please.", GLOSSARY))
    expect(result.current.map((m) => m.matchedText)).toEqual(['Secretary'])
  })
})
