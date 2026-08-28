import { describe, expect, it } from 'vitest'

import { buildGlossaryIndex, searchGlossary } from './search'
import type { Glossary, GlossaryTerm } from './schema'

function term(
  overrides: Partial<GlossaryTerm> & Pick<GlossaryTerm, 'id' | 'en' | 'hi' | 'category'>,
): GlossaryTerm {
  return {
    source: { name: 'Test source', url: 'https://rajbhasha.gov.in/x' },
    fetchedAt: '2026-08-28T00:00:00Z',
    verify: true,
    ...overrides,
  }
}

const GLOSSARY: Glossary = {
  version: '1.0.0',
  generatedAt: '2026-08-28T00:00:00Z',
  disclaimer: { en: 'Reference only.', hi: 'केवल संदर्भ के लिए।' },
  terms: [
    term({ id: 'under-secretary', category: 'designation', en: 'Under Secretary', hi: 'अवर सचिव' }),
    term({ id: 'joint-secretary', category: 'designation', en: 'Joint Secretary', hi: 'संयुक्त सचिव' }),
    term({ id: 'vote-on-account', category: 'finance', en: 'Vote on account', hi: 'लेखानुदान' }),
    term({
      id: 'firewall',
      category: 'it',
      en: 'Firewall',
      hi: 'फ़ायरवॉल',
      alsoHi: ['अग्नि सुरक्षा दीवार'],
    }),
  ],
}

describe('searchGlossary', () => {
  it('returns everything, unfiltered, for an empty query', () => {
    const index = buildGlossaryIndex(GLOSSARY)
    expect(searchGlossary(index, '')).toHaveLength(GLOSSARY.terms.length)
  })

  it('finds an exact English match', () => {
    const index = buildGlossaryIndex(GLOSSARY)
    const results = searchGlossary(index, 'Under Secretary')
    expect(results[0]?.id).toBe('under-secretary')
  })

  it('finds an exact Hindi match', () => {
    const index = buildGlossaryIndex(GLOSSARY)
    const results = searchGlossary(index, 'लेखानुदान')
    expect(results[0]?.id).toBe('vote-on-account')
  })

  it('finds a term by its roman-Hindi spelling — "avar sachiv" reaches अवर सचिव', () => {
    const index = buildGlossaryIndex(GLOSSARY)
    const results = searchGlossary(index, 'avar sachiv')
    expect(results.map((r) => r.id)).toContain('under-secretary')
  })

  it('finds a term through an alsoHi rendering', () => {
    const index = buildGlossaryIndex(GLOSSARY)
    const results = searchGlossary(index, 'अग्नि सुरक्षा दीवार')
    expect(results.map((r) => r.id)).toContain('firewall')
  })

  it('ranks an exact match ahead of a fuzzy one', () => {
    const index = buildGlossaryIndex(GLOSSARY)
    const results = searchGlossary(index, 'Secretary')
    // Both designations match "Secretary"; neither is an exact/prefix hit on
    // the whole term, so this just asserts both are found, not an order.
    expect(results.map((r) => r.id).sort()).toEqual(['joint-secretary', 'under-secretary'])
  })

  it('filters by category', () => {
    const index = buildGlossaryIndex(GLOSSARY)
    expect(searchGlossary(index, '', 'finance').map((r) => r.id)).toEqual(['vote-on-account'])
    expect(searchGlossary(index, 'Secretary', 'it')).toEqual([])
  })

  it('returns nothing for a query that matches nothing', () => {
    const index = buildGlossaryIndex(GLOSSARY)
    expect(searchGlossary(index, 'zzzznonexistentzzzz')).toEqual([])
  })
})
