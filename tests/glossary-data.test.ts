import { describe, expect, it } from 'vitest'

import { glossarySchema, GLOSSARY_CATEGORIES } from '@/modules/utils/glossary/schema'
import { fromRoot, readFromRoot } from '@/test/paths'

import type { Glossary } from '@/modules/utils/glossary/schema'

/**
 * The committed bytes of `data/glossary.json`, read off disk.
 *
 * Same arrangement as `tests/drafting-data.test.ts`: this reads the file
 * `scripts/ingest/glossary_seed.py` actually produced and the app will ship,
 * not a fixture that could quietly drift from it.
 */

const readJson = (path: string): unknown => JSON.parse(readFromRoot(path)) as unknown

const glossary: Glossary = glossarySchema.parse(readJson('data/glossary.json'))

const structureTerms = new Set(
  (readJson('data/drafting/structure-terms.json') as { terms: { en: string }[] }).terms.map((t) =>
    t.en.trim().toLowerCase(),
  ),
)

const DEVANAGARI = /[ऀ-ॿ]/

describe('the glossary dataset', () => {
  it('exists on disk and parses against the schema', () => {
    expect(() => fromRoot('data/glossary.json')).not.toThrow()
    expect(glossary.terms.length).toBeGreaterThan(0)
  })

  it('clears the 1,500-entry acceptance floor', () => {
    expect(glossary.terms.length).toBeGreaterThanOrEqual(1500)
  })

  it('has no duplicate ids', () => {
    const ids = glossary.terms.map((term) => term.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('has no duplicate English terms (case-insensitive)', () => {
    const seen = new Set<string>()
    const duplicates: string[] = []
    for (const term of glossary.terms) {
      const key = term.en.trim().toLowerCase()
      if (seen.has(key)) duplicates.push(term.en)
      seen.add(key)
    }
    expect(duplicates).toEqual([])
  })

  it('never repeats a term data/drafting/structure-terms.json already carries', () => {
    const overlap = glossary.terms.filter((term) => structureTerms.has(term.en.trim().toLowerCase()))
    expect(overlap.map((term) => term.en)).toEqual([])
  })

  it('every term is bilingual — hi is real Devanagari, never a placeholder', () => {
    const offenders = glossary.terms.filter((term) => !DEVANAGARI.test(term.hi))
    expect(offenders.map((term) => term.en)).toEqual([])
  })

  it('every term carries a source and verify: true — compiled, not read off one fetched page', () => {
    const offenders = glossary.terms.filter((term) => !term.verify || !term.source.name || !term.source.url)
    expect(offenders.map((term) => term.en)).toEqual([])
  })

  it('every term is one of the seven declared categories', () => {
    const offenders = glossary.terms.filter((term) => !GLOSSARY_CATEGORIES.includes(term.category))
    expect(offenders.map((term) => term.en)).toEqual([])
  })

  it('covers every category with a substantial number of terms', () => {
    const counts = new Map<string, number>()
    for (const term of glossary.terms) counts.set(term.category, (counts.get(term.category) ?? 0) + 1)
    for (const category of GLOSSARY_CATEGORIES) {
      expect(counts.get(category) ?? 0).toBeGreaterThan(100)
    }
  })

  it('an alsoHi list, where present, is never empty and never repeats the primary hi', () => {
    const offenders = glossary.terms.filter(
      (term) => term.alsoHi && (term.alsoHi.length === 0 || term.alsoHi.includes(term.hi)),
    )
    expect(offenders.map((term) => term.en)).toEqual([])
  })

  it('fails against a deliberately corrupted copy', () => {
    const corrupted: Glossary = {
      ...glossary,
      terms: glossary.terms.map((term, index) => (index === 0 ? { ...term, hi: '' } : term)),
    }
    expect(() => glossarySchema.parse(corrupted)).toThrow()
  })
})
