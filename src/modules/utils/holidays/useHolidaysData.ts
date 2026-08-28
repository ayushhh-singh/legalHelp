import { useAsync } from '@/lib/useAsync'

import { loadHolidays } from './data'

import type { AsyncState } from '@/lib/useAsync'
import type { HolidaysDataset } from './schema'

export function useHolidays(year: number): AsyncState<HolidaysDataset> & { retry: () => void } {
  return useAsync(() => loadHolidays(year), `holidays-${year}`, true)
}
