/**
 * A ZIP reader and writer, in this directory, with no dependency.
 *
 * Two things in this session need one and they pull in opposite directions.
 * **Batch export** writes a `.zip` of `.docx` files. **DOCX import** reads a
 * `.docx`, which is a ZIP — and it has to read parts mammoth does not expose at
 * all: `word/header1.xml`, `word/footer1.xml`, and `word/document.xml` itself,
 * where a tracked change and a merged cell are visible and in mammoth's HTML
 * output they are not.
 *
 * ### Why not a library
 *
 * `fflate` is 30 KB and would have done it. It was not added, for three
 * reasons in order of weight:
 *
 * 1. **`CompressionStream` and `DecompressionStream` are native**, in every
 *    browser this app supports and in Node 18 and later. A DEFLATE
 *    implementation is the only genuinely hard part of a ZIP, and the platform
 *    already has one. What is left is a container format that fits in a page.
 * 2. **A `.docx` is already compressed.** Its parts are DEFLATEd inside it, so
 *    the outer archive in a batch export compresses almost nothing — which is
 *    why `STORE` is a perfectly good fallback here and not a compromise.
 * 3. A dependency costs a lockfile entry, a size-budget line, a licence check
 *    and a supply-chain surface, for about 120 lines.
 *
 * Everything here is pure and takes its clock as an argument, because
 * `purity.test.ts` forbids this directory a clock of its own and because an
 * archive that is a function of its inputs is one a test can byte-compare.
 */

/** The one non-obvious constant: DOS epoch, 1 January 1980, 00:00. */
export const DOS_EPOCH = { date: 0x0021, time: 0 } as const

export interface ZipEntry {
  /** The path inside the archive. Forward slashes, no leading slash. */
  name: string
  data: Uint8Array
}

let CRC_TABLE: Uint32Array | null = null

/** CRC-32 (IEEE 802.3), the checksum every ZIP entry carries. */
export function crc32(bytes: Uint8Array): number {
  if (!CRC_TABLE) {
    const table = new Uint32Array(256)
    for (let n = 0; n < 256; n += 1) {
      let value = n
      for (let bit = 0; bit < 8; bit += 1) {
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
      }
      table[n] = value >>> 0
    }
    CRC_TABLE = table
  }
  let crc = 0xffffffff
  for (let index = 0; index < bytes.length; index += 1) {
    crc = (CRC_TABLE[(crc ^ (bytes[index] as number)) & 0xff] as number) ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

async function pipe(bytes: Uint8Array, stream: TransformStream<Uint8Array, Uint8Array>): Promise<Uint8Array> {
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
  const out = source.pipeThrough(stream)
  const chunks: Uint8Array[] = []
  let total = 0
  const reader = out.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    total += value.length
  }
  const joined = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) {
    joined.set(chunk, at)
    at += chunk.length
  }
  return joined
}

/**
 * DEFLATE, or nothing.
 *
 * Returns `null` when the platform has no `CompressionStream`, and the caller
 * stores the entry instead. That is a real fallback rather than a failure: a
 * stored ZIP is a valid ZIP, and the payload here is `.docx` files that are
 * already compressed.
 */
async function deflate(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === 'undefined') return null
  try {
    return await pipe(bytes, new CompressionStream('deflate-raw') as TransformStream<Uint8Array, Uint8Array>)
  } catch {
    return null
  }
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('deflate-raw is not available in this runtime')
  }
  return pipe(bytes, new DecompressionStream('deflate-raw') as TransformStream<Uint8Array, Uint8Array>)
}

const encodeName = (name: string): Uint8Array => new TextEncoder().encode(name)

class Writer {
  private parts: Uint8Array[] = []
  length = 0

  push(bytes: Uint8Array): void {
    this.parts.push(bytes)
    this.length += bytes.length
  }

  u16(value: number): void {
    this.push(new Uint8Array([value & 0xff, (value >>> 8) & 0xff]))
  }

  u32(value: number): void {
    this.push(
      new Uint8Array([value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff]),
    )
  }

  done(): Uint8Array {
    const out = new Uint8Array(this.length)
    let at = 0
    for (const part of this.parts) {
      out.set(part, at)
      at += part.length
    }
    return out
  }
}

/** DOS date and time, from an instant the caller supplies. */
export function dosStamp(at: Date): { date: number; time: number } {
  const year = at.getFullYear()
  if (year < 1980 || year > 2107) return { ...DOS_EPOCH }
  return {
    date: ((year - 1980) << 9) | ((at.getMonth() + 1) << 5) | at.getDate(),
    time: (at.getHours() << 11) | (at.getMinutes() << 5) | Math.floor(at.getSeconds() / 2),
  }
}

/**
 * The entries as one `.zip`.
 *
 * Flag bit 11 is set on every entry, which declares the name to be UTF-8 — a
 * batch export of Hindi documents carries Devanagari file names, and without
 * that bit Windows reads them in the system code page and produces mojibake.
 */
export async function writeZip(
  entries: readonly ZipEntry[],
  options: { modified?: Date } = {},
): Promise<Uint8Array> {
  const stamp = options.modified ? dosStamp(options.modified) : { ...DOS_EPOCH }
  const body = new Writer()
  const directory: {
    name: Uint8Array
    offset: number
    method: number
    crc: number
    sizes: [number, number]
  }[] = []

  for (const entry of entries) {
    const name = encodeName(entry.name)
    const compressed = await deflate(entry.data)
    const method = compressed && compressed.length < entry.data.length ? 8 : 0
    const payload = method === 8 && compressed ? compressed : entry.data
    const sum = crc32(entry.data)
    const offset = body.length

    body.u32(0x04034b50)
    body.u16(20)
    body.u16(0x0800)
    body.u16(method)
    body.u16(stamp.time)
    body.u16(stamp.date)
    body.u32(sum)
    body.u32(payload.length)
    body.u32(entry.data.length)
    body.u16(name.length)
    body.u16(0)
    body.push(name)
    body.push(payload)

    directory.push({ name, offset, method, crc: sum, sizes: [payload.length, entry.data.length] })
  }

  const central = new Writer()
  for (const entry of directory) {
    central.u32(0x02014b50)
    central.u16(20)
    central.u16(20)
    central.u16(0x0800)
    central.u16(entry.method)
    central.u16(stamp.time)
    central.u16(stamp.date)
    central.u32(entry.crc)
    central.u32(entry.sizes[0])
    central.u32(entry.sizes[1])
    central.u16(entry.name.length)
    central.u16(0)
    central.u16(0)
    central.u16(0)
    central.u16(0)
    central.u32(0)
    central.u32(entry.offset)
    central.push(entry.name)
  }

  const end = new Writer()
  end.u32(0x06054b50)
  end.u16(0)
  end.u16(0)
  end.u16(directory.length)
  end.u16(directory.length)
  end.u32(central.length)
  end.u32(body.length)
  end.u16(0)

  const out = new Uint8Array(body.length + central.length + end.length)
  out.set(body.done(), 0)
  out.set(central.done(), body.length)
  out.set(end.done(), body.length + central.length)
  return out
}

const u16At = (view: DataView, at: number): number => view.getUint16(at, true)
const u32At = (view: DataView, at: number): number => view.getUint32(at, true)

/**
 * Every entry of a `.zip`, by name.
 *
 * Read through the CENTRAL DIRECTORY rather than by walking local headers from
 * the front, which is what the format is for: a local header may declare its
 * sizes as zero and defer them to a data descriptor after the payload, and a
 * front-to-back walk then has no way to know where the entry ends. Word writes
 * `.docx` files both ways.
 *
 * Directory entries (a name ending in `/`) are skipped. A ZIP64 archive is
 * refused rather than mis-read — a `.docx` never is one, and guessing would
 * produce a document silently missing its later parts.
 */
export async function readZip(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let eocd = -1
  const floor = Math.max(0, bytes.length - 66_000)
  for (let at = bytes.length - 22; at >= floor; at -= 1) {
    if (u32At(view, at) === 0x06054b50) {
      eocd = at
      break
    }
  }
  if (eocd === -1) throw new Error('not a zip archive')

  const count = u16At(view, eocd + 10)
  let at = u32At(view, eocd + 16)
  if (at === 0xffffffff || count === 0xffff) throw new Error('zip64 archives are not supported')

  const out = new Map<string, Uint8Array>()
  for (let index = 0; index < count; index += 1) {
    if (u32At(view, at) !== 0x02014b50) throw new Error('corrupt central directory')
    const method = u16At(view, at + 10)
    const compressedSize = u32At(view, at + 20)
    const nameLength = u16At(view, at + 28)
    const extraLength = u16At(view, at + 30)
    const commentLength = u16At(view, at + 32)
    const offset = u32At(view, at + 42)
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength))
    at += 46 + nameLength + extraLength + commentLength

    if (name.endsWith('/')) continue
    if (u32At(view, offset) !== 0x04034b50) throw new Error('corrupt local header')
    const localName = u16At(view, offset + 26)
    const localExtra = u16At(view, offset + 28)
    const start = offset + 30 + localName + localExtra
    const raw = bytes.subarray(start, start + compressedSize)
    out.set(name, method === 0 ? raw.slice() : await inflate(raw))
  }
  return out
}

/** The archive's text parts, decoded as UTF-8. Everything else is skipped. */
export function textPart(parts: Map<string, Uint8Array>, name: string): string | null {
  const bytes = parts.get(name)
  return bytes ? new TextDecoder().decode(bytes) : null
}
