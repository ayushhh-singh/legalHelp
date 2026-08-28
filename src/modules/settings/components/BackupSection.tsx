import { useRef, useState } from 'react'

import pkg from '../../../../package.json'

import { backupFileName, buildBackup, isBackupFile, restoreBackup, type RestoreResult } from '@/lib/backup'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'

type ImportState = { status: 'idle' } | { status: 'success'; result: RestoreResult } | { status: 'error' }

/**
 * "Export all my data" / "Import backup" (Settings).
 *
 * Export is a client-side Blob download — the same pattern
 * `HolidaysPage.tsx`'s `.ics` export and the Drafting Studio's `.docx` export
 * already use — and import reads the picked file with `File#text()`. Neither
 * touches the network: a backup is a file on the reader's own device, moving
 * between the reader's own devices by whatever means they choose.
 */
export function BackupSection() {
  const { t } = useT()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [importState, setImportState] = useState<ImportState>({ status: 'idle' })

  const exportBackup = async () => {
    const file = await buildBackup(pkg.version)
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = backupFileName(file.exportedAt)
    anchor.click()
    // Freed next frame, not immediately: revoking before the click has been
    // acted on produces a download of zero bytes with no error anywhere —
    // the same reason ExportBar.tsx's .docx export defers it.
    requestAnimationFrame(() => URL.revokeObjectURL(url))
  }

  const importBackup = async (files: FileList | null) => {
    const picked = files?.[0]
    if (!picked) return
    try {
      const parsed: unknown = JSON.parse(await picked.text())
      if (!isBackupFile(parsed)) {
        setImportState({ status: 'error' })
        return
      }
      const result = await restoreBackup(parsed)
      setImportState({ status: 'success', result })
    } catch {
      setImportState({ status: 'error' })
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={() => void exportBackup()}>
          {t('pages.settings.backup.export')}
        </Button>
        <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}>
          {t('pages.settings.backup.import')}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json"
          className="sr-only"
          aria-label={t('pages.settings.backup.import')}
          onChange={(event) => void importBackup(event.target.files)}
        />
      </div>

      {importState.status === 'error' ? (
        <p role="alert" className="text-sm text-destructive">
          {t('pages.settings.backup.importError')}
        </p>
      ) : null}

      {importState.status === 'success' ? (
        <div className="flex flex-col gap-2">
          <p role="status" className="text-sm text-tulsi-foreground">
            {t('pages.settings.backup.importSuccess', {
              count: Object.values(importState.result.restored).reduce((sum, n) => sum + n, 0),
            })}
          </p>
          {/*
            Everything else a restore can touch (drafts, favourites,
            scenarios, Trainer progress) is read through useLiveQuery, which
            picks up a Dexie write on its own. `settings` is the one table
            that is not — theme, language, ai and onboarded are read into
            useAppStore once at hydrate() and never re-subscribed — so a row
            restored there sits in IndexedDB with no visible effect until a
            reload runs hydrate() again.
          */}
          {'settings' in importState.result.restored ? (
            <div>
              <p className="text-xs text-muted-foreground">{t('pages.settings.backup.reloadHint')}</p>
              <Button type="button" size="sm" onClick={() => window.location.reload()}>
                {t('pages.settings.backup.reload')}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
