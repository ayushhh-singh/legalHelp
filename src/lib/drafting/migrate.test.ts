import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { evaluateChecklist } from './checklist'
import { render, sampleValues, serialise } from './engine'
import { migrateDraft, paragraphsToBody } from './migrate'
import { officialDocSchema } from './model'
import { renderOfficialDoc } from './renderDoc'

import { docTemplateFileSchema, type DocTemplate } from '@/modules/drafting/schema'
import type { DraftValues } from './types'

const root = join(import.meta.dirname, '..', '..', '..')
const TEMPLATE_DIR = join(root, 'data', 'drafting', 'templates')

const template = (id: string): DocTemplate =>
  docTemplateFileSchema.parse(JSON.parse(readFileSync(join(TEMPLATE_DIR, `${id}.json`), 'utf8'))).template

const ALL = readdirSync(TEMPLATE_DIR)
  .filter((name) => name.endsWith('.json'))
  .map((name) => name.replace(/\.json$/, ''))

/** The fourteen forms Sessions 8-28 could actually produce a draft of. */
const LEGACY = [
  'letter',
  'demi-official',
  'office-memorandum',
  'circular',
  'endorsement',
  'id-note',
  'noting',
  'notification',
  'leave-application',
  'representation',
  'rti-reply',
  'show-cause-reply',
  'tour-programme',
  'ta-bill-cover',
]

const migrate = (id: string, values: DraftValues) =>
  migrateDraft({
    id: `draft-${id}`,
    templateId: id,
    title: 'A saved draft',
    values,
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    template: template(id),
  })

describe('every one of the fourteen legacy forms migrates', () => {
  it.each(LEGACY)('%s', (id) => {
    const form = template(id)
    const result = migrate(id, sampleValues(form))

    // The migrated document is a valid `OfficialDoc`…
    expect(officialDocSchema.safeParse(result.doc).success).toBe(true)
    expect(result.doc.templateId).toBe(id)
    expect(result.doc.createdAt).toBe('2026-05-01T00:00:00.000Z')
    expect(result.doc.updatedAt).toBe('2026-06-01T00:00:00.000Z')

    // …and it renders through the new pipeline without a single unfilled
    // placeholder, which is the claim that matters: nothing the officer typed
    // was dropped on the way across.
    const rendered = renderOfficialDoc(result.doc, form, 'en')
    expect(serialise(rendered.document)).not.toMatch(/\{\{[a-zA-Z]/)
  })

  it('migrates a draft of every one of the forty-three forms without throwing', () => {
    for (const id of ALL) {
      const result = migrate(id, sampleValues(template(id)))
      expect(officialDocSchema.safeParse(result.doc).success).toBe(true)
    }
  })
})

describe('what goes where', () => {
  const om = template('office-memorandum')

  it('puts the recognised fields into meta', () => {
    const { doc } = migrate('office-memorandum', {
      fileNumber: 'A-11011/2/2026-Estt.',
      date: '2026-08-28',
      place: 'New Delhi',
      subject: { en: 'A subject', hi: 'एक विषय' },
      urgency: 'priority',
      enclosures: ['One.', 'Two.'],
      signatoryName: 'A.B.C.',
      signatoryDesignation: 'Under Secretary',
      phone: '011-2309 2590',
      email: 'us-estt@nic.in',
      addressee: ['The Department of Expenditure', 'North Block'],
      paras: ['First paragraph.', 'Second paragraph.'],
    })

    expect(doc.meta.number).toBe('A-11011/2/2026-Estt.')
    expect(doc.meta.date).toBe('2026-08-28')
    expect(doc.meta.subject).toEqual({ en: 'A subject', hi: 'एक विषय' })
    expect(doc.meta.urgency).toBe('priority')
    expect(doc.meta.enclosures).toEqual(['One.', 'Two.'])
    expect(doc.meta.signature.name).toEqual({ en: 'A.B.C.', hi: 'A.B.C.' })
    expect(doc.meta.signature.phone).toBe('011-2309 2590')
    expect(doc.meta.to).toHaveLength(1)
    expect(doc.meta.to[0]?.name.en).toBe('The Department of Expenditure')
    expect(doc.meta.to[0]?.address).toEqual(['North Block'])
  })

  it('refuses to guess at the parts of a free-text addressee block', () => {
    const { doc } = migrate('office-memorandum', {
      addressee: ['The Under Secretary', 'Department of Expenditure', 'North Block, New Delhi'],
      paras: ['x'],
    })
    // The old form held this as one textarea. Splitting it into a designation
    // and an organisation would put a guess on a document already sent.
    expect(doc.meta.to[0]?.designation).toEqual({ en: '', hi: '' })
    expect(doc.meta.to[0]?.organisation).toEqual({ en: '', hi: '' })
  })

  it('keeps an unrecognised field in `vars` under its own id, so the layout still finds it', () => {
    const { doc, keptAsVars } = migrate('tour-programme', sampleValues(template('tour-programme')))
    expect(keptAsVars.length).toBeGreaterThan(0)
    for (const key of keptAsVars) expect(doc.vars[key]).toBeDefined()
  })

  it('keeps a value under an id the template no longer defines rather than dropping it', () => {
    const { doc, unknownFields } = migrate('office-memorandum', {
      paras: ['x'],
      aFieldThatWasRemoved: 'the officer typed this',
    })
    expect(unknownFields).toEqual(['aFieldThatWasRemoved'])
    expect(doc.vars.aFieldThatWasRemoved).toBe('the officer typed this')
  })

  it('carries an urgency the select does not know as `none`', () => {
    expect(migrate('office-memorandum', { urgency: 'nonsense', paras: ['x'] }).doc.meta.urgency).toBe('none')
  })

  it('folds a `reference` field into one reference line', () => {
    const form = template('ta-bill-cover')
    const { doc } = migrate('ta-bill-cover', { ...sampleValues(form), reference: 'Your letter of 1.5.26' })
    expect(doc.meta.referenceLines).toHaveLength(1)
    expect(doc.meta.referenceLines[0]?.number).toContain('Your letter')
    // And the layout's own `{{reference}}` still resolves to the same words,
    // because `bindings` rebuilds it from the line it was folded into.
    expect(serialise(renderOfficialDoc(doc, form, 'en').document)).toContain('Your letter of 1.5.26')
  })

  it('keeps a `reference` on a form that has no such FIELD in `vars` instead', () => {
    // `rti-reply` interpolates no `{{reference}}`, so a stray value has no
    // structured home — and is kept rather than dropped.
    const { doc, unknownFields } = migrate('rti-reply', {
      ...sampleValues(template('rti-reply')),
      reference: 'Your letter of 1.5.26',
    })
    expect(unknownFields).toContain('reference')
    expect(doc.vars.reference).toBe('Your letter of 1.5.26')
  })

  it('is bilingual only when the two bodies genuinely differ', () => {
    const shared = migrate('office-memorandum', { paras: ['Same in both.'] })
    expect(shared.doc.lang).toBe('en')
    expect(shared.doc.bodyHi).toBeUndefined()

    const split = migrate('office-memorandum', {
      paras: { en: ['English body.'], hi: ['हिंदी मुख्य भाग।'] },
    })
    expect(split.doc.lang).toBe('bilingual')
    expect(split.doc.bodyHi).toBeDefined()
  })

  it('renders a migrated document exactly as the old engine rendered the draft', () => {
    const values = sampleValues(om)
    const before = render(om, values, 'en')
    const after = renderOfficialDoc(migrate('office-memorandum', values).doc, om, 'en')
    expect(after.document.blocks.map((block) => block.lines)).toEqual(
      before.document.blocks.map((block) => block.lines),
    )
  })

  it('keeps the checklist passing across the migration, for every legacy form', () => {
    for (const id of LEGACY) {
      const form = template(id)
      const values = sampleValues(form)
      const before = evaluateChecklist(form, render(form, values, 'en'))
      const after = evaluateChecklist(form, renderOfficialDoc(migrate(id, values).doc, form, 'en'))
      expect(after.map((item) => [item.id, item.passed])).toEqual(
        before.map((item) => [item.id, item.passed]),
      )
    }
  })

  it('is idempotent — the same draft twice gives the same document', () => {
    const values = sampleValues(om)
    expect(migrate('office-memorandum', values).doc).toEqual(migrate('office-memorandum', values).doc)
  })
})

describe('paragraphsToBody', () => {
  it('makes every migrated paragraph a numberedPara', () => {
    const body = paragraphsToBody(['One.', 'Two.'])
    expect(body.content?.map((node) => node.type)).toEqual(['numberedPara', 'numberedPara'])
  })

  it('drops blank lines but never leaves an empty document', () => {
    expect(paragraphsToBody(['One.', '   ', 'Two.']).content).toHaveLength(2)
    expect(paragraphsToBody([]).content).toEqual([{ type: 'paragraph' }])
  })
})
