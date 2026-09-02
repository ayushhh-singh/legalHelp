import { db, type LibraryBookmarkRow, type LibraryProgressRow } from '@/db'

/**
 * The Library's reading state — the one file in `src/lib/library` that opens
 * the database, the same split `src/lib/srs` draws between its pure layer and
 * `store.ts`.
 *
 * Nothing here leaves the device, and nothing here is a copy of the corpus: a
 * row is a work id, a unit id, a timestamp and a duration. What a reader has
 * read is as identifying as anything this app holds, which is why it is in
 * IndexedDB and not anywhere else.
 */

export const progressId = (workId: string, unitId: string): string => `${workId}:${unitId}`

/**
 * Record time spent on one unit.
 *
 * `secondsRead` ACCUMULATES across visits rather than being overwritten: a
 * reader who opens a rule, is interrupted, and comes back has read it for the
 * sum of both, and a per-visit figure would report the shorter of the two.
 * `at` is overwritten, because "where was I" is about the last visit.
 *
 * `seconds` of 0 is a real call — the reader arrived and has not yet dwelt —
 * and it must still write the row, because that is what "continue reading"
 * reads back.
 */
export async function recordProgress(
  workId: string,
  unitId: string,
  seconds: number,
  now = new Date(),
): Promise<void> {
  const id = progressId(workId, unitId)
  const added = Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : 0

  await db.transaction('rw', db.libraryProgress, async () => {
    const existing = await db.libraryProgress.get(id)
    await db.libraryProgress.put({
      id,
      workId,
      unitId,
      at: now.toISOString(),
      secondsRead: (existing?.secondsRead ?? 0) + added,
    })
  })
}

/** Every unit of one work the reader has opened. */
export function progressFor(workId: string): Promise<LibraryProgressRow[]> {
  return db.libraryProgress.where('workId').equals(workId).toArray()
}

/** The set of unit ids read in one work — what draws the TOC's read ticks. */
export async function readUnitIds(workId: string): Promise<Set<string>> {
  const rows = await progressFor(workId)
  return new Set(rows.map((row) => row.unitId))
}

/**
 * The unit this work was last left on, or `null`.
 *
 * Sorted in code rather than by an index: `at` is indexed globally, not per
 * work, so a `where('workId')` query cannot also order by it. One work's rows
 * are at most a few hundred and usually a handful.
 */
export async function lastReadIn(workId: string): Promise<LibraryProgressRow | null> {
  const rows = await progressFor(workId)
  if (rows.length === 0) return null
  return rows.reduce((latest, row) => (row.at > latest.at ? row : latest))
}

/** The most recently opened unit across every work — the hub's "continue reading". */
export async function lastReadAnywhere(): Promise<LibraryProgressRow | null> {
  const rows = await db.libraryProgress.orderBy('at').reverse().limit(1).toArray()
  return rows[0] ?? null
}

export function isBookmarked(workId: string, unitId: string): Promise<boolean> {
  return db.libraryBookmarks.get(progressId(workId, unitId)).then((row) => row !== undefined)
}

export function bookmarksFor(workId: string): Promise<LibraryBookmarkRow[]> {
  return db.libraryBookmarks.where('workId').equals(workId).toArray()
}

/** Returns the state it left the bookmark in, so a caller need not re-read. */
export async function toggleBookmark(workId: string, unitId: string, now = new Date()): Promise<boolean> {
  const id = progressId(workId, unitId)
  const existing = await db.libraryBookmarks.get(id)
  if (existing) {
    await db.libraryBookmarks.delete(id)
    return false
  }
  await db.libraryBookmarks.put({ id, workId, unitId, createdAt: now.toISOString() })
  return true
}
