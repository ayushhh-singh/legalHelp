import { Packer } from 'docx'
import { describe, expect, it } from 'vitest'

import { buildDocxDocument, docxFileName } from './docx'
import { renderDocument, sampleValues } from './engine'

import { docTemplateFileSchema } from '@/modules/drafting/schema'
import { readFromRoot } from '@/test/paths'

import type { DocTemplate } from '@/modules/drafting/schema'

/**
 * The .docx export, unzipped and read.
 *
 * These assert against the bytes `docx` actually packs rather than against the
 * `Document` object, because everything that can go wrong here goes wrong in
 * the packing: a run whose complex-script font was never set, a page size in
 * the wrong unit, a Devanagari string mangled on the way into XML. A test of
 * the object under `Packer` would have passed for all three.
 */

const load = (id: string): DocTemplate =>
  docTemplateFileSchema.parse(JSON.parse(readFromRoot(`data/drafting/templates/${id}.json`)) as unknown)
    .template

/**
 * `word/document.xml` out of the packed archive.
 *
 * Read with Node's own zlib rather than a zip library: a .docx is a zip of
 * deflated entries, and finding one entry by name and inflating it is twenty
 * lines. Adding a dev dependency to check the dependency we just added is how
 * a test suite starts agreeing with the thing it is testing.
 */
async function documentXml(buffer: Buffer): Promise<string> {
  const { inflateRawSync } = await import('node:zlib')
  const name = Buffer.from('word/document.xml')

  // Walk local file headers. Signature 0x04034b50, little-endian.
  for (let at = 0; at + 30 <= buffer.length; at += 1) {
    if (buffer.readUInt32LE(at) !== 0x04034b50) continue
    const method = buffer.readUInt16LE(at + 8)
    const compressed = buffer.readUInt32LE(at + 18)
    const nameLength = buffer.readUInt16LE(at + 26)
    const extraLength = buffer.readUInt16LE(at + 28)
    const start = at + 30
    if (!buffer.subarray(start, start + nameLength).equals(name)) continue

    const body = buffer.subarray(start + nameLength + extraLength)
    return method === 0
      ? body.subarray(0, compressed).toString('utf8')
      : inflateRawSync(body).toString('utf8')
  }
  throw new Error('word/document.xml is not in the archive')
}

/** Every entry name in the archive, in order. */
function entryNames(buffer: Buffer): string[] {
  const names: string[] = []
  for (let at = 0; at + 30 <= buffer.length; at += 1) {
    if (buffer.readUInt32LE(at) !== 0x04034b50) continue
    const nameLength = buffer.readUInt16LE(at + 26)
    names.push(buffer.subarray(at + 30, at + 30 + nameLength).toString('utf8'))
  }
  return names
}

const pack = async (template: DocTemplate, langs: readonly ('en' | 'hi')[]) => {
  const values = sampleValues(template)
  const documents = langs.map((lang) => renderDocument(template, values, lang).document)
  const buffer = await Packer.toBuffer(buildDocxDocument(documents))
  return documentXml(Buffer.from(buffer))
}

describe('the .docx export', () => {
  it('packs a real archive with word/document.xml in it', async () => {
    const xml = await pack(load('office-memorandum'), ['en'])
    expect(xml).toContain('<w:document')
    expect(xml).toContain('</w:document>')
  })

  it('carries the subject the officer typed', async () => {
    const template = load('office-memorandum')
    const values = { ...sampleValues(template), subject: 'Grant of Children Education Allowance' }
    const buffer = await Packer.toBuffer(buildDocxDocument([renderDocument(template, values, 'en').document]))
    expect(await documentXml(Buffer.from(buffer))).toContain('Grant of Children Education Allowance')
  })

  it('sets A4 and one-inch margins', async () => {
    const xml = await pack(load('letter'), ['en'])
    expect(xml).toMatch(/w:w="11906"/)
    expect(xml).toMatch(/w:h="16838"/)
    expect(xml).toMatch(/w:top="1440"/)
    expect(xml).toMatch(/w:left="1440"/)
  })

  it('names a Latin face and a Devanagari one on the same run', async () => {
    const xml = await pack(load('office-memorandum'), ['hi'])
    // The `cs` slot is what Word applies to Devanagari. Without it a Hindi
    // O.M. opens in whatever the Latin face substitutes, which on a government
    // desktop is Times New Roman drawing boxes.
    expect(xml).toMatch(/w:cs="Nirmala UI"/)
    expect(xml).toMatch(/w:ascii="Times New Roman"/)
  })

  it('keeps Devanagari intact through the XML escaping', async () => {
    const xml = await pack(load('office-memorandum'), ['hi'])
    expect(xml).toContain('कार्यालय ज्ञापन')
  })

  it('renders the title in bold on both script slots', async () => {
    const xml = await pack(load('office-memorandum'), ['en'])
    // `w:bCs` as well as `w:b`: Word tracks the complex-script weight
    // separately, so a title set bold on the Latin slot alone comes out
    // regular in Hindi.
    expect(xml).toContain('<w:bCs/>')
  })

  it('puts a page break between the two languages and nothing before the first', async () => {
    const single = await pack(load('office-memorandum'), ['en'])
    const both = await pack(load('office-memorandum'), ['en', 'hi'])
    expect(single).not.toContain('w:type="page"')
    expect((both.match(/w:type="page"/g) ?? []).length).toBe(1)
  })

  it('numbers the paragraphs as the engine did, not as Word would', async () => {
    const xml = await pack(load('office-memorandum'), ['en'])
    // The number is text. There is no numbering.xml relationship to renumber it.
    expect(xml).toMatch(/<w:t[^>]*>2\. Doubts have been expressed/)
    expect(xml).not.toContain('<w:numPr>')
  })

  it('exports every one of the fourteen templates in both languages', async () => {
    const ids = [
      'letter',
      'demi-official',
      'office-memorandum',
      'circular',
      'endorsement',
      'id-note',
      'noting',
      'notification',
      'leave-application',
      'representation',
      'rti-reply',
      'show-cause-reply',
      'tour-programme',
      'ta-bill-cover',
    ]
    for (const id of ids) {
      const xml = await pack(load(id), ['en', 'hi'])
      expect(xml, id).toContain('</w:document>')
      // No placeholder survived into a signed document.
      expect(xml, id).not.toMatch(/\{\{[a-zA-Z]/)
    }
  })
})

/**
 * Whether the file OPENS, checked as far as it can be without a word processor.
 *
 * The brief's acceptance check is `soffice --headless --convert-to pdf`, and
 * LibreOffice is not installed on this machine (`docs/DATA-GAPS.md` #38). These
 * two assertions are what a word processor does first and are what almost every
 * "will not open" failure trips on: a package missing one of the three parts
 * ECMA-376 requires, or a `word/document.xml` that is not well-formed XML —
 * which is what an unescaped `&` in an officer's subject line would produce.
 */
describe('the archive a word processor is handed', () => {
  it('carries the three parts ECMA-376 requires', async () => {
    const template = load('office-memorandum')
    const buffer = Buffer.from(
      await Packer.toBuffer(
        buildDocxDocument([renderDocument(template, sampleValues(template), 'en').document]),
      ),
    )
    const names = entryNames(buffer)
    expect(names).toContain('[Content_Types].xml')
    expect(names).toContain('_rels/.rels')
    expect(names).toContain('word/document.xml')
  })

  it('produces well-formed XML even from input designed to break it', async () => {
    const template = load('office-memorandum')
    // Every character XML has to escape, in the field an officer types freely.
    const hostile = 'Rules 5 & 6 <urgent> "quoted" \'apostrophe\' — R&D <script>'
    const buffer = Buffer.from(
      await Packer.toBuffer(
        buildDocxDocument([
          renderDocument(template, { ...sampleValues(template), subject: hostile }, 'en').document,
        ]),
      ),
    )
    const xml = await documentXml(buffer)

    const parsed = new DOMParser().parseFromString(xml, 'application/xml')
    expect(parsed.getElementsByTagName('parsererror')).toHaveLength(0)

    // The ampersand survived as text rather than opening an entity, and the
    // angle brackets did not become elements.
    expect(xml).toContain('Rules 5 &amp; 6 &lt;urgent&gt;')
    expect(xml).not.toContain('<script>')
  })
})

describe('docxFileName', () => {
  it('prefers the file number, which is how a document is filed', () => {
    expect(docxFileName({ fileNumber: 'A-11011/2/2026-Estt.', fallback: 'O.M.', lang: 'EN' })).toBe(
      'A-11011-2-2026-Estt (EN).docx',
    )
  })

  it('falls back to the form name when there is no number', () => {
    expect(docxFileName({ fallback: 'Office Memorandum', lang: 'EN' })).toBe('Office Memorandum (EN).docx')
  })

  it('keeps Devanagari', () => {
    expect(docxFileName({ fallback: 'कार्यालय ज्ञापन', lang: 'HI' })).toBe('कार्यालय ज्ञापन (HI).docx')
  })

  it('never produces an empty name', () => {
    expect(docxFileName({ fileNumber: '///', fallback: '', lang: 'EN' })).toBe('draft (EN).docx')
  })
})
