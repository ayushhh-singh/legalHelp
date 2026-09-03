/**
 * The letterhead image an officer supplies.
 *
 * ### The app provides no emblem
 *
 * There is no Government of India emblem, no ministry crest and no seal
 * anywhere in this repository, and there will not be. Reproducing the State
 * Emblem is governed by the State Emblem of India (Prohibition of Improper
 * Use) Act 2005, and an app that shipped one would be handing every reader a
 * ready-made letterhead for an office they may not hold. What this file does is
 * accept an image the OFFICER supplies — whatever their own office permits them
 * to use — and the surface says so in both languages beside the control.
 *
 * ### The checks, and why an SVG needs a different one
 *
 * A PNG or JPEG is inert: the worst a malformed one does is fail to decode. An
 * SVG is a document that can carry script, an external reference and a
 * stylesheet, and it is rendered by the browser. This app never renders an
 * uploaded SVG inline — it goes in an `<img src="blob:…">`, where scripts do
 * not run and external references are blocked by the Content-Security-Policy —
 * and `svgIsInert` is the second belt: it refuses a file naming a script, an
 * event handler or an external URL, so a file that would have been blocked at
 * render time is refused at upload time, where the officer can be told why.
 */

/** Big enough for a scanned letterhead at 300 dpi, small enough to embed. */
export const LETTERHEAD_MAX_BYTES = 512 * 1024

/** What the header band can be without pushing the document off its first page. */
export const LETTERHEAD_MAX_HEIGHT_MM = 30
export const LETTERHEAD_MAX_WIDTH_MM = 160

export const LETTERHEAD_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml'] as const
export type LetterheadType = (typeof LETTERHEAD_TYPES)[number]

export type LetterheadRejection = 'too-big' | 'unsupported' | 'empty' | 'unsafe-svg'

export type LetterheadCheck = { ok: true; type: LetterheadType } | { ok: false; reason: LetterheadRejection }

const BY_EXTENSION: Record<string, LetterheadType> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
}

/**
 * The file, checked before anything reads it.
 *
 * The MIME type is believed only when it is one we accept — a browser reports
 * `application/octet-stream` for a `.svg` on some platforms and
 * `image/x-png` for a `.png` on others — so the extension is the fallback and
 * neither alone is trusted. A file whose extension and type disagree about
 * which of our three it is takes the extension, because that is what the
 * officer chose.
 */
export function checkLetterheadFile(file: { name: string; type: string; size: number }): LetterheadCheck {
  if (file.size === 0) return { ok: false, reason: 'empty' }
  if (file.size > LETTERHEAD_MAX_BYTES) return { ok: false, reason: 'too-big' }
  const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
  const byExtension = BY_EXTENSION[extension]
  if (byExtension) return { ok: true, type: byExtension }
  const byType = LETTERHEAD_TYPES.find((entry) => entry === file.type)
  if (byType) return { ok: true, type: byType }
  return { ok: false, reason: 'unsupported' }
}

const SCRIPTY = [
  /<\s*script\b/i,
  /\bon[a-z]+\s*=/i,
  /javascript\s*:/i,
  /<\s*foreignObject\b/i,
  /<\s*use\b[^>]*\b(?:xlink:)?href\s*=\s*["']\s*(?:https?:)?\/\//i,
  /<\s*image\b[^>]*\b(?:xlink:)?href\s*=\s*["']\s*(?:https?:)?\/\//i,
  /@import\b/i,
  /<!ENTITY\b/i,
]

/** True when an SVG contains nothing that executes or fetches. */
export function svgIsInert(source: string): boolean {
  return !SCRIPTY.some((pattern) => pattern.test(source))
}

/**
 * Whether a stored image can be embedded in a `.docx`.
 *
 * Word's `ImageRun` needs a raster for an SVG — the format carries a PNG
 * fallback alongside the vector, and there is no rasteriser in this app to make
 * one (adding `<canvas>` here would put a browser API into a pure module, and
 * `OffscreenCanvas` is not universal). So an SVG letterhead prints and previews
 * and is left out of the Word file, with the export saying so rather than
 * silently producing a document with no letterhead on it.
 */
export const embeddableInDocx = (type: LetterheadType): boolean => type !== 'image/svg+xml'

/** Width and height in twentieths of a point, from millimetres. */
export const mmToTwip = (mm: number): number => Math.round((mm / 25.4) * 1440)

/**
 * The size the image prints at, fitted inside the header band.
 *
 * Aspect ratio is preserved and the image is never enlarged: a 40-pixel-wide
 * logo blown up to 160mm is a smear, and an officer who supplied a small file
 * meant a small mark.
 */
export function fitLetterhead(
  natural: { width: number; height: number },
  box: { widthMm: number; heightMm: number } = {
    widthMm: LETTERHEAD_MAX_WIDTH_MM,
    heightMm: LETTERHEAD_MAX_HEIGHT_MM,
  },
): { widthMm: number; heightMm: number } {
  if (natural.width <= 0 || natural.height <= 0) return { widthMm: 0, heightMm: 0 }
  // 96 CSS pixels to the inch is what a browser reports for an image with no
  // physical size of its own, which is every PNG and every SVG without a
  // `width` in millimetres.
  const naturalWidthMm = (natural.width / 96) * 25.4
  const naturalHeightMm = (natural.height / 96) * 25.4
  const scale = Math.min(1, box.widthMm / naturalWidthMm, box.heightMm / naturalHeightMm)
  return {
    widthMm: Math.round(naturalWidthMm * scale * 10) / 10,
    heightMm: Math.round(naturalHeightMm * scale * 10) / 10,
  }
}
