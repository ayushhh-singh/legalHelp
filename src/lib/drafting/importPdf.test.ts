import { describe, expect, it } from 'vitest'

import {
  devanagariQuality,
  findGutter,
  linesOf,
  paragraphsOf,
  reconstructPdf,
  type PdfPageText,
  type PdfTextItem,
} from './importPdf'

/**
 * Putting a document back together from where its ink landed.
 *
 * These test the PURE layer — text runs with coordinates in, paragraphs out —
 * which is the whole of the reasoning. `tests/drafting-io.test.ts` drives the
 * same code from a real `.pdf` through pdf.js; this file is where each
 * heuristic is pinned down one at a time, because a failure in a full-pipeline
 * test tells you a document came out wrong and not which rule was responsible.
 *
 * Coordinates are PDF user space: the origin is the BOTTOM left, so a larger
 * `y` is higher up the page.
 */

const item = (text: string, x: number, y: number, width = text.length * 5, height = 11): PdfTextItem => ({
  text,
  x,
  y,
  width,
  height,
})

const page = (items: PdfTextItem[], width = 595, height = 842): PdfPageText => ({ width, height, items })

describe('linesOf', () => {
  it('groups runs onto lines by baseline and orders them left to right', () => {
    const lines = linesOf(page([item('world', 100, 700), item('Hello', 60, 700), item('Next', 60, 685)]))
    expect(lines.map((line) => line.text)).toEqual(['Hello world', 'Next'])
  })

  it('keeps a superscript on the line it belongs to', () => {
    // A footnote mark sits a few points above the baseline. A strict equality
    // test would give it a line of its own.
    const lines = linesOf(page([item('rule 3', 60, 700), item('1', 95, 704, 3, 7)]))
    expect(lines).toHaveLength(1)
  })

  it('does not put a space inside a word split across two runs', () => {
    // A PDF splits a word between runs for a kerning pair. Joining
    // unconditionally gives "Govern ment".
    const lines = linesOf(page([item('Govern', 60, 700, 30), item('ment', 90, 700, 20)]))
    expect(lines[0]?.text).toBe('Government')
  })

  it('inserts a space where there is a real gap', () => {
    const lines = linesOf(page([item('No.', 60, 700, 15), item('A-11011', 100, 700, 40)]))
    expect(lines[0]?.text).toBe('No. A-11011')
  })

  it('ignores empty runs', () => {
    expect(linesOf(page([item('', 60, 700, 0), item('Text', 70, 700)]))).toHaveLength(1)
  })
})

describe('paragraphsOf', () => {
  const from = (lines: { text: string; y: number; x?: number }[]) =>
    paragraphsOf(
      lines.map((line) => ({
        y: line.y,
        x: line.x ?? 60,
        right: (line.x ?? 60) + line.text.length * 5,
        height: 11,
        text: line.text,
      })),
    )

  it('joins a line that ends without punctuation to the next — the rule the brief names', () => {
    expect(
      from([
        { text: 'The undersigned is directed to refer to the Department of', y: 700 },
        { text: 'Expenditure Office Memorandum on the subject cited above.', y: 685 },
      ]),
    ).toEqual([
      'The undersigned is directed to refer to the Department of Expenditure Office Memorandum on the subject cited above.',
    ])
  })

  it('starts a new paragraph at a numbered one, even mid-sentence above it', () => {
    expect(
      from([
        { text: 'a line that runs on and', y: 700 },
        { text: '2. A numbered paragraph.', y: 685 },
      ]),
    ).toEqual(['a line that runs on and', '2. A numbered paragraph.'])
  })

  it('starts a new paragraph at a clause marker and at a bullet', () => {
    expect(
      from([
        { text: 'lead in', y: 700 },
        { text: '(a) a clause', y: 685 },
      ]),
    ).toHaveLength(2)
    expect(
      from([
        { text: 'lead in', y: 700 },
        { text: '• a bullet', y: 685 },
      ]),
    ).toHaveLength(2)
  })

  it('breaks on a vertical gap noticeably larger than the page line spacing', () => {
    expect(
      from([
        { text: 'One line.', y: 700 },
        { text: 'Two lines.', y: 685 },
        { text: 'After a blank line.', y: 640 },
      ]),
    ).toHaveLength(2)
  })

  it('joins a hyphenated word across a line break without a space', () => {
    expect(
      from([
        { text: 'reimburse-', y: 700 },
        { text: 'ment of the allowance', y: 685 },
      ]),
    ).toEqual(['reimbursement of the allowance'])
  })

  it('breaks at an indent when the line above ended a sentence', () => {
    expect(
      from([
        { text: 'A finished sentence.', y: 700 },
        { text: 'An indented new paragraph.', y: 685, x: 90 },
      ]),
    ).toHaveLength(2)
  })

  it('is empty for no lines', () => {
    expect(paragraphsOf([])).toEqual([])
  })

  it('never drops a line', () => {
    const lines = [
      { text: 'One', y: 700 },
      { text: 'Two', y: 685 },
      { text: '2. Three', y: 660 },
      { text: 'four', y: 645 },
    ]
    const joined = from(lines).join(' ')
    for (const line of lines) expect(joined, line.text).toContain(line.text.replace('2. ', ''))
  })
})

describe('findGutter', () => {
  const twoColumn = () =>
    page(
      Array.from({ length: 6 }, (_unused, index) => [
        item('left column text here', 60, 780 - index * 15, 200),
        item('right column text here', 330, 780 - index * 15, 200),
      ]).flat(),
    )

  it('finds the gutter on a two-column page', () => {
    const found = findGutter(twoColumn(), twoColumn().items)
    expect(found).not.toBeNull()
    expect(found).toBeGreaterThan(260)
    expect(found).toBeLessThan(330)
  })

  it('finds none on an ordinary letter', () => {
    const single = page(
      Array.from({ length: 10 }, (_unused, index) =>
        item('a full width line of an ordinary letter', 60, 780 - index * 15, 460),
      ),
    )
    expect(findGutter(single, single.items)).toBeNull()
  })

  it('finds none on a page with too little on it to tell', () => {
    const sparse = page([item('one', 60, 700, 20), item('two', 330, 700, 20)])
    expect(findGutter(sparse, sparse.items)).toBeNull()
  })

  it('is not defeated by a heading that spans both columns', () => {
    // A start-position histogram calls this page one column, because the
    // heading starts to the left of the gutter. And a strict "nothing crosses"
    // test refuses it too, because the heading does cross — which would give up
    // on most real two-column documents, since most of them have a title.
    const withHeading = page([
      item('A HEADING ACROSS THE PAGE', 60, 800, 460),
      ...Array.from({ length: 6 }, (_unused, index) => [
        item('left column text here', 60, 760 - index * 15, 200),
        item('right column text here', 330, 760 - index * 15, 200),
      ]).flat(),
    ])
    expect(findGutter(withHeading, withHeading.items)).not.toBeNull()
  })

  it('refuses a page where too much crosses the band to be a gutter', () => {
    const mostly = page([
      ...Array.from({ length: 5 }, (_unused, index) => item('a wide line', 60, 780 - index * 15, 460)),
      ...Array.from({ length: 5 }, (_unused, index) => item('narrow', 60, 700 - index * 15, 100)),
      ...Array.from({ length: 5 }, (_unused, index) => item('narrow', 330, 700 - index * 15, 100)),
    ])
    expect(findGutter(mostly, mostly.items)).toBeNull()
  })
})

describe('devanagariQuality', () => {
  it('reports clean Hindi as trustworthy', () => {
    const quality = devanagariQuality('भारत सरकार कार्मिक और प्रशिक्षण विभाग')
    expect(quality.ratio).toBeGreaterThan(0.9)
    expect(quality.suspicious).toBe(false)
  })

  it('reports an ordinary English document as trustworthy', () => {
    expect(devanagariQuality('Government of India, Ministry of Finance.').suspicious).toBe(false)
  })

  it('catches a legacy-font text layer by the blocks it lands in', () => {
    // DoPT's RTI Act maps Devanagari onto Vedic and Ol Chiki code points —
    // `ᳰकसी` for `किसी` — which is exactly what this is looking for (ADR-023).
    const quality = devanagariQuality('ᳰकसी ᱰयᳰि को ᳰकसी ᮧकार')
    expect(quality.strayRatio).toBeGreaterThan(0.02)
    expect(quality.suspicious).toBe(true)
  })

  it('catches a private-use-area font, which is the other legacy shape', () => {
    expect(devanagariQuality('  some text').suspicious).toBe(true)
  })

  it('says nothing about a document with no letters in it', () => {
    expect(devanagariQuality('123 456 ...')).toEqual({ ratio: 0, strayRatio: 0, suspicious: false })
  })

  it('never re-encodes anything — it only reports', () => {
    // The whole point: the ambiguity is real and no substitution table reverses
    // it, so the officer is told and offered the paste box (ADR-023).
    const text = 'ᳰकसी'
    devanagariQuality(text)
    expect(text).toBe('ᳰकसी')
  })
})

describe('reconstructPdf', () => {
  it('turns a one-column page into paragraphs and numbers what is numbered', () => {
    const result = reconstructPdf([
      page([
        item('The undersigned is directed to refer to the', 60, 700, 300),
        item('Office Memorandum cited above.', 60, 685, 300),
        item('2. The matter has been examined.', 60, 650, 300),
      ]),
    ])
    expect(result.columns).toEqual([1])
    expect(result.body.content?.map((node) => node.type)).toEqual(['paragraph', 'numberedPara'])
    expect(result.body.content?.[1]?.content?.[0]?.text).toBe('The matter has been examined.')
    expect(result.notices.find((notice) => notice.code === 'numbered-paras')?.count).toBe(1)
  })

  it('reads a two-column page column-wise and says it did', () => {
    const result = reconstructPdf([
      page(
        Array.from({ length: 6 }, (_unused, index) => [
          item(`left ${index}.`, 60, 780 - index * 15, 200),
          item(`right ${index}.`, 330, 780 - index * 15, 200),
        ]).flat(),
      ),
    ])
    expect(result.columns).toEqual([2])
    expect(result.notices.find((notice) => notice.code === 'columns')?.count).toBe(1)
    const text = result.text
    expect(text.indexOf('left 5')).toBeLessThan(text.indexOf('right 0'))
  })

  it('emits no page break between pages', () => {
    // A PDF's page breaks are where the ORIGINAL's type fell. This document is
    // about to be re-typeset at CSMOP margins in a different face.
    const result = reconstructPdf([page([item('Page one.', 60, 700)]), page([item('Page two.', 60, 700)])])
    expect(result.body.content?.map((node) => node.type)).toEqual(['paragraph', 'paragraph'])
  })

  it('gives a body with a caret in it for a page with nothing on it', () => {
    const result = reconstructPdf([page([])])
    expect(result.text).toBe('')
    expect(result.body.content).toEqual([{ type: 'paragraph' }])
  })

  it('carries the Devanagari verdict out to the caller', () => {
    expect(reconstructPdf([page([item('ᳰकसी ᱰयᳰि को ᳰकसी', 60, 700)])]).quality.suspicious).toBe(true)
  })
})
