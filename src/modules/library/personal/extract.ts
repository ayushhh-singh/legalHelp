/**
 * Reading a file the reader chose, on the reader's own device.
 *
 * NOTHING HERE REACHES THE NETWORK, and the two libraries that make it possible
 * are behind dynamic imports so that a reader who never adds a document never
 * downloads either. `pdfjs-dist` alone is larger than the whole app.
 *
 * NO OCR. A PDF with no text layer is a photograph of a page, and the honest
 * answer is to say so and stop — which is what the session brief asked for.
 * Guessing at a scan would produce a document full of plausible misreadings of
 * a statute, which is the worst thing this feature could do.
 */

/** Big enough for a rule book, small enough not to hang a phone. */
export const MAX_FILE_BYTES = 12 * 1024 * 1024

export type ExtractFailure = 'too-big' | 'unsupported' | 'no-text-layer' | 'failed'

export type ExtractResult = { ok: true; text: string } | { ok: false; reason: ExtractFailure }

const extensionOf = (name: string): string => name.slice(name.lastIndexOf('.')).toLowerCase()

/**
 * A PDF's text layer, page by page.
 *
 * THE WORKER IS BUNDLED, NOT FETCHED FROM A CDN. `new URL(..., import.meta.url)`
 * is the form Vite rewrites into a hashed same-origin asset, which is the only
 * form the Content-Security-Policy in `public/_headers` permits: `default-src
 * 'self'` covers `worker-src`, and the default pdf.js configuration would reach
 * for a version-matched script on unpkg. That would be a third-party request
 * from an app whose hard rule is that it makes none.
 *
 * `disableFontFace` and `useWorkerFetch` are off because only TEXT is wanted —
 * nothing here renders a page, so there is no reason to compile a font or to
 * fetch a character map. pdf.js 6 no longer takes `isEvalSupported`; it stopped
 * compiling font programmes with `eval` in v5, which is what made this
 * compatible with a policy that has no `unsafe-eval` at all.
 */
async function fromPdf(file: File): Promise<ExtractResult> {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString()
  const buffer = await file.arrayBuffer()

  const document = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    disableFontFace: true,
    useWorkerFetch: false,
  }).promise

  const pages: string[] = []
  for (let number = 1; number <= document.numPages; number += 1) {
    const page = await document.getPage(number)
    const content = await page.getTextContent()
    const line = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (line) pages.push(line)
  }

  const text = pages.join('\n\n')
  // A scan produces zero text items on every page. There is nothing to extract
  // and nothing to guess at.
  if (!text.trim()) return { ok: false, reason: 'no-text-layer' }
  return { ok: true, text }
}

async function fromDocx(file: File): Promise<ExtractResult> {
  const mammoth = await import('mammoth')
  const buffer = await file.arrayBuffer()
  const result = await mammoth.extractRawText({ arrayBuffer: buffer })
  if (!result.value.trim()) return { ok: false, reason: 'no-text-layer' }
  return { ok: true, text: result.value }
}

export async function extractFile(file: File): Promise<ExtractResult> {
  if (file.size > MAX_FILE_BYTES) return { ok: false, reason: 'too-big' }

  const extension = extensionOf(file.name)
  try {
    if (extension === '.txt' || extension === '.md') return { ok: true, text: await file.text() }
    if (extension === '.pdf') return await fromPdf(file)
    if (extension === '.docx') return await fromDocx(file)
    return { ok: false, reason: 'unsupported' }
  } catch {
    // A corrupt file, a password-protected PDF, a .docx that is really a .doc.
    // None of these is something the reader can fix from an error object.
    return { ok: false, reason: 'failed' }
  }
}
