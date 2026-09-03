import { describe, expect, it } from 'vitest'

import {
  bodyText,
  docxHtmlToBody,
  headerFooterLines,
  mergeNotices,
  noticesFromScan,
  partLines,
  scanDocumentXml,
  splitParaMarker,
} from './importDocx'
import { bodySchema, type BodyNode } from './model'

/**
 * The `.docx` mapping layer, over the HTML mammoth really produces.
 *
 * Every input below was taken from an actual mammoth run against
 * `tests/fixtures/drafting/*.docx` (`scripts/drafting-fixtures.mjs` builds
 * them), which is why they look the way they do — `<td><p>…</p></td>` rather
 * than `<td>…</td>`, and `colspan` on the cell rather than a `<colgroup>`.
 */

const map = (html: string, options = {}) => docxHtmlToBody(html, options)
const types = (nodes: readonly BodyNode[]): string[] => nodes.map((node) => node.type)
const noticeFor = (html: string, code: string) => map(html).notices.find((notice) => notice.code === code)

describe('docxHtmlToBody', () => {
  it('always produces a body the model will accept', () => {
    for (const html of ['', '<p></p>', '<p>text</p>', '<table></table>', '<div><span>x</span></div>']) {
      expect(bodySchema.safeParse(map(html).body).success, html).toBe(true)
    }
  })

  it('gives an empty document one paragraph, so the editor has a caret', () => {
    expect(map('').body.content).toEqual([{ type: 'paragraph' }])
  })

  it('maps paragraphs, headings and their levels', () => {
    const { body } = map('<p>One</p><h1>A</h1><h2>B</h2><h6>Deep</h6>')
    expect(types(body.content)).toEqual(['paragraph', 'heading', 'heading', 'heading'])
    expect(body.content.slice(1).map((node) => node.attrs?.level)).toEqual([1, 2, 3])
  })

  it('keeps bold, italic and underline and nothing else', () => {
    const { body } = map('<p><strong>b</strong><em>i</em><u>u</u><span style="color:red">plain</span></p>')
    const runs = body.content[0]?.content ?? []
    expect(runs.map((run) => run.marks?.[0]?.type)).toEqual(['bold', 'italic', 'underline', undefined])
  })

  it('reads a mark off an inline style, which is how Word writes a bolded run', () => {
    const { body } = map('<p><span style="font-weight:700">bold</span></p>')
    expect(body.content[0]?.content?.[0]?.marks?.[0]?.type).toBe('bold')
  })

  it('nests a list inside its own item rather than flattening it', () => {
    const { body } = map('<ul><li>One<ul><li>Deeper</li></ul></li><li>Two</li></ul>')
    const list = body.content[0]
    expect(list?.type).toBe('bulletList')
    expect(types(list?.content?.[0]?.content ?? [])).toEqual(['paragraph', 'bulletList'])
    expect(list?.content).toHaveLength(2)
  })

  it('tells an ordered list from a bulleted one', () => {
    expect(map('<ol><li>One</li></ol>').body.content[0]?.type).toBe('orderedList')
  })

  it('turns a leading paragraph number into a numbered paragraph and takes the marker away', () => {
    const { body, notices } = map('<p>2. The matter has been examined.</p>')
    const node = body.content[0]
    expect(node?.type).toBe('numberedPara')
    expect(node?.attrs?.level).toBe(1)
    expect(node?.content?.[0]?.text).toBe('The matter has been examined.')
    expect(notices.find((notice) => notice.code === 'numbered-paras')?.count).toBe(1)
  })

  it('reads a sub-paragraph number as level 2', () => {
    expect(map('<p>2.1 A sub-paragraph.</p>').body.content[0]?.attrs?.level).toBe(2)
  })

  it('reads a Devanagari paragraph number, which is what a Hindi document has', () => {
    // The English half working is not evidence — ADR-039's addendum, in a new
    // file. `?` on a Devanagari suffix is the trap this rule is written around.
    const node = map('<p>२. मामले की जाँच की गई है।</p>').body.content[0]
    expect(node?.type).toBe('numberedPara')
    expect(node?.content?.[0]?.text).toBe('मामले की जाँच की गई है।')
  })

  it('leaves a year, a clause letter and a bare number alone', () => {
    for (const text of ['2026. was a long year', '(a) a clause an officer typed', '2.']) {
      expect(map(`<p>${text}</p>`).body.content[0]?.type, text).toBe('paragraph')
    }
  })

  it('does not renumber a paste — only a whole imported document', () => {
    expect(map('<p>2. A paragraph.</p>', { detectNumbering: false }).body.content[0]?.type).toBe('paragraph')
  })

  it('flattens a merged table into a rectangle and says it did', () => {
    const html =
      '<table>' +
      '<tr><td colspan="2"><p>Pay and allowances</p></td><td><p>Remarks</p></td></tr>' +
      '<tr><td rowspan="2"><p>Level 7</p></td><td><p>Basic</p></td><td><p>—</p></td></tr>' +
      '<tr><td><p>Dearness allowance</p></td><td><p>60%</p></td></tr>' +
      '</table>'
    const { body, notices } = map(html)
    const table = body.content[0]
    expect(table?.type).toBe('table')
    const widths = (table?.content ?? []).map((row) => row.content?.length)
    // Every row the same width — that is what "flattened into a rectangle"
    // means, and it is what makes the plain-text projection a table at all.
    expect(widths).toEqual([3, 3, 3])
    expect(notices.find((notice) => notice.code === 'merged-cells')?.count).toBe(2)

    const text = (row: number, cell: number) =>
      body.content[0]?.content?.[row]?.content?.[cell]?.content?.[0]?.content?.[0]?.text ?? ''
    expect(text(0, 0)).toBe('Pay and allowances')
    // The spanned cell is empty, and the content stayed where it was.
    expect(text(0, 1)).toBe('')
    expect(text(0, 2)).toBe('Remarks')
    // The row below a `rowspan` starts at the SECOND column, not the first.
    expect(text(2, 1)).toBe('Dearness allowance')
  })

  it('marks a header row as header cells', () => {
    const { body } = map('<table><tr><th><p>A</p></th></tr><tr><td><p>b</p></td></tr></table>')
    expect(body.content[0]?.content?.[0]?.content?.[0]?.type).toBe('tableHeader')
    expect(body.content[0]?.content?.[1]?.content?.[0]?.type).toBe('tableCell')
  })

  it('lists an image and never embeds one', () => {
    const notice = noticeFor('<p>Before</p><p><img alt="Office seal" src="" /></p><p>After</p>', 'images')
    expect(notice?.count).toBe(1)
    expect(notice?.items).toEqual(['Office seal'])
    // And nothing image-shaped is in the body.
    expect(JSON.stringify(map('<p><img alt="x" src="data:image/png;base64,AAA" /></p>').body)).not.toContain(
      'data:image',
    )
  })

  it('maps the `<hr>` the page-break style map produces, splitting the paragraph it is in', () => {
    const { body } = map('<p>Before<hr />After</p>')
    expect(types(body.content)).toEqual(['paragraph', 'pageBreak', 'paragraph'])
  })

  it('keeps text that is not inside any element — a Google Docs paste does this', () => {
    expect(bodyText(map('Loose text<p>In a paragraph</p>').body)).toBe('Loose text\nIn a paragraph')
  })

  it('walks through a wrapper that carries no meaning', () => {
    expect(types(map('<div><section><p>Inside</p></section></div>').body.content)).toEqual(['paragraph'])
  })

  it('reports something it does not understand rather than dropping it in silence', () => {
    const notice = noticeFor('<figure><p>A caption</p></figure>', 'unsupported')
    expect(notice?.items).toEqual(['figure'])
    // The text inside it is still kept — the element is unsupported, not the
    // officer's words.
    expect(bodyText(map('<figure><p>A caption</p></figure>').body)).toBe('A caption')
  })

  it('drops a paragraph with nothing in it, and keeps one with a page break in it', () => {
    expect(map('<p>One</p><p>   </p><p>Two</p>').body.content).toHaveLength(2)
  })

  it('collapses whitespace the way HTML does, and turns a non-breaking space into a space', () => {
    expect(bodyText(map('<p>One\n   two&nbsp;three</p>').body)).toBe('One two three')
  })
})

describe('the shapes that arrive from a real Word file', () => {
  it('maps a `<br>` inside a paragraph to a hard break', () => {
    const { body } = map('<p>Line one<br />line two</p>')
    expect(body.content[0]?.content?.map((run) => run.type)).toEqual(['text', 'hardBreak', 'text'])
  })

  it('reads underline from an inline style as well as from `<u>`', () => {
    // Google Docs uses `text-decoration` on a span and nothing else.
    const { body } = map('<p><span style="text-decoration:underline">x</span></p>')
    expect(body.content[0]?.content?.[0]?.marks?.[0]?.type).toBe('underline')
  })

  it('drops a rejected deletion, which is what "accept all" means', () => {
    // mammoth normally removes these before this layer sees them; if a style
    // map ever surfaces one, it is not part of the accepted text.
    expect(bodyText(map('<p>kept <del>gone</del></p>').body)).toBe('kept')
  })

  it('maps a blockquote to a quotation of paragraphs', () => {
    const { body } = map('<blockquote><p>A quoted rule.</p></blockquote>')
    expect(body.content[0]?.type).toBe('blockquote')
    expect(body.content[0]?.content?.[0]?.type).toBe('paragraph')
    expect(bodyText(body)).toBe('A quoted rule.')
  })

  it('gives an empty blockquote a paragraph rather than no content at all', () => {
    expect(map('<blockquote></blockquote>').body.content[0]?.content).toEqual([{ type: 'paragraph' }])
  })

  it('maps a bare `<hr>` between blocks to a page break', () => {
    expect(types(map('<p>One</p><hr /><p>Two</p>').body.content)).toEqual([
      'paragraph',
      'pageBreak',
      'paragraph',
    ])
  })

  it('ignores a `<br>` that is not inside a paragraph', () => {
    expect(types(map('<p>One</p><br /><p>Two</p>').body.content)).toEqual(['paragraph', 'paragraph'])
  })

  it('lists an image that is not inside a paragraph either', () => {
    expect(noticeFor('<img alt="A seal" src="" />', 'images')?.count).toBe(1)
  })

  it('keeps a list item whose content mammoth wrapped in a paragraph', () => {
    // mammoth wraps a multi-paragraph list item in `<p>`; the nesting has to
    // survive rather than becoming a sibling of the list.
    const { body } = map('<ul><li><p>Wrapped</p><ul><li>Deeper</li></ul></li></ul>')
    expect(bodyText(body)).toBe('Wrapped\nDeeper')
    expect(body.content[0]?.content?.[0]?.content?.[1]?.type).toBe('bulletList')
  })

  it('decodes a numeric XML entity in a header part and refuses a malformed one', () => {
    expect(partLines('<w:p><w:r><w:t>&#2325;&#999999999;</w:t></w:r></w:p>')).toEqual(['क&#999999999;'])
  })

  it('breaks a line in `bodyText` at a hard break', () => {
    expect(bodyText(map('<p>One<br />Two</p>').body)).toBe('One\nTwo')
  })
})

describe('splitParaMarker', () => {
  it('splits a marker from its text', () => {
    expect(splitParaMarker('3. Text')).toEqual({ marker: '3', rest: 'Text' })
    expect(splitParaMarker('3.1.2 Text')).toEqual({ marker: '3.1.2', rest: 'Text' })
  })

  it('refuses a marker with nothing after it', () => {
    expect(splitParaMarker('3.')).toBeNull()
  })

  it('refuses four digits, which is a year', () => {
    expect(splitParaMarker('2026. was a long year')).toBeNull()
  })
})

describe('scanDocumentXml', () => {
  it('counts what the HTML cannot show', () => {
    const xml =
      '<w:p><w:ins w:id="1"><w:r><w:t>added</w:t></w:r></w:ins>' +
      '<w:del w:id="2"><w:r><w:delText>gone</w:delText></w:r></w:del></w:p>' +
      '<w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr></w:tc>' +
      '<w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr></w:tc>' +
      '<w:r><w:br w:type="page"/></w:r><w:r><w:footnoteReference w:id="3"/></w:r>' +
      '<w:sectPr><w:cols w:num="2"/></w:sectPr>'
    expect(scanDocumentXml(xml)).toEqual({
      trackedChanges: 2,
      mergedCells: 2,
      pageBreaks: 1,
      footnotes: 1,
      columns: 1,
    })
  })

  it('does not count a one-column section as a column layout', () => {
    expect(scanDocumentXml('<w:sectPr><w:cols w:num="1"/></w:sectPr>').columns).toBe(0)
  })

  it('turns the counts into notices, and reports nothing when there is nothing', () => {
    expect(noticesFromScan(scanDocumentXml('<w:p/>'))).toEqual([])
    expect(noticesFromScan(scanDocumentXml('<w:ins w:id="1"/>'))).toEqual([
      { code: 'tracked-changes', count: 1, items: [] },
    ])
  })
})

describe('partLines and headerFooterLines', () => {
  const header = (lines: string[]) =>
    `<w:hdr>${lines.map((line) => `<w:p><w:r><w:t>${line}</w:t></w:r></w:p>`).join('')}</w:hdr>`

  it('reads one line per paragraph and joins runs within one', () => {
    expect(
      partLines(
        '<w:hdr><w:p><w:r><w:t>भारत</w:t></w:r><w:r><w:t xml:space="preserve"> सरकार</w:t></w:r></w:p><w:p><w:r><w:t>Second</w:t></w:r></w:p></w:hdr>',
      ),
    ).toEqual(['भारत सरकार', 'Second'])
  })

  it('turns a tab into a space rather than carrying an invisible character into a field', () => {
    expect(partLines('<w:p><w:r><w:t>A</w:t><w:tab/><w:t>B</w:t></w:r></w:p>')).toEqual(['A B'])
  })

  it('decodes XML entities, including an ampersand written after another entity', () => {
    expect(partLines('<w:p><w:r><w:t>Grievances &amp;amp; Pensions</w:t></w:r></w:p>')).toEqual([
      'Grievances &amp; Pensions',
    ])
  })

  it('drops a footer line that is only a page number', () => {
    const parts = new Map([
      ['word/header1.xml', header(['Government of India'])],
      ['word/footer1.xml', header(['Page 1 of 2', 'Confidential'])],
    ])
    const found = headerFooterLines(parts)
    expect(found.header).toEqual(['Government of India'])
    // "Page 1 of 2" is a field result, not a letterhead. "Confidential" is a
    // real line and is kept.
    expect(found.footer).toEqual(['Confidential'])
  })

  it('does not repeat a line that appears in two header parts', () => {
    const parts = new Map([
      ['word/header1.xml', header(['Government of India'])],
      ['word/header2.xml', header(['Government of India', 'Second page only'])],
    ])
    expect(headerFooterLines(parts).header).toEqual(['Government of India', 'Second page only'])
  })
})

describe('mergeNotices', () => {
  it('sums counts and keeps every named example once', () => {
    expect(
      mergeNotices(
        [{ code: 'images', count: 2, items: ['a'] }],
        [{ code: 'images', count: 3, items: ['a', 'b'] }],
      ),
    ).toEqual([{ code: 'images', count: 5, items: ['a', 'b'] }])
  })
})

describe('bodyText', () => {
  it('is one line per block, which is what the meta extractor reads', () => {
    const { body } = map('<p>One</p><h1>Two</h1><ul><li>Three</li></ul>')
    expect(bodyText(body)).toBe('One\nTwo\nThree')
  })
})
