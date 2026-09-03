import { afterEach, describe, expect, it } from 'vitest'

import {
  isWorkId,
  loadCorpus,
  loadDefinitions,
  loadLibraryIndex,
  loadQuickRef,
  loadWork,
  resetLibraryCache,
  WORK_IDS,
} from './data'

import type { LibraryWork } from '@/schemas/library'

/**
 * The loaders, against the real `?raw` chunks — which is the only way to find
 * out whether the fifteen import specifiers actually resolve. A test that
 * mocked them would prove the map has fifteen keys, which is not the thing that
 * can be wrong.
 *
 * Slow-ish on purpose: `loadCorpus('bns')` parses 1.9 MB. That is the cost the
 * reader pays on a Sanhita and it is worth measuring once.
 */

afterEach(() => {
  resetLibraryCache()
})

describe('the shelf', () => {
  it('lists fifteen works and recognises each of them', () => {
    expect(WORK_IDS).toHaveLength(15)
    for (const id of WORK_IDS) expect(isWorkId(id)).toBe(true)
  })

  it('refuses an id it does not have, including a non-string', () => {
    expect(isWorkId('not-a-work')).toBe(false)
    expect(isWorkId(undefined)).toBe(false)
    expect(isWorkId(42)).toBe(false)
  })

  it('loads and validates the index', async () => {
    const index = await loadLibraryIndex()
    expect(index.works.map((work) => work.id).sort()).toEqual([...WORK_IDS].sort())
  })

  it('parses the index once and hands the same object back', async () => {
    // Two components mounting at once must not start two parses of the same
    // file, and a completed parse must not be thrown away on unmount.
    expect(await loadLibraryIndex()).toBe(await loadLibraryIndex())
  })
})

describe('one work', () => {
  it('loads and validates', async () => {
    const work = await loadWork('ccs-conduct')
    expect(work.id).toBe('ccs-conduct')
    expect(work.corpus.file).toBe('rules/text/ccs-conduct.json')
    expect(work.readingOrder.length).toBeGreaterThan(30)
  })

  it('rejects an unknown id by name rather than resolving to nothing', async () => {
    await expect(loadWork('nope')).rejects.toThrow(/unknown library work: nope/)
  })

  it('does not cache a failure', async () => {
    // An offline first visit must be able to succeed on the next attempt
    // rather than being stuck for the tab's life.
    await expect(loadWork('nope')).rejects.toThrow()
    await expect(loadWork('nope')).rejects.toThrow()
    expect(await loadWork('rti')).toBeTruthy()
  })
})

describe('every specifier in the two loader maps', () => {
  /**
   * The one thing that can actually be wrong in `data.ts` is a path.
   *
   * The thirty import specifiers are written out one per file because a bundler
   * can only chunk a specifier it can see, and a hand-written list of thirty
   * paths is a hand-written list of thirty chances to typo one. Nothing else in
   * the suite would notice: `tests/library-data.test.ts` reads the same files
   * with `node:fs`, so it validates the DATA while saying nothing about whether
   * the app can reach it. A wrong path here is a work that opens to an error.
   *
   * It parses ~5.5 MB and takes a few seconds. That is the cost of the only
   * assertion that covers this.
   */
  it('resolves — all fifteen works and all fifteen corpora', async () => {
    for (const id of WORK_IDS) {
      const work = await loadWork(id)
      expect(work.id, `data/library/works/${id}.json resolved to the wrong work`).toBe(id)

      const corpus = await loadCorpus(work)
      expect(corpus.units.size, `${id}: data/${work.corpus.file} built no units`).toBe(
        work.readingOrder.length,
      )
    }
  })
})

describe('a corpus', () => {
  it('builds units for a rules work', async () => {
    const work = await loadWork('rti')
    const corpus = await loadCorpus(work)
    expect(corpus.units.size).toBe(work.readingOrder.length)
    expect(corpus.units.get(work.readingOrder[0]!)?.body.en.length).toBeGreaterThan(0)
  })

  it('builds units for a law work, chapters and repealed refs included', async () => {
    const work = await loadWork('bsa')
    const corpus = await loadCorpus(work)
    const first = corpus.units.get(work.readingOrder[0]!)
    expect(first?.chapter).not.toBeNull()
    expect(corpus.units.size).toBe(work.readingOrder.length)
  })

  it('rejects a pointer it has no loader for', async () => {
    const work = await loadWork('rti')
    const broken: LibraryWork = { ...work, corpus: { kind: 'rules', file: 'rules/text/ghost.json' } }
    await expect(loadCorpus(broken)).rejects.toThrow(/unknown corpus pointer/)
  })

  it('hands the same parsed corpus back rather than re-parsing megabytes', async () => {
    const work = await loadWork('osa')
    expect(await loadCorpus(work)).toBe(await loadCorpus(work))
  })
})

/**
 * The two extract datasets, through their REAL `?raw` specifiers.
 *
 * Thirty more hand-written import paths, which is thirty more chances to typo
 * one — and a typo here is a work whose defined terms silently never load,
 * invisible to `tests/library-extracts.test.ts` because that reads the same
 * files with `node:fs`. This is the same reason ADR-038 §1 gives for loading
 * all fifteen works and all fifteen corpora here.
 */
describe('the definitions and quick-reference loaders', () => {
  it.each(WORK_IDS)('loads %s through its own specifier', async (id) => {
    const definitions = await loadDefinitions(id)
    const quickref = await loadQuickRef(id)
    expect(definitions.workId).toBe(id)
    expect(quickref.workId).toBe(id)
  })

  it('reads the RTI Act’s defined terms and its thirty-day clock', async () => {
    const definitions = await loadDefinitions('rti')
    expect(definitions.terms.some((term) => /^information$/i.test(term.term))).toBe(true)

    const quickref = await loadQuickRef('rti')
    expect(quickref.rows.some((row) => row.kind === 'time' && row.sortKey === 30)).toBe(true)
  })

  /**
   * A personal work has neither dataset, and that is not an error: the reader
   * page runs the same extraction over it in the browser instead. Rejecting
   * would make every surface handle an error for a case that is not one.
   */
  it('answers with an empty dataset for a work id it has no file for', async () => {
    const definitions = await loadDefinitions('my-something-abc')
    expect(definitions.terms).toEqual([])
    expect(definitions.unitId).toBeNull()

    const quickref = await loadQuickRef('my-something-abc')
    expect(quickref.rows).toEqual([])
    expect(quickref.counts).toEqual({ time: 0, money: 0, authority: 0 })
  })

  it('cites nothing rather than a placeholder domain for a work it has no file for', async () => {
    // A URL that exists only to satisfy a type still ships in the bundle;
    // `tests/no-external-urls.test.ts` caught exactly that here.
    expect((await loadDefinitions('my-something-abc')).source.url).toBe('')
  })

  it('parses each dataset once', async () => {
    expect(await loadQuickRef('osa')).toBe(await loadQuickRef('osa'))
  })
})
