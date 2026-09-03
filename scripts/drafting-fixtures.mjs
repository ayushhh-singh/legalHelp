/**
 * Writes tests/fixtures/drafting/* — the files the import edge-case matrix is
 * tested against.
 *
 * WHY THESE ARE GENERATED AND COMMITTED, rather than hand-placed binaries: a
 * `.docx` and a `.pdf` are opaque in a diff, and a fixture nobody can read is a
 * fixture nobody can correct. Every one of these is built from source that says
 * what it is for, in this file, so "what exactly is in tracked-changes.docx" is
 * a question with a written answer. The outputs are committed because
 * `pnpm test` must not depend on a build step.
 *
 * A `.docx` is a ZIP, and it is written here BY THE APP'S OWN ZIP WRITER —
 * `src/lib/drafting/zip.ts`, loaded through Vite's SSR module runner, the same
 * arrangement `scripts/library-extracts.mjs` uses and for a related reason: the
 * writer has to be right in the browser, so exercising it here as well is worth
 * more than a second implementation would be.
 *
 *   node scripts/drafting-fixtures.mjs           # write
 *   node scripts/drafting-fixtures.mjs --check   # rebuild and compare, write nothing
 *
 * Hand-run and on no cron. A fixture changes when a test wants something new
 * from it.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'

import { createServer } from 'vite'

const ROOT = process.cwd()
const OUT = 'tests/fixtures/drafting'

/** Every entry's timestamp, fixed, so a rebuild is byte-identical. */
const MODIFIED = new Date(Date.UTC(2026, 0, 1, 0, 0, 0))

// --------------------------------------------------------------- OOXML bits

const CONTENT_TYPES = (extra = '') => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
${extra}</Types>`

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
const R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
const WP =
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"'

const document = (body, sectPr = '<w:sectPr/>') =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${W} ${R} ${WP}><w:body>${body}${sectPr}</w:body></w:document>`

const para = (text, style = '') =>
  `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`

const headerFooterPart = (tag, lines) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:${tag} ${W} ${R}>${lines.map((line) => para(line)).join('')}</w:${tag}>`

/**
 * A style part defining the two styles the O.M. references.
 *
 * mammoth maps `p.Title` and `p.Heading1` to `<h1>` through its default style
 * map, and it does it BY STYLE ID looked up in this part — a document that
 * references a style it never defines gets a warning and a plain `<p>`. That is
 * exactly what Word writes, so a fixture without it would be testing a document
 * no word processor produces.
 */
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles ${W}>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>
</w:styles>`

/**
 * A numbering part, so the two `numId 1` paragraphs become a real list.
 *
 * mammoth reads `w:numFmt` to decide between `<ul>` and `<ol>`; without this
 * part the paragraphs come through as ordinary `<p>` and the fixture would not
 * exercise the list mapping at all.
 */
const NUMBERING = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering ${W}>
<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="\u2022"/></w:lvl></w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
</w:numbering>`

/** The parts every `.docx` here shares. */
const base = (body, options = {}) => {
  const parts = {
    '[Content_Types].xml': CONTENT_TYPES(
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
        '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' +
        (options.contentTypes ?? ''),
    ),
    '_rels/.rels': ROOT_RELS,
    'word/document.xml': document(body, options.sectPr),
    'word/styles.xml': STYLES,
    'word/numbering.xml': NUMBERING,
  }
  parts['word/_rels/document.xml.rels'] =
    options.documentRels ??
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rIdNum" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
</Relationships>`
  Object.assign(parts, options.extra ?? {})
  return parts
}

// -------------------------------------------------------------- the fixtures

/**
 * A complete Office Memorandum, of the shape an officer would actually import:
 * a file number, a date, `Subject:`, a `To` block, three numbered paragraphs, a
 * heading, a bulleted list, a two-column table and a signature block.
 *
 * This is the fixture the round-trip test uses, so every structure the mapping
 * layer understands has to be in it — a round trip that only ever sees
 * paragraphs proves nothing about the table.
 */
const OM_BODY = [
  para('No. A-11011/2/2026-Estt.(Allowances)'),
  para('Government of India'),
  para('Ministry of Personnel, Public Grievances and Pensions'),
  para('New Delhi, dated the 3rd September 2026'),
  para('OFFICE MEMORANDUM', 'Title'),
  para('Subject: Grant of Children Education Allowance — clarification regarding.'),
  para('To'),
  para('The Under Secretary'),
  para('Department of Expenditure'),
  para('North Block, New Delhi'),
  para('Sir,'),
  para(
    'The undersigned is directed to refer to the Department of Expenditure O.M. No. 12/2/2023-JCA dated 12.05.2026 on the subject cited above.',
  ),
  para(
    '2. Doubts have been expressed by various Ministries regarding the reimbursement of Children Education Allowance in respect of a child studying in a recognised institution.',
  ),
  para('2.1 The matter has been examined in consultation with the Department of Expenditure.'),
  para('Conditions', 'Heading1'),
  '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>The institution is recognised by the appropriate authority.</w:t></w:r></w:p>',
  '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>The claim is preferred within the financial year.</w:t></w:r></w:p>',
  `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="4000"/><w:gridCol w:w="4000"/></w:tblGrid>
<w:tr><w:tc><w:p><w:r><w:t>Level</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Ceiling</w:t></w:r></w:p></w:tc></w:tr>
<w:tr><w:tc><w:p><w:r><w:t>All levels</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Rs. 2,812.50 per month</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`,
  para('3. This issues with the approval of the competent authority.'),
  para('Yours faithfully,'),
  para('(A.B.C.)'),
  para('Under Secretary to the Government of India'),
].join('')

/** A one-pixel transparent PNG, so `images.docx` carries a real image part. */
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

const FIXTURES = {
  /** The happy path, and the round-trip subject. */
  'om.docx': () => base(OM_BODY),

  /**
   * Tracked changes. mammoth accepts the insertion and drops the deletion
   * silently, which is the right behaviour and exactly why the officer has to
   * be told — `scanDocumentXml` counts both marks in the XML.
   */
  'tracked-changes.docx': () =>
    base(
      [
        para('A note on the file.'),
        `<w:p><w:ins w:id="1" w:author="A" w:date="2026-01-01T00:00:00Z"><w:r><w:t xml:space="preserve">This sentence was inserted. </w:t></w:r></w:ins>` +
          `<w:del w:id="2" w:author="A" w:date="2026-01-01T00:00:00Z"><w:r><w:delText xml:space="preserve">This sentence was deleted.</w:delText></w:r></w:del></w:p>`,
      ].join(''),
    ),

  /** One inline image, which is listed and never embedded. */
  'images.docx': () =>
    base(
      [
        para('A paragraph before the seal.'),
        `<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">
<wp:extent cx="914400" cy="914400"/><wp:docPr id="1" name="Picture 1" descr="Office seal"/>
<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
<pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="seal.png" descr="Office seal"/><pic:cNvPicPr/></pic:nvPicPr>
<pic:blipFill><a:blip r:embed="rId5"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>
<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm>
<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>
</wp:inline></w:drawing></w:r></w:p>`,
        para('A paragraph after it.'),
      ].join(''),
      {
        documentRels: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/seal.png"/>
<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rIdNum" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
</Relationships>`,
        extra: { 'word/media/seal.png': PNG_1PX },
      },
    ),

  /**
   * A header and a footer — the parts mammoth does not read at all, and the
   * ones that carry a Government letterhead.
   */
  'headers-footers.docx': () =>
    base(para('The body of the letter.'), {
      contentTypes:
        '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
        '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>',
      documentRels: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>
<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rIdNum" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
</Relationships>`,
      sectPr:
        '<w:sectPr><w:headerReference w:type="default" r:id="rId2"/><w:footerReference w:type="default" r:id="rId3"/></w:sectPr>',
      extra: {
        'word/header1.xml': headerFooterPart('hdr', [
          'भारत सरकार / Government of India',
          'कार्मिक एवं प्रशिक्षण विभाग / Department of Personnel and Training',
        ]),
        // The `1` is a page-number field result and must NOT be offered as a
        // letterhead line; `headerFooterLines` drops a line that is only digits.
        'word/footer1.xml': headerFooterPart('ftr', ['Page 1 of 2', 'Confidential']),
      },
    }),

  /** A table with a horizontal merge and a vertical one. */
  'merged-cells.docx': () =>
    base(
      `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>
<w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p><w:r><w:t>Pay and allowances</w:t></w:r></w:p></w:tc>
<w:tc><w:p><w:r><w:t>Remarks</w:t></w:r></w:p></w:tc></w:tr>
<w:tr><w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr><w:p><w:r><w:t>Level 7</w:t></w:r></w:p></w:tc>
<w:tc><w:p><w:r><w:t>Basic</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>—</w:t></w:r></w:p></w:tc></w:tr>
<w:tr><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc>
<w:tc><w:p><w:r><w:t>Dearness allowance</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>60%</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`,
    ),

  /** Zero bytes. Refused before a library is loaded. */
  'empty.docx': () => null,

  /**
   * An OLE2 compound file — a real `.doc` under a `.docx` name, which is the
   * commonest wrong file in a Government office. The magic number is what lets
   * the screen say "save it as .docx" rather than throwing an opaque error.
   */
  'actually-a-doc.docx': () =>
    Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(504, 0)]),
}

// ------------------------------------------------------------------- PDFs

/**
 * A minimal PDF, written by hand.
 *
 * Uncompressed, one font, `Tj` per line — the smallest thing pdf.js will read a
 * text layer out of. Positions are in PDF user space with the origin at the
 * bottom left, which is the space `importPdf.ts` reasons in.
 */
function makePdf(pages, options = {}) {
  const objects = []
  const push = (body) => {
    objects.push(body)
    return objects.length
  }

  const font = push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  const pageIds = []
  const pageObjects = []

  for (const page of pages) {
    const stream = page.runs
      .map((run) => `BT /F1 ${run.size ?? 11} Tf 1 0 0 1 ${run.x} ${run.y} Tm (${escapePdf(run.text)}) Tj ET`)
      .join('\n')
    const contentId = push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
    pageObjects.push({ contentId })
    pageIds.push(0)
  }

  const pagesId = push('PLACEHOLDER_PAGES')
  pageObjects.forEach((entry, index) => {
    pageIds[index] = push(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${entry.contentId} 0 R >>`,
    )
  })
  objects[pagesId - 1] =
    `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] >>`
  const catalog = push(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`)

  /*
    The standard security handler, as a NORMAL object with its own xref entry.

    Appending it after the cross-reference table was tried and is what made
    pdf.js fall back to "Indexing all PDF objects" — a recovery path, so the
    fixture would have been testing the recovery rather than the encryption.

    `/O` and `/U` are filler and that is not a cheat: pdf.js computes the
    expected `/U` from the EMPTY password, compares it against the one in the
    file, and raises `PasswordException(NEED_PASSWORD)` when they differ —
    exactly what it does for a real protected document. Computing a correct
    `/U` would mean implementing RC4 and Algorithm 4 here to produce a file
    pdf.js would still refuse for the same reason.
  */
  const encryptId = options.encrypt
    ? push(`<< /Filter /Standard /V 1 /R 2 /O <${'61'.repeat(32)}> /U <${'62'.repeat(32)}> /P -1 >>`)
    : 0

  let out = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((body, index) => {
    offsets.push(out.length)
    out += `${index + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = out.length
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (let index = 1; index <= objects.length; index += 1) {
    out += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`
  }
  const security = encryptId
    ? ` /Encrypt ${encryptId} 0 R /ID [<${'ab'.repeat(16)}> <${'ab'.repeat(16)}>]`
    : ''
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R${security} >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}

const escapePdf = (text) => text.replace(/([\\()])/g, '\\$1')

const PDFS = {
  /**
   * A one-column letter whose lines break mid-sentence — the case the join
   * heuristic exists for. Line 2 ends without punctuation and must join line 3.
   */
  'letter.pdf': () =>
    makePdf([
      {
        runs: [
          { x: 70, y: 780, text: 'No. A-11011/2/2026-Estt.' },
          { x: 400, y: 780, text: 'Dated: 03.09.2026' },
          { x: 70, y: 740, text: 'Subject: Grant of Children Education Allowance.' },
          { x: 70, y: 700, text: 'The undersigned is directed to refer to the Department of' },
          { x: 70, y: 685, text: 'Expenditure Office Memorandum of even number on the subject' },
          { x: 70, y: 670, text: 'cited above.' },
          { x: 70, y: 640, text: '2. The matter has been examined in consultation with the' },
          { x: 70, y: 625, text: 'Department of Expenditure.' },
        ],
      },
    ]),

  /** Two columns with a clean gutter — read column-wise, not line-wise. */
  'two-column.pdf': () =>
    makePdf([
      {
        runs: [
          { x: 60, y: 780, text: 'Left column line one and' },
          { x: 330, y: 780, text: 'Right column line one and' },
          { x: 60, y: 765, text: 'left column line two.' },
          { x: 330, y: 765, text: 'right column line two.' },
          { x: 60, y: 740, text: 'Left column line three and' },
          { x: 330, y: 740, text: 'Right column line three and' },
          { x: 60, y: 725, text: 'left column line four.' },
          { x: 330, y: 725, text: 'right column line four.' },
          { x: 60, y: 700, text: 'Left column line five.' },
          { x: 330, y: 700, text: 'Right column line five.' },
        ],
      },
    ]),

  /** A page with no text at all — a scan, as far as anything can tell. */
  'scanned.pdf': () => makePdf([{ runs: [] }]),

  /**
   * A password-protected PDF.
   *
   * The `/Encrypt` dictionary is well-formed and its `/O` and `/U` strings are
   * filler, which is enough and is not a cheat: pdf.js computes the expected
   * `/U` from the EMPTY password, compares it against the one in the file, and
   * throws `PasswordException(NEED_PASSWORD)` when they differ — which is
   * exactly what it does for a real protected document. Computing a correct
   * `/U` would mean implementing RC4 and Algorithm 4 here to produce a file
   * pdf.js would then still refuse for the same reason.
   */
  'protected.pdf': () => makePdf([{ runs: [{ x: 70, y: 780, text: 'Secret' }] }], { encrypt: true }),
}

// -------------------------------------------------------------------- main

function write(path, bytes, check) {
  const full = resolve(ROOT, path)
  const same = existsSync(full) && Buffer.compare(readFileSync(full), bytes) === 0
  if (!check && !same) {
    mkdirSync(resolve(ROOT, OUT), { recursive: true })
    writeFileSync(full, bytes)
  }
  console.log(`  ${same ? '=' : check ? '!' : '+'} ${path} (${bytes.length} bytes)`)
  return same
}

async function main() {
  const check = process.argv.includes('--check')
  const server = await createServer({
    configFile: 'vite.config.ts',
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'error',
  })

  let changed = 0
  try {
    const { writeZip } = await server.ssrLoadModule('/src/lib/drafting/zip.ts')

    for (const [name, build] of Object.entries(FIXTURES)) {
      const parts = build()
      let bytes
      if (parts === null) bytes = Buffer.alloc(0)
      else if (Buffer.isBuffer(parts)) bytes = parts
      else {
        const entries = Object.entries(parts).map(([entryName, content]) => ({
          name: entryName,
          data: Buffer.isBuffer(content) ? new Uint8Array(content) : new TextEncoder().encode(content),
        }))
        bytes = Buffer.from(await writeZip(entries, { modified: MODIFIED }))
      }
      if (!write(`${OUT}/${name}`, bytes, check)) changed += 1
    }

    for (const [name, build] of Object.entries(PDFS)) {
      if (!write(`${OUT}/${name}`, build(), check)) changed += 1
    }
  } finally {
    await server.close()
  }

  if (check && changed > 0) {
    console.error(`\n${changed} fixture(s) differ from what is committed. Re-run without --check.`)
    process.exitCode = 1
  }
}

await main()
