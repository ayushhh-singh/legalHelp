import { describe, expect, it } from 'vitest'

import { fixtureTemplate } from '@/test/drafting-fixture'

import type { FieldValue } from './types'

import { render, renderBilingual, renderDocument, sampleValues, serialise } from './engine'

const template = fixtureTemplate()
/** The worked example, which the engine no longer supplies on its own. */
const S = sampleValues(template)

const textOf = (result: ReturnType<typeof renderDocument>, role: string) =>
  result.document.blocks
    .filter((block) => block.role === role)
    .flatMap((block) => block.lines)
    .join('\n')

describe('renderDocument', () => {
  it('falls back to the sample values, so a template always renders', () => {
    const result = renderDocument(template, S, 'en')
    expect(result.issues).toEqual([])
    expect(textOf(result, 'fileNumber')).toBe('No. A-1/2026')
    expect(result.document.subject).toBe('Subject: Testing')
  })

  it('numbers paragraphs from 2, leaving the first unnumbered', () => {
    const result = renderDocument(template, S, 'en')
    expect(result.document.paras).toEqual(['First.', '2. Second.', '3. Third.'])
  })

  it('numbers every paragraph when the block says numberFrom 1', () => {
    const noting = fixtureTemplate({
      layout: {
        ...template.layout,
        en: template.layout.en.map((block) => (block.role === 'body' ? { ...block, numberFrom: 1 } : block)),
      },
    })
    expect(renderDocument(noting, S, 'en').document.paras).toEqual(['1. First.', '2. Second.', '3. Third.'])
  })

  it('normalises a date however it was typed, and reports one that is not a date', () => {
    expect(renderDocument(template, { ...S, date: '8.8.2026' }, 'en').document.blocks[1]?.lines[0]).toBe(
      'New Delhi, the 08.08.2026',
    )

    const bad = renderDocument(template, { ...S, date: '31.02.2026' }, 'en')
    expect(bad.issues).toHaveLength(1)
    expect(bad.issues[0]?.code).toBe('date-format')
    expect(bad.issues[0]?.field).toBe('date')
  })

  it('switches Hindi numerals only when the toggle is on', () => {
    const plain = renderDocument(template, S, 'hi')
    const devanagari = renderDocument(template, S, 'hi', { devanagariDigits: true })
    expect(textOf(plain, 'dateLine')).toBe('नई दिल्ली, दिनांक 28.08.2026')
    expect(textOf(devanagari, 'dateLine')).toBe('नई दिल्ली, दिनांक २८.०८.२०२६')
    expect(devanagari.document.paras[1]).toBe('२. दूसरा।')
    // English is never re-scripted, whatever the toggle says.
    expect(renderDocument(template, S, 'en', { devanagariDigits: true }).document.paras[1]).toBe('2. Second.')
  })

  it('renders a select as its label, and "none" as nothing at all', () => {
    expect(renderDocument(template, { ...S, urgency: 'immediate' }, 'en').document.urgency).toBe('IMMEDIATE')
    expect(renderDocument(template, { ...S, urgency: 'immediate' }, 'hi').document.urgency).toBe('तत्काल')
    // "none" means no grading: the block drops out rather than printing "None".
    expect(renderDocument(template, { ...S, urgency: 'none' }, 'en').document.urgency).toBeNull()
  })

  it('reports a select value that is not one of the choices', () => {
    const result = renderDocument(template, { ...S, urgency: 'very urgent indeed' }, 'en')
    expect(result.issues.map((issue) => issue.code)).toEqual(['unknown-option'])
  })

  it('drops an omitWhenEmpty block and keeps a required one that is empty', () => {
    const result = renderDocument(template, { ...S, subject: '', fileNumber: '' }, 'en')
    expect(result.document.subject).toBeNull()
    // fileNumber is required: the line stays so the omission is visible, and
    // the issue list carries the complaint.
    expect(result.issues.map((issue) => issue.field)).toContain('fileNumber')
    expect(textOf(result, 'fileNumber')).toBe('No.')
  })

  it('appends the enclosure line with a count, and only when there are enclosures', () => {
    expect(renderDocument(template, S, 'en').document.enclosures).toEqual([])

    const withEncl = renderDocument(template, { ...S, enclosures: ['One order', 'One statement'] }, 'en')
    expect(withEncl.document.enclosures).toEqual([
      'List of enclosures:',
      '1. One order',
      '2. One statement',
      'Encl.: as above (2)',
    ])
    expect(renderDocument(template, { ...S, enclosures: ['एक आदेश'] }, 'hi').document.enclosures).toContain(
      'संलग्नक : उपर्युक्तानुसार (1)',
    )
  })

  it('reads an emptied box as an empty list, not as a list with nothing in it', () => {
    // A textarea the officer cleared arrives as [''] or as '\n\n'. It renders
    // as nothing either way, so `resolved` — which the checklist reads — has to
    // say the same thing, or a required list reports no issue and a
    // listNonEmpty rule passes over an empty list.
    const emptiedBoxes: FieldValue[] = [[''], ['', '  '], '', '\n\n']
    for (const emptied of emptiedBoxes) {
      const result = renderDocument(template, { ...S, paras: emptied }, 'en')
      expect(result.resolved.paras, JSON.stringify(emptied)).toEqual([])
      expect(result.document.paras, JSON.stringify(emptied)).toEqual([])
      expect(
        result.issues.map((issue) => issue.field),
        JSON.stringify(emptied),
      ).toEqual(['paras'])
    }
  })

  it('accepts a multiline string where a list is wanted', () => {
    const result = renderDocument(template, { ...S, enclosures: 'One\n\nTwo\n' }, 'en')
    expect(result.document.enclosures.slice(1, 3)).toEqual(['1. One', '2. Two'])
  })

  it('splits a value typed across several lines into several lines of the document', () => {
    // An addressee block is a textarea. Left as one string with newlines in it,
    // `align` pads against the length of both lines at once and `wrap` counts
    // the newline as a character, so a right-aligned block is visibly wrong.
    const addressed = fixtureTemplate({
      layout: {
        en: [{ role: 'addressee', align: 'right', lines: ['{{subject}}'] }],
        hi: [{ role: 'addressee', align: 'right', lines: ['{{subject}}'] }],
      },
    })

    const result = renderDocument(addressed, { ...S, subject: 'One\nTwo' }, 'en')
    expect(result.document.blocks[0]?.lines).toEqual(['One', 'Two'])
    expect(serialise(result.document, { width: 10 })).toBe('       One\n       Two\n')
  })

  it('drops the blank lines of a multiline value but keeps a static line', () => {
    const spaced = fixtureTemplate({
      layout: {
        en: [{ role: 'addressee', lines: ['To,', '{{subject}}'] }],
        hi: [{ role: 'addressee', lines: ['सेवा में,', '{{subject}}'] }],
      },
    })
    const result = renderDocument(spaced, { ...S, subject: 'One\n\nTwo\n' }, 'en')
    expect(result.document.blocks[0]?.lines).toEqual(['To,', 'One', 'Two'])
  })

  it('reports a field that runs past its own word limit', () => {
    const capped = fixtureTemplate({
      fields: template.fields.map((field) => (field.id === 'paras' ? { ...field, maxWords: 3 } : field)),
    })
    const values = { ...sampleValues(capped), paras: ['one two three four'] }
    expect(renderDocument(capped, values, 'en').issues.map((issue) => issue.code)).toEqual(['too-long'])
    expect(renderDocument(capped, sampleValues(capped), 'en').issues).toEqual([])
  })

  it('leaves an unknown placeholder visible and reports it', () => {
    const broken = fixtureTemplate({
      layout: {
        ...template.layout,
        en: [{ role: 'footer', lines: ['Signed by {{whoever}}'] }, ...template.layout.en],
      },
    })
    const result = renderDocument(broken, S, 'en')
    expect(result.document.blocks[0]?.lines[0]).toBe('Signed by {{whoever}}')
    expect(result.issues.map((issue) => issue.code)).toContain('unknown-field')
  })

  it('takes a per-language value, and falls back to the other language rather than showing nothing', () => {
    const both = renderDocument(template, { ...S, subject: { en: 'Leave', hi: 'अवकाश' } }, 'hi')
    expect(both.document.subject).toBe('विषय : अवकाश')

    const englishOnly = renderDocument(template, { ...S, subject: { en: 'Leave' } }, 'hi')
    expect(englishOnly.document.subject).toBe('विषय : Leave')
  })
})

describe('sampleValues', () => {
  it('builds a value for every field, and renders the template complete', () => {
    expect(Object.keys(S).sort()).toEqual(template.fields.map((field) => field.id).sort())
    expect(renderDocument(template, S, 'en').issues).toEqual([])
  })

  it('is the only way to get the specimen: a half-filled form gets nothing it did not type', () => {
    // This is what the engine used to do silently, per field. A form with one
    // field edited produced a complete document signed by the specimen's
    // "(A.B.C.)" with the specimen telephone number, and reported no issue —
    // which is precisely the failure the checklist exists to prevent.
    const partial = renderDocument(template, { subject: 'Something real' }, 'en')

    expect(partial.document.subject).toBe('Subject: Something real')
    expect(partial.document.blocks.find((block) => block.role === 'fileNumber')?.lines).toEqual(['No.'])
    expect(partial.issues.map((issue) => issue.field).sort()).toEqual(['date', 'fileNumber', 'paras'])
  })
})

describe('renderBilingual', () => {
  it('returns both documents and pairs the blocks in layout order', () => {
    const result = render(template, S, 'bilingual')
    expect(result.pairs.map((pair) => pair.role)).toEqual(['fileNumber', 'dateLine', 'subject', 'body'])
    expect(result.pairs[0]?.en.lines[0]).toBe('No. A-1/2026')
    expect(result.pairs[0]?.hi.lines[0]).toBe('संख्या ए-1/2026')
  })

  it('pairs a block that only one language dropped with an empty counterpart', () => {
    const oneSided = fixtureTemplate({
      layout: {
        en: template.layout.en,
        hi: template.layout.hi.map((block) =>
          block.role === 'subject' ? { ...block, lines: ['विषय : स्थिर'], omitWhenEmpty: false } : block,
        ),
      },
    })
    const result = renderBilingual(oneSided, { ...S, subject: '' })
    const subject = result.pairs.find((pair) => pair.role === 'subject')
    expect(subject?.en.lines).toEqual([])
    expect(subject?.hi.lines).toEqual(['विषय : स्थिर'])
    // Nothing below it shifted.
    expect(result.pairs.map((pair) => pair.role)).toEqual(['fileNumber', 'dateLine', 'subject', 'body'])
  })

  it('pairs by layout position, not by role, so a repeated role keeps its place', () => {
    // A demi-official letter has two `header` blocks — the writer's letterhead
    // and the Government of India block — with the D.O. number between them.
    // Pairing by role put both headers at the position of the first.
    const twoHeaders = fixtureTemplate({
      layout: {
        en: [
          { role: 'header', lines: ['Letterhead'] },
          { role: 'fileNumber', lines: ['D.O. No. {{fileNumber}}'] },
          { role: 'header', lines: ['Government of India'] },
        ],
        hi: [
          { role: 'header', lines: ['पत्रशीर्ष'] },
          { role: 'fileNumber', lines: ['अ.स. संख्या {{fileNumber}}'] },
          { role: 'header', lines: ['भारत सरकार'] },
        ],
      },
    })

    const { pairs } = renderBilingual(twoHeaders, sampleValues(twoHeaders))
    expect(pairs.map((pair) => pair.role)).toEqual(['header', 'fileNumber', 'header'])
    expect(pairs.map((pair) => pair.layoutIndex)).toEqual([0, 1, 2])
    expect(pairs.map((pair) => pair.en.lines[0])).toEqual([
      'Letterhead',
      'D.O. No. A-1/2026',
      'Government of India',
    ])
    expect(pairs[2]?.hi.lines[0]).toBe('भारत सरकार')
  })

  it('tags each issue with the language it came from', () => {
    const result = renderBilingual(template, { ...S, date: 'someday' })
    expect(result.issues.map((issue) => issue.lang)).toEqual(['en', 'hi'])
  })
})

describe('serialise', () => {
  it('aligns with spaces and leaves no trailing whitespace', () => {
    const text = serialise(renderDocument(template, S, 'en').document, { width: 40 })
    expect(text).toBe(
      [
        'No. A-1/2026',
        '',
        '               New Delhi, the 28.08.2026',
        '',
        'Subject: Testing',
        '',
        'First.',
        '2. Second.',
        '3. Third.',
        '',
      ].join('\n'),
    )
    expect(text).not.toMatch(/[ \t]+\n/)
  })

  it('wraps a long left-aligned line and hangs the continuation under the number', () => {
    const long = fixtureTemplate({
      layout: {
        ...template.layout,
        en: [{ role: 'body', source: 'paras', numbered: true }],
      },
    })
    const text = serialise(
      renderDocument(long, { ...S, paras: ['short', 'a b c d e f g h i j k l m n o p'] }, 'en').document,
      { width: 20 },
    )
    expect(text.split('\n')).toEqual(['short', '2. a b c d e f g h i', '   j k l m n o p', ''])
  })

  it('does not wrap a right-aligned block, which would break the column', () => {
    const right = fixtureTemplate({
      layout: { ...template.layout, en: [{ role: 'signature', align: 'right', lines: ['{{subject}}'] }] },
    })
    const text = serialise(renderDocument(right, { ...S, subject: 'a'.repeat(30) }, 'en').document, {
      width: 10,
    })
    expect(text).toBe(`${'a'.repeat(30)}\n`)
  })

  it('upper-cases a title block, which is how the specimens print it', () => {
    const titled = fixtureTemplate({
      layout: {
        ...template.layout,
        en: [{ role: 'title', align: 'center', emphasis: 'title', lines: ['Office Memorandum'] }],
      },
    })
    expect(serialise(renderDocument(titled, S, 'en').document, { width: 30 })).toBe(
      '      OFFICE MEMORANDUM\n',
    )
  })
})
