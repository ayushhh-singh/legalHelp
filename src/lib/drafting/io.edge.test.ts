import { Packer } from 'docx'
import { describe, expect, it } from 'vitest'

import { buildDocxDocument, sanitiseForDocx } from './docx'
import { extractMeta } from './extract'
import { headerFooterLines, isPageField } from './importDocx'
import { defaultPageSetup, pageRuleCss } from './print'
import { readZip, textPart } from './zip'
import type { DocumentModel, RenderedNode } from './types'

/**
 * The edge-case pass over Session 30's pure layer.
 *
 * Every test here was confirmed to FAIL against the committed code before its
 * fix was written — the rule this repository has followed since ADR-025's
 * addendum, and the only thing that distinguishes a regression test from a
 * description of what the code already does.
 *
 * The pattern this pass found is not the one the last several found. There is
 * no model here; the untrusted input is a FILE, and that half was guarded from
 * the start — a wrong extension, a `.doc` in disguise, a scan, an over-cap
 * file, an encrypted PDF and a garbled text layer all have their own refusal.
 * What failed is the half that CONVERTS: an off-by-one in a level, a control
 * that could not reach the thing it was labelled for, and a strip list that
 * took three characters out of a Government document nobody meant to lose.
 */

const model = (nodes: RenderedNode[]): DocumentModel => ({
  templateId: 'office-memorandum',
  lang: 'en',
  urgency: null,
  header: [],
  title: null,
  refLine: null,
  subject: null,
  paras: [],
  closing: null,
  signature: [],
  enclosures: [],
  copyTo: [],
  blocks: [
    { role: 'body', layoutIndex: 0, align: 'left', emphasis: 'normal', lines: [], nodes, filled: true },
  ],
})

const documentXml = async (document: ReturnType<typeof buildDocxDocument>): Promise<string> => {
  const parts = await readZip(new Uint8Array(await (await Packer.toBlob(document)).arrayBuffer()))
  return textPart(parts, 'word/document.xml') ?? ''
}

describe('the Word numbering level', () => {
  it('puts a top-level paragraph at level 0, not level 1', async () => {
    /*
      `'2. '.split('.')` is `['2', ' ']` — length TWO, because the marker ends
      in a full stop and a space. So `length - 1` made every ordinary numbered
      paragraph level 1 and every sub-paragraph level 2, one deeper than it is.

      Nothing throws and the numbers still appear: Word draws level 1 with the
      `%1.%2` format at a 425-twip indent, so an O.M. whose paragraphs should
      read `2.` `3.` `4.` down the left margin opens indented and numbered
      `2.1` `2.2` `2.3`. The test that shipped asserted `<w:numPr>` was present
      and the marker text was gone; both were true of the broken version.
    */
    const xml = await documentXml(
      buildDocxDocument([
        model([
          { kind: 'para', marker: '2. ', align: 'left', runs: [{ text: 'First.' }] },
          { kind: 'para', marker: '2.1. ', align: 'left', runs: [{ text: 'A sub-paragraph.' }] },
          { kind: 'para', marker: '2.1.1. ', align: 'left', runs: [{ text: 'Deeper still.' }] },
        ]),
      ]),
    )
    expect([...xml.matchAll(/<w:ilvl w:val="(\d)"\/>/g)].map((match) => match[1])).toEqual(['0', '1', '2'])
  })

  it('reads a Devanagari marker to the same depth', async () => {
    // The English half working is not evidence — the rule this project has
    // recorded three times now (ADR-035, ADR-038, ADR-039).
    const xml = await documentXml(
      buildDocxDocument([
        model([
          { kind: 'para', marker: '२. ', align: 'left', runs: [{ text: 'पहला।' }] },
          { kind: 'para', marker: '२.१. ', align: 'left', runs: [{ text: 'उप-अनुच्छेद।' }] },
        ]),
      ]),
    )
    expect([...xml.matchAll(/<w:ilvl w:val="(\d)"\/>/g)].map((match) => match[1])).toEqual(['0', '1'])
  })

  it('never asks Word for a level it did not define', async () => {
    // Three levels are configured. A marker with four groups must clamp rather
    // than reference a level that does not exist, which Word opens as unnumbered.
    const xml = await documentXml(
      buildDocxDocument([
        model([{ kind: 'para', marker: '1.2.3.4. ', align: 'left', runs: [{ text: 'Deep.' }] }]),
      ]),
    )
    expect([...xml.matchAll(/<w:ilvl w:val="(\d)"\/>/g)].map((match) => match[1])).toEqual(['2'])
  })
})

describe('what is stripped on the way into a .docx', () => {
  it('keeps the copyright, registered and trademark signs', () => {
    /*
      `\p{Extended_Pictographic}` includes U+00A9, U+00AE and U+2122 — they are
      emoji by default presentation rules and they are also ordinary characters
      a Government document uses. The first version removed all three silently,
      so a footer reading `© 2026 Government of India` exported as
      ` 2026 Government of India`.

      `\p{Emoji_Presentation}` is the property that means "renders as an emoji
      unless told otherwise", and none of these three has it.
    */
    expect(sanitiseForDocx('© 2026 Government of India').text).toBe('© 2026 Government of India')
    expect(sanitiseForDocx('BharatNet®').text).toBe('BharatNet®')
    expect(sanitiseForDocx('Kanthasth™').text).toBe('Kanthasth™')
    expect(sanitiseForDocx('© ® ™').pictographs).toBe(0)
  })

  it('still strips what Word prints as a black box on an office laser', () => {
    expect(sanitiseForDocx('Approved 👍 today').text).toBe('Approved  today')
    expect(sanitiseForDocx('Approved 👍🏽 today').pictographs).toBeGreaterThan(0)
    expect(sanitiseForDocx('Done ✅').text.trim()).toBe('Done')
  })

  it('strips the variation selector that forces emoji presentation on a text character', () => {
    // `✓` is text by default and stays; `✓️` (with U+FE0F) is the emoji form,
    // and taking the selector away leaves the character rather than a hole.
    expect(sanitiseForDocx('Yes ✓').text).toBe('Yes ✓')
    expect(sanitiseForDocx('Yes ✓️').text).toBe('Yes ✓')
  })

  it('leaves every Devanagari mark alone', () => {
    const text = 'कार्यालय ज्ञापन — क्ष त्र ज्ञ ॐ ।'
    expect(sanitiseForDocx(text).text).toBe(text)
    expect(sanitiseForDocx(text).pictographs).toBe(0)
  })
})

describe('the subject, when nothing separates it from the body', () => {
  const withSubject = (...after: string[]) =>
    extractMeta(
      [
        'No. A-11011/2/2026-Estt.',
        'Dated: 03.09.2026',
        'Subject: Grant of Children Education Allowance.',
        ...after,
      ].join('\n'),
    ).subject

  it('stops at the end of the subject sentence', () => {
    /*
      The continuation loop stopped when a line ENDED in a full stop, and never
      looked at whether the FIRST line already had. A reconstructed PDF has no
      blank line between the subject and the body — `reconstructPdf` joins
      paragraphs with a single newline — so the whole opening paragraph was
      appended to the subject and put into the document's title and `meta`.
    */
    expect(withSubject('The undersigned is directed to refer to the Office Memorandum.')).toBe(
      'Grant of Children Education Allowance',
    )
  })

  it('still reads a subject that genuinely runs onto a second line', () => {
    /*
      The real shape, taken from `tests/fixtures/drafting/om.docx`: a subject
      that wraps does NOT carry a full stop halfway through it. The first
      version of this test invented one and asserted that the continuation was
      taken anyway, which would have made the fix impossible — a fixture that
      encodes a wrong expectation is worse than a missing one, because the next
      person changes the code to satisfy it (ADR-040).
    */
    expect(
      extractMeta(
        [
          'Subject: Grant of Children Education Allowance in respect of a child studying',
          'in a recognised institution — clarification regarding.',
          'Sir,',
        ].join('\n'),
      ).subject,
    ).toBe(
      'Grant of Children Education Allowance in respect of a child studying in a recognised institution — clarification regarding',
    )
  })

  it('stops on a Hindi danda as well as a full stop', () => {
    expect(
      extractMeta(
        [
          'विषय: बाल शिक्षा भत्ता की प्रतिपूर्ति के संबंध में।',
          'अधोहस्ताक्षरी को यह कहने का निदेश हुआ है।',
        ].join('\n'),
      ).subject,
    ).toBe('बाल शिक्षा भत्ता की प्रतिपूर्ति के संबंध में')
  })
})

describe('the generated @page rule', () => {
  it('names the preview sheet as well as the print root', () => {
    /*
      `A4Preview` renders `.a4-print-root`, and `src/styles/index.css` sets
      `page: draft-a4` on it — a fixed A4 at 25.4mm. The print route wraps that
      element in `.draft-print-root`, so the generated rule was on the ANCESTOR
      and the inner named page won for everything inside it.

      The paper control therefore changed the stylesheet and could not change
      the page: choosing Letter produced a rule nothing applied. The e2e test
      that shipped asserted the CSS TEXT changed, which was true and proved
      nothing — a proxy for the assertion it meant to make.
    */
    const css = pageRuleCss(defaultPageSetup('Letter'))
    expect(css).toContain('.draft-print-root .a4-print-root')
    expect(css).toContain('size: 215.9mm 279.4mm;')
  })

  it("scopes the override to the print route and leaves the editor's preview alone", () => {
    // `.a4-print-root` on its own — the editor's preview — must keep printing
    // against `draft-a4`, or asking for Letter here would change the pay slip's
    // neighbour two modules away.
    expect(pageRuleCss(defaultPageSetup('A4'))).not.toMatch(/^\s*\.a4-print-root/m)
  })
})

describe('what a footer line has to look like to be a page number', () => {
  const footer = (lines: string[]) =>
    new Map([
      [
        'word/footer1.xml',
        `<w:ftr>${lines.map((line) => `<w:p><w:r><w:t>${line}</w:t></w:r></w:p>`).join('')}</w:ftr>`,
      ],
    ])

  it('keeps a footer that is nothing but a telephone number', () => {
    /*
      The test was subtractive — take away the words a page number is made of
      and the digits, and if nothing is left, that is all it was. `011-23092345`
      subtracts to nothing too, so a letterhead footer holding only the office
      telephone was dropped as a `PAGE` field result and never offered.

      A line with no page WORD in it is a page number only if it is short.
    */
    expect(isPageField('011-23092345')).toBe(false)
    expect(headerFooterLines(footer(['011-23092345', 'Page 1 of 2'])).footer).toEqual(['011-23092345'])
  })

  it('still drops the field results a page number really produces', () => {
    expect(isPageField('Page 1 of 2')).toBe(true)
    expect(isPageField('1')).toBe(true)
    expect(isPageField('2 / 12')).toBe(true)
    expect(isPageField('पृष्ठ १ में से २')).toBe(true)
  })

  it('keeps a real letterhead line whatever is in it', () => {
    expect(isPageField('Government of India')).toBe(false)
    expect(isPageField('North Block, New Delhi - 110001')).toBe(false)
    expect(isPageField('कार्मिक एवं प्रशिक्षण विभाग')).toBe(false)
  })
})
