import Dexie, { type Table } from 'dexie'

import type { ReviewLogRow, SrsCardRow, StreakRow, TrainerSettingsRow } from '@/lib/srs/types'

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
  /** The Drafting Studio's editor preferences — preview tab, Devanagari digits. */
  draft: 'draft',
  /** The Trainer's local daily-reminder toggle — see src/modules/trainer/reminder.ts. */
  learnReminder: 'learnReminder',
  /**
   * The Library reader's own type and language controls — reading mode, text
   * size step, typeface and line spacing. A preference, not reading state:
   * what has been READ is per unit and lives in `libraryProgress`.
   */
  library: 'library',
  /** True once the first-run onboarding has been completed or skipped. */
  onboarded: 'onboarded',
  /** Devanagari digits (०-९) in place of Arabic ones, applied wherever numerals render. */
  devanagariDigits: 'devanagariDigits',
  /**
   * Whether `useAutoDataUpdateCheck` may run at all — default true (ADR-034).
   * Independent of the manual "Check for data updates" button, which always
   * works regardless of this setting.
   */
  dataUpdateAutoCheck: 'dataUpdateAutoCheck',
  /** ISO instant of the last automatic check, so it runs at most once a day. Not user-facing. */
  dataUpdateLastChecked: 'dataUpdateLastChecked',
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

/**
 * One draft an officer is writing, or has written.
 *
 * `values` is a `DraftValues` from `src/lib/drafting/types.ts` — a plain map of
 * field id to a string, a list of strings, or an `{ en, hi }` pair — and it is
 * typed `unknown` here for the reason `PayScenarioRow.scenario` is: `src/db` is
 * imported by the app shell, and naming the drafting types would drag the
 * Drafting module's imports onto every route. The module validates the shape on
 * the way out, which it would have to do anyway, because a row written by an
 * older release is untrusted input like any other.
 *
 * `templateId` is denormalised and indexed so the recent list can be rendered,
 * and a draft resumed, without loading a single 24 KB template.
 */
export interface DraftRow {
  id: string
  templateId: string
  /** What the reader named it, or the subject line, or the form's own name. */
  title: string
  values: unknown
  createdAt: string
  updatedAt: string
}

/**
 * "Save as my template" — the field values an officer wants back every time.
 *
 * Deliberately a separate table from `drafts` rather than a flag on one. A
 * draft is a document with a life cycle; this is a set of defaults, it is
 * applied to new drafts rather than opened, and deleting every draft must not
 * take an officer's letterhead with it.
 */
export interface DraftDefaultsRow {
  id: string
  templateId: string
  name: string
  values: unknown
  createdAt: string
  updatedAt: string
}

/**
 * A saved glossary term, and a term that was looked at — the same shape law's
 * `LawSavedRow`/`LawRecentRow` use, and for the same reason: `termId` is the
 * primary key so re-saving or re-viewing a term overwrites rather than
 * accumulating, and `en`/`hi` are a snapshot that lets the list render before
 * `data/glossary.json` has finished loading.
 */
export interface GlossaryFavouriteRow {
  id: string
  termId: string
  en: string
  hi: string
  createdAt: string
}

export interface GlossaryRecentRow {
  id: string
  termId: string
  en: string
  hi: string
  viewedAt: string
}

/**
 * The Rules Trainer's four tables (Session 11).
 *
 * Their row shapes are declared in `src/lib/srs/types.ts` rather than here, and
 * the import above is the only place `src/db` reaches into a module directory.
 * The direction is deliberate: the scheduler owns what a schedule *is* — the
 * meaning of `stability`, of `learningSteps`, of an IST `date` — and this file
 * owns where it is kept. `import type` means no runtime edge in either
 * direction, so nothing in `src/lib/srs` is downloaded by a reader who never
 * opens the Trainer.
 *
 * `srsCards` carries no card text and no act id. The act, the rule, the
 * question and the answer are in `data/rules`, which is versioned and shipped
 * with the build; a copy here would be a second copy that a dataset refresh
 * could not correct.
 */
export type { ReviewLogRow, SrsCardRow, StreakRow, TrainerSettingsRow }

/**
 * A card the reader has marked to come back to, outside the FSRS schedule.
 * Keyed on `qId` alone — bookmarking is a toggle, not a log, so a second
 * bookmark of the same card has nothing to accumulate.
 */
export interface TrainerBookmarkRow {
  qId: string
  createdAt: string
}

/**
 * A flagged card, kept for an auditor rather than acted on automatically. Never
 * deleted by the reader — "exportable" in the session brief means read out,
 * not cleared, so a flag survives until someone with the dataset in front of
 * them resolves it.
 */
export interface TrainerReportRow {
  id: string
  qId: string
  reason: string
  note: string
  createdAt: string
}

/**
 * A card an AI agent has drafted via the `proposeCard` tool (`src/ai/tools/
 * rules.ts`), sitting outside `data/rules` until a reader accepts it.
 *
 * `card` is typed `unknown` for the reason `PayScenarioRow.scenario` is: `src/db`
 * is imported by the app shell, and naming the trainer's schema types here
 * would drag `src/modules/trainer` onto every route. `src/modules/trainer/
 * reviewQueue.ts` validates the shape on the way out.
 */
export interface ProposedCardRow {
  id: string
  card: unknown
  createdAt: string
}

/**
 * A reader's decision on a card `data/rules` itself marks `unreviewed`, or on
 * a `ProposedCardRow` — the Local Review Queue's only write.
 *
 * Never a mutation of the dataset: `data/rules` is versioned and shipped with
 * the build, and a card's home act, rule number and citation come from there.
 * This is the one row an approval or a rejection produces, and
 * `src/modules/trainer/reviewQueue.ts#effectiveCatalogue` is the one place
 * that folds it back over a card to decide what the scheduler is handed.
 */
export interface CardOverrideRow {
  qId: string
  action: 'approved' | 'rejected'
  /** A hand-edited front/back/explanation, applied only when `action` is `approved`. `null` for none. */
  patch: unknown
  decidedAt: string
}

/**
 * One restricted holiday the reader has chosen for a given year — the "any
 * two" (or three, outside Delhi/New Delhi, which this app does not attempt to
 * distinguish) a DoPT circular lets an employee pick. Keyed on
 * `"<year>:<holidayId>"` so picking the same holiday twice overwrites rather
 * than accumulating, and `year` is its own indexed field so a reload can ask
 * for one year's picks without a table scan.
 */
export interface HolidayPickRow {
  id: string
  year: number
  holidayId: string
  createdAt: string
}

/**
 * One command palette result the reader actually went to — nav destinations,
 * settings actions and other non-navigating commands are not recorded, the
 * same line `LawRecentRow`/`GlossaryRecentRow` take: this is a list of places
 * to jump back to, not a log of every keystroke. Keyed on the item's own id so
 * revisiting the same law section or job post overwrites rather than
 * accumulating, and `en`/`hi`/`section` are a snapshot so the list renders
 * before any of the underlying datasets have loaded.
 */
export interface CommandRecentRow {
  id: string
  section: string
  en: string
  hi: string
  to: string
  viewedAt: string
}

/**
 * The Library's four reading tables (Session 26).
 *
 * `libraryProgress` and `libraryBookmarks` are keyed `"<workId>:<unitId>"` — the
 * same shape `holidayPicks` uses, and for the same reason: reading a unit twice
 * or bookmarking it twice has nothing to accumulate, so the second write
 * overwrites. `workId` is its own indexed field so "where was I in this book"
 * answers without a table scan across every book.
 *
 * `libraryHighlights` and `libraryNotes` are declared now and written by
 * nothing yet — Session 27 builds their UI. Declaring a dormant table costs
 * nothing and means the kill switch, the backup and `clearAllData` all know
 * about them on day one, which is the arrangement version 2 made for the AI
 * tables.
 */
export interface LibraryProgressRow {
  /** `"<workId>:<unitId>"`. */
  id: string
  workId: string
  unitId: string
  /** ISO instant of the last time this unit was open. */
  at: string
  /** Total dwell on this unit, in seconds, accumulated across visits. */
  secondsRead: number
}

export interface LibraryBookmarkRow {
  /** `"<workId>:<unitId>"`. */
  id: string
  workId: string
  unitId: string
  createdAt: string
}

/**
 * A span of one unit's text, in one language, that the reader marked.
 *
 * `lang` is part of the row rather than derived: the English and Hindi renderings
 * of a unit are different strings of different lengths, so an offset means
 * nothing without knowing which one it indexes into.
 */
export interface LibraryHighlightRow {
  id: string
  workId: string
  unitId: string
  lang: 'en' | 'hi'
  start: number
  end: number
  colour: string
  note?: string
  createdAt: string
}

export interface LibraryNoteRow {
  id: string
  workId: string
  unitId: string
  body: string
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
  drafts!: Table<DraftRow, string>
  draftDefaults!: Table<DraftDefaultsRow, string>
  glossaryFavourites!: Table<GlossaryFavouriteRow, string>
  glossaryRecents!: Table<GlossaryRecentRow, string>
  srsCards!: Table<SrsCardRow, string>
  reviewLog!: Table<ReviewLogRow, string>
  streaks!: Table<StreakRow, string>
  trainerSettings!: Table<TrainerSettingsRow, string>
  trainerBookmarks!: Table<TrainerBookmarkRow, string>
  trainerReports!: Table<TrainerReportRow, string>
  proposedCards!: Table<ProposedCardRow, string>
  cardOverrides!: Table<CardOverrideRow, string>
  holidayPicks!: Table<HolidayPickRow, string>
  commandRecents!: Table<CommandRecentRow, string>
  libraryProgress!: Table<LibraryProgressRow, string>
  libraryBookmarks!: Table<LibraryBookmarkRow, string>
  libraryHighlights!: Table<LibraryHighlightRow, string>
  libraryNotes!: Table<LibraryNoteRow, string>

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
    // Version 5 — the Drafting Studio (Session 8). `drafts` is indexed on
    // `updatedAt` because the recent list is only ever read newest-first, and
    // on `templateId` so "my drafts of this form" needs no table scan.
    this.version(5).stores({
      settings: '&key',
      secrets: '&id',
      aiAnswers: '&id, agentId, dataVersion, createdAt',
      aiUsage: '&month',
      lawFavourites: '&id, createdAt',
      lawRecents: '&id, viewedAt',
      payScenarios: '&id, name, updatedAt',
      drafts: '&id, templateId, updatedAt',
      draftDefaults: '&id, templateId, updatedAt',
    })
    // Version 6 — the Hindi administrative glossary's favourites and recent
    // lookups (Session 10), the same shape law's own two tables use.
    this.version(6).stores({
      settings: '&key',
      secrets: '&id',
      aiAnswers: '&id, agentId, dataVersion, createdAt',
      aiUsage: '&month',
      lawFavourites: '&id, createdAt',
      lawRecents: '&id, viewedAt',
      payScenarios: '&id, name, updatedAt',
      drafts: '&id, templateId, updatedAt',
      draftDefaults: '&id, templateId, updatedAt',
      glossaryFavourites: '&id, createdAt',
      glossaryRecents: '&id, viewedAt',
    })
    // Version 7 — the Rules Trainer's spaced repetition (Session 11).
    //
    // `srsCards` is indexed on `due` because "what is due now" is the query the
    // trainer asks on every card, and an ISO-8601 UTC string sorts in
    // chronological order, so it answers as a range query rather than a scan.
    // `reviewLog` is indexed on `qId` (one card's history) and on `at` (one
    // day's work); it is append-only. `streaks` and `trainerSettings` are keyed
    // on the only thing that identifies them — an IST date, and the constant
    // `"trainer"`.
    this.version(7).stores({
      settings: '&key',
      secrets: '&id',
      aiAnswers: '&id, agentId, dataVersion, createdAt',
      aiUsage: '&month',
      lawFavourites: '&id, createdAt',
      lawRecents: '&id, viewedAt',
      payScenarios: '&id, name, updatedAt',
      drafts: '&id, templateId, updatedAt',
      draftDefaults: '&id, templateId, updatedAt',
      glossaryFavourites: '&id, createdAt',
      glossaryRecents: '&id, viewedAt',
      srsCards: '&qId, due, state',
      reviewLog: '&id, qId, at',
      streaks: '&date',
      trainerSettings: '&id',
    })
    // Version 8 — the Trainer UI's bookmarks, reports, AI-proposed cards and the
    // Local Review Queue's decisions (Session 12).
    //
    // `trainerBookmarks` and `cardOverrides` are keyed on `qId` alone: both are a
    // toggle/decision about one card, not a log, so a second write overwrites
    // rather than accumulating. `trainerReports` and `proposedCards` are
    // append-only and keyed on their own `id`, and both carry `createdAt` for a
    // newest-first list.
    this.version(8).stores({
      settings: '&key',
      secrets: '&id',
      aiAnswers: '&id, agentId, dataVersion, createdAt',
      aiUsage: '&month',
      lawFavourites: '&id, createdAt',
      lawRecents: '&id, viewedAt',
      payScenarios: '&id, name, updatedAt',
      drafts: '&id, templateId, updatedAt',
      draftDefaults: '&id, templateId, updatedAt',
      glossaryFavourites: '&id, createdAt',
      glossaryRecents: '&id, viewedAt',
      srsCards: '&qId, due, state',
      reviewLog: '&id, qId, at',
      streaks: '&date',
      trainerSettings: '&id',
      trainerBookmarks: '&qId, createdAt',
      trainerReports: '&id, qId, createdAt',
      proposedCards: '&id, createdAt',
      cardOverrides: '&qId, decidedAt',
    })
    // Version 9 — the Utilities module's holiday calendar (Session 13).
    // `holidayPicks` is indexed on `year` so "this year's restricted picks"
    // needs no table scan.
    this.version(9).stores({
      settings: '&key',
      secrets: '&id',
      aiAnswers: '&id, agentId, dataVersion, createdAt',
      aiUsage: '&month',
      lawFavourites: '&id, createdAt',
      lawRecents: '&id, viewedAt',
      payScenarios: '&id, name, updatedAt',
      drafts: '&id, templateId, updatedAt',
      draftDefaults: '&id, templateId, updatedAt',
      glossaryFavourites: '&id, createdAt',
      glossaryRecents: '&id, viewedAt',
      srsCards: '&qId, due, state',
      reviewLog: '&id, qId, at',
      streaks: '&date',
      trainerSettings: '&id',
      trainerBookmarks: '&qId, createdAt',
      trainerReports: '&id, qId, createdAt',
      proposedCards: '&id, createdAt',
      cardOverrides: '&qId, decidedAt',
      holidayPicks: '&id, year, createdAt',
    })
    // Version 10 — the command palette's recent-jumps list (Session 14). Indexed
    // on `viewedAt` for the same reason every other recents table is: it is
    // only ever read newest-first.
    this.version(10).stores({
      settings: '&key',
      secrets: '&id',
      aiAnswers: '&id, agentId, dataVersion, createdAt',
      aiUsage: '&month',
      lawFavourites: '&id, createdAt',
      lawRecents: '&id, viewedAt',
      payScenarios: '&id, name, updatedAt',
      drafts: '&id, templateId, updatedAt',
      draftDefaults: '&id, templateId, updatedAt',
      glossaryFavourites: '&id, createdAt',
      glossaryRecents: '&id, viewedAt',
      srsCards: '&qId, due, state',
      reviewLog: '&id, qId, at',
      streaks: '&date',
      trainerSettings: '&id',
      trainerBookmarks: '&qId, createdAt',
      trainerReports: '&id, qId, createdAt',
      proposedCards: '&id, createdAt',
      cardOverrides: '&qId, decidedAt',
      holidayPicks: '&id, year, createdAt',
      commandRecents: '&id, viewedAt',
    })
    // Version 11 — the Library's reading state (Session 26).
    //
    // `libraryProgress` is indexed on `workId` ("where was I in this book")
    // and on `at` (the hub's "continue reading" row, read newest-first);
    // `libraryBookmarks` the same way. `libraryHighlights` and `libraryNotes`
    // are indexed on a compound `[workId+unitId]`, because the only question
    // either is ever asked is "what did I write on THIS unit" — a reader
    // opening a unit must not pay a scan of every note they have ever made.
    // Both are declared here and written by nothing until Session 27.
    this.version(11).stores({
      settings: '&key',
      secrets: '&id',
      aiAnswers: '&id, agentId, dataVersion, createdAt',
      aiUsage: '&month',
      lawFavourites: '&id, createdAt',
      lawRecents: '&id, viewedAt',
      payScenarios: '&id, name, updatedAt',
      drafts: '&id, templateId, updatedAt',
      draftDefaults: '&id, templateId, updatedAt',
      glossaryFavourites: '&id, createdAt',
      glossaryRecents: '&id, viewedAt',
      srsCards: '&qId, due, state',
      reviewLog: '&id, qId, at',
      streaks: '&date',
      trainerSettings: '&id',
      trainerBookmarks: '&qId, createdAt',
      trainerReports: '&id, qId, createdAt',
      proposedCards: '&id, createdAt',
      cardOverrides: '&qId, decidedAt',
      holidayPicks: '&id, year, createdAt',
      commandRecents: '&id, viewedAt',
      libraryProgress: '&id, workId, at',
      libraryBookmarks: '&id, workId, createdAt',
      libraryHighlights: '&id, [workId+unitId], createdAt',
      libraryNotes: '&id, [workId+unitId], updatedAt',
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
