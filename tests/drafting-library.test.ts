import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { evaluateChecklist } from '@/lib/drafting/checklist'
import { serialise } from '@/lib/drafting/engine'
import { lintDocument } from '@/lib/drafting/lint'
import {
  bindings,
  bodySchema,
  emptyMeta,
  newDoc,
  officialDocSchema,
  type BodyDoc,
  type OfficialDoc,
  type VarValue,
} from '@/lib/drafting/model'
import { renderOfficialDoc } from '@/lib/drafting/renderDoc'
import { instantiate } from '@/lib/drafting/skeleton'
import { docTemplateFileSchema, type DocTemplate } from '@/modules/drafting/schema'

/**
 * Template Library v2, over the committed bytes.
 *
 * The claim this file makes is the one the session brief asks for and the one
 * that is actually load-bearing: **every form in the library renders from its
 * own skeleton, with its own worked example filled in, and passes its own
 * checklist** — in both languages. A form that ships a skeleton its own
 * checklist rejects is a form that teaches an officer the wrong shape.
 *
 * It reads the files off disk rather than through the loader, so what is tested
 * is the artefact `drafting_seed.py` writes and CI diffs.
 */

const root = join(import.meta.dirname, '..')
const TEMPLATE_DIR = join(root, 'data', 'drafting', 'templates')

const files = readdirSync(TEMPLATE_DIR)
  .filter((name) => name.endsWith('.json'))
  .sort()

const templates: DocTemplate[] = files.map(
  (name) => docTemplateFileSchema.parse(JSON.parse(readFileSync(join(TEMPLATE_DIR, name), 'utf8'))).template,
)

const LANGS = ['en', 'hi'] as const

/** The forms this session added — every one of them carries the v2 members. */
const V2 = templates.filter((template) => (template.variables?.length ?? 0) > 0)

describe('the library', () => {
  it('has grown to forty-three forms', () => {
    expect(templates).toHaveLength(43)
  })

  it('gives every form a bodySkeleton in both languages', () => {
    expect(templates.filter((template) => !template.bodySkeleton).map((template) => template.id)).toEqual([])
  })

  it('gives every form at least one variable', () => {
    expect(V2).toHaveLength(43)
  })
})

describe.each(templates.map((template) => [template.id, template] as const))('%s', (id, template) => {
  const skeleton = template.bodySkeleton

  it('has a schema-valid skeleton in both languages', () => {
    if (!skeleton) return
    for (const lang of LANGS) expect(bodySchema.safeParse(skeleton[lang]).success).toBe(true)
  })

  it('declares a worked example for every variable', () => {
    for (const variable of template.variables ?? []) {
      // The `paras` sample is DERIVED from the skeleton by substituting these,
      // so a variable with no example ships a form whose own worked example
      // still contains `{{key}}` — and `noPlaceholders` is a `must` on most of
      // the library.
      expect(variable.sample.en, `${id}/${variable.key}`).not.toBe('')
      expect(variable.sample.hi, `${id}/${variable.key}`).not.toBe('')
    }
  })

  it('names only fields the document can actually resolve, in every skeleton placeholder', () => {
    if (!skeleton) return
    const known = new Set([
      ...template.fields.map((field) => field.id),
      ...(template.variables ?? []).map((variable) => variable.key),
      ...Object.keys(bindings(blank(id), 'en')),
      // The two names an `{{#each}}` body binds for itself.
      '.',
      '@index',
    ])
    for (const lang of LANGS) {
      for (const name of placeholdersIn(skeleton[lang])) {
        expect(known.has(name), `${id}/${lang}: {{${name}}} resolves to nothing`).toBe(true)
      }
    }
  })

  it('instantiates from its own worked example with no marker and no chip left', () => {
    if (!skeleton) return
    for (const lang of LANGS) {
      const result = instantiate(skeleton[lang], examples(template, lang))
      expect(result.issues, `${id}/${lang}`).toEqual([])
      const text = JSON.stringify(result.body)
      expect(text, `${id}/${lang}`).not.toContain('{{#')
      expect(text, `${id}/${lang}`).not.toContain('{{/')
      expect(result.unfilled, `${id}/${lang}: unfilled placeholders`).toEqual([])
    }
  })

  it.each(LANGS)('renders from its skeleton and passes its own checklist in %s', (lang) => {
    const doc = fromSkeleton(template, lang)
    expect(officialDocSchema.safeParse(doc).success).toBe(true)

    const result = renderOfficialDoc(doc, template, lang)
    expect(serialise(result.document)).not.toMatch(/\{\{[a-zA-Z]/)

    const failing = evaluateChecklist(template, result)
      .filter((item) => !item.passed && item.severity === 'must')
      .map((item) => item.id)
    expect(failing, `${id}/${lang}`).toEqual([])
  })

  it.each(LANGS)('has no lint ERROR when rendered from its skeleton in %s', (lang) => {
    const doc = fromSkeleton(template, lang)
    const errors = lintDocument({
      doc,
      template,
      lang,
      result: renderOfficialDoc(doc, template, lang),
      now: '2027-01-01T00:00:00.000Z',
    })
      .filter((finding) => finding.severity === 'error')
      .map((finding) => finding.id)
    expect(errors, `${id}/${lang}`).toEqual([])
  })
})

describe('conditionals and repeaters are actually used', () => {
  it('at least six forms carry a conditional block', () => {
    const withIf = templates.filter((template) =>
      LANGS.some((lang) => JSON.stringify(template.bodySkeleton?.[lang] ?? {}).includes('{{#if ')),
    )
    expect(withIf.length).toBeGreaterThanOrEqual(6)
  })

  it('at least four forms carry a repeater', () => {
    const withEach = templates.filter((template) =>
      LANGS.some((lang) => JSON.stringify(template.bodySkeleton?.[lang] ?? {}).includes('{{#each ')),
    )
    expect(withEach.length).toBeGreaterThanOrEqual(4)
  })

  it('a repeater renders nothing at all when its list is empty', () => {
    const minutes = templates.find((template) => template.id === 'minutes-of-meeting')
    if (!minutes?.bodySkeleton) throw new Error('minutes-of-meeting has no skeleton')
    const withRows = instantiate(minutes.bodySkeleton.en, {
      ...examples(minutes, 'en'),
      decisions: ['A', 'B', 'C'],
    })
    const withNone = instantiate(minutes.bodySkeleton.en, { ...examples(minutes, 'en'), decisions: [] })
    expect((withRows.body.content ?? []).length).toBeGreaterThan((withNone.body.content ?? []).length)
    expect(JSON.stringify(withNone.body)).not.toContain('{{')
  })

  it('a conditional drops its block when the field is blank', () => {
    const sanction = templates.find((template) => template.id === 'sanction-order')
    if (!sanction?.bodySkeleton) throw new Error('sanction-order has no skeleton')
    const withIfd = instantiate(sanction.bodySkeleton.en, examples(sanction, 'en'))
    const without = instantiate(sanction.bodySkeleton.en, { ...examples(sanction, 'en'), ifdNumber: '' })
    expect(JSON.stringify(withIfd.body)).toContain('Integrated Finance Division')
    expect(JSON.stringify(without.body)).not.toContain('Integrated Finance Division')
  })
})

describe('every new form says whose format it borrows', () => {
  it.each(V2.filter((template) => template.verify).map((template) => [template.id, template] as const))(
    '%s',
    (_id, template) => {
      expect(template.csmopRef.chassis).toBeTruthy()
      expect(template.csmopRef.note?.en).toBeTruthy()
      expect(template.csmopRef.note?.hi).toBeTruthy()
      expect(templates.some((entry) => entry.id === template.csmopRef.chassis)).toBe(true)
    },
  )
})

// ------------------------------------------------------------------ helpers

/** A document with nothing filled in, for the binding-name list. */
function blank(templateId: string): OfficialDoc {
  return newDoc({
    id: 'x',
    templateId,
    lang: 'en',
    at: '2026-09-03T00:00:00.000Z',
    meta: emptyMeta(),
  })
}

/** Every `{{name}}`, `{{#if name}}` and `{{#each name}}` in a skeleton. */
function placeholdersIn(body: BodyDoc): string[] {
  const out = new Set<string>()
  const text = JSON.stringify(body)
  for (const match of text.matchAll(/\{\{\s*(?:#(?:if|each)\s+)?([a-zA-Z@.][\w.]*|\.)\s*\}\}/g)) {
    const name = match[1]
    if (name && !name.startsWith('/')) out.add(name)
  }
  return [...out]
}

/** The template's own worked examples, as bindings. */
function examples(template: DocTemplate, lang: 'en' | 'hi'): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {}
  for (const field of template.fields) {
    const sample = field.sample as { en: string | string[]; hi: string | string[] }
    out[field.id] = sample[lang]
  }
  for (const variable of template.variables ?? []) out[variable.key] = variable.sample[lang]
  return out
}

/** A document whose body IS the instantiated skeleton and whose meta is the form's own example. */
function fromSkeleton(template: DocTemplate, lang: 'en' | 'hi'): OfficialDoc {
  const sample = (id: string): string => {
    const field = template.fields.find((entry) => entry.id === id)
    const value = field?.sample as { en: string | string[]; hi: string | string[] } | undefined
    const side = value?.[lang]
    return Array.isArray(side) ? side.join('\n') : (side ?? '')
  }
  const list = (id: string): string[] => {
    const field = template.fields.find((entry) => entry.id === id)
    const value = field?.sample as { en: string | string[]; hi: string | string[] } | undefined
    const side = value?.[lang]
    return Array.isArray(side) ? side : side ? side.split('\n') : []
  }

  const meta = emptyMeta()
  meta.number = sample('fileNumber')
  meta.date = sample('date') || '2026-08-28'
  meta.place = sample('place')
  meta.subject = { en: sampleFor(template, 'subject', 'en'), hi: sampleFor(template, 'subject', 'hi') }
  const urgency = sample('urgency')
  meta.urgency = urgency === 'immediate' || urgency === 'priority' ? urgency : 'none'
  meta.enclosures = list('enclosures')
  meta.from = {
    ...meta.from,
    ministry: { en: sampleFor(template, 'ministry', 'en'), hi: sampleFor(template, 'ministry', 'hi') },
    department: { en: sampleFor(template, 'department', 'en'), hi: sampleFor(template, 'department', 'hi') },
    phone: sample('phone'),
    email: sample('email'),
  }
  meta.signature = {
    ...meta.signature,
    name: { en: sampleFor(template, 'signatoryName', 'en'), hi: sampleFor(template, 'signatoryName', 'hi') },
    designation: {
      en: sampleFor(template, 'signatoryDesignation', 'en'),
      hi: sampleFor(template, 'signatoryDesignation', 'hi'),
    },
    phone: sample('phone'),
    email: sample('email'),
  }
  const addressee = list('addressee')
  if (addressee.length > 0) {
    meta.to = [
      {
        id: 'to-1',
        bookId: null,
        name: { en: addressee[0] ?? '', hi: addressee[0] ?? '' },
        designation: { en: '', hi: '' },
        organisation: { en: '', hi: '' },
        address: addressee.slice(1),
        phone: '',
        email: '',
      },
    ]
  }
  meta.copyTo = list('copyTo').map((line, index) => ({
    id: `copy-${index + 1}`,
    bookId: null,
    name: { en: line, hi: line },
    designation: { en: '', hi: '' },
    organisation: { en: '', hi: '' },
    address: [],
    phone: '',
    email: '',
  }))
  const reference = sample('reference')
  if (reference) meta.referenceLines = [{ id: 'ref-1', number: reference, date: meta.date }]

  const vars: Record<string, VarValue> = {}
  for (const variable of template.variables ?? []) vars[variable.key] = variable.sample

  // Anything else the layout interpolates that is neither meta nor a declared
  // variable — a tour programme's itinerary, a notification's gazette part —
  // rides in `vars` under its own id, which is exactly what migration does.
  const covered = new Set(Object.keys(bindings(blank(template.id), lang)))
  for (const field of template.fields) {
    if (covered.has(field.id) || field.id in vars || field.type === 'paras') continue
    const value = field.sample as { en: string | string[]; hi: string | string[] }
    vars[field.id] = { en: joined(value.en), hi: joined(value.hi) }
  }

  const skeleton = template.bodySkeleton
  const body: BodyDoc = skeleton
    ? instantiate(skeleton[lang], examples(template, lang)).body
    : { type: 'doc', content: [{ type: 'paragraph' }] }

  return newDoc({
    id: `doc-${template.id}`,
    templateId: template.id,
    lang,
    at: '2026-08-28T00:00:00.000Z',
    meta,
    body,
    bodyHi: body,
    vars,
  })
}

const joined = (value: string | string[]): string => (Array.isArray(value) ? value.join('\n') : value)

function sampleFor(template: DocTemplate, id: string, lang: 'en' | 'hi'): string {
  const field = template.fields.find((entry) => entry.id === id)
  const value = field?.sample as { en: string | string[]; hi: string | string[] } | undefined
  return joined(value?.[lang] ?? '')
}
