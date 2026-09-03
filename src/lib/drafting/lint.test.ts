import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { lintBlocksExport, lintDocument, type LintRuleId } from './lint'
import { emptyMeta, newDoc, type BodyDoc, type OfficialDoc } from './model'
import { renderOfficialDoc } from './renderDoc'

import { docTemplateFileSchema, type DocTemplate } from '@/modules/drafting/schema'

const root = join(import.meta.dirname, '..', '..', '..')
const template = (id: string): DocTemplate =>
  docTemplateFileSchema.parse(
    JSON.parse(readFileSync(join(root, 'data', 'drafting', 'templates', `${id}.json`), 'utf8')),
  ).template

const om = template('office-memorandum')
const NOW = '2026-09-03T10:00:00.000Z'

const body = (...paras: string[]): BodyDoc => ({
  type: 'doc',
  content: paras.map((text) => ({
    type: 'numberedPara',
    attrs: { level: 1 },
    content: [{ type: 'text', text }],
  })),
})

function make(over: { meta?: Partial<OfficialDoc['meta']>; body?: BodyDoc } = {}): OfficialDoc {
  return newDoc({
    id: 'd1',
    templateId: 'office-memorandum',
    lang: 'en',
    at: NOW,
    meta: {
      ...emptyMeta(),
      number: 'A-1/2026',
      date: '2026-09-01',
      subject: { en: 'A subject', hi: 'एक विषय' },
      ...over.meta,
    },
    body: over.body ?? body('One paragraph, saying something.'),
  })
}

function lint(
  doc: OfficialDoc,
  lang: 'en' | 'hi' = 'en',
  extra: Partial<Parameters<typeof lintDocument>[0]> = {},
) {
  return lintDocument({
    doc,
    template: om,
    lang,
    result: renderOfficialDoc(doc, om, lang),
    now: NOW,
    ...extra,
  })
}

const rules = (doc: OfficialDoc, lang: 'en' | 'hi' = 'en'): LintRuleId[] => [
  ...new Set(lint(doc, lang).map((finding) => finding.rule)),
]

describe('placeholders', () => {
  it('is an error, one per distinct field', () => {
    const doc = make({
      body: {
        type: 'doc',
        content: [
          {
            type: 'numberedPara',
            content: [
              { type: 'placeholder', attrs: { field: 'amount' } },
              { type: 'text', text: ' and ' },
              { type: 'placeholder', attrs: { field: 'amount' } },
              { type: 'placeholder', attrs: { field: 'purpose' } },
            ],
          },
        ],
      },
    })
    const found = lint(doc).filter((finding) => finding.rule === 'placeholders')
    expect(found.map((finding) => finding.id)).toEqual(['placeholders:amount', 'placeholders:purpose'])
    expect(found.every((finding) => finding.severity === 'error')).toBe(true)
    expect(lintBlocksExport(found)).toBe(true)
  })

  it('says so when the field is not one the form defines', () => {
    const doc = make({
      body: {
        type: 'doc',
        content: [
          { type: 'numberedPara', content: [{ type: 'placeholder', attrs: { field: 'notAField' } }] },
        ],
      },
    })
    expect(lint(doc)[0]?.message.en).toContain('not a field this form defines')
  })
})

describe('subject', () => {
  it('is an error on a form that carries a subject line', () => {
    expect(rules(make({ meta: { subject: { en: '', hi: '' } } }))).toContain('subject')
  })

  it('is not raised on a form that carries no subject line at all', () => {
    // An endorsement is a single fixed sentence and places no `subject` block.
    // Asking for one there would be asking for something the form does not have.
    const endorsement = template('endorsement')
    const doc = {
      ...make({ meta: { subject: { en: '', hi: '' } } }),
      templateId: 'endorsement',
      type: 'endorsement',
    }
    const findings = lintDocument({
      doc,
      template: endorsement,
      lang: 'en',
      result: renderOfficialDoc(doc, endorsement, 'en'),
      now: NOW,
    })
    expect(findings.some((finding) => finding.rule === 'subject')).toBe(false)
  })
})

describe('date', () => {
  it('reports a missing date', () => {
    expect(lint(make({ meta: { date: '' } })).find((f) => f.rule === 'date')?.id).toBe('date:missing')
  })

  it('reports one that is not a date at all', () => {
    expect(lint(make({ meta: { date: '31.02.2026' } })).find((f) => f.rule === 'date')?.id).toBe(
      'date:invalid',
    )
  })

  it('warns about a date in the future', () => {
    const finding = lint(make({ meta: { date: '2027-01-01' } })).find((f) => f.rule === 'date')
    expect(finding?.id).toBe('date:future')
    expect(finding?.severity).toBe('warning')
  })

  it('drops to a hint when the officer says it is intended', () => {
    const finding = lint(make({ meta: { date: '2027-01-01', futureDateIntended: true } })).find(
      (f) => f.rule === 'date',
    )
    expect(finding?.severity).toBe('hint')
  })

  it("accepts TODAY'S date — the comparison is by day, not by instant", () => {
    expect(lint(make({ meta: { date: '2026-09-03' } })).some((f) => f.rule === 'date')).toBe(false)
  })
})

describe('references', () => {
  it('warns about a reference with a number and no date', () => {
    const doc = make({ meta: { referenceLines: [{ id: 'r1', number: 'A-1/2026', date: '' }] } })
    expect(lint(doc).find((f) => f.rule === 'references')?.message.en).toContain('a number with no date')
  })

  it('warns about a reference with a date and no number', () => {
    const doc = make({ meta: { referenceLines: [{ id: 'r1', number: '', date: '2026-05-12' }] } })
    expect(lint(doc).find((f) => f.rule === 'references')?.message.en).toContain('a date with no number')
  })

  it('warns about an entirely empty one', () => {
    const doc = make({ meta: { referenceLines: [{ id: 'r1', number: '', date: '' }] } })
    expect(lint(doc).find((f) => f.rule === 'references')?.message.en).toContain('is empty')
  })

  it('says nothing about a complete one', () => {
    const doc = make({ meta: { referenceLines: [{ id: 'r1', number: 'A-1/2026', date: '2026-05-12' }] } })
    expect(rules(doc)).not.toContain('references')
  })
})

describe('enclosures', () => {
  it('is an error when the text mentions one and none is listed', () => {
    const doc = make({ body: body('A copy of the order is enclosed for reference.') })
    const finding = lint(doc).find((f) => f.rule === 'enclosures')
    expect(finding?.id).toBe('enclosures:missing')
    expect(finding?.severity).toBe('error')
  })

  it('is a warning the OTHER way round — listed and never mentioned', () => {
    const doc = make({
      meta: { enclosures: ['A copy of the order.'] },
      body: body('Nothing is attached to this.'),
    })
    const finding = lint(doc).find((f) => f.rule === 'enclosures')
    expect(finding?.id).toBe('enclosures:unmentioned')
    expect(finding?.severity).toBe('warning')
  })

  it('says nothing when both agree', () => {
    const doc = make({
      meta: { enclosures: ['A copy of the order.'] },
      body: body('A copy of the order is enclosed.'),
    })
    expect(rules(doc)).not.toContain('enclosures')
  })

  it('recognises the Hindi words for an enclosure', () => {
    const doc = make({ body: { type: 'doc', content: [] } })
    doc.bodyHi = body('इसके साथ आदेश की एक प्रति संलग्न है।')
    doc.lang = 'bilingual'
    expect(rules(doc, 'hi')).toContain('enclosures')
  })
})

describe('paragraph length', () => {
  it('warns past the limit and names the paragraph', () => {
    const long = Array.from({ length: 130 }, (_, index) => `word${index}`).join(' ')
    const findings = lint(make({ body: body('Short one.', long) })).filter(
      (f) => f.rule === 'paragraphLength',
    )
    expect(findings).toHaveLength(1)
    expect(findings[0]?.para).toBe(2)
  })

  it('respects a caller-supplied limit', () => {
    const doc = make({ body: body('one two three four five') })
    expect(lint(doc, 'en', { maxParagraphWords: 3 }).some((f) => f.rule === 'paragraphLength')).toBe(true)
  })
})

describe('terminology', () => {
  const glossary = [
    { en: 'sanction', hi: 'स्वीकृति' },
    { en: 'Office Memorandum', hi: 'कार्यालय ज्ञापन' },
  ]

  it('reports NOTHING when no glossary is supplied — an absent dataset is not evidence', () => {
    const doc = make({ body: { type: 'doc', content: [] } })
    doc.bodyHi = body('यह sanction के संबंध में है।')
    doc.lang = 'bilingual'
    expect(rules(doc, 'hi')).not.toContain('terminology')
  })

  it('hints at the standard Hindi term for an English word in a Hindi document', () => {
    const doc = make({ body: { type: 'doc', content: [] } })
    doc.bodyHi = body('यह sanction के संबंध में है।')
    doc.lang = 'bilingual'
    const finding = lint(doc, 'hi', { glossary }).find((f) => f.rule === 'terminology')
    expect(finding?.severity).toBe('hint')
    expect(finding?.suggestion).toEqual({ found: 'sanction', standard: 'स्वीकृति' })
  })

  it('never runs in English', () => {
    const doc = make({ body: body('This sanction is accorded.') })
    expect(lint(doc, 'en', { glossary }).some((f) => f.rule === 'terminology')).toBe(false)
  })

  it('ignores a multi-word term and a short one', () => {
    const doc = make({ body: { type: 'doc', content: [] } })
    doc.bodyHi = body('यह Office Memorandum है। OM भी।')
    doc.lang = 'bilingual'
    expect(lint(doc, 'hi', { glossary }).some((f) => f.rule === 'terminology')).toBe(false)
  })
})

describe('passive voice', () => {
  const demiOfficial = template('demi-official')

  const doLint = (text: string) => {
    const doc = { ...make({ body: body(text) }), templateId: 'demi-official', type: 'demi-official' }
    return lintDocument({
      doc,
      template: demiOfficial,
      lang: 'en',
      result: renderOfficialDoc(doc, demiOfficial, 'en'),
      now: NOW,
    })
  }

  it('hints on a D.O. letter written impersonally — CSMOP 9.5(i)', () => {
    const finding = doLint('It is noticed that the report has not been received.').find(
      (f) => f.rule === 'passiveVoice',
    )
    expect(finding?.severity).toBe('hint')
    expect(finding?.message.en).toContain('I notice')
  })

  it('says nothing when the D.O. is in the first person', () => {
    expect(
      doLint('I notice that the report has not been received.').some((f) => f.rule === 'passiveVoice'),
    ).toBe(false)
  })

  it("NEVER fires on an Office Memorandum — its whole grammar is 'The undersigned is directed'", () => {
    const doc = make({ body: body('It is noticed that the report has not been received.') })
    expect(rules(doc)).not.toContain('passiveVoice')
  })
})

describe('ordering and the export gate', () => {
  it('puts errors first', () => {
    const doc = make({
      meta: { subject: { en: '', hi: '' }, referenceLines: [{ id: 'r1', number: 'A', date: '' }] },
    })
    const severities = lint(doc).map((finding) => finding.severity)
    expect(severities).toEqual([...severities].sort((a, b) => (a === 'error' ? -1 : b === 'error' ? 1 : 0)))
    expect(severities[0]).toBe('error')
  })

  it('blocks an export on an error and not on a warning', () => {
    expect(lintBlocksExport(lint(make({ meta: { subject: { en: '', hi: '' } } })))).toBe(true)
    expect(
      lintBlocksExport(lint(make({ meta: { referenceLines: [{ id: 'r1', number: 'A', date: '' }] } }))),
    ).toBe(false)
  })

  it('finds nothing at all on a well-formed document', () => {
    expect(lint(make())).toEqual([])
  })
})
