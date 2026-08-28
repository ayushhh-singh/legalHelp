import { describe, expect, it } from 'vitest'

import { fixtureTemplate } from '@/test/drafting-fixture'

import { render, renderBilingual, renderDocument, serialise } from './engine'

const template = fixtureTemplate()

const textOf = (result: ReturnType<typeof renderDocument>, role: string) =>
  result.document.blocks
    .filter((block) => block.role === role)
    .flatMap((block) => block.lines)
    .join('\n')

describe('renderDocument', () => {
  it('falls back to the sample values, so a template always renders', () => {
    const result = renderDocument(template, {}, 'en')
    expect(result.issues).toEqual([])
    expect(textOf(result, 'fileNumber')).toBe('No. A-1/2026')
    expect(result.document.subject).toBe('Subject: Testing')
  })

  it('numbers paragraphs from 2, leaving the first unnumbered', () => {
    const result = renderDocument(template, {}, 'en')
    expect(result.document.paras).toEqual(['First.', '2. Second.', '3. Third.'])
  })

  it('numbers every paragraph when the block says numberFrom 1', () => {
    const noting = fixtureTemplate({
      layout: {
        ...template.layout,
        en: template.layout.en.map((block) => (block.role === 'body' ? { ...block, numberFrom: 1 } : block)),
      },
    })
    expect(renderDocument(noting, {}, 'en').document.paras).toEqual(['1. First.', '2. Second.', '3. Third.'])
  })

  it('normalises a date however it was typed, and reports one that is not a date', () => {
    expect(renderDocument(template, { date: '8.8.2026' }, 'en').document.blocks[1]?.lines[0]).toBe(
      'New Delhi, the 08.08.2026',
    )

    const bad = renderDocument(template, { date: '31.02.2026' }, 'en')
    expect(bad.issues).toHaveLength(1)
    expect(bad.issues[0]?.code).toBe('date-format')
    expect(bad.issues[0]?.field).toBe('date')
  })

  it('switches Hindi numerals only when the toggle is on', () => {
    const plain = renderDocument(template, {}, 'hi')
    const devanagari = renderDocument(template, {}, 'hi', { devanagariDigits: true })
    expect(textOf(plain, 'dateLine')).toBe('नई दिल्ली, दिनांक 28.08.2026')
    expect(textOf(devanagari, 'dateLine')).toBe('नई दिल्ली, दिनांक २८.०८.२०२६')
    expect(devanagari.document.paras[1]).toBe('२. दूसरा।')
    // English is never re-scripted, whatever the toggle says.
    expect(renderDocument(template, {}, 'en', { devanagariDigits: true }).document.paras[1]).toBe(
      '2. Second.',
    )
  })

  it('renders a select as its label, and "none" as nothing at all', () => {
    expect(renderDocument(template, { urgency: 'immediate' }, 'en').document.urgency).toBe('IMMEDIATE')
    expect(renderDocument(template, { urgency: 'immediate' }, 'hi').document.urgency).toBe('तत्काल')
    // "none" means no grading: the block drops out rather than printing "None".
    expect(renderDocument(template, { urgency: 'none' }, 'en').document.urgency).toBeNull()
  })

  it('reports a select value that is not one of the choices', () => {
    const result = renderDocument(template, { urgency: 'very urgent indeed' }, 'en')
    expect(result.issues.map((issue) => issue.code)).toEqual(['unknown-option'])
  })

  it('drops an omitWhenEmpty block and keeps a required one that is empty', () => {
    const result = renderDocument(template, { subject: '', fileNumber: '' }, 'en')
    expect(result.document.subject).toBeNull()
    // fileNumber is required: the line stays so the omission is visible, and
    // the issue list carries the complaint.
    expect(result.issues.map((issue) => issue.field)).toContain('fileNumber')
    expect(textOf(result, 'fileNumber')).toBe('No.')
  })

  it('appends the enclosure line with a count, and only when there are enclosures', () => {
    expect(renderDocument(template, {}, 'en').document.enclosures).toEqual([])

    const withEncl = renderDocument(template, { enclosures: ['One order', 'One statement'] }, 'en')
    expect(withEncl.document.enclosures).toEqual([
      'List of enclosures:',
      '1. One order',
      '2. One statement',
      'Encl.: as above (2)',
    ])
    expect(renderDocument(template, { enclosures: ['एक आदेश'] }, 'hi').document.enclosures).toContain(
      'संलग्नक : उपर्युक्तानुसार (1)',
    )
  })

  it('accepts a multiline string where a list is wanted', () => {
    const result = renderDocument(template, { enclosures: 'One\n\nTwo\n' }, 'en')
    expect(result.document.enclosures.slice(1, 3)).toEqual(['1. One', '2. Two'])
  })

  it('leaves an unknown placeholder visible and reports it', () => {
    const broken = fixtureTemplate({
      layout: {
        ...template.layout,
        en: [{ role: 'footer', lines: ['Signed by {{whoever}}'] }, ...template.layout.en],
      },
    })
    const result = renderDocument(broken, {}, 'en')
    expect(result.document.blocks[0]?.lines[0]).toBe('Signed by {{whoever}}')
    expect(result.issues.map((issue) => issue.code)).toContain('unknown-field')
  })

  it('takes a per-language value, and falls back to the other language rather than showing nothing', () => {
    const both = renderDocument(template, { subject: { en: 'Leave', hi: 'अवकाश' } }, 'hi')
    expect(both.document.subject).toBe('विषय : अवकाश')

    const englishOnly = renderDocument(template, { subject: { en: 'Leave' } }, 'hi')
    expect(englishOnly.document.subject).toBe('विषय : Leave')
  })
})

describe('renderBilingual', () => {
  it('returns both documents and pairs the blocks in layout order', () => {
    const result = render(template, {}, 'bilingual')
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
    const result = renderBilingual(oneSided, { subject: '' })
    const subject = result.pairs.find((pair) => pair.role === 'subject')
    expect(subject?.en.lines).toEqual([])
    expect(subject?.hi.lines).toEqual(['विषय : स्थिर'])
    // Nothing below it shifted.
    expect(result.pairs.map((pair) => pair.role)).toEqual(['fileNumber', 'dateLine', 'subject', 'body'])
  })

  it('tags each issue with the language it came from', () => {
    const result = renderBilingual(template, { date: 'someday' })
    expect(result.issues.map((issue) => issue.lang)).toEqual(['en', 'hi'])
  })
})

describe('serialise', () => {
  it('aligns with spaces and leaves no trailing whitespace', () => {
    const text = serialise(renderDocument(template, {}, 'en').document, { width: 40 })
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
      renderDocument(long, { paras: ['short', 'a b c d e f g h i j k l m n o p'] }, 'en').document,
      { width: 20 },
    )
    expect(text.split('\n')).toEqual(['short', '2. a b c d e f g h i', '   j k l m n o p', ''])
  })

  it('does not wrap a right-aligned block, which would break the column', () => {
    const right = fixtureTemplate({
      layout: { ...template.layout, en: [{ role: 'signature', align: 'right', lines: ['{{subject}}'] }] },
    })
    const text = serialise(renderDocument(right, { subject: 'a'.repeat(30) }, 'en').document, { width: 10 })
    expect(text).toBe(`${'a'.repeat(30)}\n`)
  })

  it('upper-cases a title block, which is how the specimens print it', () => {
    const titled = fixtureTemplate({
      layout: {
        ...template.layout,
        en: [{ role: 'title', align: 'center', emphasis: 'title', lines: ['Office Memorandum'] }],
      },
    })
    expect(serialise(renderDocument(titled, {}, 'en').document, { width: 30 })).toBe(
      '      OFFICE MEMORANDUM\n',
    )
  })
})
