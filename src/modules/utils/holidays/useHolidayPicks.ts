import { useCallback, useEffect, useState } from 'react'

import { MAX_RESTRICTED_PICKS } from '@/lib/holidays/types'

import { listPicks, togglePick } from './picks'

/**
 * The settled set, tagged with the year it answers — the same "keyed settled
 * state" shape `src/lib/useAsync.ts` uses, so a year change reads as loading
 * without the effect clearing state synchronously first (a bare `setState`
 * at the top of an effect body is what `react-hooks/set-state-in-effect`
 * flags, because it forces a second render before the request has even
 * started).
 */
type Settled = { year: number; picked: Set<string> }

export function useHolidayPicks(year: number) {
  const [settled, setSettled] = useState<Settled | null>(null)

  useEffect(() => {
    let cancelled = false
    void listPicks(year)
      .then((rows) => {
        if (cancelled) return
        setSettled({ year, picked: new Set(rows.map((r) => r.holidayId)) })
      })
      .catch(() => {
        if (cancelled) return
        setSettled({ year, picked: new Set() })
      })
    return () => {
      cancelled = true
    }
  }, [year])

  const current = settled?.year === year ? settled.picked : null

  const toggle = useCallback(
    async (holidayId: string) => {
      const before = current ?? new Set<string>()
      if (!before.has(holidayId) && before.size >= MAX_RESTRICTED_PICKS) {
        return { ok: false as const, reason: 'too-many' as const }
      }
      const isNowPicked = await togglePick(year, holidayId)
      setSettled((prev) => {
        const base = prev?.year === year ? prev.picked : before
        const next = new Set(base)
        if (isNowPicked) next.add(holidayId)
        else next.delete(holidayId)
        return { year, picked: next }
      })
      return { ok: true as const }
    },
    [year, current],
  )

  return { picked: current ?? new Set<string>(), ready: current !== null, toggle }
}
