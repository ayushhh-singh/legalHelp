import type { PaletteItem } from './types'

import { db } from '@/db'

/**
 * The palette's own recent-jumps list — the same shape and the same rules as
 * `src/modules/utils/glossary/favourites.ts`'s recents half, generalised
 * across every section rather than one dataset. Keyed on the item's own id,
 * so jumping to the same law section or job post twice moves it to the top
 * rather than adding a second row.
 */

export const RECENT_LIMIT = 8

let lastStamp = 0

/** A strictly increasing ISO timestamp — see `glossary/favourites.ts` for why. */
function nextStamp(): string {
  const now = Date.now()
  lastStamp = now > lastStamp ? now : lastStamp + 1
  return new Date(lastStamp).toISOString()
}

export async function listCommandRecents(): Promise<PaletteItem[]> {
  const rows = await db.commandRecents.orderBy('viewedAt').reverse().limit(RECENT_LIMIT).toArray()
  // `recordRecent: true` so selecting a row FROM the recents list re-stamps
  // it too — without this, re-picking an item already in "Recent" left it
  // stuck at whatever rank it was already at instead of moving back to the
  // top, silently breaking the "recent items first" ordering the moment two
  // different items had ever been recorded.
  return rows.map((row) => ({
    id: row.id,
    en: row.en,
    hi: row.hi,
    to: row.to,
    hint: row.section,
    recordRecent: true,
  }))
}

export async function recordCommandRecent(item: PaletteItem, section: string): Promise<void> {
  await db.transaction('rw', db.commandRecents, async () => {
    await db.commandRecents.put({
      id: item.id,
      section,
      en: item.en,
      hi: item.hi,
      to: item.to,
      viewedAt: nextStamp(),
    })

    const surplus = (await db.commandRecents.count()) - RECENT_LIMIT
    if (surplus <= 0) return
    const oldest = await db.commandRecents.orderBy('viewedAt').limit(surplus).primaryKeys()
    await db.commandRecents.bulkDelete(oldest)
  })
}
