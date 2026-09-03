import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  PERSONAL_TEMPLATE_VERSION,
  exportTemplates,
  importTemplates,
  personalFromDocument,
  personalTemplateSchema,
  resolvePersonal,
  uniqueName,
  type PersonalTemplate,
} from './personal'

import { docTemplateFileSchema, type DocTemplate } from '@/modules/drafting/schema'

const root = join(import.meta.dirname, '..', '..', '..')
const template = (id: string): DocTemplate =>
  docTemplateFileSchema.parse(
    JSON.parse(readFileSync(join(root, 'data', 'drafting', 'templates', `${id}.json`), 'utf8')),
  ).template

const officeOrder = template('office-order')

const AT = '2026-09-03T00:00:00.000Z'

const made = (keep: string[] = ['days']): PersonalTemplate =>
  personalFromDocument({
    id: 'pt1',
    name: 'My leave order',
    baseTemplateId: 'office-order',
    vars: {
      officerName: 'Shri A.B.C.',
      officerDesignation: 'Assistant Section Officer',
      days: '10',
      chargeTo: 'Shri P.Q.R.',
    },
    body: {
      type: 'doc',
      content: [
        {
          type: 'numberedPara',
          attrs: { level: 1 },
          content: [{ type: 'text', text: 'Leave is sanctioned.' }],
        },
      ],
    },
    keepAsVariable: keep,
    base: officeOrder,
    at: AT,
  })

describe('personalFromDocument', () => {
  it('freezes what was not kept and keeps what was', () => {
    const personal = made(['days'])
    expect(Object.keys(personal.frozen).sort()).toEqual(['chargeTo', 'officerDesignation', 'officerName'])
    expect(personal.variables.map((entry) => entry.key)).toEqual(['days'])
    expect(personalTemplateSchema.safeParse(personal).success).toBe(true)
  })

  it("takes the kept variable's label and type from the base template", () => {
    const kept = made(['days']).variables[0]
    const base = (officeOrder.variables ?? []).find((entry) => entry.key === 'days')
    expect(kept?.label).toEqual(base?.label)
    expect(kept?.type).toBe(base?.type)
  })

  it("seeds the kept variable's sample from what the document actually said", () => {
    expect(made(['days']).variables[0]?.sample).toEqual({ en: '10', hi: '10' })
  })

  it("uses the document's own body as the skeleton, both languages", () => {
    const personal = made()
    expect(JSON.stringify(personal.bodySkeleton.en)).toContain('Leave is sanctioned.')
    expect(personal.bodySkeleton.hi).toEqual(personal.bodySkeleton.en)
  })

  it('has no field for a CSMOP reference at all', () => {
    // The version of "a personal template never claims a CSMOP reference" that
    // cannot be forgotten: there is nowhere to put one.
    expect(
      personalTemplateSchema.safeParse({ ...made(), csmopRef: { edition: 'x', paras: ['1'] } }).success,
    ).toBe(true)
    const parsed = personalTemplateSchema.parse({ ...made(), csmopRef: { edition: 'x', paras: ['1'] } })
    expect('csmopRef' in parsed).toBe(false)
  })
})

describe('resolvePersonal', () => {
  it('replaces the variables and the skeleton and NOTHING else', () => {
    const resolved = resolvePersonal(officeOrder, made(['days']))
    expect(resolved.id).toBe(officeOrder.id)
    expect(resolved.layout).toEqual(officeOrder.layout)
    expect(resolved.checklist).toEqual(officeOrder.checklist)
    expect(resolved.csmopRef).toEqual(officeOrder.csmopRef)
    expect(resolved.variables?.map((entry) => entry.key)).toEqual(['days'])
    expect(JSON.stringify(resolved.bodySkeleton)).toContain('Leave is sanctioned.')
  })

  it('falls back to the official form when the result would not parse', () => {
    const broken = { ...made(), variables: [{ key: '1-not-an-id' }] } as unknown as PersonalTemplate
    expect(resolvePersonal(officeOrder, broken)).toEqual(officeOrder)
  })
})

describe('uniqueName', () => {
  it('leaves a free name alone', () => {
    expect(uniqueName('Mine', ['Other'])).toBe('Mine')
  })

  it('appends the first free number', () => {
    expect(uniqueName('Mine', ['Mine'])).toBe('Mine (2)')
    expect(uniqueName('Mine', ['Mine', 'Mine (2)'])).toBe('Mine (3)')
  })
})

describe('export and import', () => {
  it('round-trips', () => {
    const file = exportTemplates([made()], AT)
    const result = importTemplates(file, [], (index) => `new-${index}`)
    if ('error' in result) throw new Error('expected an import')
    expect(result.imported).toHaveLength(1)
    expect(result.imported[0]?.id).toBe('new-0')
    expect(result.rejected).toBe(0)
  })

  it('RENAMES on a collision rather than overwriting', () => {
    const existing = [made()]
    const result = importTemplates(exportTemplates([made()], AT), existing, () => 'new-0')
    if ('error' in result) throw new Error('expected an import')
    expect(result.imported[0]?.name).toBe('My leave order (2)')
    expect(result.renamed).toEqual([{ from: 'My leave order', to: 'My leave order (2)' }])
  })

  it('always reissues the id, so an import can never overwrite a row', () => {
    const result = importTemplates(exportTemplates([made()], AT), [], () => 'brand-new')
    if ('error' in result) throw new Error('expected an import')
    expect(result.imported[0]?.id).toBe('brand-new')
    expect(result.imported[0]?.id).not.toBe('pt1')
  })

  it('refuses a file made by a newer version of the app', () => {
    const file = { ...exportTemplates([made()], AT), schemaVersion: PERSONAL_TEMPLATE_VERSION + 1 }
    expect(importTemplates(file, [], () => 'x')).toEqual({ error: 'wrong-version' })
  })

  it('refuses something that is not an export at all', () => {
    expect(importTemplates({ hello: 'world' }, [], () => 'x')).toEqual({ error: 'malformed' })
    expect(importTemplates(null, [], () => 'x')).toEqual({ error: 'malformed' })
  })

  it('imports the good rows and counts the bad ones', () => {
    const file = {
      ...exportTemplates([made()], AT),
      templates: [made(), { name: 'broken' } as unknown as PersonalTemplate],
    }
    const result = importTemplates(file, [], (index) => `new-${index}`)
    if ('error' in result) throw new Error('expected an import')
    expect(result.imported).toHaveLength(1)
    expect(result.rejected).toBe(1)
  })

  it('clears the favourite flag on the way in', () => {
    const file = exportTemplates([{ ...made(), favourite: true }], AT)
    const result = importTemplates(file, [], () => 'x')
    if ('error' in result) throw new Error('expected an import')
    expect(result.imported[0]?.favourite).toBe(false)
  })
})
