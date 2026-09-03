import {
  DEVANAGARI_STACK,
  docxFileName,
  uniqueName,
  type DocxLetterhead,
  type DocxOptions,
} from '@/lib/drafting/docx'
import { defaultPageSetup, type PageSetup } from '@/lib/drafting/print'
import { embeddableInDocx, type LetterheadType } from '@/lib/drafting/letterhead'
import { pick, type OfficialDoc } from '@/lib/drafting/model'
import { letterheadSizeMm } from './letterheadStore'
import type { LetterheadImageRow } from '@/db'
import type { DocumentModel } from '@/lib/drafting/types'

/**
 * Everything the export surfaces have in common, in one place.
 *
 * `ExportBar` (one document) and the batch export (many) must produce the same
 * `.docx` for the same document — the batch is not a second exporter with its
 * own idea of margins. So both build their `DocxOptions` here, and the only
 * thing the batch adds is the archive around the result.
 */

export interface ExportSettings {
  page: PageSetup
  bilingual: 'sequential' | 'sideBySide'
  /** Body paragraph numbers as real Word numbering, so Word renumbers on edit. */
  wordNumbering: boolean
  /** Print the profile's letterhead lines and image in the running header. */
  letterhead: boolean
  pageNumbers: boolean
}

export const defaultExportSettings = (): ExportSettings => ({
  page: defaultPageSetup('A4'),
  bilingual: 'sequential',
  wordNumbering: true,
  letterhead: true,
  pageNumbers: true,
})

/** The stored image as `docx` wants it, or null when it cannot be embedded. */
export async function docxLetterhead(row: LetterheadImageRow | null): Promise<DocxLetterhead | null> {
  if (!row) return null
  if (!embeddableInDocx(row.type as LetterheadType)) return null
  const size = letterheadSizeMm(row)
  return {
    data: new Uint8Array(await row.data.arrayBuffer()),
    format: row.type === 'image/jpeg' ? 'jpg' : 'png',
    widthMm: size.widthMm,
    heightMm: size.heightMm,
  }
}

export interface BuildOptionsArgs {
  doc: OfficialDoc
  lang: 'en' | 'hi'
  settings: ExportSettings
  letterhead: DocxLetterhead | null
  /** Translated strings — this module never reaches for i18n itself. */
  labels: { pageOf: string; columnEn: string; columnHi: string }
}

/**
 * The `.docx` options for one document.
 *
 * `meta.from.letterhead` is the profile's own snapshot, taken when the document
 * was created (ADR-041 §5) — so a document exported today carries the
 * letterhead it was written under, not the one the officer has now. That is the
 * same rule the signature block follows and it is deliberate: a document
 * already issued has to render tomorrow exactly as it rendered the day it went
 * out.
 */
export function buildDocxOptions(args: BuildOptionsArgs): DocxOptions {
  const { doc, lang, settings, letterhead, labels } = args

  /*
    `headerLines` is deliberately left EMPTY, and that is not an oversight.

    `renderOfficialDoc`'s `applyStationery` already prepends the profile's
    letterhead lines to the document's first `header` block, so they are part of
    the document and reach the `.docx` through the ordinary block path. Putting
    them in the running header as well would print the officer's letterhead
    twice on page one.

    The running header carries the IMAGE only, which the block path cannot
    express — and a repeating image is the right behaviour for one in a way a
    repeating letterhead is not: CSMOP's specimens print the letterhead once, at
    the head of the first page.
  */

  return {
    page: settings.page,
    devanagariFonts: DEVANAGARI_STACK,
    wordNumbering: settings.wordNumbering,
    bilingual: settings.bilingual,
    columnHeadings: [labels.columnEn, labels.columnHi],
    headerLines: [],
    letterhead: settings.letterhead ? letterhead : null,
    pageNumbers: settings.pageNumbers,
    pageNumberLabel: { of: labels.pageOf },
    numberDate: doc.meta.number && doc.meta.date ? { number: doc.meta.number, date: doc.meta.date } : null,
    properties: {
      title: doc.title || pick(doc.meta.subject, lang),
      subject: pick(doc.meta.subject, lang),
      // The officer's own name, out of the document's own snapshot of the
      // profile. Never the app's name: a `creator` naming Sahayak would be a
      // claim about authorship of a document an officer signs.
      creator: pick(doc.meta.signature.name, lang) || pick(doc.meta.from.name, lang),
      description: '',
      keywords: doc.tags.join(', '),
    },
  }
}

/** The file name for one exported document, deduplicated within a batch. */
export function nameFor(doc: OfficialDoc, fallback: string, lang: string, taken: Set<string>): string {
  return uniqueName(docxFileName({ fileNumber: doc.meta.number, fallback, lang }), taken)
}

/**
 * Save a blob to the officer's device.
 *
 * The object URL is revoked on the NEXT FRAME rather than immediately: Safari
 * has not started reading the blob when `click()` returns, and revoking
 * synchronously produces a download of zero bytes with no error anywhere.
 */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  requestAnimationFrame(() => URL.revokeObjectURL(url))
}

/**
 * Whether the browser can share these files, asked before anything is built.
 *
 * `navigator.canShare` with the actual files, not `'share' in navigator`: every
 * desktop Chrome has `share` and none of them accepts a `.docx`, so the feature
 * check that matters is the one that names the payload. A browser that says no
 * gets the download instead, with no error and no explanation needed.
 */
export function canShareFiles(files: readonly File[]): boolean {
  const shareable = navigator as Navigator & { canShare?: (data: ShareData) => boolean }
  if (typeof shareable.canShare !== 'function' || typeof navigator.share !== 'function') return false
  try {
    return shareable.canShare({ files: [...files] })
  } catch {
    return false
  }
}

/** The documents to export for a view — one language, or both in layout order. */
export const documentsFor = (
  view: 'en' | 'hi' | 'both',
  single: DocumentModel | null,
  bilingual: { en: DocumentModel; hi: DocumentModel } | null,
): DocumentModel[] =>
  view === 'both' ? (bilingual ? [bilingual.en, bilingual.hi] : []) : single ? [single] : []
