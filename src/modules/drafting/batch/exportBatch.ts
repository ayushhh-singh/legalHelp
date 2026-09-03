import { getDocument } from '../documents'
import { loadTemplate } from '../data'
import { getPersonal } from '../personalStore'
import { getLetterhead } from '../letterheadStore'
import {
  buildDocxOptions,
  defaultExportSettings,
  docxLetterhead,
  nameFor,
  type ExportSettings,
} from '../exportDoc'

import { resolvePersonal } from '@/lib/drafting/personal'
import { renderOfficialDoc } from '@/lib/drafting/renderDoc'
import { serialise } from '@/lib/drafting/engine'
import { writeZip, type ZipEntry } from '@/lib/drafting/zip'
import type { Lang } from '@/lib/drafting/types'

/**
 * Exporting several documents at once.
 *
 * Everything here is on the device and nothing is a second implementation:
 * each document goes through the same `renderOfficialDoc` the editor's preview
 * uses and the same `toDocxBlob` the single-document export uses, and the only
 * thing this file adds is the archive around the results.
 *
 * ### It reports what it could not do
 *
 * A batch of thirty in which two documents fail to render must not be an
 * archive of twenty-eight presented as an archive of thirty. `failed` carries
 * every id that did not make it and the surface says how many — which is the
 * same rule the study layer learned about `Promise.all` (a due list that
 * silently disappears is worse than a short one) applied to a file an officer
 * is about to send somewhere.
 *
 * ### Sequential, not `Promise.all`
 *
 * Packing a `.docx` is CPU work in the main thread, and thirty at once on a
 * phone is a frozen tab. They are packed one at a time with a progress callback
 * between them, so the page can say "12 of 30" and stay responsive.
 */

export interface BatchOptions {
  lang: Lang
  settings?: ExportSettings
  labels: { pageOf: string; columnEn: string; columnHi: string }
  onProgress?: (done: number, total: number) => void
  /** Aborts between documents. A half-written archive is never handed over. */
  signal?: AbortSignal
}

export interface BatchResult {
  entries: ZipEntry[]
  failed: string[]
}

/** Every selected document as a `.docx`, in memory. */
export async function buildBatchEntries(ids: readonly string[], options: BatchOptions): Promise<BatchResult> {
  const settings = options.settings ?? defaultExportSettings()
  const letterheadRow = settings.letterhead ? ((await getLetterhead()) ?? null) : null
  const letterhead = await docxLetterhead(letterheadRow)
  const taken = new Set<string>()
  const entries: ZipEntry[] = []
  const failed: string[] = []

  // Imported once for the whole batch rather than per document: `docx` is
  // ~340 KB and the dynamic import is cached, but naming it once here makes
  // the single load obvious to anyone reading for bundle behaviour.
  const { toDocxBytes } = await import('@/lib/drafting/docx')

  for (const [index, id] of ids.entries()) {
    if (options.signal?.aborted) break
    try {
      const found = await getDocument(id)
      if (!found.ok) {
        failed.push(id)
        continue
      }
      const base = await loadTemplate(found.doc.templateId)
      const personal = found.doc.personalTemplateId ? await getPersonal(found.doc.personalTemplateId) : null
      const template = personal ? resolvePersonal(base, personal) : base

      const rendered = renderOfficialDoc(found.doc, template, options.lang)
      const bytes = await toDocxBytes([rendered.document], {
        ...buildDocxOptions({
          doc: found.doc,
          lang: options.lang,
          settings,
          letterhead,
          labels: options.labels,
        }),
      })
      entries.push({
        name: nameFor(found.doc, template.shortName[options.lang], options.lang.toUpperCase(), taken),
        data: bytes,
      })
    } catch {
      failed.push(id)
    }
    options.onProgress?.(index + 1, ids.length)
  }

  return { entries, failed }
}

/** The same, packed into one `.zip`. */
export async function buildBatchZip(
  ids: readonly string[],
  options: BatchOptions & { modified?: Date },
): Promise<{ zip: Uint8Array; count: number; failed: string[] }> {
  const built = await buildBatchEntries(ids, options)
  const zip = await writeZip(built.entries, options.modified ? { modified: options.modified } : {})
  return { zip, count: built.entries.length, failed: built.failed }
}

/**
 * Every selected document as plain text, separated by a rule.
 *
 * Deliberately OUTSIDE any checklist gate, exactly as "Copy as text" is on one
 * document: blocking the clipboard would mean an app that holds an officer's
 * own words hostage to its own checklist.
 */
export async function batchPlainText(ids: readonly string[], lang: Lang): Promise<string> {
  const parts: string[] = []
  for (const id of ids) {
    try {
      const found = await getDocument(id)
      if (!found.ok) continue
      const base = await loadTemplate(found.doc.templateId)
      const personal = found.doc.personalTemplateId ? await getPersonal(found.doc.personalTemplateId) : null
      const template = personal ? resolvePersonal(base, personal) : base
      parts.push(serialise(renderOfficialDoc(found.doc, template, lang).document))
    } catch {
      // One document that will not render must not cost the officer the other
      // twenty-nine; it is simply not in the text.
    }
  }
  return parts.join('\n\n' + '—'.repeat(40) + '\n\n')
}
