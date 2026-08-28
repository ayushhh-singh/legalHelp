import { clearAllData, db } from '@/db'

/**
 * "Export all my data" / "Import backup" / "Erase all my data" (Settings).
 *
 * Every table is included EXCEPT the three that must never leave the device:
 * `secrets` is the AI key vault (ciphertext, but a passphrase-mode vault is
 * only as safe as the passphrase, and moving it into a portable file is a
 * real weakening of "on-device only" even if the bytes are encrypted);
 * `aiAnswers` and `aiUsage` are a cache and a billing ledger, neither of
 * which is something a reader saved on purpose. Excluding by name rather
 * than including by name means a table a later session adds is backed up by
 * default, the same convention `clearAllData` already uses for erase.
 */
const EXCLUDED_FROM_BACKUP = new Set(['secrets', 'aiAnswers', 'aiUsage'])

export interface BackupFile {
  app: 'sahayak'
  exportedAt: string
  appVersion: string
  /** One entry per included Dexie table, keyed by table name. */
  tables: Record<string, unknown[]>
}

export async function buildBackup(appVersion: string): Promise<BackupFile> {
  const tables: Record<string, unknown[]> = {}
  for (const table of db.tables) {
    if (EXCLUDED_FROM_BACKUP.has(table.name)) continue
    tables[table.name] = await table.toArray()
  }
  return { app: 'sahayak', exportedAt: new Date().toISOString(), appVersion, tables }
}

/** `<app>-backup-<date>.json`, the date the export was taken. */
export function backupFileName(exportedAt: string): string {
  const date = exportedAt.slice(0, 10)
  return `sahayak-backup-${date}.json`
}

export function isBackupFile(value: unknown): value is BackupFile {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    record.app === 'sahayak' &&
    typeof record.exportedAt === 'string' &&
    Boolean(record.tables) &&
    typeof record.tables === 'object'
  )
}

export interface RestoreResult {
  /** Table name → rows written. */
  restored: Record<string, number>
  /** A key in the file that is not a table this build recognises, or whose value was not an array. */
  skipped: string[]
}

/**
 * Restores by `bulkPut` per table — a merge, not a wipe. A row in the backup
 * overwrites a local row with the same primary key; a local row the backup
 * does not mention is left alone. A reader who wants a clean slate uses
 * "Erase all my data" first, which is a separate, explicit, typed-confirmation
 * action rather than something an import does as a side effect.
 *
 * A row written by a different build is untrusted input like any other
 * (`src/modules/pay/scenarios.ts#asScenario` takes the same stance): a table
 * this build does not have, or a value that is not an array, is skipped and
 * reported rather than thrown on, so one bad key does not fail the whole
 * restore.
 */
export async function restoreBackup(file: BackupFile): Promise<RestoreResult> {
  const known = new Map(db.tables.map((table) => [table.name, table]))
  const restored: Record<string, number> = {}
  const skipped: string[] = []

  for (const [name, rows] of Object.entries(file.tables)) {
    if (EXCLUDED_FROM_BACKUP.has(name) || !Array.isArray(rows)) {
      skipped.push(name)
      continue
    }
    const table = known.get(name)
    if (!table) {
      skipped.push(name)
      continue
    }
    if (rows.length > 0) await table.bulkPut(rows)
    restored[name] = rows.length
  }

  return { restored, skipped }
}

/**
 * "Erase all my data": every Dexie table (`clearAllData`, which iterates
 * `db.tables` so a table added later cannot be left behind), plus the
 * service worker's Cache Storage entries — the precached shell and the
 * `data-v1`/`runtime-v1` runtime caches vite.config.ts declares. Feature-
 * detected: `caches` does not exist in the unit-test jsdom environment or on
 * an insecure origin, and this must still clear IndexedDB either way.
 */
export async function eraseAllLocalData(): Promise<void> {
  await clearAllData()
  if (typeof caches !== 'undefined') {
    const keys = await caches.keys()
    await Promise.all(keys.map((key) => caches.delete(key)))
  }
}
