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
  ai: 'ai',
  /** The last scenario the Pay calculator was left on. */
  pay: 'pay',
} as const

/**
 * Encrypted-at-rest rows for the AI layer (Session 3A). Two shapes share the
 * table: `vault` holds the key-derivation material, everything else holds a
 * ciphertext. Neither ever contains a plaintext secret — see src/ai/crypto.ts
 * for what that does and does not protect against.
 */
export interface VaultRow {
  id: 'vault'
  mode: 'device' | 'passphrase'
  /** PBKDF2 salt; present in passphrase mode only. */
  salt?: Uint8Array
  /**
   * Non-extractable AES-GCM key, structured-cloned into IndexedDB; present in
   * device mode only. Usable for decryption, unreadable as bytes.
   */
  deviceKey?: CryptoKey
  createdAt: string
}

export interface SecretRow {
  id: string
  iv: Uint8Array
  ciphertext: Uint8Array
  updatedAt: string
}

export type SecretsRow = VaultRow | SecretRow

/** One cached AI answer. See src/ai/answer-cache.ts for the matching rules. */
export interface AiAnswerRow {
  id: string
  agentId: string
  language: string
  /** data/_meta/versions.json at the time the answer was produced. */
  dataVersion: string
  promptVersion: number
  /** Lower-cased, punctuation-stripped question — what similarity runs over. */
  normalised: string
  question: string
  answer: string
  json?: unknown
  meta: unknown
  createdAt: string
}

/** Token spend for one calendar month (`YYYY-MM`), for the hard budget stop. */
export interface AiUsageRow {
  month: string
  inputTokens: number
  outputTokens: number
  cacheCreationInputTokens: number
  cacheReadInputTokens: number
  costUsd: number
  runs: number
}

/**
 * A saved section, and a section that was looked at. Both are keyed
 * `"<code>:<section>"` so a second save of the same section overwrites rather
 * than accumulating.
 *
 * `heading` is a snapshot, not a source of truth: it lets the saved list and
 * the recent list render immediately, before the 3.9 MB of section text this
 * module fetches has finished parsing. Every card rendered from one of these
 * rows re-reads the live record from `data/law/*.json` once it is loaded, so a
 * heading corrected by the weekly ingest shows through.
 */
export interface LawSavedRow {
  id: string
  code: string
  section: string
  act: string
  heading: { en: string; hi: string }
  createdAt: string
}

export interface LawRecentRow {
  id: string
  code: string
  section: string
  act: string
  heading: { en: string; hi: string }
  /** What the reader typed to get here — the recent list replays the search. */
  query: string
  viewedAt: string
}

/**
 * A named pay scenario, saved by the reader.
 *
 * `scenario` is a `PayScenario` from `src/lib/pay/scenario.ts`, stored as the
 * plain object it already is. It is deliberately typed `unknown` here: `src/db`
 * is imported by the app shell, and naming the pay types would drag the Pay
 * module's imports onto every route. The Pay module validates the shape on the
 * way out, which it would have to do anyway — a row written by an older release
 * is untrusted input like any other.
 */
export interface PayScenarioRow {
  id: string
  name: string
  scenario: unknown
  /** Denormalised so the saved list can render before the datasets load. */
  jobId: string | null
  level: string
  createdAt: string
  updatedAt: string
}

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS]

export class SahayakDB extends Dexie {
  settings!: Table<SettingRow, string>
  secrets!: Table<SecretsRow, string>
  aiAnswers!: Table<AiAnswerRow, string>
  aiUsage!: Table<AiUsageRow, string>
  lawFavourites!: Table<LawSavedRow, string>
  lawRecents!: Table<LawRecentRow, string>
  payScenarios!: Table<PayScenarioRow, string>

  constructor(name = 'sahayak') {
    super(name)
    // Schema version 1. Bump with a new .version(n).stores({...}).upgrade(...)
    // block; never edit a released version in place.
    this.version(1).stores({
      settings: '&key',
    })
    // Version 2 — the dormant AI layer. All three tables stay empty until the
    // reader turns AI on; declaring them costs nothing and means the kill
    // switch has somewhere to clear from on day one.
    this.version(2).stores({
      settings: '&key',
      secrets: '&id',
      aiAnswers: '&id, agentId, dataVersion, createdAt',
      aiUsage: '&month',
    })
    // Version 3 — the Law Converter's saved sections and recent lookups
    // (Session 4). Both are indexed on their timestamp because both are only
    // ever read newest-first.
    this.version(3).stores({
      settings: '&key',
      secrets: '&id',
      aiAnswers: '&id, agentId, dataVersion, createdAt',
      aiUsage: '&month',
      lawFavourites: '&id, createdAt',
      lawRecents: '&id, viewedAt',
    })
    // Version 4 — the Pay calculator's named scenarios (Session 5). Indexed on
    // `updatedAt` because the list is only ever read newest-first, and on
    // `name` so a rename can check for a clash without scanning the table.
    this.version(4).stores({
      settings: '&key',
      secrets: '&id',
      aiAnswers: '&id, agentId, dataVersion, createdAt',
      aiUsage: '&month',
      lawFavourites: '&id, createdAt',
      lawRecents: '&id, viewedAt',
      payScenarios: '&id, name, updatedAt',
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
