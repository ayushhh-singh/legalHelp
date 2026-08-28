import { beforeAll, describe, expect, it } from 'vitest'

import { registerDraftingTools } from './drafting'
import { getTool, listTools } from './registry'

import type { DraftValues } from '@/lib/drafting/types'

/**
 * The six drafting tools, run for real against the committed datasets.
 *
 * They are called through the registry rather than as plain functions, so the
 * zod schema each declares is exercised on the way in — which is the half a
 * direct call would skip, and the half a model will find.
 */

const call = async (name: string, input: unknown): Promise<Record<string, unknown>> => {
  const tool = getTool(name)
  if (!tool) throw new Error(`tool not registered: ${name}`)
  const parsed = tool.def.inputSchema.parse(input)
  const result = await tool.def.handler(parsed, {
    language: 'en',
    signal: new AbortController().signal,
  })
  return result as Record<string, unknown>
}

beforeAll(() => {
  registerDraftingTools()
})

describe('registration', () => {
  it('registers all six under the draft scope', () => {
    const names = listTools('draft')
      .filter((tool) => tool.def.scope === 'draft')
      .map((tool) => tool.def.name)
      .sort()
    expect(names).toEqual([
      'check_draft',
      'get_draft_template',
      'list_draft_phrases',
      'list_draft_templates',
      'lookup_admin_term',
      'render_draft',
    ])
  })

  it('is idempotent, so a hot reload does not throw on the duplicate guard', () => {
    expect(() => {
      registerDraftingTools()
      registerDraftingTools()
    }).not.toThrow()
  })

  it('gives every one a Hindi description — the registry throws without one', () => {
    for (const tool of listTools('draft').filter((each) => each.def.scope === 'draft')) {
      expect(tool.def.description.hi.length, tool.def.name).toBeGreaterThan(40)
    }
  })

  it('registers NO tool that can read the reader’s own drafts', () => {
    // The `drafts` table is the most sensitive thing this app holds. A tool
    // that could list or read it would make every agent in the app one that
    // reads an officer's unfinished work (ADR-021).
    const names = listTools().map((tool) => tool.def.name)
    for (const name of names) {
      expect(name).not.toMatch(/my_draft|list_drafts|read_draft\b|saved_draft/)
    }
  })
})

describe('list_draft_templates', () => {
  it('lists all fourteen with their use-when line', async () => {
    const result = await call('list_draft_templates', {})
    const templates = result.templates as { id: string; useWhen: string; useWhenHi: string }[]
    expect(templates).toHaveLength(14)
    for (const entry of templates) {
      expect(entry.useWhen.length, entry.id).toBeGreaterThan(20)
      expect(entry.useWhenHi.length, entry.id).toBeGreaterThan(20)
    }
  })

  it('says which forms CSMOP prescribes no format for', async () => {
    const result = await call('list_draft_templates', {})
    const templates = result.templates as { id: string; formatPrescribedByCsmop: boolean }[]
    const unprescribed = templates.filter((entry) => !entry.formatPrescribedByCsmop).map((e) => e.id)
    expect(unprescribed.sort()).toEqual(
      [
        'circular',
        'leave-application',
        'representation',
        'rti-reply',
        'show-cause-reply',
        'ta-bill-cover',
        'tour-programme',
      ].sort(),
    )
  })
})

describe('get_draft_template', () => {
  it('returns the fields, the checklist and the CSMOP paragraphs', async () => {
    const result = await call('get_draft_template', { templateId: 'office-memorandum' })
    expect(result.found).toBe(true)
    expect(result.person).toBe('third')

    const fields = result.fields as { id: string; required: boolean }[]
    expect(fields.map((field) => field.id)).toContain('signatoryDesignation')

    const checklist = result.checklist as { id: string; csmopRef: string | null; why: string }[]
    const thirdPerson = checklist.find((item) => item.id === 'third-person')
    expect(thirdPerson?.csmopRef).toBe('8.4(3)')
    expect(thirdPerson?.why).toContain('third person')
  })

  it('carries the verify note and the chassis for a form the manual does not prescribe', async () => {
    const result = await call('get_draft_template', { templateId: 'rti-reply' })
    expect(result.verify).toBe(true)
    expect(result.chassis).toBeTruthy()
    expect(String(result.verifyNote)).toContain('prescribes no format')
  })

  it('says so, and lists the alternatives, for a form that does not exist', async () => {
    const result = await call('get_draft_template', { templateId: 'not-a-form' })
    expect(result.found).toBe(false)
    expect(result.available).toHaveLength(14)
  })

  it('rejects an id that is not a slug before the handler ever runs', () => {
    const tool = getTool('get_draft_template')
    expect(tool?.def.inputSchema.safeParse({ templateId: '../../etc/passwd' }).success).toBe(false)
    expect(tool?.def.inputSchema.safeParse({ templateId: 'Office Memorandum' }).success).toBe(false)
  })
})

describe('render_draft', () => {
  const values: DraftValues = {
    fileNumber: 'A-11011/2/2026-Estt.',
    ministry: 'Ministry of Personnel, Public Grievances and Pensions',
    department: 'Department of Personnel and Training',
    place: 'New Delhi',
    date: '2026-08-28',
    subject: 'Grant of Children Education Allowance — clarification regarding.',
    paras: [
      'The undersigned is directed to refer to this Department’s O.M. dated 12.03.2025 and to say that the matter has been considered.',
      'It is hereby clarified that reimbursement is admissible on production of a certificate of enrolment.',
    ],
    signatoryName: 'A.B.C.',
    signatoryDesignation: 'Under Secretary to the Govt. of India',
    phone: '011-2309 2590',
    email: 'us-estt@nic.in',
    addressee: 'All Ministries / Departments of the Government of India',
    urgency: 'none',
  }

  it('lays out an Office Memorandum with the title centred and the addressee last', async () => {
    const result = await call('render_draft', { templateId: 'office-memorandum', values, lang: 'en' })
    expect(result.title).toBe('OFFICE MEMORANDUM')
    expect(result.subject).toContain('Children Education Allowance')

    const text = String(result.text)
    // The addressee comes AFTER the signature on an O.M. — the thing officers
    // are most often marked down on, and the reason this is a tool at all.
    expect(text.indexOf('Under Secretary')).toBeLessThan(text.indexOf('All Ministries'))
  })

  it('leaves the first paragraph unnumbered and numbers from 2', async () => {
    const result = await call('render_draft', { templateId: 'office-memorandum', values, lang: 'en' })
    const paragraphs = result.paragraphs as string[]
    expect(paragraphs[0]?.startsWith('The undersigned')).toBe(true)
    expect(paragraphs[1]?.startsWith('2. ')).toBe(true)
  })

  it('numbers a note on a file from 1 instead', async () => {
    const result = await call('render_draft', {
      templateId: 'noting',
      values: { paras: ['The case is as follows.', 'The rules provide otherwise.'] },
      lang: 'en',
    })
    const paragraphs = result.paragraphs as string[]
    expect(paragraphs[0]?.startsWith('1. ')).toBe(true)
    expect(paragraphs[1]?.startsWith('2. ')).toBe(true)
  })

  it('reports a blank required field rather than filling it from the specimen', async () => {
    const result = await call('render_draft', {
      templateId: 'office-memorandum',
      values: { subject: 'Only the subject' },
      lang: 'en',
    })
    const issues = result.issues as { field: string | null; code: string }[]
    expect(issues.some((issue) => issue.code === 'required' && issue.field === 'signatoryName')).toBe(true)
    // And no specimen leaked in.
    expect(String(result.text)).not.toContain('A.B.C.')
  })

  it('renders the Hindi issue with the manual’s own title', async () => {
    const result = await call('render_draft', { templateId: 'office-memorandum', values, lang: 'hi' })
    expect(result.title).toBe('कार्यालय ज्ञापन')
  })

  it('returns both issues for "bilingual", each separately addressable', async () => {
    const result = await call('render_draft', { templateId: 'office-memorandum', values, lang: 'bilingual' })
    const en = result.en as { title: string }
    const hi = result.hi as { title: string }
    expect(en.title).toBe('OFFICE MEMORANDUM')
    expect(hi.title).toBe('कार्यालय ज्ञापन')
    expect(String(result.text)).toContain('कार्यालय ज्ञापन')
  })

  it('writes Devanagari digits only when asked', async () => {
    const plain = await call('render_draft', { templateId: 'office-memorandum', values, lang: 'hi' })
    const devanagari = await call('render_draft', {
      templateId: 'office-memorandum',
      values,
      lang: 'hi',
      devanagariDigits: true,
    })
    expect(String(plain.text)).toContain('28.08.2026')
    expect(String(devanagari.text)).toContain('२८.०८.२०२६')
  })

  it('appends the enclosure count nobody remembers to type', async () => {
    const result = await call('render_draft', {
      templateId: 'office-memorandum',
      values: { ...values, enclosures: ['The order dated 12.03.2025', 'The certificate'] },
      lang: 'en',
    })
    expect(result.enclosures).toContain('Encl.: as above (2)')
  })

  it('drops a value shape the engine could not render', () => {
    const tool = getTool('render_draft')
    const bad = tool?.def.inputSchema.safeParse({
      templateId: 'letter',
      lang: 'en',
      values: { subject: 42 },
    })
    expect(bad?.success).toBe(false)
  })
})

describe('check_draft', () => {
  it('passes every item on the worked example', async () => {
    const template = await call('get_draft_template', { templateId: 'office-memorandum' })
    const fields = template.fields as { id: string; example: string | string[] }[]
    const values = Object.fromEntries(fields.map((field) => [field.id, field.example]))

    const result = await call('check_draft', { templateId: 'office-memorandum', values, lang: 'en' })
    expect(result.mustFailing).toBe(0)
    expect(result.passed).toBe(true)
  })

  it('fails the third-person rule on an O.M. written in the first person', async () => {
    const result = await call('check_draft', {
      templateId: 'office-memorandum',
      values: { paras: ['I am directed to say that we have considered the matter.'] },
      lang: 'en',
    })
    const items = result.items as { id: string; passed: boolean; why: string }[]
    const thirdPerson = items.find((item) => item.id === 'third-person')
    expect(thirdPerson?.passed).toBe(false)
    // The `why` is what an agent must quote; a bare "failed" is uncitable.
    expect(thirdPerson?.why).toContain('third person')
  })

  it('names the fields that are still blank', async () => {
    const result = await call('check_draft', { templateId: 'office-memorandum', values: {}, lang: 'en' })
    expect(result.mustFailing).toBeGreaterThan(0)
    expect(result.missingFields).toContain('fileNumber')
  })

  it('is capable of saying no — an empty form fails a required item', async () => {
    const result = await call('check_draft', { templateId: 'letter', values: {}, lang: 'hi' })
    expect(result.passed).toBe(false)
  })
})

describe('list_draft_phrases', () => {
  it('returns only the phrases that belong to the form', async () => {
    const result = await call('list_draft_phrases', { templateId: 'leave-application' })
    const phrases = result.phrases as { appliesTo: string[] }[]
    expect(phrases.length).toBeGreaterThan(0)
    for (const phrase of phrases) {
      expect(phrase.appliesTo.includes('leave-application') || phrase.appliesTo.includes('*')).toBe(true)
    }
  })

  it('carries both languages and the paragraph behind each', async () => {
    const result = await call('list_draft_phrases', { templateId: 'office-memorandum', kind: 'opening' })
    const phrases = result.phrases as { en: string; hi: string; csmopRef: string | null }[]
    expect(phrases.some((phrase) => phrase.en.includes('undersigned is directed'))).toBe(true)
    for (const phrase of phrases) {
      expect(phrase.hi.length).toBeGreaterThan(0)
    }
  })
})

describe('lookup_admin_term', () => {
  it('returns the manual’s Hindi, not the expected rendering', async () => {
    const result = await call('lookup_admin_term', { query: 'Top Priority' })
    const terms = result.terms as { en: string; hi: string; alsoWritten: string[] }[]
    const topPriority = terms.find((term) => term.en.toLowerCase().includes('top priority'))
    expect(topPriority?.hi).toBe('परम अग्रता')
    // The form everyone expects is findable, but it is not what is printed.
    expect(topPriority?.alsoWritten).toContain('सर्वोच्च अग्रता')
  })

  it('finds a term by the rendering an officer would have guessed', async () => {
    const result = await call('lookup_admin_term', { query: 'सर्वोच्च अग्रता' })
    const terms = result.terms as { hi: string }[]
    expect(terms.some((term) => term.hi === 'परम अग्रता')).toBe(true)
  })

  it('finds the demi-official letter under both names', async () => {
    const printed = await call('lookup_admin_term', { query: 'अर्ध-सरकारी' })
    expect((printed.terms as unknown[]).length).toBeGreaterThan(0)
    const expected = await call('lookup_admin_term', { query: 'अर्ध-शासकीय' })
    expect((expected.terms as { hi: string }[]).some((term) => term.hi === 'अर्ध-सरकारी पत्र')).toBe(true)
  })

  it('returns nothing rather than guessing', async () => {
    const result = await call('lookup_admin_term', { query: 'zzzzzz' })
    expect(result.count).toBe(0)
  })
})
