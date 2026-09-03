import { ClipboardCopy, FileArchive, Share2 } from 'lucide-react'
import { useState } from 'react'

import { batchPlainText, buildBatchZip } from './exportBatch'
import { canShareFiles, defaultExportSettings, saveBlob, shareFallbackNeeded } from '../exportDoc'

import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'

/**
 * The bar that appears once documents are selected.
 *
 * Three actions, and the difference between them is deliberate:
 *
 * - **A `.zip` of Word files** is the one an office actually wants, and it is
 *   built entirely on the device — `src/lib/drafting/zip.ts` writes the archive
 *   with the platform's own DEFLATE and no dependency.
 * - **Copy as plain text** is outside every gate, exactly as it is for a single
 *   document: an app that holds an officer's own words hostage to its own
 *   checklist is not what a checklist is for.
 * - **Share** is offered only when `navigator.canShare` says yes to the ACTUAL
 *   files. Every desktop Chrome has `navigator.share` and none of them accepts
 *   a `.docx`, so the feature check that matters is the one naming the payload.
 *
 * Progress is real. Packing thirty `.docx` files is CPU work in this thread, so
 * `exportBatch` does them one at a time and reports between each; a spinner
 * with no number is what makes an officer close the tab at document nineteen.
 */
export function BatchExportBar({ ids, onClear }: { ids: readonly string[]; onClear: () => void }) {
  const { t, language } = useT()
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [message, setMessage] = useState('')

  const labels = {
    pageOf: t('draft.print.pageOf'),
    columnEn: t('draft.preview.columnEn'),
    columnHi: t('draft.preview.columnHi'),
  }

  const zipName = `${t('draft.batch.zipName')}.zip`

  const run = async (then: (blob: Blob, count: number, failed: string[]) => void) => {
    setBusy(true)
    setMessage('')
    setProgress({ done: 0, total: ids.length })
    try {
      const built = await buildBatchZip(ids, {
        lang: language,
        settings: defaultExportSettings(),
        labels,
        modified: new Date(),
        onProgress: (done, total) => setProgress({ done, total }),
      })
      // `Uint8Array` → `Blob` here rather than in `buildBatchZip`, so the pure
      // side of the batch stays testable without a `Blob` at all.
      then(new Blob([built.zip as BlobPart], { type: 'application/zip' }), built.count, built.failed)
      setMessage(
        [
          t('draft.batch.done', { count: built.count }),
          built.failed.length > 0 ? t('draft.batch.partial', { count: built.failed.length }) : '',
        ]
          .filter(Boolean)
          .join(' '),
      )
    } catch {
      setMessage(t('draft.batch.failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-muted/50 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{t('draft.batch.selected', { count: ids.length })}</span>

        <Button
          size="sm"
          disabled={busy || ids.length === 0}
          onClick={() => void run((blob) => saveBlob(blob, zipName))}
        >
          <FileArchive aria-hidden="true" className="mr-1 size-4" />
          {t('draft.batch.exportZip')}
        </Button>

        <Button
          size="sm"
          variant="outline"
          disabled={busy || ids.length === 0}
          onClick={() => {
            void batchPlainText(ids, language)
              .then((text) => navigator.clipboard.writeText(text))
              .then(() => setMessage(t('draft.batch.copied')))
              // Every copy affordance in this app wraps the clipboard: an
              // insecure origin, a denied permission or a locked-down managed
              // device otherwise gives an unhandled rejection and a button that
              // silently does nothing.
              .catch(() => setMessage(t('draft.batch.copyFailed')))
          }}
        >
          <ClipboardCopy aria-hidden="true" className="mr-1 size-4" />
          {t('draft.batch.copyText')}
        </Button>

        <Button
          size="sm"
          variant="outline"
          disabled={busy || ids.length === 0}
          onClick={() =>
            void run((blob) => {
              const file = new File([blob], zipName, { type: 'application/zip' })
              if (canShareFiles([file])) {
                void navigator
                  .share({ files: [file], title: t('draft.batch.shareTitle') })
                  .catch((error: unknown) => {
                    /*
                      A cancellation is `AbortError` and is not a failure — the
                      officer pressed Cancel. ANYTHING else is, and the commonest
                      one is `NotAllowedError`: `navigator.share` needs the user
                      gesture that started the call, and building the archive
                      spends it. Swallowing that left the officer with no file,
                      no message and no error on a perfectly ordinary press.
                    */
                    if (!shareFallbackNeeded(error)) return
                    saveBlob(blob, zipName)
                    setMessage(t('draft.batch.sharedAsDownload'))
                  })
                return
              }
              saveBlob(blob, zipName)
            })
          }
        >
          <Share2 aria-hidden="true" className="mr-1 size-4" />
          {t('draft.batch.share')}
        </Button>

        <Button size="sm" variant="ghost" onClick={onClear} disabled={busy}>
          {t('draft.batch.clearSelection')}
        </Button>
      </div>

      <p aria-live="polite" className="text-sm text-muted-foreground">
        {busy ? t('draft.batch.building', { done: progress.done, total: progress.total }) : message}
      </p>
    </div>
  )
}
