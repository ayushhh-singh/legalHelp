import Dexie, { type Table } from 'dexie'

/**
 * All user state lives here, on the device (master context, hard rule).
 * There is no account, no server and no sync. Every table added in future
 * sessions must keep that property.
 */

export interface SettingRow {
  key: string
  value: unknown
}

/** Keys are declared centrally so a typo cannot create an orphan row. */
export const SETTING_KEYS = {
  language: 'language',
  theme: 'theme',
  pwaOfflineReadyNoticeShown: 'pwaOfflineReadyNoticeShown',
} as const

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS]

export class SahayakDB extends Dexie {
  settings!: Table<SettingRow, string>

  constructor(name = 'sahayak') {
    super(name)
    // Schema version 1. Bump with a new .version(n).stores({...}).upgrade(...)
    // block; never edit a released version in place.
    this.version(1).stores({
      settings: '&key',
    })
  }
}

export const db = new SahayakDB()

export async function getSetting<T>(key: SettingKey): Promise<T | undefined> {
  const row = await db.settings.get(key)
  return row?.value as T | undefined
}

export async function setSetting(key: SettingKey, value: unknown): Promise<void> {
  await db.settings.put({ key, value })
}

/**
 * Used by Settings ("clear stored data") and by tests. Iterates every table so
 * a table added in a later session cannot be silently left behind.
 */
export async function clearAllData(): Promise<void> {
  await Promise.all(db.tables.map((table) => table.clear()))
}
