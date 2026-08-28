import { holidaysDatasetSchema } from './schema'

import type { HolidaysDataset } from './schema'

/**
 * `data/holidays/holidays-2026.json` as a `?raw` dynamic import, the same
 * arrangement `src/modules/pay/data.ts` and the Law Converter use (ADR-013):
 * a content-hashed chunk the service worker precaches through the ordinary
 * JavaScript glob, so the calendar works offline on a first visit, rather
 * than a `fetch('/data/...')` that would only be cached after an online
 * visit to this route.
 *
 * Only 2026 is bundled today. A later year is a second entry in this map —
 * `scripts/ingest/holidays.py <year>` writes the file, this map names the
 * specifier (a bundler can only chunk a specifier it can see, so this cannot
 * be a computed `import()`), and the picker in `HolidaysPage.tsx` grows a
 * second option.
 */
const LOADERS: Record<number, () => Promise<{ default: string }>> = {
  2026: () => import('../../../../data/holidays/holidays-2026.json?raw'),
}

export const AVAILABLE_YEARS = Object.keys(LOADERS).map(Number).sort()

const pending = new Map<number, Promise<HolidaysDataset>>()

export async function loadHolidays(year: number): Promise<HolidaysDataset> {
  const cached = pending.get(year)
  if (cached) return cached

  const loader = LOADERS[year]
  if (!loader) throw new Error(`no bundled holiday calendar for ${year}`)

  const promise = loader()
    .then((mod) => holidaysDatasetSchema.parse(JSON.parse(mod.default)))
    .catch((error: unknown) => {
      pending.delete(year)
      throw error
    })
  pending.set(year, promise)
  return promise
}

/** Test seam, matching `resetPayTablesCache()` in `src/modules/pay/data.ts`. */
export function resetHolidaysCache(): void {
  pending.clear()
}
