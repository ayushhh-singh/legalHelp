import { z } from 'zod'

import { isoDateValue } from './format'

/**
 * The correspondence register — what came in, what went out, and what is still
 * waiting for an answer.
 *
 * Every section keeps one, and it is the thing an officer is actually asked
 * about: "what happened to that letter from the Ministry". This is its pure
 * half — the row shape, the thread arithmetic, the follow-up arithmetic, the
 * duplicate-number check and the two exports. `src/modules/drafting/register/`
 * is the Dexie half.
 *
 * ### Three rules, and each one is a decision
 *
 * 1. **A register entry is a fact about paper, not a copy of a document.** It
 *    holds a number, a date, a correspondent and a subject, and it POINTS at a
 *    document or an intake by id. Deleting the document leaves the entry, which
 *    is the whole point of a register — an office that could lose the record of
 *    a letter by deleting its draft has no register at all. `docId` and
 *    `intakeId` are therefore nullable pointers and nothing renders from them
 *    that is not also stored here.
 *
 * 2. **A thread is a chain of `inReplyTo`, resolved by walking, never a stored
 *    tree.** A stored `children[]` is a second copy of the same relation and the
 *    two go out of step the first time an entry is deleted. `threadOf` walks up
 *    to the root and back down, and it is cycle-safe because an officer editing
 *    two entries into each other's `inReplyTo` is a thing that will happen.
 *
 * 3. **Overdue is computed from a date the caller supplies.** No clock here
 *    (`purity.test.ts`), which is also what makes "overdue tomorrow" a test that
 *    fails rather than one that passes until tomorrow.
 */

/* ------------------------------------------------------------------ *
 * The row
 * ------------------------------------------------------------------ */

export const REGISTER_DIRECTIONS = ['received', 'sent'] as const
export type RegisterDirection = (typeof REGISTER_DIRECTIONS)[number]

export const REGISTER_STATUSES = ['pending', 'replied', 'closed'] as const
export type RegisterStatus = (typeof REGISTER_STATUSES)[number]

/**
 * `correspondent` is a snapshot with an optional pointer, exactly as
 * `Addressee.bookId` is on a document (ADR-041 §5). Deleting somebody from the
 * address book must not empty the register's account of who wrote to the
 * office.
 */
export const correspondentSchema = z.object({
  name: z.string().default(''),
  organisation: z.string().default(''),
  bookId: z.string().nullable().default(null),
})

export type Correspondent = z.infer<typeof correspondentSchema>

export const registerEntrySchema = z.object({
  id: z.string().min(1),
  direction: z.enum(REGISTER_DIRECTIONS),
  /** The communication's own reference number, as it prints. May be empty. */
  number: z.string().default(''),
  /** ISO date of the communication. `receivedOn` is when it reached the office. */
  date: z.string().default(''),
  receivedOn: z.string().default(''),
  correspondent: correspondentSchema,
  subject: z.string().default(''),
  status: z.enum(REGISTER_STATUSES).default('pending'),
  /** ISO date. Empty means no follow-up is being kept. */
  followUpDate: z.string().default(''),
  notes: z.string().default(''),
  /** The document in `documents` this entry is about, where there is one. */
  docId: z.string().nullable().default(null),
  /** The inbound letter in `intakes` this entry is about, where there is one. */
  intakeId: z.string().nullable().default(null),
  /** The entry this one answers. The only relation stored. */
  inReplyTo: z.string().nullable().default(null),
  /** Every entry in one chain shares it. Assigned by `threadIdFor`. */
  threadId: z.string().default(''),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type RegisterEntry = z.infer<typeof registerEntrySchema>

/** A stored row, believed only as far as the schema can check it. */
export function readEntry(raw: unknown): RegisterEntry | null {
  const parsed = registerEntrySchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

/**
 * Every date this file stores is ISO, and this is where that becomes true.
 *
 * A register mixes two sources that print dates differently: an intake carries
 * `2026-08-12`, read off a letter by `extract.ts`, and a document carries
 * `12.08.2026`, which is what CSMOP's specimens and every DoPT order print
 * (`format.ts#formatDate`). Storing both and comparing them as strings sorts a
 * September reply before an August letter — `04.09.2026` is less than
 * `2026-08-12` by code unit — so the register's whole ordering, its thread
 * view, its CSV and its overdue list are wrong for any thread that mixes the
 * two.
 *
 * This is CLAUDE.md's own recorded trap in a new place: Session 29 read the
 * year out of a migrated document with `Number(date.slice(0, 4))` and stamped
 * `seqYear: 28`. `isoDateValue` reads both shapes in either script and is what
 * both sessions should have gone through.
 *
 * A date it cannot read becomes the empty string rather than being kept as
 * typed: an unorderable date in an ordered list is worse than a missing one,
 * and `compareEntries` already falls through to `receivedOn` and then to the
 * creation instant.
 */
const asIso = (value: string): string => (value ? isoDateValue(value) : '')

/** The date fields, normalised. Applied on every write, in one place. */
export function normaliseDates<T extends Partial<RegisterEntry>>(patch: T): T {
  const out = { ...patch }
  if (typeof out.date === 'string') out.date = asIso(out.date)
  if (typeof out.receivedOn === 'string') out.receivedOn = asIso(out.receivedOn)
  if (typeof out.followUpDate === 'string') out.followUpDate = asIso(out.followUpDate)
  return out
}

export function newEntry(args: {
  id: string
  direction: RegisterDirection
  at: string
  threadId?: string
  patch?: Partial<Omit<RegisterEntry, 'id' | 'direction' | 'createdAt' | 'updatedAt'>>
}): RegisterEntry {
  return registerEntrySchema.parse({
    id: args.id,
    direction: args.direction,
    correspondent: { name: '', organisation: '', bookId: null },
    threadId: args.threadId ?? args.id,
    createdAt: args.at,
    updatedAt: args.at,
    ...normaliseDates(args.patch ?? {}),
  })
}

/* ------------------------------------------------------------------ *
 * Threads
 * ------------------------------------------------------------------ */

/**
 * The thread id a new entry should carry.
 *
 * A reply inherits the thread of what it answers; anything else starts its own,
 * keyed on its own id. That is what makes a thread id stable when the first
 * entry of a chain is later edited — the id never depends on a number or a
 * subject, both of which an officer corrects.
 */
export function threadIdFor(entry: Pick<RegisterEntry, 'id'>, parent?: RegisterEntry | null): string {
  return parent?.threadId || parent?.id || entry.id
}

/**
 * One thread, oldest first.
 *
 * Walks up `inReplyTo` to the root, then collects every entry sharing the
 * root's thread id. The upward walk is bounded by the number of entries, which
 * is what makes a cycle — two entries answering each other — terminate rather
 * than hang. A cycle is not an error to report: it is a state an officer can
 * type into the two dropdowns, and a register that hangs on it is worse than
 * one that shows a slightly odd chain.
 */
export function threadOf(entries: readonly RegisterEntry[], id: string): RegisterEntry[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]))
  const seen = new Set<string>()
  let current = byId.get(id)
  while (current?.inReplyTo && !seen.has(current.id)) {
    seen.add(current.id)
    const parent = byId.get(current.inReplyTo)
    if (!parent) break
    current = parent
  }
  const root = current
  if (!root) return []
  const thread = root.threadId || root.id
  return entries.filter((entry) => (entry.threadId || entry.id) === thread).sort(compareEntries)
}

/**
 * Oldest first, by date and then by creation instant.
 *
 * Never `localeCompare` — `purity.test.ts` fails on it across this directory,
 * and for the reason `versions.ts#compareAt` gives: this ordering decides what
 * a CSV export contains, and two devices holding the same register must produce
 * the same file.
 */
export function compareEntries(a: RegisterEntry, b: RegisterEntry): number {
  const left = a.date || a.receivedOn || a.createdAt
  const right = b.date || b.receivedOn || b.createdAt
  if (left !== right) return left < right ? -1 : 1
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0
}

/* ------------------------------------------------------------------ *
 * Follow-ups
 * ------------------------------------------------------------------ */

export type FollowUpState = 'none' | 'due' | 'overdue' | 'upcoming'

/**
 * Where a follow-up stands on a given day.
 *
 * `today` is an ISO date the caller supplies. A closed or replied entry has no
 * follow-up whatever its date says — the date is what it was waiting for, and
 * it is not waiting any more.
 *
 * The comparison is on the DATE STRING, which is right because both sides are
 * `YYYY-MM-DD` and that format's code-unit order is chronological order. It
 * also sidesteps the whole question of which timezone "today" is in: the
 * caller decides that once (`src/lib/istDay.ts` for a statutory day, the
 * device's own day for a reminder) rather than this file deciding it for them.
 */
export function followUpState(entry: RegisterEntry, today: string): FollowUpState {
  if (!entry.followUpDate) return 'none'
  if (entry.status !== 'pending') return 'none'
  if (entry.followUpDate < today) return 'overdue'
  if (entry.followUpDate === today) return 'due'
  return 'upcoming'
}

/** Everything wanting attention today, most overdue first. */
export function dueFollowUps(entries: readonly RegisterEntry[], today: string): RegisterEntry[] {
  return entries
    .filter((entry) => {
      const state = followUpState(entry, today)
      return state === 'due' || state === 'overdue'
    })
    .sort((a, b) => (a.followUpDate < b.followUpDate ? -1 : a.followUpDate > b.followUpDate ? 1 : 0))
}

/**
 * The date a follow-up should be set to, given a period in days.
 *
 * Pure date arithmetic on the ISO string via UTC, so it cannot drift by an hour
 * across a DST boundary in some other part of the world. India observes no
 * daylight saving, but the DEVICE may be running in a locale that does, and a
 * follow-up that lands a day early because the officer was travelling is a
 * defect nobody would ever diagnose.
 */
export function addDaysIso(iso: string, days: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return ''
  const at = new Date(`${iso}T00:00:00.000Z`)
  if (Number.isNaN(at.getTime())) return ''
  at.setUTCDate(at.getUTCDate() + days)
  return at.toISOString().slice(0, 10)
}

/* ------------------------------------------------------------------ *
 * Duplicate numbers
 * ------------------------------------------------------------------ */

/**
 * A number that has already been used on another outbound communication.
 *
 * The register is the second half of the duplicate check
 * `src/modules/drafting/numberingStore.ts` already runs over `numberIssues`:
 * that one knows what this app ISSUED, and this one also knows what an officer
 * recorded by hand for a communication issued before they had the app. Both
 * feed the same warning, which is a warning rather than a bar for the reason
 * `validatePattern` gives about `{SEQ}` — an office's numbering is the office's.
 *
 * Comparison is case-insensitive and ignores whitespace, because
 * `A-11011/2/2026-Estt.` and `A-11011/2/2026 -Estt.` are the same number
 * written twice, and warning about neither is worse than warning about both.
 */
export const numberKey = (value: string): string => value.replace(/\s+/g, '').toLowerCase()

export function duplicateNumbers(
  entries: readonly RegisterEntry[],
  number: string,
  exceptId = '',
): RegisterEntry[] {
  const key = numberKey(number)
  if (!key) return []
  return entries.filter(
    (entry) => entry.id !== exceptId && entry.direction === 'sent' && numberKey(entry.number) === key,
  )
}

/* ------------------------------------------------------------------ *
 * Search and filters
 * ------------------------------------------------------------------ */

export interface RegisterFilter {
  query?: string
  direction?: RegisterDirection | 'all'
  status?: RegisterStatus | 'all'
  /** Only entries in this thread. */
  threadId?: string
  /** Only entries whose follow-up is due or overdue on this ISO date. */
  dueOn?: string
}

/**
 * Filter and search. Substring, case-folded, over every field an officer would
 * search by — never fuse.js.
 *
 * A register is a list of things the officer wrote down themselves, in words
 * they chose; fuzzy matching over it would return a letter about leave when
 * they typed a file number, and the number is the one thing they are certain
 * of. `src/lib/retrieval.ts` exists for the corpus, where the reader does not
 * know the words. This is the opposite case.
 */
export function filterEntries(entries: readonly RegisterEntry[], filter: RegisterFilter): RegisterEntry[] {
  const needle = (filter.query ?? '').trim().toLowerCase()
  return entries
    .filter((entry) => {
      if (filter.direction && filter.direction !== 'all' && entry.direction !== filter.direction) {
        return false
      }
      if (filter.status && filter.status !== 'all' && entry.status !== filter.status) return false
      if (filter.threadId && (entry.threadId || entry.id) !== filter.threadId) return false
      if (filter.dueOn) {
        const state = followUpState(entry, filter.dueOn)
        if (state !== 'due' && state !== 'overdue') return false
      }
      if (!needle) return true
      return [
        entry.number,
        entry.subject,
        entry.correspondent.name,
        entry.correspondent.organisation,
        entry.notes,
        entry.date,
      ]
        .join(' ')
        .toLowerCase()
        .includes(needle)
    })
    .sort((a, b) => -compareEntries(a, b))
}

/* ------------------------------------------------------------------ *
 * Export
 * ------------------------------------------------------------------ */

export const CSV_COLUMNS = [
  'direction',
  'number',
  'date',
  'receivedOn',
  'correspondent',
  'organisation',
  'subject',
  'status',
  'followUpDate',
  'threadId',
  'notes',
] as const

/**
 * RFC 4180 quoting: every field quoted, an inner quote doubled, CRLF line
 * endings.
 *
 * Quoting everything rather than only what needs it is deliberate. A subject
 * line contains a comma about half the time and a file number contains one
 * occasionally; a rule that quotes conditionally has to be right about both,
 * and a rule that quotes always cannot be wrong. CRLF because the file is
 * opened in Excel on a Government desktop, and `\n` alone puts the whole
 * register on one row there.
 */
const cell = (value: string): string => `"${value.replace(/"/g, '""')}"`

export function toCsv(entries: readonly RegisterEntry[]): string {
  const rows = [
    CSV_COLUMNS.map((column) => cell(column)).join(','),
    ...entries.map((entry) =>
      [
        entry.direction,
        entry.number,
        entry.date,
        entry.receivedOn,
        entry.correspondent.name,
        entry.correspondent.organisation,
        entry.subject,
        entry.status,
        entry.followUpDate,
        entry.threadId || entry.id,
        entry.notes.replace(/\r?\n/g, ' '),
      ]
        .map(cell)
        .join(','),
    ),
  ]
  return `${rows.join('\r\n')}\r\n`
}

export interface RegisterExport {
  kind: 'sahayak-correspondence-register'
  version: 1
  exportedAt: string
  entries: RegisterEntry[]
}

export function toJsonExport(entries: readonly RegisterEntry[], at: string): RegisterExport {
  return {
    kind: 'sahayak-correspondence-register',
    version: 1,
    exportedAt: at,
    entries: [...entries].sort(compareEntries),
  }
}

const registerExportSchema = z.object({
  kind: z.literal('sahayak-correspondence-register'),
  version: z.literal(1),
  exportedAt: z.string(),
  entries: z.array(registerEntrySchema),
})

/** Read an exported file back. Rows that do not parse are dropped and counted. */
export function fromJsonExport(raw: unknown): { entries: RegisterEntry[]; dropped: number } | null {
  const parsed = registerExportSchema.safeParse(raw)
  if (parsed.success) return { entries: parsed.data.entries, dropped: 0 }

  // A file whose envelope is right and whose rows are partly wrong is worth
  // salvaging: the alternative is refusing a whole register because one entry
  // written by a later version carries a field this build does not know.
  const loose = z.object({
    kind: z.literal('sahayak-correspondence-register'),
    entries: z.array(z.unknown()),
  })
  const envelope = loose.safeParse(raw)
  if (!envelope.success) return null
  const entries: RegisterEntry[] = []
  let dropped = 0
  for (const row of envelope.data.entries) {
    const entry = readEntry(row)
    if (entry) entries.push(entry)
    else dropped += 1
  }
  return { entries, dropped }
}
