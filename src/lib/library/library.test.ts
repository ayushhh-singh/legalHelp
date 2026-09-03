import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { beforeEach, describe, expect, it } from 'vitest'

import { LIBRARY_CATEGORIES, ALL_CATEGORIES } from './categories'
import { buildCorpus, paragraphs, tocLeaves, type CorpusJson } from './corpus'
import { lawCrossReferences } from './crossRefs'
import { unitLabel } from './label'
import { adjacent, firstUnitId, getUnit, tocPath, tocUnitIds } from './navigate'
import { estimateReadTime } from './readTime'
import { buildWorkSearchIndex, searchAll, searchWithin } from './search'
import {
  bookmarksFor,
  isBookmarked,
  lastReadAnywhere,
  lastReadIn,
  progressFor,
  progressId,
  readUnitIds,
  recordProgress,
  toggleBookmark,
} from './store'
import { isLibraryTag, LIBRARY_TAGS, tagLabel } from './tags'

import { clearAllData } from '@/db'
import { libraryWorkSchema, type LibraryWork } from '@/schemas/library'

/**
 * The Library's pure layer, against the REAL committed datasets.
 *
 * The corpora are read off disk with `node:fs` rather than through the module's
 * own `?raw` dynamic imports, for the reason every other dataset suite in this
 * repository gives: the committed bytes are the artefact, and a test that only
 * exercises a fixture has tested a fixture. `data.ts`'s loaders are covered
 * separately, at the end, where what is under test is the loader.
 */

const root = process.cwd()
const readJson = <T>(...parts: string[]): T => JSON.parse(readFileSync(resolve(root, ...parts), 'utf8')) as T

const workIds = readdirSync(resolve(root, 'data/library/works'))
  .filter((name) => name.endsWith('.json'))
  .map((name) => name.replace(/\.json$/, ''))

const work = (id: string): LibraryWork => libraryWorkSchema.parse(readJson(`data/library/works/${id}.json`))

const corpusOf = (w: LibraryWork) => buildCorpus(w, readJson<CorpusJson>('data', w.corpus.file))

const conduct = work('ccs-conduct')
const bns = work('bns')
const frsr = work('fr-sr')

describe('paragraphs', () => {
  it('breaks a run-on rule before each numbered sub-clause and each proviso', () => {
    const split = paragraphs('(1) A shall do X. (2) B shall do Y: Provided that C. Explanation - D means E.')
    expect(split).toEqual([
      '(1) A shall do X.',
      '(2) B shall do Y:',
      'Provided that C.',
      'Explanation - D means E.',
    ])
  })

  it('trusts a corpus that breaks its own lines rather than re-splitting them', () => {
    // data/law/*.json prints newlines between sub-sections; second-guessing
    // them would split inside a sub-section the source kept together.
    expect(paragraphs('(1) One thing. Provided that it holds.\n(2) Another.')).toEqual([
      '(1) One thing. Provided that it holds.',
      '(2) Another.',
    ])
  })

  it('returns nothing for an empty or blank string', () => {
    expect(paragraphs('')).toEqual([])
    expect(paragraphs('   \n  ')).toEqual([])
  })

  it('breaks before a Devanagari proviso as well as an English one', () => {
    // The English half of a symmetric-looking pattern silently covering one
    // language is the exact bug ADR-035 records for `\bधारा`.
    expect(paragraphs('कोई व्यक्ति यह करेगा। परन्तु ऐसा नहीं होगा।')).toEqual([
      'कोई व्यक्ति यह करेगा।',
      'परन्तु ऐसा नहीं होगा।',
    ])
  })

  it.each(workIds)('adds and removes nothing from any unit of %s', (id) => {
    // THE GUARANTEE. Splitting is presentational, and the thing being split is
    // a statute: joining the pieces must give back exactly what the corpus
    // holds, modulo the whitespace the split consumed. Without this assertion,
    // a regex that ate a character would be invisible on screen and wrong in a
    // way somebody would act on.
    const w = work(id)
    const corpus = corpusOf(w)
    const collapse = (value: string) => value.replace(/\s+/g, ' ').trim()

    const source = readJson<CorpusJson>('data', w.corpus.file)
    for (const unitId of w.readingOrder) {
      const unit = corpus.units.get(unitId)
      expect(unit, `${id}:${unitId} did not build`).toBeDefined()
      if (!unit) continue
      for (const lang of ['en', 'hi'] as const) {
        const original =
          'sections' in source
            ? source.sections[unitId]?.text[lang]
            : source.rules.find((rule) => rule.id === unitId)?.text[lang]
        expect(collapse(unit.body[lang].join(' ')), `${id}:${unitId}.${lang}`).toBe(collapse(original ?? ''))
      }
    }
  })
})

describe('buildCorpus', () => {
  it('builds one unit per entry of the reading order', () => {
    const corpus = corpusOf(conduct)
    expect(corpus.units.size).toBe(conduct.readingOrder.length)
    expect(corpus.workId).toBe('ccs-conduct')
  })

  it('takes a heading from the corpus where it prints one', () => {
    const unit = corpusOf(conduct).units.get('ccs-conduct-2')
    expect(unit?.heading.en).toBe('Definitions')
  })

  it("falls back to the work's own authored Hindi where the corpus prints none", () => {
    // data/rules/text/*.json has heading.hi === '' for all 818 rules; the Hindi
    // is authored in scripts/authoring/hindi/<act>.json, folded into the work
    // by library_seed.py and folded back onto the unit here. Without this a
    // Hindi reader would see numbers where the Trainer shows headings.
    const unit = corpusOf(conduct).units.get('ccs-conduct-2')
    expect(unit?.heading.hi).toBe('परिभाषाएँ')
  })

  it('carries the excerpt only for a unit the source gave no heading', () => {
    const corpus = corpusOf(frsr)
    const first = corpus.units.get('fr-sr-f-r-1')
    expect(first?.heading.en).toBe('')
    expect(first?.excerpt?.en).toContain('Fundamental Rules')

    expect(corpusOf(conduct).units.get('ccs-conduct-2')?.excerpt).toBeNull()
  })

  it('keeps sub-rules as their own parts, numbered', () => {
    const unit = corpusOf(work('ccs-cca')).units.get('ccs-cca-1')
    expect(unit?.parts.length).toBeGreaterThan(0)
    expect(unit?.parts[0]?.number).toBe('1(1)')
  })

  it.each(workIds)('%s: every sub-rule is a slice of the body, never extra content', (id) => {
    // THE REASON THE READER DOES NOT RENDER `parts`. All 219 rules in
    // data/rules/text that have sub-rules have them as verbatim slices of the
    // same `text`, so a surface that renders both prints the whole rule twice
    // — which the first version of the reader did, and which only a real
    // browser found, because each half was individually correct.
    const collapse = (value: string) => value.replace(/\s+/g, ' ').trim()
    for (const unit of corpusOf(work(id)).units.values()) {
      if (unit.parts.length === 0) continue
      const body = collapse(unit.body.en.join(' '))
      for (const part of unit.parts) {
        const text = collapse(part.text.en)
        if (!text) continue
        expect(body, `${id} ${unit.number} ${part.number}`).toContain(text.slice(0, 60))
      }
    }
  })

  it('carries a law unit chapter and its repealed-Act mappings', () => {
    const unit = corpusOf(bns).units.get('103')
    expect(unit?.chapter?.number).toBeTruthy()
    expect(unit?.repealedRefs.some((ref) => ref.act === 'IPC')).toBe(true)
    // Deduplicated: a section can map to the same old section from several
    // clauses, and a chip drawn twice reads as two different provisions.
    const keys = (unit?.repealedRefs ?? []).map((ref) => `${ref.act}:${ref.section}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('does not prefix a number that already carries its own unit word', () => {
    // "Rule F.R. 17(1)" went onto 179 Trainer cards before ADR-023 caught it.
    expect(corpusOf(frsr).units.get('fr-sr-f-r-1')?.citation.en.startsWith('F.R. 1,')).toBe(true)
    expect(corpusOf(conduct).units.get('ccs-conduct-2')?.citation.en.startsWith('Rule 2,')).toBe(true)
    expect(corpusOf(conduct).units.get('ccs-conduct-2')?.citation.hi.startsWith('नियम 2,')).toBe(true)
  })

  it('skips a unit the corpus turns out not to have, rather than inventing one', () => {
    const broken: LibraryWork = { ...conduct, readingOrder: [...conduct.readingOrder, 'nope'] }
    const corpus = buildCorpus(broken, readJson<CorpusJson>('data', conduct.corpus.file))
    expect(corpus.units.has('nope')).toBe(false)
  })
})

describe('tocLeaves', () => {
  it('flattens a nested table of contents in document order', () => {
    expect(tocLeaves(bns.toc).map((node) => node.unitIds[0])).toEqual(bns.readingOrder)
  })

  it('returns a flat one unchanged', () => {
    expect(tocLeaves(conduct.toc)).toHaveLength(conduct.toc.length)
  })
})

describe('navigation', () => {
  const corpus = corpusOf(conduct)

  it('finds a unit, and answers null for one that is not there', () => {
    expect(getUnit(corpus, 'ccs-conduct-2')?.number).toBe('2')
    expect(getUnit(corpus, 'ccs-conduct-999')).toBeNull()
  })

  it('walks the reading order in both directions', () => {
    const [first, second, third] = conduct.readingOrder
    const middle = adjacent(corpus, second!)
    expect(middle.previous?.id).toBe(first)
    expect(middle.next?.id).toBe(third)
    expect(middle.position).toBe(2)
    expect(middle.total).toBe(conduct.readingOrder.length)
  })

  it('stops at both ends', () => {
    expect(adjacent(corpus, conduct.readingOrder[0]!).previous).toBeNull()
    expect(adjacent(corpus, conduct.readingOrder.at(-1)!).next).toBeNull()
  })

  it('never offers a next that resolves to nothing', () => {
    // `readingOrder` is the work's claim; the corpus is the fact. Walking the
    // claim alone would offer a Next button that lands on an error page.
    const broken: LibraryWork = {
      ...conduct,
      readingOrder: [conduct.readingOrder[0]!, 'ghost', conduct.readingOrder[1]!],
    }
    const partial = buildCorpus(broken, readJson<CorpusJson>('data', conduct.corpus.file))
    const at = adjacent(partial, conduct.readingOrder[0]!)
    expect(at.next?.id).toBe(conduct.readingOrder[1])
    expect(at.total).toBe(2)
  })

  it('reports nothing for a unit outside the work', () => {
    expect(adjacent(corpus, 'ccs-conduct-999')).toEqual({
      previous: null,
      next: null,
      position: 0,
      total: conduct.readingOrder.length,
    })
  })

  it('opens on the first unit', () => {
    expect(firstUnitId(conduct)).toBe(conduct.readingOrder[0])
    expect(firstUnitId({ ...conduct, readingOrder: [] })).toBeNull()
  })

  it('gives the chapter path for a law unit and a single node for a flat one', () => {
    const deep = tocPath(bns, '103')
    expect(deep.length).toBe(2)
    expect(deep[1]?.unitIds).toEqual(['103'])

    expect(tocPath(conduct, 'ccs-conduct-2')).toHaveLength(1)
    expect(tocPath(conduct, 'nope')).toEqual([])
  })

  it('names every unit from the table of contents', () => {
    expect(tocUnitIds(bns)).toEqual(bns.readingOrder)
  })
})

describe('unitLabel', () => {
  const both = { en: 'Definitions', hi: 'परिभाषाएँ' }

  it("prefers the reader's own language", () => {
    expect(unitLabel(both, null, 'hi')).toEqual({ text: 'परिभाषाएँ', isExcerpt: false, lang: 'hi' })
  })

  it('falls to the excerpt in that language before crossing to the other', () => {
    const shown = unitLabel({ en: '', hi: 'शीर्षक' }, { en: 'These rules may…', hi: '' }, 'en')
    expect(shown).toEqual({ text: 'These rules may…', isExcerpt: true, lang: 'en' })
  })

  it('crosses languages only when its own has nothing, and says that it did', () => {
    // A law chapter title with no Hindi is better shown in English than not
    // shown at all — but the caller has to be able to mark it up as English.
    expect(unitLabel({ en: 'Preliminary', hi: '' }, null, 'hi')).toEqual({
      text: 'Preliminary',
      isExcerpt: false,
      lang: 'en',
    })
  })

  it('uses the other language’s excerpt as the last resort', () => {
    expect(unitLabel({ en: '', hi: '' }, { en: 'Opening words…', hi: '' }, 'hi')).toEqual({
      text: 'Opening words…',
      isExcerpt: true,
      lang: 'en',
    })
  })

  it('returns nothing when there is nothing, rather than a placeholder', () => {
    expect(unitLabel({ en: '', hi: '' }, null, 'en').text).toBe('')
  })
})

describe('estimateReadTime', () => {
  it('reads English at 180 words a minute', () => {
    expect(estimateReadTime(Array(360).fill('word').join(' '))).toBe(2)
  })

  it('reads Devanagari more slowly, at 140', () => {
    expect(estimateReadTime(Array(280).fill('शब्द').join(' '))).toBe(2)
  })

  it('rates each word by its own script, not by the reader', () => {
    // A Hindi reader reading the English text of a rule — which is every rule
    // in this corpus — is still reading English words.
    const english = Array(360).fill('word').join(' ')
    expect(estimateReadTime(english)).toBe(Math.ceil(360 / 180))
  })

  it('never reports less than a minute', () => {
    expect(estimateReadTime('')).toBe(1)
    expect(estimateReadTime('one')).toBe(1)
    expect(estimateReadTime('—')).toBe(1)
  })
})

describe('search inside a work', () => {
  const index = buildWorkSearchIndex(corpusOf(conduct))

  it('finds a phrase in the English body', () => {
    const hits = searchWithin(index, 'absolute integrity')
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.some((hit) => hit.unit.number === '3')).toBe(true)
    expect(hits[0]?.snippet.length).toBeGreaterThan(0)
  })

  it('finds a Devanagari heading regardless of the reader’s language', () => {
    // Both languages are always indexed: the bodies are English-only and the
    // headings are Hindi-and-English, so indexing one language would make one
    // of the two searches silently find nothing.
    const hits = searchWithin(index, 'परिभाषाएँ')
    expect(hits.some((hit) => hit.unit.number === '2')).toBe(true)
  })

  it('finds a unit by its number, exactly, ahead of everything else', () => {
    // fuse's minMatchCharLength is 3, so a two-character query never reaches
    // the index at all — and "11" is the single most obvious thing a reader
    // types into a rule book. It is answered exactly, and first.
    const hits = searchWithin(index, '11')
    expect(hits[0]?.unit.number).toBe('11')
  })

  it('does not let a longer number outrank the one that was typed', () => {
    expect(searchWithin(index, '3')[0]?.unit.number).toBe('3')
  })

  it('reaches a number that carries its own unit word', () => {
    const frsrIndex = buildWorkSearchIndex(corpusOf(frsr))
    expect(searchWithin(frsrIndex, '22')[0]?.unit.number).toBe('F.R. 22')
  })

  it('does not index the same text twice through sub-rules', () => {
    // A rule with sub-rules must not out-score one without them purely for
    // carrying a second copy of its own text.
    const withSubRules = searchWithin(index, 'devotion to duty')
    expect(new Set(withSubRules.map((hit) => hit.unit.id)).size).toBe(withSubRules.length)
  })

  it('answers nothing for a query too short to mean anything', () => {
    expect(searchWithin(index, 'a')).toEqual([])
    expect(searchWithin(index, '   ')).toEqual([])
  })

  it('caps what it renders without capping what it matches', () => {
    expect(searchWithin(index, 'Government', 3).length).toBeLessThanOrEqual(3)
  })

  it('quotes context around the match', () => {
    const hit = searchWithin(index, 'absolute integrity')[0]
    expect(hit?.snippet.toLowerCase()).toContain('integrity')
  })
})

describe('search across the shelf', () => {
  it('groups per work and ranks the book the query is about first', () => {
    const indexes = new Map([
      ['ccs-conduct', buildWorkSearchIndex(corpusOf(conduct))],
      ['posh', buildWorkSearchIndex(corpusOf(work('posh')))],
    ])
    const entries = readJson<{ works: { id: string }[] }>('data/library/index.json').works.filter((entry) =>
      indexes.has(entry.id),
    ) as never

    const groups = searchAll(entries, indexes, 'sexual harassment')
    expect(groups.length).toBeGreaterThan(0)
    expect(groups[0]?.work.id).toBe('posh')
    for (let i = 1; i < groups.length; i += 1) {
      expect(groups[i - 1]!.hits.length).toBeGreaterThanOrEqual(groups[i]!.hits.length)
    }
  })

  it('skips a work whose index the caller did not build', () => {
    const entries = readJson<{ works: { id: string }[] }>('data/library/index.json').works as never
    expect(searchAll(entries, new Map(), 'anything')).toEqual([])
  })
})

describe('law cross-references', () => {
  it('finds a citation the rule book writes out in full', () => {
    expect(lawCrossReferences('an offence punishable under section 509 of the Indian Penal Code')).toEqual([
      { act: 'IPC', section: '509', query: 'IPC 509' },
    ])
  })

  it('names the Act in the query it builds', () => {
    // A bare number re-parses on a fresh visit as the repealed Act's section
    // (ADR-029 point 4), so the Act is what makes the link land correctly.
    const [ref] = lawCrossReferences('under section 337 of the Code of Criminal Procedure, 1973')
    expect(ref?.query).toBe('CrPC 337')
  })

  it('ignores a bare internal reference, which is what most of them are', () => {
    // "the provisions of Rule 3" inside the CCS (Leave) Rules means Rule 3 of
    // those rules; offering it as a link to BNS 3 is worse than offering none.
    expect(lawCrossReferences('subject to the provisions of Rule 3 and section 4')).toEqual([])
  })

  it('deduplicates a citation the document repeats', () => {
    const text = 'section 509 of the Indian Penal Code … again section 509 of the Indian Penal Code'
    expect(lawCrossReferences(text)).toHaveLength(1)
  })

  it('keeps a letter suffix, because 124 and 124A are different sections', () => {
    const [ref] = lawCrossReferences('section 124A of the Indian Penal Code')
    expect(ref?.section).toBe('124A')
  })

  it('finds the ones that are actually in the committed rule books, and names them', () => {
    const found = new Map<string, string[]>()
    for (const id of workIds) {
      const w = work(id)
      if (w.corpus.kind !== 'rules') continue
      for (const unit of corpusOf(w).units.values()) {
        const refs = lawCrossReferences([...unit.body.en, ...unit.parts.map((p) => p.text.en)].join(' '))
        for (const ref of refs) {
          const key = `${w.id} ${unit.number}`
          found.set(key, [...(found.get(key) ?? []), ref.query])
        }
      }
    }

    // Named, not counted. The whole design claim is that this pattern is
    // narrow enough to be RIGHT rather than plentiful — six occurrences across
    // twelve rule books, in two units after per-unit deduplication — and a
    // count would pass just as happily against a looser pattern that had
    // started matching internal rule references.
    expect([...found.values()].flat().sort()).toEqual(['CrPC 337', 'IPC 509'])
  })
})

describe('tags and categories', () => {
  it('labels every declared tag in both languages', () => {
    for (const [tag, label] of Object.entries(LIBRARY_TAGS)) {
      expect(label.en.trim(), tag).toBeTruthy()
      expect(label.hi.trim(), tag).toBeTruthy()
    }
  })

  it('answers with the slug for a tag nothing has labelled yet', () => {
    expect(tagLabel('made-up', 'en')).toBe('made-up')
    expect(isLibraryTag('made-up')).toBe(false)
    expect(tagLabel('conduct', 'hi')).toBe('आचरण')
  })

  it('orders every category the schema declares', () => {
    expect([...LIBRARY_CATEGORIES].sort()).toEqual([...ALL_CATEGORIES].sort())
  })
})

describe('reading state', () => {
  beforeEach(async () => {
    await clearAllData()
  })

  it('keys a row on the work and the unit together', () => {
    // A law unit id is a bare section number, unique only within its code.
    expect(progressId('bns', '103')).toBe('bns:103')
  })

  it('round-trips through IndexedDB', async () => {
    await recordProgress('ccs-conduct', 'ccs-conduct-2', 0, new Date('2026-09-01T10:00:00.000Z'))
    const rows = await progressFor('ccs-conduct')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: 'ccs-conduct:ccs-conduct-2',
      workId: 'ccs-conduct',
      unitId: 'ccs-conduct-2',
      secondsRead: 0,
    })
  })

  it('accumulates dwell across visits rather than overwriting it', async () => {
    await recordProgress('ccs-conduct', 'ccs-conduct-2', 30, new Date('2026-09-01T10:00:00.000Z'))
    await recordProgress('ccs-conduct', 'ccs-conduct-2', 45, new Date('2026-09-02T10:00:00.000Z'))
    const [row] = await progressFor('ccs-conduct')
    expect(row?.secondsRead).toBe(75)
    // `at` is the LAST visit: "where was I" is about the last one.
    expect(row?.at).toBe('2026-09-02T10:00:00.000Z')
  })

  it('ignores a nonsense duration instead of poisoning the total', async () => {
    await recordProgress('bns', '103', Number.NaN)
    await recordProgress('bns', '103', -60)
    const [row] = await progressFor('bns')
    expect(row?.secondsRead).toBe(0)
  })

  it('answers which units of a work have been opened', async () => {
    await recordProgress('bns', '1', 0)
    await recordProgress('bns', '103', 0)
    await recordProgress('bnss', '1', 0)
    expect([...(await readUnitIds('bns'))].sort()).toEqual(['1', '103'])
  })

  it('finds the last unit read in one work and across all of them', async () => {
    await recordProgress('bns', '1', 0, new Date('2026-09-01T10:00:00.000Z'))
    await recordProgress('bns', '103', 0, new Date('2026-09-03T10:00:00.000Z'))
    await recordProgress('rti', 'rti-8', 0, new Date('2026-09-02T10:00:00.000Z'))

    expect((await lastReadIn('bns'))?.unitId).toBe('103')
    expect(await lastReadIn('gfr')).toBeNull()
    expect((await lastReadAnywhere())?.unitId).toBe('103')
  })

  it('has no last-read anywhere on a fresh device', async () => {
    expect(await lastReadAnywhere()).toBeNull()
  })

  it('toggles a bookmark both ways and reports the state it left', async () => {
    expect(await isBookmarked('bns', '103')).toBe(false)
    expect(await toggleBookmark('bns', '103')).toBe(true)
    expect(await isBookmarked('bns', '103')).toBe(true)
    expect(await bookmarksFor('bns')).toHaveLength(1)

    expect(await toggleBookmark('bns', '103')).toBe(false)
    expect(await isBookmarked('bns', '103')).toBe(false)
    expect(await bookmarksFor('bns')).toEqual([])
  })
})
