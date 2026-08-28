import type { CardPatch } from './reviewQueue'

import { db, type CardOverrideRow, type ProposedCardRow, type TrainerBookmarkRow, type TrainerReportRow } from '@/db'

/**
 * The Dexie half of everything `src/lib/srs/store.ts` does not own: bookmarks,
 * reports and the Local Review Queue's decisions. Kept out of `src/lib/srs`
 * deliberately — that directory is the FSRS schedule and nothing else, and
 * `purity.test.ts` there would fail on a second table it does not expect.
 */

// ------------------------------------------------------------------ bookmarks

export const listBookmarks = (): Promise<TrainerBookmarkRow[]> => db.trainerBookmarks.toArray()

/** Toggle a bookmark. Returns the new state. */
export async function toggleBookmark(qId: string): Promise<boolean> {
  const existing = await db.trainerBookmarks.get(qId)
  if (existing) {
    await db.trainerBookmarks.delete(qId)
    return false
  }
  await db.trainerBookmarks.put({ qId, createdAt: new Date().toISOString() })
  return true
}

/** Bookmark every id given, skipping any already bookmarked — never a toggle. */
export async function bookmarkMany(qIds: readonly string[]): Promise<void> {
  const at = new Date().toISOString()
  await db.transaction('rw', db.trainerBookmarks, async () => {
    const existing = new Set(await db.trainerBookmarks.toCollection().primaryKeys())
    const fresh = qIds.filter((qId) => !existing.has(qId))
    if (fresh.length > 0) await db.trainerBookmarks.bulkPut(fresh.map((qId) => ({ qId, createdAt: at })))
  })
}

// -------------------------------------------------------------------- reports

export const listReports = (): Promise<TrainerReportRow[]> =>
  db.trainerReports.orderBy('createdAt').reverse().toArray()

export async function submitReport(qId: string, reason: string, note: string): Promise<TrainerReportRow> {
  const row: TrainerReportRow = { id: `${qId}#${Date.now()}`, qId, reason, note, createdAt: new Date().toISOString() }
  await db.trainerReports.put(row)
  return row
}

/** A flat CSV, for the "exportable" requirement — one row per report. */
export function reportsToCsv(rows: readonly TrainerReportRow[]): string {
  const escape = (value: string): string => `"${value.replace(/"/g, '""')}"`
  const header = ['id', 'qId', 'reason', 'note', 'createdAt'].join(',')
  const lines = rows.map((row) => [row.id, row.qId, row.reason, row.note, row.createdAt].map(escape).join(','))
  return [header, ...lines].join('\n')
}

// -------------------------------------------------------------- review queue

export const listProposedCards = (): Promise<ProposedCardRow[]> =>
  db.proposedCards.orderBy('createdAt').toArray()

export const listCardOverrides = (): Promise<CardOverrideRow[]> => db.cardOverrides.toArray()

export interface DecideInput {
  qId: string
  action: 'approved' | 'rejected'
  patch?: CardPatch | null
}

export async function decideCard(input: DecideInput): Promise<void> {
  const row: CardOverrideRow = {
    qId: input.qId,
    action: input.action,
    patch: input.patch ?? null,
    decidedAt: new Date().toISOString(),
  }
  await db.cardOverrides.put(row)
}

/** Approve every qId in one transaction — the review queue's bulk-approve action. */
export async function bulkApprove(qIds: readonly string[]): Promise<void> {
  const at = new Date().toISOString()
  await db.transaction('rw', db.cardOverrides, async () => {
    await db.cardOverrides.bulkPut(qIds.map((qId) => ({ qId, action: 'approved' as const, patch: null, decidedAt: at })))
  })
}
