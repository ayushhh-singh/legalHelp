import { describe, expect, it } from 'vitest'

import {
  buildRetrievalIndex,
  isRetrievable,
  numberKey,
  numbersIn,
  retrieve,
  retrieveAcross,
  snippetAround,
  type RetrievalDoc,
} from './retrieval'

/**
 * Query parsing and the engine's own rules, in isolation from any dataset.
 *
 * `tests/retrieval.test.ts` is where the forty-query acceptance set runs
 * against the committed corpora; this file is about the jobs before that —
 * turning what somebody typed into a set of provision numbers, deciding whether
 * it is worth running at all, and the scope and personal-flag rules that hold
 * whatever the documents are. The split is the one `src/lib/search.test.ts` and
 * `tests/law-search.test.ts` already draw.
 */

const doc = (over: Partial<RetrievalDoc> & Pick<RetrievalDoc, 'id' | 'kind'>): RetrievalDoc => ({
  citation: 'Rule 1, Test Rules, 2026',
  heading: 'Heading',
  text: 'Body text.',
  href: '/library/test/1',
  sourceUrl: 'https://example.gov.in/test',
  personal: false,
  ...over,
})

describe('numberKey and numbersIn', () => {
  it('folds Devanagari digits and case, and KEEPS a sub-section apart', () => {
    expect(numberKey('१०३')).toBe('103')
    expect(numberKey('65b')).toBe('65B')
    expect(numberKey('4.7')).toBe('4.7')

    /*
      This assertion used to read `expect(numberKey('318 (4)')).toBe('3184')`,
      and it was describing the defect rather than the requirement.

      `3184` is not a fold of `318(4)` — it is a DIFFERENT provision number, and
      in this corpus a real one: `1(1)` folded onto Rule 11 in every one of the
      nine rule books with eleven rules, and 256 of GFR's 307 rule numbers were
      reachable that way. Because the number pass scores 1.0, the stranger
      arrived level with the right answer.

      Which makes the test two blocks down ("keeps 124 and 124A apart", citing
      ADR-035) the exact lesson this file then broke one level of resolution
      further in. An edge-case pass that contradicts a committed assertion has
      to decide which of the two is describing the app; this one was not.
    */
    expect(numberKey('318 (4)')).toBe('318(4)')
    expect(numberKey('318 (4)')).not.toBe(numberKey('3184'))
  })

  it('keeps 124 and 124A apart', () => {
    // The ADR-035 lesson: IPC 124A is sedition and IPC 124 is assaulting the
    // President. A digits-only key made a citation of one look supported by a
    // result about the other.
    expect(numberKey('124')).not.toBe(numberKey('124A'))
  })

  it('reads a bare number, and both resolutions of a sub-section', () => {
    expect(numbersIn('18')).toEqual(['18'])
    // Both resolutions, and neither of them the concatenation: `18(2)` is the
    // sub-section and `18` is the rule that stores it. `182` is somebody else.
    expect(numbersIn('rule 18(2)')).toContain('18(2)')
    expect(numbersIn('rule 18(2)')).toContain('18')
    expect(numbersIn('rule 18(2)')).not.toContain('182')
  })

  it('reads a Devanagari unit word, which carries no word boundary', () => {
    // `/\bधारा/` matches nothing, ever — the trap ADR-035 and ADR-038 both
    // record. If the Devanagari half of PROVISION is ever anchored, this fails.
    expect(numbersIn('धारा 8')).toContain('8')
    expect(numbersIn('नियम 18')).toContain('18')
    expect(numbersIn('उपनियम 3')).toContain('3')
  })

  it('finds nothing in prose that names no provision', () => {
    expect(numbersIn('what does absolute integrity mean')).toEqual([])
    expect(numbersIn('the BNS 2023 replaced the IPC 1860')).toEqual([])
  })
})

describe('isRetrievable', () => {
  it('refuses one letter and accepts one digit', () => {
    expect(isRetrievable('a')).toBe(false)
    expect(isRetrievable('3')).toBe(true)
    expect(isRetrievable('३')).toBe(true)
    expect(isRetrievable('   ')).toBe(false)
    expect(isRetrievable('18')).toBe(true)
  })
})

describe('snippetAround', () => {
  it('windows the text around the match and marks both ellipses', () => {
    const text = `${'x'.repeat(200)} needle ${'y'.repeat(200)}`
    const snippet = snippetAround(text, 'needle', 20)
    expect(snippet).toContain('needle')
    expect(snippet.startsWith('…')).toBe(true)
    expect(snippet.endsWith('…')).toBe(true)
    expect(snippet.length).toBeLessThan(text.length)
  })

  it('returns the opening when the needle is not literally present', () => {
    // A fuzzy hit no substring search can locate. The opening of the unit is
    // honest context; claiming a match that is not there would not be.
    expect(snippetAround('Every Government servant shall maintain integrity.', 'intergrity', 10)).toContain(
      'Every Government',
    )
  })
})

describe('scope and the personal flag', () => {
  const index = buildRetrievalIndex([
    doc({ id: 'rule:a', kind: 'rule', heading: 'Integrity', number: '3' }),
    doc({ id: 'section:b', kind: 'section', heading: 'Integrity', number: '4' }),
    doc({ id: 'glossary:c', kind: 'glossary', heading: 'Integrity', citation: 'Integrity / सत्यनिष्ठा' }),
    doc({ id: 'aid:d', kind: 'aid', heading: 'Integrity', text: 'What Rule 3 requires.' }),
    doc({ id: 'definition:e', kind: 'definition', heading: 'Integrity' }),
    doc({
      id: 'note:f',
      kind: 'note',
      heading: '',
      text: 'my note about integrity',
      personal: true,
      sourceUrl: null,
    }),
  ])

  it('returns every kind under `all`', () => {
    const kinds = new Set(retrieve(index, 'integrity', { k: 20 }).map((hit) => hit.kind))
    expect(kinds.size).toBeGreaterThan(3)
  })

  it.each([
    ['law', ['section']],
    ['rules', ['rule']],
    ['glossary', ['glossary']],
    ['personal', ['note']],
  ] as const)('restricts %s to %o', (scope, expected) => {
    const kinds = [...new Set(retrieve(index, 'integrity', { scope, k: 20 }).map((hit) => hit.kind))]
    expect(kinds).toEqual(expected)
  })

  it('reaches rules, sections, aids and definitions under `library`, and not the glossary', () => {
    const kinds = new Set(retrieve(index, 'integrity', { scope: 'library', k: 20 }).map((h) => h.kind))
    expect(kinds.has('glossary')).toBe(false)
    expect(kinds.has('note')).toBe(false)
    expect(kinds.has('rule')).toBe(true)
  })

  it('excludes personal documents on request', () => {
    const hits = retrieve(index, 'integrity', { k: 20, excludePersonal: true })
    expect(hits.some((hit) => hit.personal)).toBe(false)
  })

  it('applies the scope filter AFTER the search, so k is filled from what is in scope', () => {
    // The trap this guards: asking fuse for exactly k and then filtering can
    // return nothing at all when the top k are out of scope.
    const hits = retrieve(index, 'integrity', { scope: 'personal', k: 1 })
    expect(hits.map((hit) => hit.id)).toEqual(['note:f'])
  })
})

describe('retrieve, over a synthetic index', () => {
  const index = buildRetrievalIndex([
    doc({ id: 'rule:18', kind: 'rule', heading: 'Property', number: '18', citation: 'Rule 18' }),
    doc({ id: 'rule:18a', kind: 'rule', heading: 'Property abroad', number: '18A', citation: 'Rule 18A' }),
    doc({
      id: 'rule:2',
      kind: 'rule',
      heading: 'Definitions',
      number: '2',
      text: 'See Rule 18 for property returns.',
      citation: 'Rule 2',
    }),
  ])

  it('puts the numbered rule first, above a rule that merely cites it', () => {
    expect(retrieve(index, '18')[0]?.id).toBe('rule:18')
  })

  it('keeps 18 and 18A apart', () => {
    expect(retrieve(index, '18A')[0]?.id).toBe('rule:18a')
    expect(retrieve(index, '18')[0]?.id).toBe('rule:18')
  })

  it('gives a number match a score of exactly 1, above any fuzzy hit', () => {
    const hits = retrieve(index, 'rule 18', { k: 5 })
    expect(hits[0]?.score).toBe(1)
    for (const hit of hits.slice(1)) expect(hit.score).toBeLessThan(1)
  })

  it('returns nothing for a query nothing matches', () => {
    expect(retrieve(index, 'zzzzqqqq')).toEqual([])
  })

  it('refuses a one-letter query before touching the index', () => {
    expect(retrieve(index, 'a')).toEqual([])
  })

  it('merges across indexes deterministically', () => {
    const other = buildRetrievalIndex([doc({ id: 'aid:x', kind: 'aid', heading: 'Property' })])
    const once = retrieveAcross([index, other], 'property', { k: 5 }).map((hit) => hit.id)
    const twice = retrieveAcross([index, other], 'property', { k: 5 }).map((hit) => hit.id)
    expect(once).toEqual(twice)
    expect(once.length).toBeGreaterThan(1)
  })
})

describe('buildRetrievalIndex', () => {
  it('indexes a document with no number without crashing, and cannot be found by one', () => {
    const index = buildRetrievalIndex([doc({ id: 'glossary:a', kind: 'glossary', heading: 'Office' })])
    expect(index.count).toBe(1)
    expect(index.byNumber.size).toBe(0)
    expect(retrieve(index, 'office')[0]?.id).toBe('glossary:a')
  })

  it('groups two documents sharing a number under one key', () => {
    const index = buildRetrievalIndex([
      doc({ id: 'rule:a', kind: 'rule', number: '3', workId: 'x' }),
      doc({ id: 'rule:b', kind: 'rule', number: '3', workId: 'y' }),
    ])
    expect(index.byNumber.get('3')?.length).toBe(2)
    expect(retrieve(index, '3').length).toBe(2)
  })
})
