import { describe, expect, it } from 'vitest'

import { DROPPED_CASES, SEARCH_CASES } from './fixtures/law-search'

import { browseCode, buildEngine, searchLaw, sortKeyFor, type LawSearchEngine } from '@/modules/law/search'
import type { LawCorpus, LawDataset, LawIndex } from '@/modules/law/types'
import { readFromRoot } from '@/test/paths'

/**
 * The search, run against the COMMITTED datasets.
 *
 * Read off disk rather than imported, for the same reason `tests/law-data.test.ts`
 * does it: these are the bytes the weekly ingest opens a pull request against,
 * and a fixture copy of them would let the two drift. It also keeps 3.9 MB of
 * section text out of whatever bundle imports this module.
 *
 * `tests/fixtures/law-search.ts` is the specification; this file is only the
 * harness that runs it.
 */
const load = <T>(file: string): T => JSON.parse(readFromRoot('data/law', file)) as T

const corpus: LawCorpus = {
  index: load<LawIndex>('index.json'),
  datasets: {
    bns: load<LawDataset>('bns.json'),
    bnss: load<LawDataset>('bnss.json'),
    bsa: load<LawDataset>('bsa.json'),
  },
}

const engine: LawSearchEngine = buildEngine(corpus)

const label = (hit: { doc: { ref: { record: { act: string; section: string } } } }) =>
  `${hit.doc.ref.record.act} ${hit.doc.ref.record.section}`

describe('law search', () => {
  it('builds one document per section of all three Acts', () => {
    expect(engine.docs).toHaveLength(1059)
  })

  describe.each(SEARCH_CASES)('$query', (testCase) => {
    const result = searchLaw(engine, { query: testCase.query, direction: 'old-new' })
    const ranked = result.hits.map(label)

    it(`ranks ${testCase.top} first`, () => {
      expect(ranked[0], `got: ${ranked.slice(0, 5).join(', ') || '(nothing)'}`).toBe(testCase.top)
    })

    if (testCase.within) {
      const within = testCase.withinN ?? 5
      it(`also returns ${testCase.within.join(', ')} in the first ${within}`, () => {
        expect(ranked.slice(0, within)).toEqual(expect.arrayContaining(testCase.within ?? []))
      })
    }
  })

  describe.each(DROPPED_CASES)('$query', (testCase) => {
    it(`reports ${testCase.dropped?.join(', ')} as having no counterpart`, () => {
      const result = searchLaw(engine, { query: testCase.query, direction: 'old-new' })
      const dropped = result.dropped.map((entry) => `${entry.oldAct} ${entry.section}`)
      expect(dropped).toEqual(expect.arrayContaining(testCase.dropped ?? []))
      // Not merely present — the entry has to carry the explanation, or the UI
      // has a banner with nothing in it.
      for (const entry of result.dropped) {
        expect(entry.entry.newSections).toEqual([])
      }
    })
  })
})

describe('ranking rules', () => {
  it('puts an exact section match above every text match', () => {
    // "103" is a section number AND a word that appears in a hundred places.
    const result = searchLaw(engine, { query: '103', direction: 'new-old' })
    expect(result.hits[0]?.reason).toBe('section')
  })

  it('offers the same number read the other way, but never above the answer', () => {
    const result = searchLaw(engine, { query: '302', direction: 'old-new' })
    const bns302 = result.hits.findIndex((hit) => label(hit) === 'BNS 302')
    const bns103 = result.hits.findIndex((hit) => label(hit) === 'BNS 103')

    expect(bns103).toBe(0)
    expect(bns302).toBeGreaterThan(bns103)
    expect(result.hits[bns302]?.reason).toBe('section-other-direction')
  })

  it('suppresses the other direction entirely when the query names an Act', () => {
    // "IPC 302" cannot also be a question about BNS 302 — the reader said IPC.
    const result = searchLaw(engine, { query: 'ipc 302', direction: 'old-new' })
    expect(result.hits.map(label)).not.toContain('BNS 302')
    expect(result.hits.map(label)).toContain('BNS 103')
  })

  it('lets the Act named in the query override the direction toggle', () => {
    const result = searchLaw(engine, { query: 'crpc 438', direction: 'new-old' })
    expect(result.direction).toBe('old-new')
    expect(result.hits[0] && label(result.hits[0])).toBe('BNSS 482')
  })

  it('honours the direction toggle when the query names no Act', () => {
    const forward = searchLaw(engine, { query: '482', direction: 'old-new' })
    const backward = searchLaw(engine, { query: '482', direction: 'new-old' })

    // Read old -> new, "482" is three questions at once: IPC 482 -> BNS 345,
    // CrPC 482 -> BNSS 528, IEA 482 (which does not exist). Read the other way
    // it is BNSS 482, anticipatory bail. Both readings are offered; which one
    // leads is what the toggle decides.
    expect(forward.hits[0] && label(forward.hits[0])).toBe('BNS 345')
    expect(forward.hits.map(label)).toContain('BNSS 528')
    expect(backward.hits.map(label).slice(0, 3)).toContain('BNSS 482')
  })

  it('restricts to one code when a chip is set', () => {
    const result = searchLaw(engine, { query: 'murder', code: 'bnss', direction: 'old-new' })
    expect(result.hits.every((hit) => hit.doc.code === 'bnss')).toBe(true)
  })

  it('resolves a sub-section reference to its parent section', () => {
    const result = searchLaw(engine, { query: 'bns 318(4)', direction: 'new-old' })
    expect(result.hits[0] && label(result.hits[0])).toBe('BNS 318')
    expect(result.parsed.sectionRef).toBe('318(4)')
  })

  it('finds a phrase that appears only in the section text', () => {
    // Nothing is headed "audio-video electronic means"; BNSS 105 is about it.
    const result = searchLaw(engine, { query: 'audio-video electronic means', direction: 'old-new' })
    expect(result.hits.map(label).slice(0, 10)).toContain('BNSS 105')
  })

  it('returns nothing rather than everything for an empty query', () => {
    expect(searchLaw(engine, { query: '   ', direction: 'old-new' }).hits).toEqual([])
  })

  it('survives a query that is only punctuation', () => {
    expect(() => searchLaw(engine, { query: '((()))', direction: 'old-new' })).not.toThrow()
  })
})

describe('browsing a code', () => {
  it('returns every section of that Act, in number order', () => {
    const bns = browseCode(engine, 'bns')
    expect(bns).toHaveLength(358)
    expect(label(bns[0]!)).toBe('BNS 1')
    expect(label(bns[357]!)).toBe('BNS 358')
  })

  it('orders a lettered section beside its neighbour, not at the end', () => {
    const bnss = browseCode(engine, 'bnss').map(label)
    expect(bnss).toHaveLength(531)
    expect(bnss.indexOf('BNSS 2')).toBe(bnss.indexOf('BNSS 1') + 1)
  })

  it('never mixes codes', () => {
    for (const code of ['bns', 'bnss', 'bsa'] as const) {
      expect(browseCode(engine, code).every((hit) => hit.doc.code === code)).toBe(true)
    }
  })

  it('scores every browse row worse than any real match, so a query wins', () => {
    // The browse list is replaced the moment anything is typed; the score is
    // belt and braces for any future caller that merges the two.
    expect(browseCode(engine, 'bsa').every((hit) => hit.score === 1)).toBe(true)
  })
})

describe('sortKeyFor', () => {
  it('orders a lettered section between its neighbours', () => {
    expect(sortKeyFor('103')).toBeLessThan(sortKeyFor('103A'))
    expect(sortKeyFor('103A')).toBeLessThan(sortKeyFor('104'))
    expect(sortKeyFor('376A')).toBeLessThan(sortKeyFor('376AB'))
  })
})
