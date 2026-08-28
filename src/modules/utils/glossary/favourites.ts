import type { GlossaryTerm } from './schema'

import { db, type GlossaryFavouriteRow, type GlossaryRecentRow } from '@/db'

/**
 * Favourites and recent lookups — the only user state this module keeps.
 *
 * Both live in IndexedDB, on the device, with no account and no sync (master
 * context, hard rule). The recent list is written when a term is copied or
 * inserted, not on every keystroke of a search — it is a list of what an
 * officer acted on, matching `src/modules/law/saved.ts`'s own rule.
 */

/** Newest first, and never more than this many. */
export const RECENT_LIMIT = 20

/**
 * A strictly increasing ISO timestamp. Same technique as `src/modules/law/
 * saved.ts`: `Date.now()` has millisecond resolution, and Dexie orders same-
 * millisecond rows by primary key, which is not insertion order. Nudging each
 * collision forward by a millisecond keeps the ordering total.
 */
let lastStamp = 0

function nextStamp(): string {
  const now = Date.now()
  lastStamp = now > lastStamp ? now : lastStamp + 1
  return new Date(lastStamp).toISOString()
}

function snapshot(term: GlossaryTerm) {
  return { id: term.id, termId: term.id, en: term.en, hi: term.hi }
}

/* ------------------------------------------------------------------ *
 * Favourites
 * ------------------------------------------------------------------ */

export async function listFavourites(): Promise<GlossaryFavouriteRow[]> {
  return db.glossaryFavourites.orderBy('createdAt').reverse().toArray()
}

export async function isFavourite(termId: string): Promise<boolean> {
  return (await db.glossaryFavourites.get(termId)) !== undefined
}

/** Returns the state it settled on, so the caller does not have to guess. */
export async function toggleFavourite(term: GlossaryTerm): Promise<boolean> {
  // One transaction: a double tap on a slow device must not read "absent"
  // twice and end up writing the row after having just deleted it.
  return db.transaction('rw', db.glossaryFavourites, async () => {
    const existing = await db.glossaryFavourites.get(term.id)
    if (existing) {
      await db.glossaryFavourites.delete(term.id)
      return false
    }
    await db.glossaryFavourites.put({ ...snapshot(term), createdAt: nextStamp() })
    return true
  })
}

/* ------------------------------------------------------------------ *
 * Recent lookups
 * ------------------------------------------------------------------ */

export async function listRecents(): Promise<GlossaryRecentRow[]> {
  return db.glossaryRecents.orderBy('viewedAt').reverse().limit(RECENT_LIMIT).toArray()
}

/**
 * Record that a term was acted on, and trim the list back to 20. Re-acting on
 * a term moves it to the top rather than adding a second row — the primary key
 * is the term, not the visit — which is why this is a `put` and the trim
 * counts rows rather than deleting by age.
 */
export async function recordLookup(term: GlossaryTerm): Promise<void> {
  await db.transaction('rw', db.glossaryRecents, async () => {
    await db.glossaryRecents.put({ ...snapshot(term), viewedAt: nextStamp() })

    const surplus = (await db.glossaryRecents.count()) - RECENT_LIMIT
    if (surplus <= 0) return
    const oldest = await db.glossaryRecents.orderBy('viewedAt').limit(surplus).primaryKeys()
    await db.glossaryRecents.bulkDelete(oldest)
  })
}

export async function clearRecents(): Promise<void> {
  await db.glossaryRecents.clear()
}
