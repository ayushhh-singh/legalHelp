import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  libraryDefinitionsSchema,
  libraryQuickRefSchema,
  libraryWorkSchema,
  type LibraryWork,
} from '@/schemas/library'

/**
 * The two generated extract datasets, against the committed bytes.
 *
 * These are the first datasets in this repository written by a NODE script
 * rather than a Python one (`scripts/library-extracts.mjs`), and the reason is
 * that their grammar has to run in the browser too — over a document the reader
 * added themselves. That removes the usual producer/consumer split this project
 * relies on, so this suite has to work harder: it checks the shape, and then it
 * checks every claim the rows make about the corpus they came from.
 */

const root = process.cwd()
const readJson = <T>(...parts: string[]): T => JSON.parse(readFileSync(resolve(root, ...parts), 'utf8')) as T

const workIds = readdirSync(resolve(root, 'data/library/works'))
  .filter((name) => name.endsWith('.json'))
  .map((name) => name.replace(/\.json$/, ''))

const work = (id: string): LibraryWork => libraryWorkSchema.parse(readJson(`data/library/works/${id}.json`))

describe('data/library/definitions', () => {
  it('has one file per work and no others', () => {
    const files = readdirSync(resolve(root, 'data/library/definitions'))
      .filter((name) => name.endsWith('.json'))
      .map((name) => name.replace(/\.json$/, ''))
    expect(files.sort()).toEqual([...workIds].sort())
  })

  it.each(workIds)('%s parses against the schema', (id) => {
    expect(() =>
      libraryDefinitionsSchema.parse(readJson(`data/library/definitions/${id}.json`)),
    ).not.toThrow()
  })

  it.each(workIds)('%s names a unit the work actually has', (id) => {
    const data = libraryDefinitionsSchema.parse(readJson(`data/library/definitions/${id}.json`))
    if (data.unitId === null) {
      expect(data.terms).toEqual([])
      return
    }
    expect(work(id).readingOrder).toContain(data.unitId)
  })

  it('reads terms out of at least ten of the fifteen works', () => {
    // Not all fifteen: CSMOP and FR/SR publish no definitions clause this
    // repository could extract, and CCS (Pension) rule 3 arrives with its
    // clause markers and quotation marks lost (docs/DATA-GAPS.md #72).
    const withTerms = workIds.filter(
      (id) =>
        libraryDefinitionsSchema.parse(readJson(`data/library/definitions/${id}.json`)).terms.length > 0,
    )
    expect(withTerms.length).toBeGreaterThanOrEqual(10)
  })

  it('marks every term below full confidence for verification, and no others', () => {
    for (const id of workIds) {
      const data = libraryDefinitionsSchema.parse(readJson(`data/library/definitions/${id}.json`))
      for (const term of data.terms) {
        expect(term.verify, `${id}: ${term.term}`).toBe(term.confidence !== 'high')
      }
    }
  })

  it('never repeats a term within one work', () => {
    for (const id of workIds) {
      const terms = libraryDefinitionsSchema
        .parse(readJson(`data/library/definitions/${id}.json`))
        .terms.map((term) => term.term.toLowerCase())
      expect(new Set(terms).size, id).toBe(terms.length)
    }
  })

  it('reads the RTI Act’s own vocabulary', () => {
    const terms = libraryDefinitionsSchema
      .parse(readJson('data/library/definitions/rti.json'))
      .terms.map((term) => term.term.toLowerCase())
    for (const wanted of [
      'appropriate government',
      'information',
      'public authority',
      'right to information',
    ]) {
      expect(terms, wanted).toContain(wanted)
    }
  })
})

describe('data/library/quickref', () => {
  it('has one file per work and no others', () => {
    const files = readdirSync(resolve(root, 'data/library/quickref'))
      .filter((name) => name.endsWith('.json'))
      .map((name) => name.replace(/\.json$/, ''))
    expect(files.sort()).toEqual([...workIds].sort())
  })

  it.each(workIds)('%s parses against the schema', (id) => {
    expect(() => libraryQuickRefSchema.parse(readJson(`data/library/quickref/${id}.json`))).not.toThrow()
  })

  /**
   * The claim that makes every row clickable: it names a unit that exists. A
   * row pointing at a renumbered unit is a table row that opens an error page,
   * and nothing else in the suite would notice.
   */
  it.each(workIds)('%s only names units that are in the work', (id) => {
    const data = libraryQuickRefSchema.parse(readJson(`data/library/quickref/${id}.json`))
    const units = new Set(work(id).readingOrder)
    const stray = data.rows.filter((row) => !units.has(row.unitId))
    expect(stray.map((row) => row.unitId)).toEqual([])
  })

  it.each(workIds)('%s counts agree with the rows', (id) => {
    const data = libraryQuickRefSchema.parse(readJson(`data/library/quickref/${id}.json`))
    for (const kind of ['time', 'money', 'authority'] as const) {
      expect(data.counts[kind], `${id}/${kind}`).toBe(data.rows.filter((row) => row.kind === kind).length)
    }
  })

  it('sorts a period by days and a figure by rupees', () => {
    for (const id of workIds) {
      for (const row of libraryQuickRefSchema.parse(readJson(`data/library/quickref/${id}.json`)).rows) {
        if (row.kind === 'authority') expect(typeof row.sortKey).toBe('string')
        else expect(typeof row.sortKey, `${id} ${row.value}`).toBe('number')
      }
    }
  })

  it('quotes text that is really in the unit it names', () => {
    // The whole point of a quick-reference row is that an officer can check it
    // without leaving the table. A quote that is not in the provision would
    // make the table worse than not having one.
    const data = libraryQuickRefSchema.parse(readJson('data/library/quickref/rti.json'))
    const rules = readJson<{ rules: { id: string; text: { en: string } }[] }>(
      'data/rules/text/rti.json',
    ).rules
    const byId = new Map(rules.map((rule) => [rule.id, rule.text.en.replace(/\s+/g, ' ')]))

    for (const row of data.rows.slice(0, 150)) {
      const text = byId.get(row.unitId)
      expect(text, row.unitId).toBeDefined()
      expect(text!).toContain(row.quote.replace(/^…|…$/g, ''))
    }
  })

  it('finds the RTI Act’s thirty-day clock and its forty-eight-hour one', () => {
    const rows = libraryQuickRefSchema.parse(readJson('data/library/quickref/rti.json')).rows
    expect(rows.some((row) => row.kind === 'time' && row.sortKey === 30)).toBe(true)
    expect(rows.some((row) => row.kind === 'time' && /forty-eight hours/i.test(row.value))).toBe(true)
  })

  it('finds the GFR’s monetary thresholds', () => {
    const rows = libraryQuickRefSchema.parse(readJson('data/library/quickref/gfr.json')).rows
    expect(rows.filter((row) => row.kind === 'money').length).toBeGreaterThan(10)
  })
})

describe('the two datasets together', () => {
  it('are registered in data/_meta/versions.json, so Settings can show them', () => {
    const meta = readJson<{ datasets: Record<string, unknown> }>('data/_meta/versions.json')
    expect(Object.keys(meta.datasets)).toContain('library-definitions')
    expect(Object.keys(meta.datasets)).toContain('library-quickref')
  })

  it('cite the same source as the work they were read out of', () => {
    for (const id of workIds) {
      const source = work(id).source
      const definitions = libraryDefinitionsSchema.parse(readJson(`data/library/definitions/${id}.json`))
      const quickref = libraryQuickRefSchema.parse(readJson(`data/library/quickref/${id}.json`))
      expect(definitions.source, id).toEqual(source)
      expect(quickref.source, id).toEqual(source)
    }
  })
})

describe('amendment notes', () => {
  it.each(workIds)('%s keys every note to a unit it has', (id) => {
    const data = work(id)
    for (const unitId of Object.keys(data.amendments)) {
      expect(data.readingOrder, `${id}: ${unitId}`).toContain(unitId)
    }
  })

  it('records the DPDP substitution on the RTI Act’s section 8', () => {
    const notes = work('rti').amendments['rti-8']
    expect(notes).toBeDefined()
    expect(notes![0]!.date).toBe('2025-11-13')
    expect(notes![0]!.note.en).toMatch(/Digital Personal Data Protection Act/)
    expect(notes![0]!.note.hi.length).toBeGreaterThan(20)
  })

  it('records that BNS section 106(2) is not in force', () => {
    expect(work('bns').amendments['106']?.[0]?.note.en).toMatch(/not in force/i)
  })

  it('gives every note a bilingual body and a source URL', () => {
    for (const id of workIds) {
      for (const [unitId, notes] of Object.entries(work(id).amendments)) {
        for (const note of notes) {
          expect(note.note.en.length, `${id}:${unitId}`).toBeGreaterThan(20)
          expect(note.note.hi.length, `${id}:${unitId}`).toBeGreaterThan(20)
          expect(note.source.url, `${id}:${unitId}`).toMatch(/^https:\/\//)
        }
      }
    }
  })
})
