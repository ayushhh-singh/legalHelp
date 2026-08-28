import { describe, expect, it } from 'vitest'

import { fixtureTemplate } from '@/test/drafting-fixture'

import { countFailures, evaluateChecklist } from './checklist'
import { renderDocument } from './engine'

import type { ChecklistItem, DocTemplate } from '@/modules/drafting/schema'

const bl = (en: string, hi: string) => ({ en, hi })

/** A template carrying exactly one checklist item, so a rule is tested alone. */
function withRule(rule: ChecklistItem['rule'], overrides: Partial<DocTemplate> = {}): DocTemplate {
  return fixtureTemplate({
    checklist: [
      {
        id: 'under-test',
        label: bl('Under test', 'परीक्षणाधीन'),
        why: bl('Because.', 'क्योंकि।'),
        severity: 'must',
        rule,
      },
    ],
    ...overrides,
  })
}

const verdict = (
  template: DocTemplate,
  values: Parameters<typeof renderDocument>[1],
  lang: 'en' | 'hi' = 'en',
) => evaluateChecklist(template, renderDocument(template, values, lang))[0]?.passed

describe('evaluateChecklist', () => {
  it('returns one result per item, in the template order, in the document language', () => {
    const template = fixtureTemplate()
    const results = evaluateChecklist(template, renderDocument(template, {}, 'hi'))
    expect(results).toHaveLength(1)
    expect(results[0]?.id).toBe('no-placeholders')
    expect(results[0]?.label).toBe('कोई प्लेसहोल्डर नहीं छूटा')
    expect(results[0]?.passed).toBe(true)
  })

  it('required and allRequired read the values, not the rendered text', () => {
    expect(verdict(withRule({ kind: 'required', field: 'subject' }), {})).toBe(true)
    expect(verdict(withRule({ kind: 'required', field: 'subject' }), { subject: '   ' })).toBe(false)
    expect(
      verdict(withRule({ kind: 'allRequired', fields: ['fileNumber', 'subject'] }), { subject: '' }),
    ).toBe(false)
  })

  it('listNonEmpty distinguishes an empty list from an absent one', () => {
    const rule = { kind: 'listNonEmpty', field: 'enclosures' } as const
    expect(verdict(withRule(rule), {})).toBe(false)
    expect(verdict(withRule(rule), { enclosures: ['One order'] })).toBe(true)
  })

  it('blockPresent does not count a block whose placeholders are all empty', () => {
    const rule = { kind: 'blockPresent', role: 'subject' } as const
    // The subject block is omitWhenEmpty, so it drops out entirely...
    expect(verdict(withRule(rule), { subject: '' })).toBe(false)
    expect(verdict(withRule(rule), { subject: 'Testing' })).toBe(true)

    // ...and a block that stays but rendered nothing does not count either.
    const stays = withRule(rule, {
      layout: {
        ...fixtureTemplate().layout,
        en: fixtureTemplate().layout.en.map((block) =>
          block.role === 'subject' ? { ...block, omitWhenEmpty: false } : block,
        ),
      },
    })
    expect(verdict(stays, { subject: '' })).toBe(false)
  })

  it('contains matches the needle for the document language, case-insensitively', () => {
    const rule = { kind: 'contains', role: 'body', text: bl('undersigned', 'अधोहस्ताक्षरी') } as const
    expect(verdict(withRule(rule), { paras: ['The Undersigned is directed to say.'] })).toBe(true)
    expect(verdict(withRule(rule), { paras: ['It is directed.'] })).toBe(false)
    expect(verdict(withRule(rule), { paras: ['अधोहस्ताक्षरी को निदेश हुआ है।'] }, 'hi')).toBe(true)
    // The English needle must not satisfy the Hindi document.
    expect(verdict(withRule(rule), { paras: ['The undersigned.'] }, 'hi')).toBe(false)
  })

  it('regex and regexAbsent are opposites over the same text', () => {
    const values = { paras: ['It is noticed that the file is delayed.'] }
    expect(verdict(withRule({ kind: 'regex', role: 'body', pattern: 'it is noticed' }), values)).toBe(true)
    expect(verdict(withRule({ kind: 'regexAbsent', role: 'body', pattern: 'it is noticed' }), values)).toBe(
      false,
    )
  })

  it('paraNumbering reads the numbering back off the rendered paragraphs', () => {
    const template = withRule({ kind: 'paraNumbering' })
    expect(verdict(template, {})).toBe(true)
    expect(verdict(template, { paras: [] })).toBe(false)

    const fromOne = withRule(
      { kind: 'paraNumbering' },
      {
        layout: {
          ...fixtureTemplate().layout,
          en: fixtureTemplate().layout.en.map((block) =>
            block.role === 'body' ? { ...block, numberFrom: 1 } : block,
          ),
        },
      },
    )
    expect(verdict(fromOne, {})).toBe(true)
  })

  it('paraNumbering counts Devanagari numerals too', () => {
    const template = withRule({ kind: 'paraNumbering' })
    const result = renderDocument(template, {}, 'hi', { devanagariDigits: true })
    expect(result.document.paras[1]).toBe('२. दूसरा।')
    expect(evaluateChecklist(template, result)[0]?.passed).toBe(true)
  })

  it('noPlaceholders fails on a layout that names a field the template lacks', () => {
    const broken = withRule(
      { kind: 'noPlaceholders' },
      {
        layout: {
          ...fixtureTemplate().layout,
          en: [{ role: 'footer', lines: ['Signed by {{whoever}}'] }, ...fixtureTemplate().layout.en],
        },
      },
    )
    expect(verdict(broken, {})).toBe(false)
    expect(verdict(withRule({ kind: 'noPlaceholders' }), {})).toBe(true)
  })

  it('person tests the body for whole-word pronouns, in either script', () => {
    const third = withRule({ kind: 'person', value: 'third' })
    const first = withRule({ kind: 'person', value: 'first' })

    expect(verdict(third, { paras: ['The undersigned is directed to say that.'] })).toBe(true)
    expect(verdict(third, { paras: ['I am directed to say that.'] })).toBe(false)
    expect(verdict(first, { paras: ['I am directed to say that.'] })).toBe(true)

    expect(verdict(third, { paras: ['अधोहस्ताक्षरी को निदेश हुआ है।'] }, 'hi')).toBe(true)
    expect(verdict(third, { paras: ['मुझे यह कहने का निदेश हुआ है।'] }, 'hi')).toBe(false)
    // A Devanagari word that merely contains हम is not the pronoun हम.
    expect(verdict(third, { paras: ['यह एक अहम मामला है।'] }, 'hi')).toBe(true)
  })

  it('enclosuresConsistent only complains when the text says something is attached', () => {
    const rule = { kind: 'enclosuresConsistent' } as const
    expect(verdict(withRule(rule), { paras: ['Nothing is attached to this.'] })).toBe(true)
    expect(verdict(withRule(rule), { paras: ['The order is enclosed.'] })).toBe(false)
    expect(verdict(withRule(rule), { paras: ['The order is enclosed.'], enclosures: ['The order'] })).toBe(
      true,
    )
    expect(verdict(withRule(rule), { paras: ['आदेश संलग्न है।'] }, 'hi')).toBe(false)
  })

  it('maxWords counts the words of one role', () => {
    const rule = { kind: 'maxWords', role: 'body', count: 5 } as const
    expect(verdict(withRule(rule), { paras: ['One two three.'] })).toBe(true)
    expect(verdict(withRule(rule), { paras: ['One two three four five six seven.'] })).toBe(false)
  })

  it('replyDate asks for a date only where the text asks for something', () => {
    const rule = { kind: 'replyDate' } as const
    expect(verdict(withRule(rule), { paras: ['This is for information.'] })).toBe(true)
    expect(verdict(withRule(rule), { paras: ['The information may be sent immediately.'] })).toBe(false)
    expect(verdict(withRule(rule), { paras: ['The information may be sent by 28.02.2026.'] })).toBe(true)
    expect(verdict(withRule(rule), { paras: ['सूचना दिनांक 28.02.2026 तक भेजी जाए।'] }, 'hi')).toBe(true)
    expect(verdict(withRule(rule), { paras: ['सूचना तुरंत भेजी जाए।'] }, 'hi')).toBe(false)
  })

  it('throws on a rule kind nothing implements, rather than passing it', () => {
    const template = withRule({ kind: 'somethingNew' } as unknown as ChecklistItem['rule'])
    expect(() => evaluateChecklist(template, renderDocument(template, {}, 'en'))).toThrow(
      /unimplemented checklist rule/,
    )
  })
})

describe('countFailures', () => {
  it('separates the must-fix items from the should-fix ones', () => {
    expect(
      countFailures([
        { id: 'a', label: '', why: '', severity: 'must', passed: false },
        { id: 'b', label: '', why: '', severity: 'must', passed: true },
        { id: 'c', label: '', why: '', severity: 'should', passed: false },
      ]),
    ).toEqual({ must: 1, should: 1 })
  })
})
