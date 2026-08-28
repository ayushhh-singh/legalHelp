import { useCallback, useEffect, useState } from 'react'

import { listFavourites, listRecents, recordLookup, toggleFavourite } from './favourites'

import type { GlossaryFavouriteRow, GlossaryRecentRow } from '@/db'
import type { GlossaryTerm } from './schema'

/**
 * Favourites and recents, read once on mount and kept in sync with every
 * mutation this hook itself makes.
 *
 * The load is the same `cancelled`-flag shape `SectionActions.tsx` uses for a
 * single boolean: no ref-guarded latch is involved (ADR-022 is about a write
 * that RESTORES shared state from an async continuation — a URL, a draft's
 * fields — where a second StrictMode mount must not repeat the restore. This
 * is a plain read-then-render with nothing to restore INTO, so `cancelled`
 * alone is sufficient; a second mount just re-reads the same rows).
 */
export function useGlossaryFavourites() {
  const [favourites, setFavourites] = useState<GlossaryFavouriteRow[] | null>(null)
  const [recents, setRecents] = useState<GlossaryRecentRow[] | null>(null)

  useEffect(() => {
    let cancelled = false
    void Promise.all([listFavourites(), listRecents()])
      .then(([favouriteRows, recentRows]) => {
        if (cancelled) return
        setFavourites(favouriteRows)
        setRecents(recentRows)
      })
      .catch(() => {
        // Blocked IndexedDB. Both lists render empty rather than the page
        // disappearing — the same line `store.ts` takes for preferences.
        if (cancelled) return
        setFavourites([])
        setRecents([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  const toggle = useCallback(async (term: GlossaryTerm) => {
    await toggleFavourite(term)
    setFavourites(await listFavourites())
  }, [])

  const recordUsed = useCallback(async (term: GlossaryTerm) => {
    await recordLookup(term)
    setRecents(await listRecents())
  }, [])

  const favouriteIds = new Set((favourites ?? []).map((row) => row.termId))

  return { favourites: favourites ?? [], recents: recents ?? [], favouriteIds, toggle, recordUsed }
}
