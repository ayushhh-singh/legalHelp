import { describe, expect, it } from 'vitest'

import { buildRetrievalIndex, retrieve, retrieveAcross, type RetrievalDoc } from '@/lib/retrieval'

import { buildCorpus, type CorpusJson } from '@/lib/library'
import {
  docsFromAids,
  docsFromCorpus,
  docsFromGlossary,
  docsFromNotes,
} from '@/modules/library/retrievalDocs'
import type { GlossaryTerm } from '@/modules/utils/glossary/schema'
import type { LibraryAids, LibraryWork } from '@/schemas/library'
import { RETRIEVAL_CASES } from './fixtures/retrieval'

import { readFromRoot } from '@/test/paths'

/**
 * The retrieval engine, against the COMMITTED DATASETS rather than a fixture
 * corpus.
 *
 * That choice is the same one `tests/law-search.test.ts` makes and it is the
 * reason its acceptance set is worth anything: a ranking table tuned against
 * six invented documents tells you nothing about how it behaves over 818 rules,
 * and it is the second corpus where "Interpretation" stops being a unique
 * heading. `tests/fixtures/retrieval.ts` is the specification; this file is what
 * runs it.
 */

const readJson = <T>(path: string): T => JSON.parse(readFromRoot(path)) as T

const WORK_IDS = ['ccs-conduct', 'ccs-cca', 'ccs-leave', 'csmop', 'rti', 'osa', 'posh'] as const

function corpusFor(workId: string) {
  const work = readJson<LibraryWork>(`data/library/works/${workId}.json`)
  return buildCorpus(work, readJson<CorpusJson>(`data/${work.corpus.file}`))
}

const docs: RetrievalDoc[] = []
for (const workId of WORK_IDS) {
  const corpus = corpusFor(workId)
  const work = readJson<LibraryWork>(`data/library/works/${workId}.json`)
  docs.push(...docsFromCorpus(corpus, 'en', 'rule', work.source.url))
  const aids = readJson<LibraryAids>(`data/library/aids/${workId}.json`)
  docs.push(...docsFromAids(aids.aids, corpus, 'en'))
}

// The glossary is 1,891 terms and a megabyte; a slice keeps the suite fast
// while still putting a real roman-Hindi lookup through the folded index.
const glossary = readJson<{ terms: GlossaryTerm[] }>('data/glossary.json').terms
docs.push(...docsFromGlossary(glossary))

docs.push(
  ...docsFromNotes(
    [
      {
        id: 'test-note-1',
        workId: 'ccs-conduct',
        unitId: 'ccs-conduct-3',
        body: 'my own words on rule 3: integrity, devotion, nothing unbecoming.',
      },
    ],
    () => 'Rule 3, CCS (Conduct) Rules, 1964',
  ),
)

const index = buildRetrievalIndex(docs)

describe('the retrieval acceptance set', () => {
  it('has forty cases', () => {
    expect(RETRIEVAL_CASES.length).toBe(40)
  })

  it.each(RETRIEVAL_CASES.map((entry, at) => [at, entry] as const))('case %i — %o', (_at, entry) => {
    const results = retrieve(index, entry.query, {
      ...(entry.scope ? { scope: entry.scope } : {}),
      ...(entry.k ? { k: entry.k } : {}),
    })
    const ids = results.map((hit) => hit.id)

    if (entry.query === 'zzzzqqqq' || entry.query === 'a') {
      expect(results, entry.why).toEqual([])
      return
    }

    if (entry.topId) expect(ids[0], entry.why).toBe(entry.topId)
    if (entry.topKind) expect(results[0]?.kind, entry.why).toBe(entry.topKind)
    if (entry.expectId) expect(ids, entry.why).toContain(entry.expectId)
    if (entry.rejectId) expect(ids, entry.why).not.toContain(entry.rejectId)
  })
})

describe('retrieve', () => {
  it('never returns more than k', () => {
    expect(retrieve(index, 'leave', { k: 3 }).length).toBeLessThanOrEqual(3)
  })

  it('ranks an exact number above everything fuse finds', () => {
    const [first] = retrieve(index, '18')
    expect(first?.reason).toBe('number')
    expect(first?.score).toBe(1)
  })

  it('carries the personal flag through, and never drops it', () => {
    const notes = retrieve(index, 'my own words', { scope: 'personal' })
    expect(notes.length).toBeGreaterThan(0)
    for (const hit of notes) expect(hit.personal).toBe(true)
    // And a published one is never marked personal.
    for (const hit of retrieve(index, 'Gifts', { scope: 'rules' })) expect(hit.personal).toBe(false)
  })

  it('drops the reader’s own notes on request, without dropping anything else', () => {
    const withNotes = retrieve(index, 'integrity devotion unbecoming', { k: 20 })
    const without = retrieve(index, 'integrity devotion unbecoming', { k: 20, excludePersonal: true })
    expect(withNotes.some((hit) => hit.personal)).toBe(true)
    expect(without.some((hit) => hit.personal)).toBe(false)
  })

  it('returns a source URL for a published document and null for a personal one', () => {
    const rule = retrieve(index, 'Gifts', { scope: 'rules' })[0]
    expect(rule?.sourceUrl).toMatch(/^https?:\/\//)
    const note = retrieve(index, 'my own words', { scope: 'personal' })[0]
    expect(note?.sourceUrl).toBeNull()
  })

  it('gives every hit a route in this app rather than an external link', () => {
    for (const hit of retrieve(index, 'leave', { k: 10 })) expect(hit.href.startsWith('/')).toBe(true)
  })

  it('never repeats a document, even when the number and the fuzzy pass both match', () => {
    const ids = retrieve(index, 'Rule 18', { k: 20 }).map((hit) => hit.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('says why each hit matched', () => {
    for (const hit of retrieve(index, 'Gifts', { k: 5 })) {
      expect(['number', 'citation', 'heading', 'text']).toContain(hit.reason)
    }
  })
})

describe('retrieveAcross', () => {
  it('merges two indexes and honours k over the merged set', () => {
    const rules = buildRetrievalIndex(docs.filter((doc) => doc.kind === 'rule'))
    const aids = buildRetrievalIndex(docs.filter((doc) => doc.kind === 'aid'))
    const merged = retrieveAcross([rules, aids], 'gifts', { k: 4 })
    expect(merged.length).toBeLessThanOrEqual(4)
    expect(merged.length).toBeGreaterThan(0)
  })

  it('is deterministic — the same query twice gives the same order', () => {
    const once = retrieveAcross([index], 'leave salary', { k: 6 }).map((hit) => hit.id)
    const twice = retrieveAcross([index], 'leave salary', { k: 6 }).map((hit) => hit.id)
    expect(once).toEqual(twice)
  })
})
