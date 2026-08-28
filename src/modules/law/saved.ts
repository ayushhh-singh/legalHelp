import type { LawCode, LawSection } from './types'

import { db, type LawRecentRow, type LawSavedRow } from '@/db'

/**
 * Saved sections and recent lookups — the only user state this module keeps.
 *
 * Both live in IndexedDB, on the device, with no account and no sync (master
 * context, hard rule). Neither records a query the reader did not act on: the
 * recent list is written when a section is opened, not on every keystroke, so
 * it is a list of what was read rather than a log of what was typed.
 */

/** Newest first, and never more than this many. */
export const RECENT_LIMIT = 20

export const rowId = (code: LawCode, section: string) => `${code}:${section}`

function snapshot(code: LawCode, record: LawSection) {
  return {
    id: rowId(code, record.section),
    code,
    section: record.section,
    act: record.act,
    heading: { en: record.heading.en, hi: record.heading.hi },
  }
}

/* ------------------------------------------------------------------ *
 * Favourites
 * ------------------------------------------------------------------ */

export async function listFavourites(): Promise<LawSavedRow[]> {
  return db.lawFavourites.orderBy('createdAt').reverse().toArray()
}

export async function isFavourite(code: LawCode, section: string): Promise<boolean> {
  return (await db.lawFavourites.get(rowId(code, section))) !== undefined
}

export async function addFavourite(code: LawCode, record: LawSection): Promise<void> {
  await db.lawFavourites.put({ ...snapshot(code, record), createdAt: new Date().toISOString() })
}

export async function removeFavourite(code: LawCode, section: string): Promise<void> {
  await db.lawFavourites.delete(rowId(code, section))
}

/**
 * Delete by the row's own primary key. The saved list holds rows read back out
 * of IndexedDB, where `code` is a plain string — narrowing it back to `LawCode`
 * just to rebuild the id it already has would be a cast, not a check.
 */
export async function removeFavouriteById(id: string): Promise<void> {
  await db.lawFavourites.delete(id)
}

/** Returns the state it settled on, so the caller does not have to guess. */
export async function toggleFavourite(code: LawCode, record: LawSection): Promise<boolean> {
  const id = rowId(code, record.section)
  // One transaction: a double tap on a slow device must not read "absent"
  // twice and end up writing the row after having just deleted it.
  return db.transaction('rw', db.lawFavourites, async () => {
    const existing = await db.lawFavourites.get(id)
    if (existing) {
      await db.lawFavourites.delete(id)
      return false
    }
    await db.lawFavourites.put({ ...snapshot(code, record), createdAt: new Date().toISOString() })
    return true
  })
}

/* ------------------------------------------------------------------ *
 * Recent lookups
 * ------------------------------------------------------------------ */

export async function listRecents(): Promise<LawRecentRow[]> {
  return db.lawRecents.orderBy('viewedAt').reverse().limit(RECENT_LIMIT).toArray()
}

/**
 * Record that a section was opened, and trim the list back to 20.
 *
 * Re-opening a section moves it to the top rather than adding a second row —
 * the primary key is the section, not the visit — which is why this is a `put`
 * and why the trim counts rows rather than deleting by age.
 */
export async function recordLookup(code: LawCode, record: LawSection, query: string): Promise<void> {
  await db.transaction('rw', db.lawRecents, async () => {
    await db.lawRecents.put({
      ...snapshot(code, record),
      query: query.trim(),
      viewedAt: new Date().toISOString(),
    })

    const surplus = (await db.lawRecents.count()) - RECENT_LIMIT
    if (surplus <= 0) return
    const oldest = await db.lawRecents.orderBy('viewedAt').limit(surplus).primaryKeys()
    await db.lawRecents.bulkDelete(oldest)
  })
}

export async function clearRecents(): Promise<void> {
  await db.lawRecents.clear()
}
