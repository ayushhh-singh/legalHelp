import { describe, expect, it } from 'vitest'

import {
  DOC_MODEL_VERSION,
  bindings,
  bodySchema,
  emptyBody,
  emptyMeta,
  isBlank,
  newDoc,
  officialDocSchema,
  placeholderFields,
  readDoc,
  upgradeDoc,
} from './model'

const at = '2026-09-03T10:00:00.000Z'

const base = () =>
  newDoc({
    id: 'doc-1',
    templateId: 'office-memorandum',
    lang: 'en',
    at,
    meta: {
      ...emptyMeta(),
      number: 'A-11011/2/2026-Estt.',
      date: '2026-09-03',
      subject: { en: 'Children Education Allowance', hi: 'बाल शिक्षा भत्ता' },
      to: [
        {
          id: 'to-1',
          bookId: null,
          name: { en: 'The Under Secretary', hi: 'अवर सचिव' },
          designation: { en: '', hi: '' },
          organisation: { en: 'Department of Expenditure', hi: 'व्यय विभाग' },
          address: ['North Block, New Delhi'],
          phone: '',
          email: '',
        },
      ],
      enclosures: ['A copy of the order.'],
      referenceLines: [{ id: 'ref-1', number: 'A-1/2026', date: '12.05.2026' }],
    },
  })

describe('the document model', () => {
  it('stamps the current version on a new document', () => {
    expect(base().docModelVersion).toBe(DOC_MODEL_VERSION)
    expect(officialDocSchema.safeParse(base()).success).toBe(true)
  })

  it('carries `type` and `templateId` as the same value', () => {
    const doc = base()
    expect(doc.type).toBe(doc.templateId)
  })

  it('rejects a body node the model does not know', () => {
    expect(bodySchema.safeParse({ type: 'doc', content: [{ type: 'iframe' }] }).success).toBe(false)
    expect(bodySchema.safeParse({ type: 'doc', content: [{ type: 'numberedPara' }] }).success).toBe(true)
  })

  it('refuses a document written by a NEWER build rather than half-reading it', () => {
    const result = readDoc({ ...base(), docModelVersion: DOC_MODEL_VERSION + 1 })
    expect(result).toEqual({ ok: false, reason: 'too-new', storedVersion: DOC_MODEL_VERSION + 1 })
  })

  it('reads a document at the current version', () => {
    const result = readDoc(base())
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.doc.meta.number).toBe('A-11011/2/2026-Estt.')
  })

  it('refuses rubbish', () => {
    expect(readDoc(null)).toEqual({ ok: false, reason: 'malformed' })
    expect(readDoc({ id: 'x' })).toEqual({ ok: false, reason: 'malformed' })
  })

  it('upgrades an unversioned row and fills in the missing alias', () => {
    const raw = upgradeDoc({ ...base(), docModelVersion: undefined, templateId: undefined }) as {
      docModelVersion: number
      templateId: string
    }
    expect(raw.docModelVersion).toBe(1)
    expect(raw.templateId).toBe('office-memorandum')
  })
})

describe('bindings', () => {
  it('resolves the meta-derived names the fourteen original layouts interpolate', () => {
    const values = bindings(base(), 'en')
    expect(values.fileNumber).toBe('A-11011/2/2026-Estt.')
    expect(values.subject).toBe('Children Education Allowance')
    expect(values.enclosures).toEqual(['A copy of the order.'])
    expect(values.addressee).toEqual([
      'The Under Secretary',
      'Department of Expenditure',
      'North Block, New Delhi',
    ])
    expect(values.reference).toBe('A-1/2026 dated 12.05.2026')
  })

  it('resolves the OTHER language, and falls through when one side is empty', () => {
    const doc = base()
    expect(bindings(doc, 'hi').subject).toBe('बाल शिक्षा भत्ता')
    doc.meta.subject = { en: 'Only English', hi: '' }
    expect(bindings(doc, 'hi').subject).toBe('Only English')
  })

  it('layers `vars` over the built-ins so a form can own a name', () => {
    const doc = { ...base(), vars: { subject: 'A variable subject', officerName: 'Shri A.B.C.' } }
    expect(bindings(doc, 'en').subject).toBe('A variable subject')
    expect(bindings(doc, 'en').officerName).toBe('Shri A.B.C.')
  })

  it('picks the right side of a bilingual variable', () => {
    const doc = { ...base(), vars: { post: { en: 'Section Officer', hi: 'अनुभाग अधिकारी' } } }
    expect(bindings(doc, 'hi').post).toBe('अनुभाग अधिकारी')
  })
})

describe('isBlank and placeholderFields', () => {
  it('treats an empty string, whitespace and an empty list as blank', () => {
    expect(isBlank(undefined)).toBe(true)
    expect(isBlank('')).toBe(true)
    expect(isBlank('   ')).toBe(true)
    expect(isBlank([])).toBe(true)
    expect(isBlank(['x'])).toBe(false)
    expect(isBlank('x')).toBe(false)
  })

  it('finds every placeholder field in document order, nested', () => {
    const body = {
      type: 'doc' as const,
      content: [
        {
          type: 'numberedPara' as const,
          content: [
            { type: 'text' as const, text: 'Ref ' },
            { type: 'placeholder' as const, attrs: { field: 'fileNumber' } },
          ],
        },
        {
          type: 'blockquote' as const,
          content: [
            {
              type: 'paragraph' as const,
              content: [{ type: 'placeholder' as const, attrs: { field: 'amount' } }],
            },
          ],
        },
      ],
    }
    expect(placeholderFields(body)).toEqual(['fileNumber', 'amount'])
    expect(placeholderFields(emptyBody())).toEqual([])
  })
})
