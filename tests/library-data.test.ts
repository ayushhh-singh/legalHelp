import { readdirSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { LIBRARY_CATEGORIES, ALL_CATEGORIES, isLibraryTag } from '@/lib/library'
import { libraryIndexSchema, libraryWorkSchema, type LibraryWork, type TocNode } from '@/schemas/library'
import { fromRoot, readFromRoot } from '@/test/paths'

/**
 * The committed bytes of `data/library`, read off disk — the same arrangement
 * `tests/law-data.test.ts`, `tests/pay-data.test.ts`, `tests/drafting-data.test.ts`
 * and `tests/rules-data.test.ts` use, and for the same reason: these files are
 * what `scripts/ingest/library_seed.py` produces and what the app ships. A work
 * that validates only against a test's own object literal has been tested for
 * nothing.
 *
 * THE LOAD-BEARING ASSERTION HERE IS THE POINTER. A work file carries no
 * statutory text at all; every unit id in it is a promise about a record in
 * `data/rules/text/<act>.json` or `data/law/<code>.json`. If that promise
 * breaks — a corpus regenerated with a renamed rule, a work built against an
 * older one — the reader page renders "this work has no such unit" for a
 * section that plainly exists, and nothing else in the suite would notice.
 * `resolves into the pointed-at corpus`, below, is the test that catches it.
 */

const WORKS_DIR = 'data/library/works'

const readJson = <T>(path: string): T => JSON.parse(readFromRoot(path)) as T

const workIds = readdirSync(fromRoot(WORKS_DIR))
  .filter((name) => name.endsWith('.json'))
  .map((name) => name.replace(/\.json$/, ''))
  .sort()

const works = new Map<string, LibraryWork>(
  workIds.map((id) => [id, readJson<LibraryWork>(`${WORKS_DIR}/${id}.json`)]),
)

/** Every unit id the corpus a work points at actually has. */
function corpusUnitIds(work: LibraryWork): Set<string> {
  const raw = readJson<unknown>(`data/${work.corpus.file}`)
  if (work.corpus.kind === 'law') {
    const sections = (raw as { sections: Record<string, unknown> }).sections
    return new Set(Object.keys(sections))
  }
  const rules = (raw as { rules: { id: string }[] }).rules
  return new Set(rules.map((rule) => rule.id))
}

const leaves = (nodes: readonly TocNode[]): TocNode[] =>
  nodes.flatMap((node) => ((node.children ?? []).length > 0 ? leaves(node.children ?? []) : [node]))

describe('the shelf', () => {
  it('is the fifteen works this session built, and the seed script agrees', () => {
    // A floor AND an exact list: a work silently dropped by a regenerated
    // dataset would keep any count-based assertion happy at fourteen.
    expect(workIds).toEqual([
      'bns',
      'bnss',
      'bsa',
      'ccs-cca',
      'ccs-conduct',
      'ccs-leave',
      'ccs-pension',
      'csmop',
      'fr-sr',
      'gfr',
      'ol-act',
      'ol-rules',
      'osa',
      'posh',
      'rti',
    ])
  })

  it('validates against the zod schema, which is `strictObject` throughout', () => {
    const index = libraryIndexSchema.parse(readJson('data/library/index.json'))
    expect(index.works.map((work) => work.id).sort()).toEqual(workIds)
    expect(index.totals.works).toBe(workIds.length)
    expect(index.totals.units).toBe(
      [...works.values()].reduce((sum, work) => sum + work.readingOrder.length, 0),
    )
  })

  it('groups every work into a category the hub actually draws', () => {
    // LIBRARY_CATEGORIES is the render order and `satisfies` only proves each
    // entry is a real category. A category in the schema but not in that list
    // is a work nobody would ever see, which is what this checks.
    expect([...LIBRARY_CATEGORIES].sort()).toEqual([...ALL_CATEGORIES].sort())
    for (const work of works.values()) {
      expect(LIBRARY_CATEGORIES, `${work.id} is in an ungrouped category`).toContain(work.category)
    }
  })

  it('labels every exam tag in both languages', () => {
    for (const work of works.values()) {
      for (const tag of work.examTags) {
        expect(isLibraryTag(tag), `${work.id}: no label for tag "${tag}" in src/lib/library/tags.ts`).toBe(
          true,
        )
      }
    }
  })
})

describe.each(workIds)('%s', (workId) => {
  const work = works.get(workId)!

  it('validates against the zod schema', () => {
    expect(() => libraryWorkSchema.parse(work)).not.toThrow()
  })

  it('resolves into the pointed-at corpus — every unit id, no exceptions', () => {
    const real = corpusUnitIds(work)
    const missing = work.readingOrder.filter((id) => !real.has(id))
    expect(missing, `${workId}: ${missing.length} unit id(s) are not in data/${work.corpus.file}`).toEqual([])
  })

  it('covers the whole corpus, so no provision is unreachable', () => {
    const real = corpusUnitIds(work)
    const unreachable = [...real].filter((id) => !work.readingOrder.includes(id))
    expect(unreachable.length, `${workId}: ${unreachable.length} unit(s) reachable from nowhere`).toBe(0)
  })

  it('names each unit exactly once in the reading order', () => {
    expect(new Set(work.readingOrder).size).toBe(work.readingOrder.length)
  })

  it('has a table of contents whose leaves are exactly the reading order', () => {
    const fromToc = leaves(work.toc).flatMap((node) => node.unitIds)
    expect([...fromToc].sort()).toEqual([...work.readingOrder].sort())
    // A leaf is one unit. A branch that lost its children would otherwise pass
    // the set comparison above while rendering a chapter with nothing in it.
    for (const leaf of leaves(work.toc)) expect(leaf.unitIds).toHaveLength(1)
  })

  it('gives every branch the union of its children', () => {
    const walk = (nodes: readonly TocNode[]) => {
      for (const node of nodes) {
        const children = node.children ?? []
        if (children.length === 0) continue
        expect(node.unitIds).toEqual(children.flatMap((child) => child.unitIds))
        walk(children)
      }
    }
    walk(work.toc)
  })

  it('carries a heading or an excerpt for every unit, in at least one language', () => {
    for (const leaf of leaves(work.toc)) {
      const anything =
        leaf.heading.en.trim() || leaf.heading.hi.trim() || leaf.excerpt?.en.trim() || leaf.excerpt?.hi.trim()
      expect(anything, `${workId} ${leaf.number}: nothing to label this unit with`).toBeTruthy()
    }
  })

  it('emits an excerpt exactly where a heading is missing, and nowhere else', () => {
    for (const leaf of leaves(work.toc)) {
      const complete = Boolean(leaf.heading.en.trim()) && Boolean(leaf.heading.hi.trim())
      // An excerpt on a unit that has both headings is dead weight in every
      // reader's download; a unit missing one with no excerpt is a bare number
      // in the table of contents.
      expect(leaf.excerpt === undefined, `${workId} ${leaf.number}`).toBe(complete)
    }
  })

  it('cites a source and an official text, both on an allowlisted host', () => {
    expect(work.source.url).toMatch(/^https:\/\//)
    expect(work.officialUrl).toMatch(/^https:\/\//)
    expect(work.source.name.length).toBeGreaterThan(10)
  })

  it('describes itself in both languages', () => {
    for (const field of ['title', 'shortTitle', 'description'] as const) {
      expect(work[field].en.trim(), `${workId}.${field}.en`).toBeTruthy()
      expect(work[field].hi.trim(), `${workId}.${field}.hi`).toBeTruthy()
    }
    expect(work.unitLabel.en.trim()).toBeTruthy()
    expect(work.unitLabel.hi.trim()).toBeTruthy()
  })

  it('says its Hindi needs verifying, because all of it is authored or curated', () => {
    // Not one of the fifteen sources publishes Hindi this repository could
    // extract (ADR-023), so a work that claimed otherwise would be claiming
    // something no Ministry has published.
    expect(work.verify).toBe(true)
  })

  it('estimates a reading time in the right order of magnitude', () => {
    // Bounds, not a figure: the point is that a 1,000-word rule book is not
    // reported as a six-hour read and a 500-page one is not reported as ten
    // minutes. `estimateReadTime` has its own exact tests.
    expect(work.estimatedMinutes).toBeGreaterThanOrEqual(1)
    expect(work.estimatedMinutes).toBeLessThan(60 * 12)
    expect(work.estimatedMinutes).toBeGreaterThanOrEqual(work.readingOrder.length / 60)
  })

  it('counts practice cards against real units, and only where there are some', () => {
    for (const [unitId, count] of Object.entries(work.practiseCounts)) {
      expect(work.readingOrder, `${workId}: practiseCounts names ${unitId}`).toContain(unitId)
      expect(count).toBeGreaterThan(0)
    }
    // A law work has none: nothing in data/rules/cards cites a law section.
    if (work.corpus.kind === 'law') expect(Object.keys(work.practiseCounts)).toEqual([])
  })
})

describe('practice counts agree with the cards themselves', () => {
  it('matches what data/rules/cards actually serves', () => {
    // Re-derived here rather than trusted: the counts are written by a Python
    // script and read by TypeScript, which is exactly the seam where a
    // "reviewState" spelling could drift and nobody would see a wrong number.
    for (const work of works.values()) {
      if (work.corpus.kind !== 'rules') continue
      const cards = readJson<{ cards: { reviewState: string; ruleRef: { textId: string } }[] }>(
        `data/rules/cards/${work.id}.json`,
      )
      const expected = new Map<string, number>()
      for (const card of cards.cards) {
        if (card.reviewState !== 'approved') continue
        expected.set(card.ruleRef.textId, (expected.get(card.ruleRef.textId) ?? 0) + 1)
      }
      expect(work.practiseCounts, work.id).toEqual(Object.fromEntries([...expected].sort()))
    }
  })
})

describe('a corrupted work is rejected', () => {
  /**
   * Every assertion above passes against the committed files. This is the
   * negative side: a suite that has never been shown to fail is a suite that
   * proves nothing (ADR-016's addendum makes the same point about
   * `tests/pay-data.test.ts`).
   */
  const sound = works.get('ccs-conduct')!

  it('fails the schema on an unknown key', () => {
    expect(() => libraryWorkSchema.parse({ ...sound, readOrder: [] })).toThrow()
  })

  it('fails the pointer check on a renamed unit', () => {
    const broken = { ...sound, readingOrder: [...sound.readingOrder.slice(1), 'ccs-conduct-999'] }
    const real = corpusUnitIds(broken)
    expect(broken.readingOrder.filter((id) => !real.has(id))).toEqual(['ccs-conduct-999'])
  })

  it('fails the corpus pointer on a file that does not exist', () => {
    expect(() =>
      libraryWorkSchema.parse({ ...sound, corpus: { kind: 'rules', file: 'rules/text/NOPE.json' } }),
    ).toThrow()
  })
})
