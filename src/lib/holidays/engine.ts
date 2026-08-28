/**
 * The holiday calendar. Pure: no React, no Dexie, no clock of its own — every
 * function takes `today` as an argument, the way `src/lib/pay/engine.ts`
 * takes its datasets as arguments rather than importing them.
 */

import { compareIsoDate } from '@/lib/istDay'

import { MAX_RESTRICTED_PICKS } from './types'

import type { IsoDate } from '@/lib/istDay'
import type { Holiday, HolidaysDataset } from './types'

export interface UpcomingHoliday extends Holiday {
  kind: 'gazetted' | 'restricted'
}

/** Every holiday on or after `today`, gazetted first-and-restricted merged, nearest first. */
export function upcoming(
  dataset: HolidaysDataset,
  today: IsoDate,
  pickedRestrictedIds: ReadonlySet<string>,
  limit = 5,
): UpcomingHoliday[] {
  const gazetted: UpcomingHoliday[] = dataset.gazetted.map((h) => ({ ...h, kind: 'gazetted' as const }))
  const restricted: UpcomingHoliday[] = dataset.restricted
    .filter((h) => pickedRestrictedIds.has(h.id))
    .map((h) => ({ ...h, kind: 'restricted' as const }))

  return [...gazetted, ...restricted]
    .filter((h) => compareIsoDate(h.date, today) >= 0)
    .sort((a, b) => compareIsoDate(a.date, b.date))
    .slice(0, limit)
}

export type PickValidation = { ok: true } | { ok: false; reason: 'too-many' | 'unknown-id' }

/** A DoPT circular lets an employee choose at most `MAX_RESTRICTED_PICKS` restricted holidays a year. */
export function validatePicks(dataset: HolidaysDataset, pickedIds: readonly string[]): PickValidation {
  if (pickedIds.length > MAX_RESTRICTED_PICKS) return { ok: false, reason: 'too-many' }
  const known = new Set(dataset.restricted.map((h) => h.id))
  if (pickedIds.some((id) => !known.has(id))) return { ok: false, reason: 'unknown-id' }
  return { ok: true }
}

export function findHoliday(dataset: HolidaysDataset, id: string): Holiday | undefined {
  return dataset.gazetted.find((h) => h.id === id) ?? dataset.restricted.find((h) => h.id === id)
}
