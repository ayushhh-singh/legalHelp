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

// ------------------------------------------------- the Drafting Studio, v2

/**
 * A document written in the new editor (Session 29, ADR-041).
 *
 * The row IS an `OfficialDoc` — `src/lib/drafting/model.ts` owns the shape and
 * `readDoc` is the only thing that should turn one of these back into a typed
 * document. It is declared `unknown` here for the reason `DraftRow.values` is:
 * a row written by a later release is untrusted input, and a type declaration
 * that says otherwise is a claim this file cannot keep.
 *
 * `drafts` (the Session 8 table) is NOT dropped. Migration copies each row into
 * `documents` and leaves the original where it is — the backup the brief asks
 * for is the table itself, and a migration that deletes its own source is one
 * nobody can re-run.
 */
export interface DocumentRow {
  id: string
  templateId: string
  title: string
  status: string
  updatedAt: string
  createdAt: string
  /** Set on a row produced by migrating a Session 8 draft. Its `drafts` id. */
  migratedFrom?: string
  threadId?: string
  doc: unknown
}

/** One snapshot. `doc` is the whole `OfficialDoc` as it was. */
export interface DocVersionRow {
  id: string
  docId: string
  at: string
  reason: string
  label: string
  doc: unknown
}

/** A comment to self, anchored to a block. Never exported with the document. */
export interface DocCommentRow {
  id: string
  docId: string
  blockIndex: number
  blockText: string
  text: string
  resolved: boolean
  createdAt: string
  updatedAt: string
}

/** The one profile row. Keyed on the literal `"profile"`. */
export interface DraftingProfileRow {
  id: 'profile'
  updatedAt: string
  [key: string]: unknown
}

export interface AddressBookRow {
  id: string
  name: unknown
  updatedAt: string
  createdAt: string
  [key: string]: unknown
}

/**
 * A template the officer saved themselves.
 *
 * `base` is the official template it was cloned from, and it is what the
 * renderer uses for the layout and the checklist. A personal template never
 * claims a CSMOP reference of its own — `src/modules/drafting/personal.ts`
 * refuses to store one — and every surface badges it "yours".
 */
export interface PersonalTemplateRow {
  id: string
  name: string
  baseTemplateId: string
  updatedAt: string
  createdAt: string
  template: unknown
}

export interface NumberPatternRow {
  id: string
  name: string
  updatedAt: string
  [key: string]: unknown
}

/** One number that was actually issued. Append-only; the duplicate check reads it. */
export interface NumberIssueRow {
  id: string
  patternId: string
  number: string
  docId: string
  issuedAt: string
}

export interface TemplateFavouriteRow {
  id: string
  createdAt: string
}

export interface TemplateRecentRow {
  id: string
  viewedAt: string
}

/**
 * A letterhead image the officer supplied.
 *
 * The BYTES live here, in a `Blob`, and not as a data URI in the profile row.
 * Three reasons, in order of weight: a base64 data URI is a third larger than
 * the file it encodes and the profile row is read on every new document; a
 * `Blob` can be handed straight to `URL.createObjectURL` for the preview and
 * to `ImageRun` for the `.docx` with no decoding step; and a table can be
 * deleted on its own, so "remove my letterhead" does not rewrite the profile.
 *
 * There is exactly one row today, keyed `letterhead`, and the table is keyed on
 * an id rather than fixed at one because a second office is a second row and
 * not a migration.
 */
export interface LetterheadImageRow {
  id: string
  /** `image/png`, `image/jpeg` or `image/svg+xml`. */
  type: string
  name: string
  data: Blob
  /** Natural size in CSS pixels, measured once on upload. */
  width: number
  height: number
  updatedAt: string
}

/**
 * A communication that ARRIVED — the letter an officer is about to answer
 * (Session 31, ADR-043 §2).
 *
 * The `text` is the whole letter, and it is the most sensitive thing this app
 * stores after a document: it is somebody else's writing, addressed to this
 * office. Three consequences the reply screen keeps:
 *
 *  - **Nothing is written here until the officer chooses "keep with the
 *    draft".** A letter pasted to read the chips and then abandoned leaves no
 *    row at all — the analysis lives in component state and dies with the tab.
 *  - **It is in the backup**, because `buildBackup` excludes by NAME and this
 *    is not one of the three excluded. That is right: an officer restoring a
 *    device wants the letter their draft answers.
 *  - **`analysis` is what the deterministic pass read**, stored as `unknown`
 *    for the reason `DocumentRow.doc` is: a row written by a later release is
 *    untrusted input.
 */
export interface IntakeRow {
  id: string
  /** The letter as received. Never edited by the app. */
  text: string
  /** The subject, denormalised so a list renders without parsing every letter. */
  subject: string
  number: string
  /** ISO date of the letter itself. `receivedOn` is when it reached the office. */
  date: string
  receivedOn: string
  createdAt: string
  updatedAt: string
  /** `analyseIntake`'s output, as the officer corrected it. */
  analysis: unknown
  /** The AI analysis, when one was run and kept. Absent otherwise. */
  aiAnalysis?: unknown
  /** Documents drafted in reply point here; this is the convenience back-link. */
  replyDocId?: string
}

/**
 * One line of the correspondence register (Session 31, ADR-043 §5).
 *
 * `src/lib/drafting/register.ts` owns the shape and `readEntry` is the only
 * thing that should turn one of these back into a typed entry. Declared
 * `unknown`-free here because the register's own schema fills every default,
 * but read through `readEntry` all the same — the fields below are what the
 * INDEXES need, and the source of truth is the parsed row.
 */
export interface RegisterEntryRow {
  id: string
  direction: string
  number: string
  date: string
  status: string
  threadId: string
  followUpDate: string
  updatedAt: string
  createdAt: string
  entry: unknown
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
  /**
   * When the reader said they had read it — a DELIBERATE act, distinct from
   * having opened it, which is what every other field here records. The table
   * of contents ticks arrivals; this is the tick an officer working through a
   * rule book for an examination actually wants.
   */
  markedReadAt?: string | null
  /** How far down the unit the reader was, 0-1, so returning lands where they left. */
  scrollRatio?: number
}

export interface LibraryBookmarkRow {
  /** `"<workId>:<unitId>"`. */
  id: string
  workId: string
  unitId: string
  /** What the reader called it. Optional — a bookmark with no label is still a bookmark. */
  label?: string
  createdAt: string
}

/**
 * A span of one unit's text, in one language, that the reader marked.
 *
 * `lang` is part of the row rather than derived: the English and Hindi renderings
 * of a unit are different strings of different lengths, so an offset means
 * nothing without knowing which one it indexes into. A highlight made in English
 * never renders on the Hindi pane, and the other way round.
 *
 * `quote` is the recovery path and is why a highlight cannot be silently lost.
 * The offsets index into `normaliseText()` of the unit as it was when the mark
 * was made; `data/law/*.json` is rewritten weekly by the NCRB ingest, so a word
 * inserted ahead of a highlight moves every offset after it.
 * `src/lib/library/anchor.ts#resolveAnchor` tries the offsets, then searches for
 * this text, and a highlight that neither finds is listed under "needs
 * attention" in My Study rather than deleted.
 */
export interface LibraryHighlightRow {
  id: string
  workId: string
  unitId: string
  lang: 'en' | 'hi'
  start: number
  end: number
  /** The text covered when the highlight was made — see above. */
  quote: string
  /** One of the four paired accent tokens: marigold, tulsi, violet, coral. */
  colour: string
  createdAt: string
}

/**
 * A margin note, on a unit and optionally on one highlight inside it.
 *
 * `body` is markdown-lite (`src/lib/library/markdown.ts`) and is stored as the
 * reader typed it, never as rendered markup — the AST is built at render time
 * so nothing in this app ever has to trust stored HTML.
 *
 * `highlightId` is what makes a note "about this phrase" rather than "about
 * this rule", and `part` is the finer anchor `LibraryUnit.parts` was kept for:
 * a sub-rule number is a real citation an officer uses.
 */
export interface LibraryNoteRow {
  id: string
  workId: string
  unitId: string
  highlightId?: string
  /** A sub-rule number — "1(2)" — where the note is about one part of a rule. */
  part?: string
  body: string
  createdAt: string
  updatedAt: string
}

/**
 * A document the reader added themselves — pasted, or extracted on this device
 * from a .txt/.md/.pdf/.docx file.
 *
 * NEVER LEAVES THE DEVICE AND IS NEVER PRESENTED AS A SOURCE. It carries no
 * publisher, no official URL and no citation, and every surface that renders it
 * marks it as the reader's own document (`src/lib/library/personal.ts`). It is
 * excluded from anything that presents sources as authoritative, which is the
 * session brief's own requirement and the reason it is a separate table rather
 * than a flag on a work.
 *
 * The units are stored inline rather than in a table of their own: a personal
 * work is one document of a few hundred kilobytes at most, it is always read
 * whole, and a second table would buy a join for nothing.
 */
export interface LibraryPersonalWorkRow {
  /** Always `my-<slug>`, so a personal id can never collide with a dataset one. */
  id: string
  title: string
  /** The one language the document is in. There is no translation of it. */
  language: 'en' | 'hi'
  /** What the reader says it is and where it came from. Free text. */
  note: string
  /**
   * What one unit of THIS document is called.
   *
   * Asked on the review screen rather than assumed, because the alternative is
   * to label every unit of every personal document "Section" and print
   * "Section 12" on a citation for something that is a paragraph of an office
   * order. `item` is the honest default for a document that numbers its parts
   * and does not say what they are.
   */
  unitWord: 'section' | 'rule' | 'paragraph' | 'item'
  units: { id: string; number: string; heading: string; text: string; division: string | null }[]
  divisions: { label: string; title: string; from: number }[]
  createdAt: string
  updatedAt: string
}

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS]

/**
 * One chapter of one work, scheduled by FSRS — the SECOND deck this app keeps.
 *
 * The card deck (`srsCards`) asks a question and grades the answer. This deck
 * asks nothing: the reader READS a chapter and rates how confident they are
 * that they could use it, 1-4, and that rating is the FSRS grade. It is a
 * separate table rather than a flag on `srsCards` for two reasons, and both are
 * about not corrupting the other deck. A chapter is not a `Card` — it has no
 * `qId` in `data/rules/cards`, so every function in `src/lib/srs` that is
 * handed a catalogue would have nothing to look it up in. And the two decks
 * have to be countable apart: "12 cards and 3 chapters due" is the honest
 * report, and one table would make it "15 due" with no way back.
 *
 * The scheduling itself is NOT forked — `src/lib/study/chapters.ts` calls
 * `gradeCard` and `createCard` from `src/lib/srs/engine.ts`, which are pure and
 * take a row, so both decks are scheduled by the same FSRS instance with the
 * same fuzz-off guarantee (ADR-025).
 */
export interface ChapterCardRow {
  /** `"<workId>:<nodeId>"` — the table-of-contents node, not a unit. */
  id: string
  workId: string
  nodeId: string
  /** Everything `SrsCardRow` carries, minus its `qId`. */
  due: string
  stability: number
  difficulty: number
  elapsed: number
  scheduled: number
  reps: number
  lapses: number
  state: 'new' | 'learning' | 'review' | 'relearning'
  lastReview: string | null
  lastGrade: 'Again' | 'Hard' | 'Good' | 'Easy' | null
  learningSteps: number
}

/** One confidence rating on one chapter. Append-only, like `reviewLog`. */
export interface ChapterLogRow {
  /** `"<cardId>#<reps>#<at>"`, the shape `src/lib/srs/engine.ts` uses. */
  id: string
  cardId: string
  workId: string
  grade: 'Again' | 'Hard' | 'Good' | 'Easy'
  at: string
  stateBefore: 'new' | 'learning' | 'review' | 'relearning'
  /**
   * What produced the rating. A rating the reader gave after reading is
   * `confidence`; one derived from a chapter quiz or a Feynman self-grade is
   * marked as such, so "how did I actually rate this" stays answerable.
   */
  reason: 'confidence' | 'quiz' | 'feynman'
}

/**
 * One attempt at explaining a unit in the reader's own words.
 *
 * The text is stored EXACTLY as typed and is never sent anywhere. The three
 * grades are the reader's own — `src/lib/study/feynman.ts` states the three
 * prompts and this row records what they said about each. There is no marking:
 * an attempt is evidence the reader produced, and the value is in re-reading it
 * a week later beside the rule.
 */
export interface FeynmanAttemptRow {
  id: string
  workId: string
  unitId: string
  /** What the reader wrote, verbatim. */
  body: string
  /** Self-grade per prompt, in the order `FEYNMAN_PROMPTS` declares them. */
  grades: ('missed' | 'partial' | 'got-it')[]
  at: string
  /** An AI comment, if the reader asked for one and AI was on. Never required. */
  comment?: string
}

/**
 * One study session — a stretch of time the reader spent on a work.
 *
 * `endedAt` is null while the session is running, which is what makes an
 * interrupted session recoverable: the timer is wall-clock arithmetic over
 * `startedAt`, not a counter that dies with the tab.
 */
export interface StudySessionRow {
  id: string
  workId: string
  /** The table-of-contents node the reader was working through, if any. */
  nodeId: string | null
  mode: 'free' | 'pomodoro'
  startedAt: string
  endedAt: string | null
  /** Focused minutes, excluding breaks. Written when the session ends. */
  minutes: number
  /** Completed pomodoro work intervals. Zero in free mode. */
  pomodoros: number
}

/**
 * A weekly target for one work. `minutes` and `units` are both optional and a
 * goal with neither is not stored — a goal that asks for nothing is noise on
 * the weekly review screen.
 */
export interface StudyGoalRow {
  /** The work id. One goal per work. */
  id: string
  minutesPerWeek?: number
  unitsPerWeek?: number
  updatedAt: string
}

/**
 * One departmental examination the reader is preparing for (Session 32, ADR-044).
 *
 * The row holds CHOICES and never a plan. `src/lib/exam/plan.ts` rebuilds the
 * day-by-day plan from the profile, the target date and the schedule as it
 * stands now — a stored plan is out of date the moment a card is graded, and a
 * reader who has raced ahead on the Leave Rules should not be sent back to them
 * on Thursday because a plan written on Monday said so.
 *
 * It is keyed on the PROFILE id rather than on a literal `"exam"`, so switching
 * profiles keeps the target date the reader already typed against the one they
 * switched away from. `active` is what says which is current; `setActiveExam`
 * clears the others in one transaction, and `activeExamChoice` reads the flag
 * rather than a second settings row.
 *
 * Nothing here identifies an organisation's business: a profile id names a
 * PUBLIC examination, and the date is the reader's own.
 */
export interface ExamChoiceRow {
  /** A profile id from `data/exams/index.json`. */
  id: string
  /** IST day (`YYYY-MM-DD`) of the examination, or null while none is chosen. */
  targetDate: string | null
  /** Minutes a day, or null to take the Session 28 study goal instead. */
  dailyMinutes: number | null
  /** Exactly one row is true. */
  active: boolean
  createdAt: string
  updatedAt: string
}

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
  libraryPersonalWorks!: Table<LibraryPersonalWorkRow, string>
  chapterCards!: Table<ChapterCardRow, string>
  chapterLog!: Table<ChapterLogRow, string>
  feynmanAttempts!: Table<FeynmanAttemptRow, string>
  studySessions!: Table<StudySessionRow, string>
  studyGoals!: Table<StudyGoalRow, string>
  documents!: Table<DocumentRow, string>
  docVersions!: Table<DocVersionRow, string>
  docComments!: Table<DocCommentRow, string>
  draftingProfile!: Table<DraftingProfileRow, string>
  addressBook!: Table<AddressBookRow, string>
  personalTemplates!: Table<PersonalTemplateRow, string>
  numberPatterns!: Table<NumberPatternRow, string>
  numberIssues!: Table<NumberIssueRow, string>
  templateFavourites!: Table<TemplateFavouriteRow, string>
  templateRecents!: Table<TemplateRecentRow, string>
  letterheadImages!: Table<LetterheadImageRow, string>
  intakes!: Table<IntakeRow, string>
  registerEntries!: Table<RegisterEntryRow, string>
  examChoices!: Table<ExamChoiceRow, string>

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
    // Version 12 — the Library's annotation layer and the reader's own works
    // (Session 27), which is what version 11 declared its two dormant tables
    // for.
    //
    // `libraryHighlights` and `libraryNotes` gain a `workId` index: My Study
    // filters by work across every unit, which the compound `[workId+unitId]`
    // cannot answer on its own, and `colour` is indexed because filtering by it
    // is one of the three filters that screen offers. `libraryPersonalWorks` is
    // the one new table; it is indexed on `updatedAt` because the shelf lists
    // the reader's own documents newest-first, the same way every other
    // recents-shaped table here is.
    //
    // No `.upgrade()` block: both annotation tables were declared in version 11
    // and written by nothing, so there are no rows to migrate — the row shapes
    // changed on paper only (`quote` on a highlight, `highlightId`/`part` and
    // timestamps on a note, `label` on a bookmark, `markedReadAt`/`scrollRatio`
    // on progress). The three optional fields on existing tables need no
    // migration either: absent is the state every row written before this
    // release is in, and every reader of them treats absent as "not set".
    this.version(12).stores({
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
      libraryHighlights: '&id, [workId+unitId], workId, colour, createdAt',
      libraryNotes: '&id, [workId+unitId], workId, updatedAt',
      libraryPersonalWorks: '&id, updatedAt',
    })
    // Version 13 — the study layer (Session 28): the chapter revision deck, the
    // Feynman attempts, the session log and the weekly goals.
    //
    // `chapterCards` is indexed on `due` for the same reason `srsCards` is: "what
    // is due now" is a range query over an ISO-8601 UTC string, not a scan. It is
    // also indexed on `workId`, because the Library's own surfaces ask "what is
    // due in THIS book" and the compound key alone cannot answer that.
    // `chapterLog` and `feynmanAttempts` are append-only and carry `at` so a
    // week's work is a range query; `feynmanAttempts` also carries the compound
    // `[workId+unitId]`, which is how the reader page finds the attempts on the
    // unit in front of them. `studySessions` is indexed on `startedAt` for the
    // weekly review, and `studyGoals` is keyed on the work id alone — a goal is
    // a setting about a book, not a log.
    //
    // No `.upgrade()` block: all five tables are new and empty, and nothing
    // written before this release has a shape to migrate.
    this.version(13).stores({
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
      libraryHighlights: '&id, [workId+unitId], workId, colour, createdAt',
      libraryNotes: '&id, [workId+unitId], workId, updatedAt',
      libraryPersonalWorks: '&id, updatedAt',
      chapterCards: '&id, workId, due',
      chapterLog: '&id, cardId, workId, at',
      feynmanAttempts: '&id, [workId+unitId], workId, at',
      studySessions: '&id, workId, startedAt',
      studyGoals: '&id, updatedAt',
    })
    // Version 14 — the document editor (Session 29, ADR-041).
    //
    // `documents` replaces `drafts` as what an editor opens, and `drafts` is
    // kept rather than dropped: the migration copies out of it and a migration
    // that deletes its own source is one nobody can re-run. Indexed on
    // `templateId` and `status` for "my office memoranda" and "what is still a
    // draft", and on `updatedAt` because every list of documents is read
    // newest-first.
    //
    // `docVersions` and `docComments` are keyed on their own id and indexed on
    // `docId`, so opening one document reads only its own snapshots. Both are
    // capped by code rather than by the schema — `prune` keeps thirty.
    //
    // `draftingProfile` is one row keyed on the literal "profile", the shape
    // `trainerSettings` already uses for a single settings row. It is a table
    // rather than a `settings` key because it is a document of its own with a
    // dozen bilingual members, and because a `settings` row is read once at
    // hydrate while this must be live-queried.
    //
    // `numberIssues` is append-only and indexed on `number` so the duplicate
    // warning is a lookup rather than a scan.
    //
    // No `upgrade()` block: all ten are new and empty.
    this.version(14).stores({
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
      libraryHighlights: '&id, [workId+unitId], workId, colour, createdAt',
      libraryNotes: '&id, [workId+unitId], workId, updatedAt',
      libraryPersonalWorks: '&id, updatedAt',
      chapterCards: '&id, workId, due',
      chapterLog: '&id, cardId, workId, at',
      feynmanAttempts: '&id, [workId+unitId], workId, at',
      studySessions: '&id, workId, startedAt',
      studyGoals: '&id, updatedAt',
      documents: '&id, templateId, status, updatedAt, threadId',
      docVersions: '&id, docId, at',
      docComments: '&id, docId, resolved, createdAt',
      draftingProfile: '&id',
      addressBook: '&id, updatedAt, createdAt',
      personalTemplates: '&id, baseTemplateId, updatedAt',
      numberPatterns: '&id, updatedAt',
      numberIssues: '&id, patternId, number, issuedAt',
      templateFavourites: '&id, createdAt',
      templateRecents: '&id, viewedAt',
    })

    /*
      Version 15 — the letterhead image (Session 30, ADR-042 §6).

      One new table and nothing else, so there is no `upgrade()` block: a
      version that only ADDS a store needs no data moved, and writing an empty
      upgrade function would suggest to the next reader that one was considered
      and found unnecessary rather than that none was needed.

      Every table of every version above is repeated verbatim, because Dexie
      reads a version's `stores()` as the COMPLETE schema at that version — an
      omitted table is a dropped table, not an unchanged one.
    */
    this.version(15).stores({
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
      libraryHighlights: '&id, [workId+unitId], workId, colour, createdAt',
      libraryNotes: '&id, [workId+unitId], workId, updatedAt',
      libraryPersonalWorks: '&id, updatedAt',
      chapterCards: '&id, workId, due',
      chapterLog: '&id, cardId, workId, at',
      feynmanAttempts: '&id, [workId+unitId], workId, at',
      studySessions: '&id, workId, startedAt',
      studyGoals: '&id, updatedAt',
      documents: '&id, templateId, status, updatedAt, threadId',
      docVersions: '&id, docId, at',
      docComments: '&id, docId, resolved, createdAt',
      draftingProfile: '&id',
      addressBook: '&id, updatedAt, createdAt',
      personalTemplates: '&id, baseTemplateId, updatedAt',
      numberPatterns: '&id, updatedAt',
      numberIssues: '&id, patternId, number, issuedAt',
      templateFavourites: '&id, createdAt',
      templateRecents: '&id, viewedAt',
      letterheadImages: '&id, updatedAt',
    })

    /*
      Version 16 — the inbound letter and the correspondence register
      (Session 31, ADR-043).

      Two new tables and nothing else, so there is no `upgrade()` block, for the
      reason version 15's note gives: a version that only ADDS a store needs no
      data moved, and an empty upgrade function suggests one was considered and
      found unnecessary rather than that none was needed.

      `registerEntries` carries seven indexes because the register is a screen
      of filters — direction, status, thread, follow-up date — and because
      `duplicateNumbers` looks a number up on every issue. The row denormalises
      exactly those fields out of `entry`; `readEntry` is what turns the row
      back into something typed.

      Both tables are in the backup automatically, because `buildBackup`
      excludes by NAME rather than including by name. Asserted anyway in
      `src/modules/drafting/register/registerStore.test.ts`, because "it is
      backed up" is a claim rather than a comment.

      Every table of every version above is repeated verbatim: Dexie reads a
      version's `stores()` as the COMPLETE schema at that version, so an omitted
      table is a dropped table.
    */
    this.version(16).stores({
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
      libraryHighlights: '&id, [workId+unitId], workId, colour, createdAt',
      libraryNotes: '&id, [workId+unitId], workId, updatedAt',
      libraryPersonalWorks: '&id, updatedAt',
      chapterCards: '&id, workId, due',
      chapterLog: '&id, cardId, workId, at',
      feynmanAttempts: '&id, [workId+unitId], workId, at',
      studySessions: '&id, workId, startedAt',
      studyGoals: '&id, updatedAt',
      documents: '&id, templateId, status, updatedAt, threadId',
      docVersions: '&id, docId, at',
      docComments: '&id, docId, resolved, createdAt',
      draftingProfile: '&id',
      addressBook: '&id, updatedAt, createdAt',
      personalTemplates: '&id, baseTemplateId, updatedAt',
      numberPatterns: '&id, updatedAt',
      numberIssues: '&id, patternId, number, issuedAt',
      templateFavourites: '&id, createdAt',
      templateRecents: '&id, viewedAt',
      letterheadImages: '&id, updatedAt',
      intakes: '&id, createdAt, updatedAt',
      registerEntries: '&id, direction, number, status, threadId, followUpDate, date, updatedAt',
    })
    /*
      Version 17 — the departmental-exam mode's one table (Session 32, ADR-044).

      `examChoices` is indexed on `active`, because "which examination am I
      preparing for" is asked on four screens and is a one-row answer, and on
      `updatedAt` so a picker can list the reader's own choices newest-first.

      No `upgrade()` block: the table is new and empty, and an empty upgrade
      function would suggest a migration was considered and found unnecessary
      rather than that none was needed (v15's note, and v16's).

      It is in the backup automatically, because `buildBackup` excludes by NAME
      rather than including by name. Asserted anyway in
      `src/lib/exam/store.test.ts`, because "it is backed up" is a claim rather
      than a comment.

      Every table of every version above is repeated verbatim: Dexie reads a
      version's `stores()` as the COMPLETE schema at that version, so an omitted
      table is a dropped table.
    */
    this.version(17).stores({
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
      libraryHighlights: '&id, [workId+unitId], workId, colour, createdAt',
      libraryNotes: '&id, [workId+unitId], workId, updatedAt',
      libraryPersonalWorks: '&id, updatedAt',
      chapterCards: '&id, workId, due',
      chapterLog: '&id, cardId, workId, at',
      feynmanAttempts: '&id, [workId+unitId], workId, at',
      studySessions: '&id, workId, startedAt',
      studyGoals: '&id, updatedAt',
      documents: '&id, templateId, status, updatedAt, threadId',
      docVersions: '&id, docId, at',
      docComments: '&id, docId, resolved, createdAt',
      draftingProfile: '&id',
      addressBook: '&id, updatedAt, createdAt',
      personalTemplates: '&id, baseTemplateId, updatedAt',
      numberPatterns: '&id, updatedAt',
      numberIssues: '&id, patternId, number, issuedAt',
      templateFavourites: '&id, createdAt',
      templateRecents: '&id, viewedAt',
      letterheadImages: '&id, updatedAt',
      intakes: '&id, createdAt, updatedAt',
      registerEntries: '&id, direction, number, status, threadId, followUpDate, date, updatedAt',
      examChoices: '&id, active, updatedAt',
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
