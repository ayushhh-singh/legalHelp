import { inflateRawSync } from 'node:zlib'

import { describe, expect, it } from 'vitest'

import { crc32, dosStamp, readZip, textPart, writeZip, DOS_EPOCH } from './zip'

/**
 * The ZIP writer and reader, checked against the format rather than against
 * itself.
 *
 * A round trip through both would pass with two matching bugs, so the archives
 * written here are also taken apart with **Node's own `zlib`** and read at the
 * byte level — the same rule `docx.test.ts` states about not using a zip
 * library to check the zip library.
 */

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text)
const u32 = (data: Uint8Array, at: number): number =>
  new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(at, true)
const u16 = (data: Uint8Array, at: number): number =>
  new DataView(data.buffer, data.byteOffset, data.byteLength).getUint16(at, true)

describe('crc32', () => {
  it('agrees with the published check value', () => {
    // The IEEE 802.3 check value for "123456789" is 0xCBF43926 — the one number
    // every CRC-32 implementation is measured against.
    expect(crc32(bytes('123456789')) >>> 0).toBe(0xcbf43926)
  })

  it('is zero for no bytes', () => {
    expect(crc32(new Uint8Array(0))).toBe(0)
  })
})

describe('writeZip', () => {
  it('produces an archive Node can inflate', async () => {
    const body = 'Government of India — कार्यालय ज्ञापन'.repeat(20)
    const zip = await writeZip([{ name: 'a.txt', data: bytes(body) }])

    expect(u32(zip, 0)).toBe(0x04034b50)
    const method = u16(zip, 8)
    const nameLength = u16(zip, 26)
    const extraLength = u16(zip, 28)
    const compressedSize = u32(zip, 18)
    const start = 30 + nameLength + extraLength
    const payload = zip.subarray(start, start + compressedSize)
    const text = new TextDecoder().decode(method === 8 ? new Uint8Array(inflateRawSync(payload)) : payload)
    expect(text).toBe(body)
  })

  it('declares its names as UTF-8, so Devanagari survives Windows', async () => {
    const zip = await writeZip([{ name: 'कार्यालय ज्ञापन.docx', data: bytes('x') }])
    // Bit 11 of the general-purpose flags. Without it Windows reads the name in
    // the system code page and produces mojibake.
    expect(u16(zip, 6) & 0x0800).toBe(0x0800)
  })

  it('is a pure function of its input — the same entries give the same bytes', async () => {
    const entries = [
      { name: 'a.txt', data: bytes('one') },
      { name: 'b.txt', data: bytes('two') },
    ]
    const first = await writeZip(entries)
    const second = await writeZip(entries)
    expect(Array.from(second)).toEqual(Array.from(first))
  })

  it('stamps the DOS epoch when no clock is supplied', async () => {
    const zip = await writeZip([{ name: 'a.txt', data: bytes('x') }])
    expect(u16(zip, 10)).toBe(DOS_EPOCH.time)
    expect(u16(zip, 12)).toBe(DOS_EPOCH.date)
  })

  it('writes an archive with no entries at all', async () => {
    const zip = await writeZip([])
    // Just the end-of-central-directory record: 22 bytes, zero entries.
    expect(zip.length).toBe(22)
    expect(u32(zip, 0)).toBe(0x06054b50)
    expect(await readZip(zip)).toEqual(new Map())
  })
})

describe('dosStamp', () => {
  it('encodes a date in the DOS bit layout', () => {
    const stamp = dosStamp(new Date(2026, 8, 3, 14, 30, 20))
    expect((stamp.date >> 9) + 1980).toBe(2026)
    expect((stamp.date >> 5) & 0xf).toBe(9)
    expect(stamp.date & 0x1f).toBe(3)
    expect(stamp.time >> 11).toBe(14)
  })

  it('falls back to the epoch for a year DOS cannot hold', () => {
    // The format has seven bits for the year, starting at 1980. A file dated
    // 1970 has to become something rather than overflow into 2106.
    expect(dosStamp(new Date(1970, 0, 1))).toEqual({ ...DOS_EPOCH })
  })
})

describe('readZip', () => {
  it('round-trips every entry, compressed or stored', async () => {
    const entries = [
      { name: 'word/document.xml', data: bytes('<w:document/>'.repeat(200)) },
      // Two bytes: too small for deflate to help, so this one is STORED and
      // takes the other branch of the reader.
      { name: 'tiny', data: bytes('hi') },
    ]
    const parts = await readZip(await writeZip(entries))
    expect(textPart(parts, 'word/document.xml')).toBe('<w:document/>'.repeat(200))
    expect(textPart(parts, 'tiny')).toBe('hi')
    expect(textPart(parts, 'absent')).toBeNull()
  })

  it('reads a real .docx written by the `docx` library', async () => {
    const { Packer } = await import('docx')
    const { buildDocxDocument } = await import('./docx')
    const blob = await Packer.toBlob(
      buildDocxDocument([
        {
          templateId: 't',
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
              lines: ['A paragraph.'],
              filled: true,
            },
          ],
        },
      ]),
    )
    const parts = await readZip(new Uint8Array(await blob.arrayBuffer()))
    // The three parts ECMA-376 requires, read by our own reader out of an
    // archive we did not write. This is the assertion that matters: the
    // importer opens files Word wrote, not files this file wrote.
    expect(parts.has('[Content_Types].xml')).toBe(true)
    expect(parts.has('_rels/.rels')).toBe(true)
    expect(textPart(parts, 'word/document.xml')).toContain('A paragraph.')
  })

  it('refuses something that is not a zip at all', async () => {
    await expect(readZip(bytes('not a zip, just some text'))).rejects.toThrow(/not a zip/)
  })

  it('skips directory entries', async () => {
    const parts = await readZip(
      await writeZip([
        { name: 'word/', data: new Uint8Array(0) },
        { name: 'word/document.xml', data: bytes('<x/>') },
      ]),
    )
    expect([...parts.keys()]).toEqual(['word/document.xml'])
  })
})
