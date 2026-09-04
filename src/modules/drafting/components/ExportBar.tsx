import { AlertTriangle, ClipboardCopy, Download, Printer } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'
import { serialise, serialiseBilingual } from '@/lib/drafting/engine'
import type { BilingualRenderResult, ChecklistResult, RenderResult } from '@/lib/drafting/types'
import type { PreviewView } from '../url'

/**
 * Export: Word, print, clipboard — and the gate in front of them.
 *
 * ### The gate
 *
 * A failing **required** checklist item blocks the export. That is the one
 * piece of this module that says no to an officer, and it is deliberate: the
 * items in that class are the ones that make a document the wrong document —
 * an Office Memorandum written in the first person, paragraphs numbered
 * against the specimen, or a `{{signatoryName}}` still sitting in the
 * signature block. Exporting one of those produces a file that looks finished
 * and is not, and the cost of catching it here is a click.
 *
 * A failing **recommended** item does not block. It asks once, and the second
 * press goes through. The difference matters: an app that treats "the guard
 * file is not on the copy-to list" as equally fatal to "this is not an O.M."
 * teaches officers to click past both.
 *
 * The block is on the export, never on the typing. Nothing here prevents an
 * officer from writing anything, and "Copy as text" is deliberately OUTSIDE
 * the gate — a reader who wants the text out of this app always gets it.
 *
 * ### Why `docx` is imported inside the handler
 *
 * It is ~340 KB, it is needed once per document at most, and a great many
 * drafts are printed rather than exported. A static import would put it in the
 * editor's chunk and charge every visit to `/draft/documents` for it. The dynamic import
 * is what keeps the route light, in the same way `useLawEngine(enabled)` keeps
 * 490 KB of statute off a reader who has not searched yet.
 */

export function ExportBar({
  view,
  single,
  bilingual,
  checklist,
  fileNumber,
  fallbackName,
  onOpenChecklist,
}: {
  view: PreviewView
  single: RenderResult | null
  bilingual: BilingualRenderResult | null
  checklist: ChecklistResult[]
  fileNumber: string
  fallbackName: string
  onOpenChecklist: () => void
}) {
  const { t } = useT()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [override, setOverride] = useState(false)

  const failing = checklist.filter((item) => !item.passed)
  const must = failing.filter((item) => item.severity === 'must').length
  const should = failing.length - must

  const blocked = must > 0
  const needsOverride = !blocked && should > 0 && !override

  /** The documents this view would export: one, or both in layout order. */
  const documents =
    view === 'both'
      ? bilingual
        ? [bilingual.en.document, bilingual.hi.document]
        : []
      : single
        ? [single.document]
        : []

  const download = async () => {
    if (documents.length === 0) return
    setBusy(true)
    setMessage('')
    try {
      const { docxFileName, toDocxBlob } = await import('@/lib/drafting/docx')
      const blob = await toDocxBlob(documents)
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = docxFileName({
        fileNumber,
        fallback: fallbackName,
        lang: view === 'both' ? 'EN-HI' : view.toUpperCase(),
      })
      document.body.append(anchor)
      anchor.click()
      anchor.remove()
      // Revoked on the next frame, not immediately: Safari has not started
      // reading the blob when `click()` returns, and revoking synchronously
      // produces a download of zero bytes with no error anywhere.
      requestAnimationFrame(() => URL.revokeObjectURL(url))
    } catch {
      setMessage(t('draft.export.failed'))
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    const text =
      view === 'both' && bilingual ? serialiseBilingual(bilingual) : single ? serialise(single.document) : ''
    try {
      await navigator.clipboard.writeText(text)
      setMessage(t('draft.export.copied'))
    } catch {
      setMessage(t('draft.export.copyFailed'))
    }
  }

  return (
    <div data-print-hide className="flex flex-col gap-3">
      {blocked ? (
        <div role="status" className="flex flex-col gap-2 rounded-lg border border-coral/30 bg-coral/15 p-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-coral-foreground">
            <AlertTriangle aria-hidden="true" className="h-4 w-4 shrink-0" />
            {t('draft.export.blockedTitle')}
          </p>
          <p className="text-sm text-coral-foreground">{t('draft.export.blockedBody')}</p>
          <div>
            <Button type="button" variant="outline" size="sm" onClick={onOpenChecklist}>
              {t('draft.export.openChecklist')}
            </Button>
          </div>
        </div>
      ) : null}

      {needsOverride ? (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border-l-[3px] border-marigold bg-marigold/15 px-3 py-2"
        >
          <p className="text-sm text-marigold-foreground">{t('draft.export.anywayHint')}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => setOverride(true)}>
            {t('draft.export.anyway')}
          </Button>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          onClick={() => void download()}
          disabled={busy || blocked || needsOverride || documents.length === 0}
        >
          <Download aria-hidden="true" className="h-4 w-4" />
          {busy ? t('draft.export.building') : t('draft.export.docx')}
        </Button>

        <Button
          type="button"
          variant="outline"
          onClick={() => window.print()}
          disabled={blocked || needsOverride}
        >
          <Printer aria-hidden="true" className="h-4 w-4" />
          {t('draft.export.print')}
        </Button>

        {/*
          Outside the gate, always. Blocking the clipboard would mean an app
          that holds an officer's own words hostage to its own checklist, which
          is not what a checklist is for.
        */}
        <Button type="button" variant="outline" onClick={() => void copy()}>
          <ClipboardCopy aria-hidden="true" className="h-4 w-4" />
          {t('draft.export.copy')}
        </Button>
      </div>

      <p aria-live="polite" className="text-xs text-muted-foreground">
        {message}
      </p>
    </div>
  )
}
