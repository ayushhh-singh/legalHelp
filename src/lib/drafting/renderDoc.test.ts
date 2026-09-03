import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { evaluateChecklist } from './checklist'
import { serialise } from './engine'
import { emptyMeta, newDoc, type BodyDoc, type OfficialDoc } from './model'
import {
  bodyFieldOf,
  linesOfNodes,
  projectBody,
  renderOfficialDoc,
  renderOfficialDocBilingual,
} from './renderDoc'

import { docTemplateFileSchema, type DocTemplate } from '@/modules/drafting/schema'

const root = join(import.meta.dirname, '..', '..', '..')
const template = (id: string): DocTemplate =>
  docTemplateFileSchema.parse(
    JSON.parse(readFileSync(join(root, 'data', 'drafting', 'templates', `${id}.json`), 'utf8')),
  ).template

const om = template('office-memorandum')

const body = (...paras: string[]): BodyDoc => ({
  type: 'doc',
  content: paras.map((text) => ({
    type: 'numberedPara',
    attrs: { level: 1 },
    content: [{ type: 'text', text }],
  })),
})

const doc = (over: Partial<OfficialDoc> = {}): OfficialDoc => ({
  ...newDoc({
    id: 'd1',
    templateId: 'office-memorandum',
    lang: 'en',
    at: '2026-09-03T00:00:00.000Z',
    meta: {
      ...emptyMeta(),
      number: 'A-11011/2/2026-Estt.',
      date: '2026-09-03',
      place: 'New Delhi',
      subject: { en: 'Children Education Allowance', hi: 'बाल शिक्षा भत्ता' },
      from: {
        ...emptyMeta().from,
        ministry: { en: 'Ministry of Personnel', hi: 'कार्मिक मंत्रालय' },
        department: { en: 'Department of Personnel and Training', hi: 'कार्मिक और प्रशिक्षण विभाग' },
        phone: '011-2309 2590',
        email: 'us-estt@nic.in',
      },
      signature: {
        ...emptyMeta().signature,
        name: { en: 'A.B.C.', hi: 'ए.बी.सी.' },
        designation: { en: 'Under Secretary', hi: 'अवर सचिव' },
        phone: '011-2309 2590',
        email: 'us-estt@nic.in',
      },
      to: [
        {
          id: 'to-1',
          bookId: null,
          name: { en: 'The Department of Expenditure', hi: 'व्यय विभाग' },
          designation: { en: '', hi: '' },
          organisation: { en: '', hi: '' },
          address: [],
          phone: '',
          email: '',
        },
      ],
    },
    body: body('The undersigned is directed to refer to the subject cited above.', 'It is hereby clarified.'),
  }),
  ...over,
})

describe('renderOfficialDoc', () => {
  it('produces the same block shape the form engine does', () => {
    const result = renderOfficialDoc(doc(), om, 'en')
    const roles = result.document.blocks.map((block) => block.role)
    expect(roles).toContain('title')
    expect(roles).toContain('subject')
    expect(roles).toContain('body')
    expect(result.document.subject).toBe('Subject: Children Education Allowance')
  })

  it('numbers the body the way the LAYOUT says — first unnumbered, then from 2', () => {
    const result = renderOfficialDoc(doc(), om, 'en')
    const bodyBlock = result.document.blocks.find((block) => block.role === 'body')
    expect(bodyBlock?.lines).toEqual([
      'The undersigned is directed to refer to the subject cited above.',
      '2. It is hereby clarified.',
    ])
  })

  it('attaches the rich projection and generates `lines` FROM it', () => {
    const result = renderOfficialDoc(doc(), om, 'en')
    const bodyBlock = result.document.blocks.find((block) => block.role === 'body')
    expect(bodyBlock?.nodes).toBeDefined()
    expect(linesOfNodes(bodyBlock?.nodes ?? [])).toEqual(bodyBlock?.lines)
  })

  it('leaves a chrome block with no `nodes` at all', () => {
    const result = renderOfficialDoc(doc(), om, 'en')
    const subject = result.document.blocks.find((block) => block.role === 'subject')
    expect(subject?.nodes).toBeUndefined()
  })

  it('renders a placeholder as the literal {{field}}, so noPlaceholders catches it', () => {
    const withChip = doc({
      body: {
        type: 'doc',
        content: [
          {
            type: 'numberedPara',
            attrs: { level: 1 },
            content: [
              { type: 'text', text: 'Ref ' },
              { type: 'placeholder', attrs: { field: 'fileNumber' } },
            ],
          },
        ],
      },
    })
    const result = renderOfficialDoc(withChip, om, 'en')
    expect(serialise(result.document)).toContain('{{fileNumber}}')
    const checklist = evaluateChecklist(om, result)
    expect(checklist.find((item) => item.id === 'no-placeholders')?.passed).toBe(false)
  })

  it("runs the template's own checklist over a properly filled document", () => {
    const result = renderOfficialDoc(doc(), om, 'en')
    const failing = evaluateChecklist(om, result)
      .filter((item) => !item.passed && item.severity === 'must')
      .map((item) => item.id)
    expect(failing).toEqual([])
  })

  it('pairs both languages on layout index', () => {
    const both = renderOfficialDocBilingual(doc(), om)
    expect(both.pairs.length).toBeGreaterThan(0)
    for (const pair of both.pairs) {
      expect(pair.en.layoutIndex).toBe(pair.layoutIndex)
      expect(pair.hi.layoutIndex).toBe(pair.layoutIndex)
    }
  })

  it('finds the body field from the layout, and answers null when there is none', () => {
    expect(bodyFieldOf(om, 'en')).toBe('paras')
    // All forty-three committed forms happen to place a sourced `body` block,
    // so the null branch is exercised against a layout with none rather than
    // against a template chosen today and changed tomorrow.
    const bodyless: DocTemplate = {
      ...om,
      layout: {
        en: om.layout.en.filter((block) => block.role !== 'body'),
        hi: om.layout.hi.filter((block) => block.role !== 'body'),
      },
    }
    expect(bodyFieldOf(bodyless, 'en')).toBeNull()
    // And a document rendered against it still produces its chrome rather than
    // throwing — a form with no body is a form, not an error.
    expect(renderOfficialDoc(doc(), bodyless, 'en').document.blocks.length).toBeGreaterThan(0)
  })
})

describe('projectBody', () => {
  it('numbers a numberedPara by depth, renumbering as it goes', () => {
    const nodes = projectBody(
      {
        type: 'doc',
        content: [
          { type: 'numberedPara', attrs: { level: 1 }, content: [{ type: 'text', text: 'One' }] },
          { type: 'numberedPara', attrs: { level: 2 }, content: [{ type: 'text', text: 'One-one' }] },
          { type: 'numberedPara', attrs: { level: 2 }, content: [{ type: 'text', text: 'One-two' }] },
          { type: 'numberedPara', attrs: { level: 1 }, content: [{ type: 'text', text: 'Two' }] },
        ],
      },
      'en',
    )
    expect(nodes.map((node) => (node.kind === 'para' ? node.marker : ''))).toEqual([
      '1. ',
      '1.1. ',
      '1.2. ',
      '2. ',
    ])
  })

  it('ignores a `number` attribute — a stored number goes stale', () => {
    const nodes = projectBody(
      {
        type: 'doc',
        content: [
          { type: 'numberedPara', attrs: { level: 1, number: 99 }, content: [{ type: 'text', text: 'One' }] },
        ],
      },
      'en',
    )
    expect(nodes[0]?.kind === 'para' && nodes[0].marker).toBe('1. ')
  })

  it('uses Devanagari digits when asked, in Hindi', () => {
    const nodes = projectBody(
      {
        type: 'doc',
        content: [{ type: 'numberedPara', attrs: { level: 1 }, content: [{ type: 'text', text: 'एक' }] }],
      },
      'hi',
      { devanagariDigits: true },
    )
    expect(nodes[0]?.kind === 'para' && nodes[0].marker).toBe('१. ')
  })

  it('projects headings, lists, quotes and tables', () => {
    const nodes = projectBody(
      {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Background' }] },
          {
            type: 'bulletList',
            content: [
              {
                type: 'listItem',
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First' }] }],
              },
            ],
          },
          {
            type: 'blockquote',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Quoted rule' }] }],
          },
          {
            type: 'table',
            content: [
              {
                type: 'tableRow',
                content: [
                  {
                    type: 'tableHeader',
                    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }],
                  },
                  {
                    type: 'tableHeader',
                    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'B' }] }],
                  },
                ],
              },
            ],
          },
          { type: 'pageBreak' },
        ],
      },
      'en',
    )
    expect(nodes.map((node) => node.kind)).toEqual(['heading', 'listItem', 'quote', 'table', 'pageBreak'])
    expect(linesOfNodes(nodes)).toEqual(['Background', '• First', '    Quoted rule', 'A\tB'])
  })

  it('carries marks onto runs', () => {
    const nodes = projectBody(
      {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'bold', marks: [{ type: 'bold' }] }],
          },
        ],
      },
      'en',
    )
    expect(nodes[0]?.kind === 'para' && nodes[0].runs[0]?.bold).toBe(true)
  })
})
