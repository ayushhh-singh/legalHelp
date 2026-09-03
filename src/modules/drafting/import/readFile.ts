/**
 * Reading a file the officer chose, on the officer's own device.
 *
 * NOTHING HERE REACHES THE NETWORK. The two libraries that make it possible —
 * `pdfjs-dist` and `mammoth` — are behind dynamic imports, so an officer who
 * never imports a document never downloads either; together they are about
 * 630 KB gzip, which is more than four times the whole initial route
 * (`vite.config.ts`'s `globIgnores` keeps them out of the precache for the same
 * reason).
 *
 * The mapping itself is not here. `src/lib/drafting/{importDocx,importPdf}.ts`
 * are pure and hold every decision about what a paragraph is; this file is the
 * part that touches a `File`, a zip and a PDF worker, and it is deliberately
 * thin enough to read in one screen.
 */

import {
  bodyText,
  docxHtmlToBody,
  headerFooterLines,
  mergeNotices,
  noticesFromScan,
  scanDocumentXml,
  type ImportNotice,
} from '@/lib/drafting/importDocx'
import { reconstructPdf, type PdfPageText, type PdfTextItem } from '@/lib/drafting/importPdf'
import { extractMeta, type ExtractedMeta } from '@/lib/drafting/extract'
import { cleanPastedText, normaliseBody, type PasteOptions } from '@/lib/drafting/paste'
import { readZip, textPart } from '@/lib/drafting/zip'
import type { BodyDoc } from '@/lib/drafting/model'

/**
 * The cap the session brief sets. Enforced twice, on purpose: against
 * `File.size` before anything is read, and again while reading, because
 * `File.size` is a snapshot of a file the operating system may still be
 * writing and a `Blob` from a share target need not report one at all.
 */
export const MAX_IMPORT_BYTES = 20 * 1024 * 1024

export type ImportFailure =
  | 'too-big'
  | 'empty'
  | 'unsupported'
  | 'wrong-kind'
  | 'pdf-password'
  | 'pdf-no-text'
  | 'docx-empty'
  | 'failed'

export interface ImportedDocument {
  body: BodyDoc
  notices: ImportNotice[]
  meta: ExtractedMeta
  /** Header and footer lines, offered for the letterhead. Never applied. */
  letterhead: string[]
  footer: string[]
  /** Set when a Hindi text layer is present and cannot be believed. */
  garbledHindi: boolean
  source: 'docx' | 'pdf' | 'text'
}

export type ImportResult = { ok: true; document: ImportedDocument } | { ok: false; reason: ImportFailure }

/**
 * A file's extension, or nothing at all.
 *
 * The guard matters: `name.slice(name.lastIndexOf('.'))` on a name with NO dot
 * slices from -1 and returns the last CHARACTER — so `README` has extension
 * `"E"` and `abc123` has extension `"3"`. Neither is in the accepted list, so
 * the refusal is right by accident; the message is not, and a name that happened
 * to end in `f` would be one character away from being read as something. Found
 * by a browser run: Playwright saves a download to a temporary path with no
 * extension at all.
 */
function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? '' : name.slice(dot).toLowerCase()
}

/**
 * The file's bytes, read as a stream and abandoned the moment it goes over.
 *
 * `await file.arrayBuffer()` would allocate the whole thing before anyone could
 * check its size, which for a 400 MB file mistakenly chosen on a phone is a tab
 * that dies with no message. This reads chunk by chunk and stops.
 */
export async function readBytes(file: Blob, cap = MAX_IMPORT_BYTES): Promise<Uint8Array | 'too-big'> {
  if (file.size > cap) return 'too-big'

  /*
    `Blob.prototype.stream` is present in every browser this app supports and
    absent in jsdom, which is what the unit suite runs in. The fallback is not
    a test accommodation: it is the same read without the early abort, and it
    is still behind the size check above, so the only thing lost where the
    stream is missing is the ability to stop halfway through a file that lied
    about its size.
  */
  if (typeof file.stream !== 'function') {
    const whole = new Uint8Array(await file.arrayBuffer())
    return whole.length > cap ? 'too-big' : whole
  }

  const stream = file.stream() as unknown as ReadableStream<Uint8Array>
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.length
      if (total > cap) {
        await reader.cancel()
        return 'too-big'
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const out = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.length
  }
  return out
}

/**
 * What the FIRST BYTES say the file is.
 *
 * A `.doc` renamed to `.docx` is the commonest wrong file in a Government
 * office — the old binary format is still what a lot of circulars are filed in
 * — and mammoth's failure on one is an opaque exception. Checking the magic
 * number lets the screen say "this is an older Word file, open it in Word and
 * save it as .docx", which is something an officer can act on.
 */
export function sniff(bytes: Uint8Array): 'zip' | 'pdf' | 'ole' | 'unknown' {
  const starts = (...signature: number[]): boolean => signature.every((byte, index) => bytes[index] === byte)
  if (starts(0x50, 0x4b, 0x03, 0x04) || starts(0x50, 0x4b, 0x05, 0x06)) return 'zip'
  if (starts(0x25, 0x50, 0x44, 0x46)) return 'pdf'
  // The OLE2 compound-file header — a real `.doc`, `.xls` or `.ppt`.
  if (starts(0xd0, 0xcf, 0x11, 0xe0)) return 'ole'
  return 'unknown'
}

// ------------------------------------------------------------------- docx

/**
 * The style map, and the two entries that are not mammoth's defaults.
 *
 * `u => u` because mammoth ignores underline by default (it is more often
 * emphasis than meaning on the web, and in a Government document it is
 * neither — it is how a heading is marked). `br[type='page'] => hr` because a
 * page break is otherwise unreachable: mammoth reads it and then has nowhere
 * to put it, and `<hr>` is the one void element that survives its own
 * empty-element pruning. `importDocx.ts` maps that `<hr>` back to a
 * `pageBreak` node.
 */
const STYLE_MAP = ['u => u', "br[type='page'] => hr", "p[style-name='Subtitle'] => h2:fresh"]

async function fromDocx(bytes: Uint8Array, paste: PasteOptions): Promise<ImportResult> {
  const mammoth = await import('mammoth')
  // A copy into a fresh ArrayBuffer: `bytes` may be a view into a larger
  // buffer, and mammoth reads the whole buffer rather than the view.
  const buffer = bytes.slice().buffer

  const rendered = await mammoth.convertToHtml(
    /*
      BOTH keys, and the second one is not redundant.

      mammoth ships two builds. The browser build — which is what Vite resolves
      through the package's `browser` field, and therefore what ships — reads
      `arrayBuffer` and nothing else. The Node build reads `path`, `buffer` or
      `file` and rejects an options object carrying only `arrayBuffer`, which
      is what Vitest's jsdom environment resolves. Supplying both means the
      SHIPPED code path is what the tests exercise; the alternative was a test
      that drove a different function than production does, which is the kind of
      test that goes green while the app is broken.
    */
    { arrayBuffer: buffer, buffer: bytes } as unknown as { arrayBuffer: ArrayBuffer },
    {
      styleMap: STYLE_MAP,
      // Images are LISTED, never embedded. Not calling `image.read()` is what
      // keeps a 6 MB photograph out of an IndexedDB row; the `<img>` element it
      // leaves behind is what `importDocx.ts` counts.
      convertImage: mammoth.images.imgElement(() => Promise.resolve({ src: '' })),
    },
  )

  const mapped = docxHtmlToBody(rendered.value, { detectNumbering: true })

  let scanNotices: ImportNotice[] = []
  let letterhead: string[] = []
  let footer: string[] = []
  try {
    const parts = await readZip(bytes)
    const documentXml = textPart(parts, 'word/document.xml')
    if (documentXml) scanNotices = noticesFromScan(scanDocumentXml(documentXml))
    const text = new Map<string, string>()
    for (const name of parts.keys()) {
      if (name.startsWith('word/header') || name.startsWith('word/footer')) {
        text.set(name, textPart(parts, name) ?? '')
      }
    }
    const found = headerFooterLines(text)
    letterhead = found.header
    footer = found.footer
    if (letterhead.length > 0)
      scanNotices = mergeNotices(scanNotices, [
        { code: 'header', count: letterhead.length, items: letterhead.slice(0, 4) },
      ])
    if (footer.length > 0)
      scanNotices = mergeNotices(scanNotices, [
        { code: 'footer', count: footer.length, items: footer.slice(0, 4) },
      ])
  } catch {
    // The archive could not be re-read. mammoth already produced a document,
    // so the import succeeds without the header, footer and tracked-change
    // notices rather than failing — and it says nothing it cannot support.
  }

  const body = normaliseBody(mapped.body, paste)
  const text = bodyText(body)
  if (!text.trim() && letterhead.length === 0) return { ok: false, reason: 'docx-empty' }

  return {
    ok: true,
    document: {
      body,
      notices: mergeNotices(mapped.notices, scanNotices),
      meta: extractMeta(text),
      letterhead,
      footer,
      garbledHindi: false,
      source: 'docx',
    },
  }
}

// -------------------------------------------------------------------- pdf

/**
 * A PDF's text layer, page by page, with the geometry `importPdf.ts` needs.
 *
 * THE WORKER IS BUNDLED, NOT FETCHED FROM A CDN. `new URL(..., import.meta.url)`
 * is the form Vite rewrites into a hashed same-origin asset, which is the only
 * form the Content-Security-Policy in `public/_headers` permits: `default-src
 * 'self'` covers `worker-src`, and pdf.js's default configuration would reach
 * for a version-matched script on a CDN — a third-party request from an app
 * whose hard rule is that it makes none.
 *
 * The transform matrix is `[a, b, c, d, e, f]` and `e`/`f` are the translation,
 * which is where the run sits. `height` comes from `d` rather than from the
 * reported `height`, which pdf.js gives as 0 for a run in a rotated or scaled
 * text object.
 */
async function fromPdf(bytes: Uint8Array, paste: PasteOptions): Promise<ImportResult> {
  const pdfjs = await import('pdfjs-dist')
  /*
    Set once, and never over something already set.

    Two modules in this app configure pdf.js — this one and the Library's
    `personal/extract.ts` — and whichever runs second would otherwise stamp the
    first one's setting again for no reason. The guard also lets a test point
    the worker at a local file, which is the only way the PDF path can be
    exercised outside a real browser: under jsdom this URL is
    `http://localhost/...`, and pdf.js's fake-worker fallback cannot import it.
  */
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url,
    ).toString()
  }

  let document
  try {
    document = await pdfjs.getDocument({
      data: bytes.slice(),
      disableFontFace: true,
      useWorkerFetch: false,
    }).promise
  } catch (error) {
    // pdf.js throws a `PasswordException` with `name === 'PasswordException'`.
    // Matched by name rather than by `instanceof`, because the class is not
    // exported from the entry point this app imports.
    const name = (error as { name?: string } | null)?.name ?? ''
    if (name === 'PasswordException') return { ok: false, reason: 'pdf-password' }
    return { ok: false, reason: 'failed' }
  }

  const pages: PdfPageText[] = []
  for (let number = 1; number <= document.numPages; number += 1) {
    const page = await document.getPage(number)
    const viewport = page.getViewport({ scale: 1 })
    const content = await page.getTextContent()
    const items: PdfTextItem[] = []
    for (const item of content.items) {
      if (!('str' in item) || item.str === '') continue
      const transform = item.transform as number[]
      items.push({
        text: item.str,
        x: transform[4] ?? 0,
        y: transform[5] ?? 0,
        width: item.width ?? 0,
        height: Math.abs(transform[3] ?? 0) || item.height || 10,
      })
    }
    pages.push({ width: viewport.width, height: viewport.height, items })
  }

  const reconstructed = reconstructPdf(pages)
  if (!reconstructed.text.trim()) return { ok: false, reason: 'pdf-no-text' }

  const body = normaliseBody(reconstructed.body, paste)
  return {
    ok: true,
    document: {
      body,
      notices: reconstructed.notices,
      meta: extractMeta(reconstructed.text),
      letterhead: [],
      footer: [],
      garbledHindi: reconstructed.quality.suspicious,
      source: 'pdf',
    },
  }
}

// ------------------------------------------------------------------ public

/**
 * A chosen file, as a document.
 *
 * The extension decides which reader runs and the MAGIC NUMBER decides whether
 * it may: a `.docx` that is not a zip and a `.pdf` that does not start `%PDF`
 * are refused with `wrong-kind` before a library is even loaded, which is both
 * faster and a message an officer can act on.
 */
export async function importFile(file: File, paste: PasteOptions = {}): Promise<ImportResult> {
  const extension = extensionOf(file.name)
  if (file.size === 0) return { ok: false, reason: 'empty' }
  if (!['.docx', '.pdf', '.txt', '.md'].includes(extension)) {
    return { ok: false, reason: 'unsupported' }
  }

  const bytes = await readBytes(file)
  if (bytes === 'too-big') return { ok: false, reason: 'too-big' }
  if (bytes.length === 0) return { ok: false, reason: 'empty' }

  const kind = sniff(bytes)
  try {
    if (extension === '.docx') {
      if (kind !== 'zip') return { ok: false, reason: 'wrong-kind' }
      return await fromDocx(bytes, paste)
    }
    if (extension === '.pdf') {
      if (kind !== 'pdf') return { ok: false, reason: 'wrong-kind' }
      return await fromPdf(bytes, paste)
    }
    const text = new TextDecoder().decode(bytes)
    const cleaned = cleanPastedText(text, paste)
    if (!text.trim()) return { ok: false, reason: 'empty' }
    return {
      ok: true,
      document: {
        body: cleaned.body,
        notices: cleaned.notices,
        meta: extractMeta(text),
        letterhead: [],
        footer: [],
        garbledHindi: false,
        source: 'text',
      },
    }
  } catch {
    // A corrupt archive, a PDF with a broken cross-reference table, a `.docx`
    // that is really a `.doc`. None of these is something an officer can fix
    // from an exception object, so the screen offers the paste box instead.
    return { ok: false, reason: 'failed' }
  }
}
