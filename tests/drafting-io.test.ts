import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

import { beforeAll, describe, expect, it } from 'vitest'

import { importFile, readBytes, sniff, MAX_IMPORT_BYTES } from '@/modules/drafting/import/readFile'
import { bodyText } from '@/lib/drafting/importDocx'
import { bodySchema, type BodyDoc, type BodyNode } from '@/lib/drafting/model'
import { fromRoot, readFromRoot } from '@/test/paths'

/**
 * The import pipeline, end to end, over the committed fixtures.
 *
 * This is the session brief's edge-case matrix. Every row is a file in
 * `tests/fixtures/drafting/`, written by `scripts/drafting-fixtures.mjs` from
 * source that says what it is for — a `.docx` is opaque in a diff, and a
 * fixture nobody can read is a fixture nobody can correct.
 *
 * The pure layers each have their own file (`importDocx.test.ts`,
 * `importPdf.test.ts`, `extract.test.ts`). What is tested HERE is the wiring:
 * that mammoth and pdf.js are driven correctly, that the archive is re-read for
 * the parts mammoth cannot see, and that every failure an officer can cause
 * comes back as a reason they can act on rather than an exception.
 */

/*
  Read through `fromRoot`, not `new URL(..., import.meta.url)`.

  Vite reads a template literal inside `new URL` as a glob import and refuses
  it — and `import.meta.url` is not a `file:` URL under the jsdom environment
  anyway, which is the reason `src/test/paths.ts` exists at all.
*/
/*
  pdf.js needs a worker it can actually import.

  In the app the worker is a hashed same-origin asset — `new URL(...,
  import.meta.url)` is the form Vite rewrites, and the only form the
  Content-Security-Policy permits. Under jsdom that same expression resolves to
  `http://localhost/...`, which pdf.js's fake-worker fallback refuses ("Only
  URLs with a scheme in: file and data are supported"). Pointing it at the file
  on disk is what lets the PDF path be exercised here at all; `readFile.ts` sets
  it only when it is unset, which is what makes this possible without a
  test-only branch in the shipped module.
*/
beforeAll(async () => {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
    fromRoot('node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs'),
  ).href
})

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(fromRoot('tests/fixtures/drafting', name)))

const asFile = (name: string, type = ''): File => new File([fixture(name) as BlobPart], name, { type })

const types = (body: BodyDoc): string[] => (body.content ?? []).map((node) => node.type)

const has = (body: BodyDoc, type: string): boolean => {
  const walk = (nodes: readonly BodyNode[]): boolean =>
    nodes.some((node) => node.type === type || walk(node.content ?? []))
  return walk(body.content ?? [])
}

// -------------------------------------------------------------- the happy path

describe('importing an Office Memorandum', () => {
  it('reads every structure the mapping layer knows', async () => {
    const result = await importFile(asFile('om.docx'))
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const { body, meta, notices } = result.document
    expect(bodySchema.safeParse(body).success).toBe(true)
    expect(types(body)).toContain('numberedPara')
    expect(types(body)).toContain('heading')
    expect(has(body, 'bulletList')).toBe(true)
    expect(has(body, 'table')).toBe(true)

    // The four facts off the first page, none of them invented.
    expect(meta.number).toBe('A-11011/2/2026-Estt.(Allowances)')
    expect(meta.confidence.number).toBe('high')
    expect(meta.dateIso).toBe('2026-09-03')
    expect(meta.subject).toContain('Children Education Allowance')
    expect(meta.to[0]).toBe('The Under Secretary')

    // Nothing lossy happened except the numbering this app now owns.
    expect(notices.map((notice) => notice.code)).toEqual(['numbered-paras'])
  })

  it("keeps the officer's words — no paragraph is dropped", async () => {
    const result = await importFile(asFile('om.docx'))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const text = bodyText(result.document.body)
    for (const phrase of [
      'Government of India',
      'The undersigned is directed to refer',
      'Doubts have been expressed',
      'The matter has been examined',
      'Rs. 2,812.50 per month',
      'Under Secretary to the Government of India',
    ]) {
      expect(text, phrase).toContain(phrase)
    }
  })
})

// ------------------------------------------------------ what Word carries in

describe('the things mammoth cannot show', () => {
  it('accepts every tracked change and says how many', async () => {
    const result = await importFile(asFile('tracked-changes.docx'))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const text = bodyText(result.document.body)
    // Accept all: the insertion is in, the deletion is out.
    expect(text).toContain('This sentence was inserted.')
    expect(text).not.toContain('This sentence was deleted.')
    // And the officer is told, because the document they are now editing is
    // not the document they were sent.
    expect(result.document.notices.find((notice) => notice.code === 'tracked-changes')?.count).toBe(2)
  })

  it('lists an image and puts none in the document', async () => {
    const result = await importFile(asFile('images.docx'))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const notice = result.document.notices.find((entry) => entry.code === 'images')
    expect(notice?.count).toBe(1)
    expect(notice?.items).toEqual(['Office seal'])
    expect(JSON.stringify(result.document.body)).not.toContain('data:image')
    // The paragraphs either side survive.
    expect(bodyText(result.document.body)).toContain('A paragraph after it.')
  })

  it('captures the header and footer for review and applies neither', async () => {
    const result = await importFile(asFile('headers-footers.docx'))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.document.letterhead).toEqual([
      'भारत सरकार / Government of India',
      'कार्मिक एवं प्रशिक्षण विभाग / Department of Personnel and Training',
    ])
    // "Page 1 of 2" is a field result, not a letterhead line.
    expect(result.document.footer).toEqual(['Confidential'])
    expect(result.document.notices.map((notice) => notice.code)).toContain('header')
    // The body itself is untouched by any of it.
    expect(bodyText(result.document.body)).toBe('The body of the letter.')
  })

  it('flattens merged cells into a rectangle and says how many', async () => {
    const result = await importFile(asFile('merged-cells.docx'))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const table = result.document.body.content?.[0]
    expect(table?.type).toBe('table')
    const widths = (table?.content ?? []).map((row) => row.content?.length)
    expect(new Set(widths).size).toBe(1)
    expect(result.document.notices.find((notice) => notice.code === 'merged-cells')?.count).toBeGreaterThan(0)
  })
})

// ------------------------------------------------------------------- refusals

describe('a file this app cannot use', () => {
  const reasons: [string, string][] = [
    ['empty.docx', 'empty'],
    ['actually-a-doc.docx', 'wrong-kind'],
    ['scanned.pdf', 'pdf-no-text'],
  ]

  for (const [name, reason] of reasons) {
    it(`refuses ${name} with "${reason}"`, async () => {
      const result = await importFile(asFile(name))
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.reason).toBe(reason)
    })
  }

  it('refuses an extension it does not read, before loading a library', async () => {
    const result = await importFile(new File(['x'], 'notes.rtf'))
    expect(result).toEqual({ ok: false, reason: 'unsupported' })
  })

  it('refuses a name with no extension at all rather than reading its last letter', async () => {
    // `name.slice(name.lastIndexOf('.'))` slices from -1 when there is no dot
    // and returns the last CHARACTER, so `README` had extension "E" and a name
    // ending in `f` would have been one character from meaning something. A
    // browser run found it: a Playwright download is saved to a temporary path
    // with no extension.
    expect(await importFile(new File(['x'], 'README'))).toEqual({ ok: false, reason: 'unsupported' })
    expect(await importFile(new File(['x'], '.docx'))).toEqual({ ok: false, reason: 'unsupported' })
  })

  it('refuses a zero-byte file of any kind', async () => {
    expect(await importFile(new File([], 'empty.txt'))).toEqual({ ok: false, reason: 'empty' })
  })

  it('refuses a PDF whose name is right and whose bytes are not', async () => {
    const result = await importFile(new File([fixture('om.docx') as BlobPart], 'renamed.pdf'))
    expect(result).toEqual({ ok: false, reason: 'wrong-kind' })
  })

  it('refuses a file over the cap without reading it', async () => {
    const big = new File([new Uint8Array(MAX_IMPORT_BYTES + 1)], 'big.docx')
    expect(await importFile(big)).toEqual({ ok: false, reason: 'too-big' })
  })
})

describe('sniff', () => {
  it('tells the three kinds apart by their first bytes', () => {
    expect(sniff(fixture('om.docx'))).toBe('zip')
    expect(sniff(fixture('letter.pdf'))).toBe('pdf')
    expect(sniff(fixture('actually-a-doc.docx'))).toBe('ole')
    expect(sniff(new TextEncoder().encode('hello'))).toBe('unknown')
  })
})

describe('readBytes', () => {
  it('stops at the cap while reading, not only from the reported size', async () => {
    // `File.size` is a snapshot of a file the operating system may still be
    // writing, and a Blob from a share target need not report one at all.
    const blob = new Blob([new Uint8Array(4096)])
    expect(await readBytes(blob, 100)).toBe('too-big')
  })

  it('reads a small file whole', async () => {
    const bytes = await readBytes(new Blob([new Uint8Array([1, 2, 3])]))
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(Array.from(bytes as Uint8Array)).toEqual([1, 2, 3])
  })
})

// ----------------------------------------------------------------------- PDF

describe('importing a PDF', () => {
  it('reconstructs paragraphs from a text layer and reads the chrome', async () => {
    const result = await importFile(asFile('letter.pdf'))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const text = bodyText(result.document.body)
    // The line that ends without punctuation was joined to the next.
    expect(text).toContain('refer to the Department of Expenditure Office Memorandum')
    expect(result.document.meta.number).toBe('A-11011/2/2026-Estt.')
    expect(result.document.meta.dateIso).toBe('2026-09-03')
    expect(result.document.meta.subject).toContain('Children Education Allowance')
    expect(result.document.garbledHindi).toBe(false)
  })

  it('reads a two-column page column-wise', async () => {
    const result = await importFile(asFile('two-column.pdf'))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.document.notices.map((notice) => notice.code)).toContain('columns')
    const text = result.document.body.content?.map((node) => node.content?.[0]?.text ?? '').join(' ')
    expect(text?.indexOf('left column line five')).toBeLessThan(text?.indexOf('Right column line one') ?? 0)
  })

  it('says a password-protected PDF is password-protected, not "failed"', async () => {
    // pdf.js raises `PasswordException` with `name === 'PasswordException'`,
    // matched by NAME rather than `instanceof` because the class is not
    // exported from the entry point this app imports.
    const result = await importFile(asFile('protected.pdf'))
    expect(result).toEqual({ ok: false, reason: 'pdf-password' })
  })

  it('says "this is a scan, paste the text instead" rather than guessing', async () => {
    // NO OCR. Guessing at a scan would produce an official document full of
    // plausible misreadings, which is the worst thing this feature could do.
    const result = await importFile(asFile('scanned.pdf'))
    expect(result).toEqual({ ok: false, reason: 'pdf-no-text' })
  })
})

// -------------------------------------------------------------- plain text

describe('importing plain text', () => {
  it('reads a .txt and extracts its chrome', async () => {
    const result = await importFile(
      new File(
        [
          'No. A-11011/2/2026-Estt.\nDated: 03.09.2026\n\nSubject: A plain text letter.\n\nThe first paragraph\nwrapped over two lines.\n\nThe second paragraph.',
        ],
        'letter.txt',
      ),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.document.meta.number).toBe('A-11011/2/2026-Estt.')
    expect(result.document.meta.subject).toBe('A plain text letter')
    expect(bodyText(result.document.body)).toContain('The first paragraph wrapped over two lines.')
  })

  it('normalises Devanagari to NFC on the way in', async () => {
    const decomposed = 'क' + 'ि' + 'सी'
    const result = await importFile(new File([decomposed], 'hindi.txt'))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(bodyText(result.document.body)).toBe(decomposed.normalize('NFC'))
  })
})

// ----------------------------------------------------------------- volume

/**
 * The brief's volume rows: twelve enclosures, twenty copy-to entries, a subject
 * that wraps, and a sixty-page document.
 *
 * None of these has a threshold in the code, and that is the point of testing
 * them: the failure they guard against is a limit somebody adds later without
 * noticing what it truncates. An officer really does copy a circular to twenty
 * offices.
 */
describe('a document with a great deal in it', () => {
  const bigDoc = async (over: Partial<import('@/lib/drafting/model').DocMeta> = {}) => {
    const { docTemplateFileSchema } = await import('@/modules/drafting/schema')
    const { newDoc, emptyMeta } = await import('@/lib/drafting/model')
    const { renderOfficialDoc } = await import('@/lib/drafting/renderDoc')
    const template = docTemplateFileSchema.parse(
      JSON.parse(readFromRoot('data/drafting/templates/circular.json')) as unknown,
    ).template
    const doc = newDoc({
      id: 'volume',
      templateId: 'circular',
      lang: 'en',
      at: '2026-09-03T10:00:00.000Z',
      meta: { ...emptyMeta(), number: 'A-1/2026', date: '2026-09-03', ...over },
      body: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'The body.' }] }],
      },
    })
    return renderOfficialDoc(doc, template, 'en')
  }

  it('prints all twelve enclosures and counts them', async () => {
    const enclosures = Array.from({ length: 12 }, (_unused, index) => `Annexure ${index + 1}`)
    const rendered = await bigDoc({ enclosures })
    for (const one of enclosures) {
      expect(rendered.document.enclosures.join('\n'), one).toContain(one)
    }
    // `Encl.: as above (12)` — the count the engine generates, not a guess.
    expect(rendered.document.enclosures.join(' ')).toContain('12')
  })

  it('prints all twenty copy-to entries', async () => {
    const copyTo = Array.from({ length: 20 }, (_unused, index) => ({
      id: `c-${index}`,
      bookId: null,
      name: { en: `Officer ${index + 1}`, hi: '' },
      designation: { en: `Section Officer ${index + 1}`, hi: '' },
      organisation: { en: 'Ministry of Finance', hi: '' },
      address: [],
      phone: '',
      email: '',
    }))
    const rendered = await bigDoc({ copyTo })
    const printed = rendered.document.copyTo.join('\n')
    expect(printed).toContain('Section Officer 1,')
    expect(printed).toContain('Section Officer 20,')
  })

  it('carries a long subject whole, without truncating it', async () => {
    const subject =
      'Grant of Children Education Allowance in respect of a child studying in a recognised institution situated beyond the station of posting of the Government servant — clarification regarding.'
    const rendered = await bigDoc({ subject: { en: subject, hi: '' } })
    // Wrapping is the renderer's job on the page; the MODEL keeps every word.
    expect(rendered.document.subject).toContain('clarification regarding')
    expect(rendered.document.subject?.length).toBeGreaterThan(150)
  })

  it('imports and exports a sixty-page document without losing a paragraph', async () => {
    /*
      No wall-clock assertion. A duration is a budget, not a correctness bound
      (CLAUDE.md), and a timing assertion under four parallel workers is a flake
      waiting to happen. What is asserted is that nothing is DROPPED at volume —
      the failure mode a later `slice(0, 200)` would introduce.
    */
    const paragraphs = Array.from(
      { length: 1200 },
      (_unused, index) => `<p>Paragraph ${index + 1} of a very long circular.</p>`,
    ).join('')
    const { docxHtmlToBody } = await import('@/lib/drafting/importDocx')
    const mapped = docxHtmlToBody(paragraphs, { detectNumbering: false })
    expect(mapped.body.content).toHaveLength(1200)
    expect(bodyText(mapped.body)).toContain('Paragraph 1200 of a very long circular.')

    const { toDocxBytes } = await import('@/lib/drafting/docx')
    const bytes = await toDocxBytes([
      {
        templateId: 'circular',
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
          {
            role: 'body',
            layoutIndex: 0,
            align: 'left',
            emphasis: 'normal',
            lines: Array.from({ length: 1200 }, (_unused, index) => `Paragraph ${index + 1}.`),
            filled: true,
          },
        ],
      },
    ])
    expect(bytes.length).toBeGreaterThan(10_000)
    const parts = await (await import('@/lib/drafting/zip')).readZip(bytes)
    const xml = new TextDecoder().decode(parts.get('word/document.xml') ?? new Uint8Array())
    expect(xml).toContain('Paragraph 1200.')
  }, 60_000)
})

// ------------------------------------------------------------- the round trip

describe('export then import', () => {
  const load = async () => {
    const { docTemplateFileSchema } = await import('@/modules/drafting/schema')
    return docTemplateFileSchema.parse(
      JSON.parse(readFromRoot('data/drafting/templates/office-memorandum.json')) as unknown,
    ).template
  }

  const body: BodyDoc = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'The undersigned is directed to say.' }] },
      { type: 'numberedPara', attrs: { level: 1 }, content: [{ type: 'text', text: 'The second point.' }] },
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Conditions' }] },
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'The first condition.' }] }],
          },
        ],
      },
      {
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [
              {
                type: 'tableCell',
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Level' }] }],
              },
              {
                type: 'tableCell',
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ceiling' }] }],
              },
            ],
          },
        ],
      },
    ],
  }

  const exported = async (options = {}) => {
    const template = await load()
    const { newDoc, emptyMeta } = await import('@/lib/drafting/model')
    const { renderOfficialDoc } = await import('@/lib/drafting/renderDoc')
    const { toDocxBlob } = await import('@/lib/drafting/docx')
    const doc = newDoc({
      id: 'round-trip',
      templateId: 'office-memorandum',
      lang: 'en',
      at: '2026-09-03T10:00:00.000Z',
      meta: {
        ...emptyMeta(),
        number: 'A-11011/2/2026-Estt.',
        date: '2026-09-03',
        subject: { en: 'A round trip', hi: '' },
      },
      body,
    })
    const blob = await toDocxBlob([renderOfficialDoc(doc, template, 'en').document], options)
    return new File([blob], 'round-trip.docx')
  }

  it('comes back structurally equal', async () => {
    const result = await importFile(await exported())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const back = result.document.body

    // Every structure survives the trip through Word's XML.
    expect(has(back, 'heading')).toBe(true)
    expect(has(back, 'bulletList')).toBe(true)
    expect(has(back, 'table')).toBe(true)
    for (const phrase of [
      'The undersigned is directed to say.',
      'The second point.',
      'Conditions',
      'The first condition.',
      'Ceiling',
    ]) {
      expect(bodyText(back), phrase).toContain(phrase)
    }
  })

  it('moves a paragraph number OUT of the text and into Word, which is the point of it', async () => {
    // With Word numbering on, the marker is Word's to draw — so it is not text
    // any more and the re-import sees a plain paragraph. That is the trade the
    // session brief asks for ("so Word renumbers on edit") stated plainly, and
    // it is why the OTHER setting round-trips the numbering as well.
    const withWordNumbering = await importFile(await exported())
    expect(withWordNumbering.ok).toBe(true)
    if (!withWordNumbering.ok) return
    expect(bodyText(withWordNumbering.document.body)).not.toContain('2. The second point.')

    const asText = await importFile(await exported({ wordNumbering: false }))
    expect(asText.ok).toBe(true)
    if (!asText.ok) return
    expect(types(asText.document.body)).toContain('numberedPara')
  })

  it('gets its own file number and subject back off the exported page', async () => {
    const result = await importFile(await exported())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.document.meta.number).toBe('A-11011/2/2026-Estt.')
    expect(result.document.meta.subject).toContain('A round trip')
  })
})
