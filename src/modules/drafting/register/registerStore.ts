import { db, type RegisterEntryRow } from '@/db'
import { docId } from '../documents'
import {
  compareEntries,
  duplicateNumbers,
  newEntry,
  normaliseDates,
  readEntry,
  threadIdFor,
  type RegisterDirection,
  type RegisterEntry,
} from '@/lib/drafting/register'

/**
 * The correspondence register on the device.
 *
 * `src/lib/drafting/register.ts` is the whole of the arithmetic — threads,
 * follow-ups, duplicates, the two exports — and this file is only the Dexie
 * half: read a row, parse it, write it back. The split is the one
 * `src/lib/srs/store.ts` draws and the reason is the same: everything worth
 * getting wrong is testable without a database in the room.
 *
 * ### The row and the entry are two shapes on purpose
 *
 * `RegisterEntryRow` denormalises seven fields out of the entry so IndexedDB
 * can index them; `entry` is the whole `RegisterEntry` and is what
 * `readEntry` parses. Nothing outside this file reads the denormalised fields —
 * they exist for `where()` and for nothing else, and a screen that read
 * `row.status` instead of `entry.status` would be reading a copy.
 */

const toRow = (entry: RegisterEntry): RegisterEntryRow => ({
  id: entry.id,
  direction: entry.direction,
  number: entry.number,
  date: entry.date,
  status: entry.status,
  threadId: entry.threadId || entry.id,
  followUpDate: entry.followUpDate,
  updatedAt: entry.updatedAt,
  createdAt: entry.createdAt,
  entry,
})

/**
 * Every entry, oldest first, with unreadable rows dropped.
 *
 * Dropped rather than thrown on: a register with one row written by a later
 * build is still a register, and refusing to open the screen at all would take
 * the other two hundred entries with it. The count of what was dropped is
 * reported by `listEntriesWithDropped` for the one screen that says so.
 */
export async function listEntries(): Promise<RegisterEntry[]> {
  return (await listEntriesWithDropped()).entries
}

export async function listEntriesWithDropped(): Promise<{
  entries: RegisterEntry[]
  dropped: number
}> {
  const rows = await db.registerEntries.toArray()
  const entries: RegisterEntry[] = []
  let dropped = 0
  for (const row of rows) {
    const entry = readEntry(row.entry)
    if (entry) entries.push(entry)
    else dropped += 1
  }
  return { entries: entries.sort(compareEntries), dropped }
}

export async function getEntry(id: string): Promise<RegisterEntry | null> {
  const row = await db.registerEntries.get(id)
  return row ? readEntry(row.entry) : null
}

export async function putEntry(entry: RegisterEntry): Promise<RegisterEntry> {
  await db.registerEntries.put(toRow(entry))
  return entry
}

export async function deleteEntry(id: string): Promise<RegisterEntry | null> {
  const existing = await getEntry(id)
  if (existing) await db.registerEntries.delete(id)
  return existing
}

/**
 * Create an entry, resolving its thread from what it answers.
 *
 * The thread is computed here rather than by the caller, because it is the one
 * thing that would go wrong quietly: an entry whose `inReplyTo` points at a
 * letter but whose `threadId` is its own id is a reply that never appears in
 * its own chain, and nothing on any screen would look broken.
 */
export async function createEntry(args: {
  direction: RegisterDirection
  at: string
  inReplyTo?: string | null
  patch?: Partial<RegisterEntry>
}): Promise<RegisterEntry> {
  const id = `reg-${docId()}`
  const parent = args.inReplyTo ? await getEntry(args.inReplyTo) : null
  const entry = newEntry({
    id,
    direction: args.direction,
    at: args.at,
    threadId: threadIdFor({ id }, parent),
    patch: { ...args.patch, ...(args.inReplyTo ? { inReplyTo: args.inReplyTo } : {}) },
  })
  return putEntry(entry)
}

export async function updateEntry(
  id: string,
  patch: Partial<RegisterEntry>,
  at: string,
): Promise<RegisterEntry | null> {
  const existing = await getEntry(id)
  if (!existing) return null
  /*
    `id`, `createdAt` and `direction` are not patchable. A register entry that
    changed direction would move from one half of the register to the other and
    take its thread with it, and there is no screen that wants that — a
    misfiled entry is deleted and re-entered.
  */
  const next: RegisterEntry = {
    ...existing,
    // Every date is stored ISO, whatever shape the caller had. A document's
    // `meta.date` is `12.08.2026` and an intake's is `2026-08-12`, and a
    // register that stored both would sort a September reply before an August
    // letter — see `normaliseDates`.
    ...normaliseDates(patch),
    id: existing.id,
    direction: existing.direction,
    createdAt: existing.createdAt,
    updatedAt: at,
  }
  return putEntry(next)
}

/* ------------------------------------------------------------------ *
 * Automatic entries
 * ------------------------------------------------------------------ */

/**
 * Record an outbound communication, when a number is issued for it.
 *
 * Called by `issueNumber`'s caller rather than by `issueNumber` itself, and
 * that is deliberate: `src/modules/drafting/numberingStore.ts` is Session 29's
 * and issuing a number is a fact about the numbering series, not about the
 * register. Wiring the register into it would mean a session that turned the
 * register off could no longer issue a number.
 *
 * It is idempotent on the document: issuing a second number for the same
 * document UPDATES the entry rather than creating a second one, because a
 * document that was renumbered is still one communication.
 */
export async function recordIssuedNumber(args: {
  docId: string
  number: string
  date: string
  subject: string
  at: string
  /** The intake this document answers, when it answers one. */
  intakeId?: string | null
  /** The register entry for that intake, so the two join into one thread. */
  inReplyTo?: string | null
}): Promise<RegisterEntry> {
  const existing = (await listEntries()).find(
    (entry) => entry.direction === 'sent' && entry.docId === args.docId,
  )
  if (existing) {
    const updated = await updateEntry(
      existing.id,
      { number: args.number, date: args.date, subject: args.subject },
      args.at,
    )
    if (updated) return updated
  }
  return createEntry({
    direction: 'sent',
    at: args.at,
    ...(args.inReplyTo ? { inReplyTo: args.inReplyTo } : {}),
    patch: {
      number: args.number,
      date: args.date,
      subject: args.subject,
      docId: args.docId,
      intakeId: args.intakeId ?? null,
      status: 'pending',
    },
  })
}

/**
 * Record an inbound communication, when the officer keeps an intake.
 *
 * Idempotent on the intake for the same reason: keeping the same letter twice
 * is one letter.
 */
export async function recordIntake(args: {
  intakeId: string
  number: string
  date: string
  receivedOn: string
  subject: string
  correspondent?: { name: string; organisation: string }
  at: string
}): Promise<RegisterEntry> {
  const existing = (await listEntries()).find((entry) => entry.intakeId === args.intakeId)
  const patch: Partial<RegisterEntry> = {
    number: args.number,
    date: args.date,
    receivedOn: args.receivedOn,
    subject: args.subject,
    intakeId: args.intakeId,
    ...(args.correspondent ? { correspondent: { ...args.correspondent, bookId: null } } : {}),
  }
  if (existing) {
    const updated = await updateEntry(existing.id, patch, args.at)
    if (updated) return updated
  }
  return createEntry({ direction: 'received', at: args.at, patch })
}

/**
 * Mark the letter a document answers as replied.
 *
 * A separate step from `recordIssuedNumber`, and called after it, because the
 * two are different facts: a number was issued (about the outbound side) and
 * the inbound letter has been answered (about the inbound side). Doing them in
 * one function would leave no way to correct one without the other.
 */
export async function markReplied(entryId: string, at: string): Promise<RegisterEntry | null> {
  return updateEntry(entryId, { status: 'replied' }, at)
}

/* ------------------------------------------------------------------ *
 * The duplicate check
 * ------------------------------------------------------------------ */

/**
 * Communications this office has already sent under the same number.
 *
 * The register's half of the check `numberingStore.ts` runs over
 * `numberIssues`: that one knows what THIS APP issued, this one also knows what
 * the officer recorded by hand for a communication issued before they had it.
 * Both feed one warning.
 */
export async function duplicatesOf(number: string, exceptId = ''): Promise<RegisterEntry[]> {
  return duplicateNumbers(await listEntries(), number, exceptId)
}
