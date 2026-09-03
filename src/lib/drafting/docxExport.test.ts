import { Packer } from 'docx'
import { describe, expect, it } from 'vitest'

import {
  DEVANAGARI_STACK,
  buildDocxDocument,
  firstParaNumber,
  sanitiseForDocx,
  strippedCharacters,
  uniqueName,
} from './docx'
import { defaultPageSetup } from './print'
import { readZip, textPart } from './zip'
import type { DocumentModel, RenderedBlock, RenderedNode } from './types'

/**
 * The `.docx` writer's SECOND projection — the one that reads
 * `RenderedBlock.nodes`.
 *
 * `docx.test.ts` covers the `lines` path, which is every block of chrome and
 * every document written in the Session 8 form editor, and it is deliberately
 * left alone: those assertions are the guarantee that this session did not
 * change what the fourteen committed templates export. Everything here is about
 * what `nodes` adds, which is what closes `docs/DATA-GAPS.md` #78.
 *
 * The archive is read with this project's own `readZip`, which
 * `zip.test.ts` checks against Node's `zlib` independently — so a bug in the
 * reader would fail there rather than quietly agreeing with itself here.
 */

const part = async (document: ReturnType<typeof buildDocxDocument>, name: string): Promise<string> => {
  const blob = await Packer.toBlob(document)
  const parts = await readZip(new Uint8Array(await blob.arrayBuffer()))
  return textPart(parts, name) ?? ''
}

const xmlOf = (document: ReturnType<typeof buildDocxDocument>) => part(document, 'word/document.xml')

const block = (nodes: RenderedNode[], role: RenderedBlock['role'] = 'body'): RenderedBlock => ({
  role,
  layoutIndex: 0,
  align: 'left',
  emphasis: 'normal',
  lines: [],
  nodes,
  filled: true,
})

const model = (blocks: RenderedBlock[], lang: 'en' | 'hi' = 'en'): DocumentModel => ({
  templateId: 'office-memorandum',
  lang,
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
  blocks,
})

const para = (text: string, marker = ''): RenderedNode => ({
  kind: 'para',
  marker,
  align: 'left',
  runs: [{ text }],
})

describe('a block with `nodes`', () => {
  it('writes a table as a real Word table, not tab-separated text', async () => {
    // This is the defect `docs/DATA-GAPS.md` #78 records: `linesOfNodes` joins a
    // row with tabs, because tabs are what a plain-text table is, and the
    // exporter read only `lines`.
    const xml = await xmlOf(
      buildDocxDocument([
        model([
          block([
            {
              kind: 'table',
              rows: [
                { header: true, cells: [[{ text: 'Level' }], [{ text: 'Ceiling' }]] },
                { header: false, cells: [[{ text: 'All' }], [{ text: 'Rs. 2,812.50' }]] },
              ],
            },
          ]),
        ]),
      ]),
    )
    expect(xml).toContain('<w:tbl>')
    expect((xml.match(/<w:tr\b/g) ?? []).length).toBe(2)
    expect((xml.match(/<w:tc>/g) ?? []).length).toBe(4)
    expect(xml).toContain('Rs. 2,812.50')
  })

  it('pads a ragged table so every row has the same number of cells', async () => {
    const xml = await xmlOf(
      buildDocxDocument([
        model([
          block([
            {
              kind: 'table',
              rows: [
                { header: false, cells: [[{ text: 'a' }], [{ text: 'b' }], [{ text: 'c' }]] },
                { header: false, cells: [[{ text: 'd' }]] },
              ],
            },
          ]),
        ]),
      ]),
    )
    // Word refuses to open a table whose rows disagree about their width.
    expect((xml.match(/<w:tc>/g) ?? []).length).toBe(6)
  })

  it('writes a heading as a Word heading style and keeps it with what follows', async () => {
    const xml = await xmlOf(
      buildDocxDocument([
        model([block([{ kind: 'heading', level: 1, runs: [{ text: 'Conditions' }] }, para('Text.')])]),
      ]),
    )
    expect(xml).toContain('w:val="Heading1"')
    // A heading alone at the foot of a page is an orphan.
    expect(xml).toContain('<w:keepNext/>')
  })

  it('writes a list as Word numbering rather than as a bullet character', async () => {
    const xml = await xmlOf(
      buildDocxDocument([
        model([
          block([
            { kind: 'listItem', marker: '• ', depth: 0, runs: [{ text: 'A bullet' }] },
            { kind: 'listItem', marker: '1. ', depth: 0, runs: [{ text: 'A number' }] },
          ]),
        ]),
      ]),
    )
    expect((xml.match(/<w:numPr>/g) ?? []).length).toBe(2)
    expect(xml).not.toContain('<w:t>• A bullet</w:t>')
  })

  it('writes a page break', async () => {
    const xml = await xmlOf(
      buildDocxDocument([model([block([para('One'), { kind: 'pageBreak' }, para('Two')])])]),
    )
    expect(xml).toContain('w:type="page"')
  })

  it('carries bold, italic and underline through onto both script slots', async () => {
    const xml = await xmlOf(
      buildDocxDocument([
        model([
          block([
            {
              kind: 'para',
              marker: '',
              align: 'left',
              runs: [{ text: 'x', bold: true, italic: true, underline: true }],
            },
          ]),
        ]),
      ]),
    )
    expect(xml).toContain('<w:bCs/>')
    expect(xml).toContain('<w:iCs/>')
    expect(xml).toContain('<w:u ')
  })

  it('keeps a `{{placeholder}}` visible, because that is what blocks an export', async () => {
    const xml = await xmlOf(
      buildDocxDocument([
        model([
          block([
            {
              kind: 'para',
              marker: '',
              align: 'left',
              runs: [{ text: '{{fileNumber}}', placeholder: 'fileNumber' }],
            },
          ]),
        ]),
      ]),
    )
    expect(xml).toContain('{{fileNumber}}')
  })
})

describe('paragraph numbering', () => {
  const numbered = () => model([block([para('First.', '2. '), para('Second.', '3. ')])])

  it('hands the numbers to Word, so Word renumbers when the officer edits', async () => {
    const xml = await xmlOf(buildDocxDocument([numbered()]))
    expect(xml).toContain('<w:numPr>')
    // The marker is Word's to draw now, so it must NOT also be text.
    expect(xml).not.toContain('<w:t>2. First.</w:t>')
    expect(xml).toContain('First.')
  })

  it('starts Word at the number the engine generated', async () => {
    // CSMOP leaves the opening paragraph of an O.M. unnumbered and numbers from
    // 2. Without this the exported document renumbers from 1 the moment it
    // opens — the export would disagree with the preview before anyone edited
    // anything.
    expect(firstParaNumber([numbered()])).toBe(2)
    const numbering = await part(buildDocxDocument([numbered()]), 'word/numbering.xml')
    expect(numbering).toContain('<w:start w:val="2"/>')
  })

  it('reads a Devanagari marker, which is what a Hindi document carries', () => {
    expect(firstParaNumber([model([block([para('पहला।', '२. ')])], 'hi')])).toBe(2)
  })

  it('is 1 when nothing is numbered', () => {
    expect(firstParaNumber([model([block([para('Unnumbered.')])])])).toBe(1)
  })

  it('puts the marker back as text when Word numbering is turned off', async () => {
    const xml = await xmlOf(buildDocxDocument([numbered()], { wordNumbering: false }))
    expect(xml).toContain('2. ')
    expect(xml).not.toContain('<w:numPr>')
  })

  it('gives each language its own numbering, so the Hindi half restarts', async () => {
    const numbering = await part(
      buildDocxDocument([numbered(), model([block([para('पहला।', '2. ')])], 'hi')]),
      'word/numbering.xml',
    )
    // `docx` resolves a reference name to a `w:num` instance, so what is
    // visible in the part is the RESULT: two independent numbering instances,
    // each starting at 2. One shared instance would continue the English
    // paragraph numbers into the Hindi half.
    expect((numbering.match(/<w:startOverride w:val="2"\/>/g) ?? []).length).toBe(2)
  })
})

describe('the page', () => {
  it('is A4 at one inch by default', async () => {
    const xml = await xmlOf(buildDocxDocument([model([block([para('x')])])]))
    expect(xml).toMatch(/w:w="11906"/)
    expect(xml).toMatch(/w:top="1440"/)
  })

  it('is Letter when Letter was chosen', async () => {
    const xml = await xmlOf(
      buildDocxDocument([model([block([para('x')])])], { page: defaultPageSetup('Letter') }),
    )
    expect(xml).toMatch(/w:w="12240"/)
    expect(xml).toMatch(/w:h="15840"/)
  })
})

describe('the running header and footer', () => {
  it('writes a header part when there are letterhead lines', async () => {
    const document = buildDocxDocument([model([block([para('x')])])], {
      headerLines: ['भारत सरकार / Government of India'],
    })
    expect(await xmlOf(document)).toContain('headerReference')
    expect(await part(document, 'word/header1.xml')).toContain('Government of India')
  })

  it('writes no header at all when there is nothing to put in one', async () => {
    expect(
      await xmlOf(buildDocxDocument([model([block([para('x')])])], { pageNumbers: false })),
    ).not.toContain('headerReference')
  })

  it('writes "page x of y" as Word FIELDS, so they are right after an edit', async () => {
    const document = buildDocxDocument([model([block([para('x')])])], { pageNumberLabel: { of: 'of' } })
    const footer = await part(document, 'word/footer1.xml')
    expect(footer).toContain('PAGE')
    expect(footer).toContain('NUMPAGES')
    expect(footer).toContain('of')
  })

  it('translates the word between the two numbers', async () => {
    const footer = await part(
      buildDocxDocument([model([block([para('x')])])], { pageNumberLabel: { of: 'में से' } }),
      'word/footer1.xml',
    )
    expect(footer).toContain('में से')
  })
})

describe('the number and date table', () => {
  it('puts them at the head of the page, left and right', async () => {
    const xml = await xmlOf(
      buildDocxDocument([model([block([para('x')])])], {
        numberDate: { number: 'A-11011/2/2026-Estt.', date: '03.09.2026' },
      }),
    )
    expect(xml).toContain('A-11011/2/2026-Estt.')
    expect(xml).toContain('03.09.2026')
    expect(xml.indexOf('A-11011')).toBeLessThan(xml.indexOf('03.09.2026'))
  })

  it('writes nothing when the document has only one of the two', async () => {
    const xml = await xmlOf(
      buildDocxDocument([model([block([para('x')])])], { numberDate: { number: 'A-1', date: '' } }),
    )
    expect(xml).not.toContain('<w:tbl>')
  })
})

describe('bilingual output', () => {
  const two = () => [model([block([para('English body.')])]), model([block([para('हिंदी मूल पाठ।')])], 'hi')]

  it('separates the two with one page break by default', async () => {
    const xml = await xmlOf(buildDocxDocument(two()))
    expect((xml.match(/w:type="page"/g) ?? []).length).toBe(1)
  })

  it('puts them in one two-column table when asked', async () => {
    const xml = await xmlOf(
      buildDocxDocument(two(), { bilingual: 'sideBySide', columnHeadings: ['English', 'हिंदी'] }),
    )
    expect(xml).toContain('<w:tbl>')
    expect(xml).not.toContain('w:type="page"')
    expect(xml).toContain('English body.')
    expect(xml).toContain('हिंदी मूल पाठ।')
  })

  it('puts a visible em dash where one side has nothing', async () => {
    // A mismatch has to read as a mismatch, not as a document that happens to
    // be shorter in Hindi.
    const uneven = [
      model([block([para('One')]), { ...block([para('Two')]), layoutIndex: 1 }]),
      model([block([para('एक')])], 'hi'),
    ]
    const xml = await xmlOf(buildDocxDocument(uneven, { bilingual: 'sideBySide' }))
    expect(xml).toContain('—')
  })

  it('falls back to sequential when only one document was given', async () => {
    const xml = await xmlOf(
      buildDocxDocument([model([block([para('Only one.')])])], { bilingual: 'sideBySide' }),
    )
    expect(xml).not.toContain('<w:tbl>')
    expect(xml).toContain('Only one.')
  })
})

describe('document properties', () => {
  it('carries the title, subject and the officer, and never names the app', async () => {
    const core = await part(
      buildDocxDocument([model([block([para('x')])])], {
        properties: { title: 'Children Education Allowance', subject: 'CEA', creator: 'A.B.C.' },
      }),
      'docProps/core.xml',
    )
    expect(core).toContain('Children Education Allowance')
    expect(core).toContain('A.B.C.')
    expect(core.toLowerCase()).not.toContain('sahayak')
  })

  it('leaves them empty when the profile is empty', async () => {
    const core = await part(buildDocxDocument([model([block([para('x')])])]), 'docProps/core.xml')
    expect(core).not.toContain('sahayak')
  })
})

describe('sanitiseForDocx', () => {
  it('strips a bidirectional override, which can make a file number read as something else', () => {
    // "Trojan Source" in an office document: the text a reader SEES and the
    // text a program reads are different, and an official record is exactly
    // where that matters.
    const hostile = 'A-11011‮/2/2026'
    const result = sanitiseForDocx(hostile)
    expect(result.bidi).toBe(1)
    expect(result.text).toBe('A-11011/2/2026')
  })

  it('leaves Arabic, Hebrew and Urdu LETTERS alone — it strips the controls, not the scripts', () => {
    expect(sanitiseForDocx('اردو עברית').text).toBe('اردو עברית')
  })

  it('strips an emoji, which Word prints as a black box on an office laser', () => {
    const result = sanitiseForDocx('Approved 👍🏽 today')
    expect(result.pictographs).toBeGreaterThan(0)
    expect(result.text).not.toContain('👍')
  })

  it('leaves ordinary Devanagari and its matras completely alone', () => {
    const text = 'कार्यालय ज्ञापन — क्ष त्र ज्ञ'
    expect(sanitiseForDocx(text).text).toBe(text)
    expect(sanitiseForDocx(text).pictographs).toBe(0)
  })

  it('is counted across a whole document, so the export can say what it removed', () => {
    const stripped = strippedCharacters([
      model([{ ...block([]), lines: ['Approved 👍', 'Also ‮reversed'], nodes: undefined }]),
    ])
    expect(stripped.pictographs).toBe(1)
    expect(stripped.bidi).toBe(1)
  })
})

describe('uniqueName', () => {
  it('leaves the first one alone and numbers the rest', () => {
    const taken = new Set<string>()
    expect(uniqueName('O.M. (EN).docx', taken)).toBe('O.M. (EN).docx')
    expect(uniqueName('O.M. (EN).docx', taken)).toBe('O.M. (EN) (2).docx')
    expect(uniqueName('O.M. (EN).docx', taken)).toBe('O.M. (EN) (3).docx')
  })

  it('matters because a zip with two entries of one name extracts to one file', () => {
    // Ten documents with no file numbers would otherwise be ten copies of one
    // name, and nine of the officer's documents would silently not be there.
    const taken = new Set<string>()
    const names = Array.from({ length: 10 }, () => uniqueName('draft (EN).docx', taken))
    expect(new Set(names).size).toBe(10)
  })
})

describe('the font stack', () => {
  it('writes the first face into the complex-script slot and names the rest for the reader', async () => {
    // A Word run names ONE font per script slot; there is no fallback list in
    // the format. The stack is a stack in the app, and the export dialog says
    // so — `DEVANAGARI_STACK` is what it reads.
    const xml = await xmlOf(buildDocxDocument([model([block([para('कार्यालय')])], 'hi')]))
    expect(xml).toContain(`w:cs="${DEVANAGARI_STACK[0]}"`)
    expect(DEVANAGARI_STACK.length).toBeGreaterThan(1)
  })

  it('follows an override', async () => {
    const xml = await xmlOf(buildDocxDocument([model([block([para('x')])])], { devanagariFonts: ['Mangal'] }))
    expect(xml).toContain('w:cs="Mangal"')
  })
})
