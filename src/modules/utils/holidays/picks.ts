import { db } from '@/db'

import type { HolidayPickRow } from '@/db'

/** Strictly-increasing so same-millisecond rows still order by creation, not by primary key. */
let lastStamp = 0
function nextStamp(): string {
  const now = Date.now()
  lastStamp = now > lastStamp ? now : lastStamp + 1
  return new Date(lastStamp).toISOString()
}

function rowId(year: number, holidayId: string): string {
  return `${year}:${holidayId}`
}

export async function listPicks(year: number): Promise<HolidayPickRow[]> {
  return db.holidayPicks.where('year').equals(year).toArray()
}

/** Toggles one restricted-holiday pick for a year; the caller enforces the max-two rule. */
export async function togglePick(year: number, holidayId: string): Promise<boolean> {
  const id = rowId(year, holidayId)
  return db.transaction('rw', db.holidayPicks, async () => {
    const existing = await db.holidayPicks.get(id)
    if (existing) {
      await db.holidayPicks.delete(id)
      return false
    }
    await db.holidayPicks.put({ id, year, holidayId, createdAt: nextStamp() })
    return true
  })
}
