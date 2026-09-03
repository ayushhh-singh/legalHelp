import { describe, expect, it } from 'vitest'

import { cleanPastedHtml, cleanPastedText, normaliseBody, normaliseText } from './paste'
import { bodySchema } from './model'

/** What a word processor puts on the clipboard, cleaned. */

describe('normaliseText', () => {
  it('normalises Devanagari to NFC', () => {
    // The same word composed and decomposed is the same word and a different
    // string, and every comparison in this app is a string comparison — the
    // search index, the checklist regexes, find-and-replace.
    const decomposed = 'क' + 'ि'
    expect(normaliseText(decomposed)).toBe(decomposed.normalize('NFC'))
    expect(normaliseText('क्ष').normalize('NFD')).toBe('क्ष'.normalize('NFD'))
  })

  it('straightens the quotes Word makes as you type', () => {
    expect(normaliseText('“quoted” and ‘single’ and…')).toBe('"quoted" and \'single\' and...')
  })

  it('turns a non-breaking space into a space', () => {
    // Invisible, not matched by `\s` in some engines, and what makes an exact
    // search for "Under Secretary" fail on a document that contains it.
    expect(normaliseText('Under Secretary')).toBe('Under Secretary')
  })

  it('removes the zero-width space and the byte-order mark', () => {
    expect(normaliseText('﻿A​B')).toBe('AB')
  })

  it('keeps the zero-width JOINER and NON-joiner, which mean something in Devanagari', () => {
    // ZWNJ is what keeps a conjunct from forming; removing it turns `क्‌ष` into
    // `क्ष`, which is a different spelling. This is the "tidy up the invisible
    // characters" rule that quietly damages one script and not the other.
    const withZwnj = 'क्‌ष'
    expect(normaliseText(withZwnj)).toBe(withZwnj)
    expect(normaliseText('क‍ष')).toBe('क‍ष')
  })

  it('still removes the invisible space when the typography is declined', () => {
    expect(normaliseText('“quoted” x', { straightQuotes: false })).toBe('“quoted” x')
  })

  it('converts digits only when asked, and the default is to leave them alone', () => {
    // A file number is `A-11011/2/2026` in both issues of a bilingual document,
    // and converting it would make the document wrong.
    expect(normaliseText('A-11011/2/2026')).toBe('A-11011/2/2026')
    expect(normaliseText('2026', { digits: 'devanagari' })).toBe('२०२६')
    expect(normaliseText('२०२६', { digits: 'ascii' })).toBe('2026')
  })

  it('strips trailing spaces at the end of a line', () => {
    expect(normaliseText('one   \ntwo\t\n')).toBe('one\ntwo\n')
  })

  it('drops a literal bullet glyph left at the start of a line', () => {
    expect(normaliseText('• An item')).toBe('An item')
  })
})

describe('normaliseBody', () => {
  it('reaches every text node, however deep', () => {
    const body = normaliseBody({
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableCell',
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a b' }] }],
                },
              ],
            },
          ],
        },
      ],
    })
    expect(JSON.stringify(body)).toContain('a b')
    expect(bodySchema.safeParse(body).success).toBe(true)
  })
})

describe('cleanPastedHtml', () => {
  it('keeps the structure and throws away the appearance', () => {
    const word =
      '<p class="MsoNormal" style="font-family:Calibri;color:#1F497D;font-size:11pt">' +
      '<span style="font-weight:bold">Subject</span>: a paste from Word</p>'
    const { body } = cleanPastedHtml(word)
    expect(body.content[0]?.type).toBe('paragraph')
    expect(body.content[0]?.content?.[0]?.marks?.[0]?.type).toBe('bold')
    expect(JSON.stringify(body)).not.toContain('Calibri')
    expect(JSON.stringify(body)).not.toContain('1F497D')
  })

  it('does NOT renumber a pasted fragment', () => {
    // A whole imported document is one this app takes the numbering of. A paste
    // is three sub-paragraphs copied out of a rule book, and they should read as
    // they did rather than be renumbered from wherever the caret was.
    expect(cleanPastedHtml('<p>2. A numbered paragraph.</p>').body.content[0]?.type).toBe('paragraph')
  })

  it('survives the conditional-comment noise a Word paste carries', () => {
    const { body } = cleanPastedHtml('<!--[if gte mso 9]><xml><w:WordDocument/></xml><![endif]--><p>Kept</p>')
    expect(body.content).toHaveLength(1)
  })
})

describe('cleanPastedText', () => {
  it('treats a blank line as a paragraph break and a single newline as a wrap', () => {
    const { body } = cleanPastedText('One line\nwrapped here.\n\nA second paragraph.')
    expect(body.content).toHaveLength(2)
    expect(body.content[0]?.content?.[0]?.text).toBe('One line wrapped here.')
  })

  it('gives every line its own paragraph when there is no blank line anywhere', () => {
    // A list of addressees pasted from a spreadsheet is not one paragraph.
    expect(
      cleanPastedText('The Under Secretary\nDepartment of Expenditure\nNew Delhi').body.content,
    ).toHaveLength(3)
  })

  it('gives an empty paste a body with a caret in it', () => {
    expect(cleanPastedText('   ').body.content).toEqual([{ type: 'paragraph' }])
  })
})
