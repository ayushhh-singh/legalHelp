import { beforeAll, describe, expect, it } from 'vitest'

import { registerLawTools, resetLawToolCache } from './law'
import { clearRegistry, getTool, registeredToolNames, validateToolInput } from './registry'

import type { ToolContext } from '../types'

/**
 * The Law Converter's agent tools.
 *
 * Two properties are being checked, and only one of them is "the function
 * returns the right thing":
 *
 *  1. **Every result carries the section number and the source.** `runAgent`
 *     discards an answer that states a section number no cited tool result
 *     contains (ADR-011), so a result that omitted its own number would make
 *     every correct answer about it unciteable. That is a test, not a comment.
 *  2. **A dropped provision is an explicit answer, not an empty list.** An agent
 *     that reads "no results" for IPC 377 will guess a section number. This is
 *     the single most dangerous thing it can do in this module.
 */

const ctx: ToolContext = { language: 'en', signal: new AbortController().signal }

const call = async (name: string, input: unknown) => {
  const tool = getTool(name)
  expect(tool, `${name} is not registered`).toBeDefined()
  if (!tool) throw new Error('unreachable')

  // Go through the same validation the agent loop does, so a test cannot pass
  // an input shape the model would never be allowed to send.
  const validated = validateToolInput(tool, input)
  expect(validated.ok ? null : validated.message).toBeNull()
  if (!validated.ok) throw new Error(validated.message)

  return (await tool.def.handler(validated.value as never, ctx)) as Record<string, unknown>
}

beforeAll(() => {
  clearRegistry()
  resetLawToolCache()
  registerLawTools()
})

describe('registration', () => {
  it('registers all five tools', () => {
    expect(registeredToolNames()).toEqual([
      'compare_old_new',
      'format_citation',
      'get_classification',
      'get_section',
      'search_sections',
    ])
  })

  it('is idempotent, so a hot reload does not throw on the duplicate guard', () => {
    expect(() => registerLawTools()).not.toThrow()
  })

  it('describes every tool in both languages', () => {
    for (const name of registeredToolNames()) {
      const tool = getTool(name)
      expect(tool?.def.description.en, name).toBeTruthy()
      expect(tool?.def.description.hi, name).toMatch(/[ऀ-ॿ]/)
    }
  })

  it('derives a JSON Schema the model can be given', () => {
    const schema = getTool('get_section')?.jsonSchema
    expect(schema?.type).toBe('object')
    expect(Object.keys(schema?.properties ?? {})).toEqual(['code', 'section'])
    expect(schema?.$schema).toBeUndefined()
  })

  it('rejects an input the model got wrong, with a message the model can act on', () => {
    const tool = getTool('get_section')
    const result = tool && validateToolInput(tool, { code: 'ipc', section: '302' })
    expect(result?.ok).toBe(false)
    expect(result && !result.ok && result.message).toContain('get_section')
  })

  it('scopes them all to the law module', () => {
    for (const name of registeredToolNames()) {
      expect(getTool(name)?.def.scope, name).toBe('law')
    }
  })
})

describe('search_sections', () => {
  it('resolves a repealed-Act number to the section of the new Act', async () => {
    const result = await call('search_sections', { query: 'IPC 302' })
    const results = result.results as Array<Record<string, unknown>>
    expect(results[0]?.section).toBe('103')
    expect(results[0]?.act).toBe('BNS')
  })

  it('finds a section by roman-Hindi', async () => {
    const result = await call('search_sections', { query: 'hatya', limit: 5 })
    const sections = (result.results as Array<Record<string, unknown>>).map((row) => row.section)
    expect(sections).toContain('103')
  })

  it('says how it read the query, so a wrong reading is visible', async () => {
    const result = await call('search_sections', { query: 'sec 438 crpc' })
    expect(result.interpretedAs).toMatchObject({ sectionRef: '438', act: 'CrPC' })
    expect(result.direction).toBe('old-new')
  })

  it('returns a dropped provision as its own answer, not as an empty list', async () => {
    const result = await call('search_sections', { query: 'IPC 377' })
    const dropped = result.droppedProvisions as Array<Record<string, unknown>>
    expect(dropped).toHaveLength(1)
    expect(dropped[0]?.section).toBe('377')
    expect(dropped[0]?.note).toBeTruthy()
  })

  it('gives every result the number an answer would have to cite', async () => {
    const result = await call('search_sections', { query: 'organised crime' })
    for (const row of result.results as Array<Record<string, unknown>>) {
      expect(row.section).toBeTruthy()
      expect(row.act).toBeTruthy()
      expect(row.actName).toBeTruthy()
    }
  })

  it('honours the code filter', async () => {
    const result = await call('search_sections', { query: 'arrest', code: 'bnss' })
    for (const row of result.results as Array<Record<string, unknown>>) {
      expect(row.code).toBe('bnss')
    }
  })
})

describe('get_section', () => {
  it('returns the record with its source and its disclaimer', async () => {
    const result = await call('get_section', { code: 'bns', section: '103' })
    expect(result.found).toBe(true)
    expect(result.section).toBe('103')
    expect((result.heading as Record<string, string>).en).toBe('Punishment for murder.')
    expect((result.source as Record<string, string>).url).toMatch(/^https:\/\//)
    expect(result.disclaimer).toContain('Reference only')
  })

  it('follows a sub-section reference to its parent', async () => {
    const result = await call('get_section', { code: 'bns', section: '318(4)' })
    expect(result.section).toBe('318')
  })

  it('carries the curated warnings attached to the section', async () => {
    const result = await call('get_section', { code: 'bns', section: '103' })
    const notes = result.notes as Array<{ kind: string; title: { en: string } }>
    expect(notes.some((note) => note.kind === 'trap')).toBe(true)
  })

  it('flags a section whose Hindi is a curated translation, not the statute', async () => {
    // docs/DATA-GAPS.md #18: an agent must not present curated Hindi as the
    // Act's own words, and it can only avoid that if it is told.
    const result = await call('get_section', { code: 'bns', section: '103' })
    expect(result.hindiIsCurated).toBe(true)
  })

  it('says "not found" rather than throwing on a section that does not exist', async () => {
    const result = await call('get_section', { code: 'bns', section: '9999' })
    expect(result.found).toBe(false)
  })
})

describe('compare_old_new', () => {
  it('maps a repealed section forward and says what changed', async () => {
    const result = await call('compare_old_new', { oldAct: 'IPC', oldSection: '420' })
    expect(result.status).toBe('mapped')
    const corresponds = result.corresponds as Array<Record<string, unknown>>
    expect(corresponds[0]?.section).toBe('318(4)')
    expect(result.warnings).toBeTruthy()
  })

  it('reports a repealed provision with no counterpart as "dropped"', async () => {
    const result = await call('compare_old_new', { oldAct: 'IPC', oldSection: '497' })
    expect(result.status).toBe('dropped')
    expect((result.note as Record<string, string>).en).toContain('no corresponding provision')
  })

  it('carries the number-swap warning for the CrPC 438/482 pair', async () => {
    const bail = await call('compare_old_new', { oldAct: 'CrPC', oldSection: '438' })
    const inherent = await call('compare_old_new', { oldAct: 'CrPC', oldSection: '482' })

    expect((bail.corresponds as Array<Record<string, unknown>>)[0]?.section).toBe('482')
    expect((inherent.corresponds as Array<Record<string, unknown>>)[0]?.section).toBe('528')
    expect((bail.warnings as unknown[]).length).toBeGreaterThan(0)
  })

  it('says "not found" for a section of the repealed Act that never existed', async () => {
    expect((await call('compare_old_new', { oldAct: 'IPC', oldSection: '9999' })).found).toBe(false)
  })
})

describe('get_classification', () => {
  it('gives the four properties per sub-section, from the First Schedule', async () => {
    const result = await call('get_classification', { code: 'bns', section: '103' })
    expect(result.classified).toBe(true)

    const rows = result.classification as Array<Record<string, unknown>>
    expect(rows.map((row) => row.clause)).toEqual(['103(1)', '103(2)'])
    expect(rows[0]).toMatchObject({
      cognizable: 'cognizable',
      bailable: 'non-bailable',
      compoundable: 'non-compoundable',
    })
    expect((result.source as Record<string, string>).url).toMatch(/^https:\/\//)
  })

  it('distinguishes sub-sections that differ on bail', async () => {
    // BNS 318(2) is non-cognizable and bailable; 318(4) is neither. Citing the
    // section without the sub-section is exactly the error this prevents.
    const result = await call('get_classification', { code: 'bns', section: '318' })
    const rows = result.classification as Array<Record<string, unknown>>
    const bailable = new Set(rows.map((row) => row.bailable))
    expect(bailable.size).toBeGreaterThan(1)
  })

  it('says why a procedural Act carries no classification', async () => {
    const result = await call('get_classification', { code: 'bnss', section: '173' })
    expect(result.classified).toBe(false)
    expect(result.reason).toContain('procedural')
  })
})

describe('format_citation', () => {
  it('writes the citation in each language', async () => {
    const en = await call('format_citation', { code: 'bns', section: '103', lang: 'en' })
    const hi = await call('format_citation', { code: 'bns', section: '103', lang: 'hi' })

    expect(en.citation).toBe(
      'Section 103 of the Bharatiya Nyaya Sanhita, 2023 (corresponding to Section 302 IPC)',
    )
    expect(hi.citation).toBe('भारतीय न्याय संहिता, 2023 की धारा 103 (भा.दं.सं. की धारा 302 के तत्स्थानी)')
  })

  it('cites a sub-section as itself', async () => {
    const result = await call('format_citation', { code: 'bns', section: '318(4)', lang: 'en' })
    expect(result.citation).toContain('Section 318(4)')
    expect(result.citation).toContain('420')
  })

  it('cites a section given without a sub-section as the section', async () => {
    const result = await call('format_citation', { code: 'bns', section: '318', lang: 'en' })
    expect(result.citation).toContain('Section 318 of')
  })
})

describe('grounding', () => {
  it('never returns a result without the section number it is about', async () => {
    // The agent loop rejects an answer stating a section number that appears in
    // no cited snippet. Every tool therefore has to put its own number in its
    // result, or a correct answer about it could not be shown at all.
    const calls: Array<[string, unknown]> = [
      ['search_sections', { query: 'IPC 302' }],
      ['get_section', { code: 'bns', section: '103' }],
      ['compare_old_new', { oldAct: 'IPC', oldSection: '302' }],
      ['get_classification', { code: 'bns', section: '103' }],
      ['format_citation', { code: 'bns', section: '103', lang: 'en' }],
    ]

    for (const [name, input] of calls) {
      const result = await call(name, input)
      expect(JSON.stringify(result), name).toContain('103')
    }
  })
})
