import { useCallback, useEffect, useState } from 'react'

import { listFavourites, listRecents, recordLookup, RECENT_LIMIT, toggleFavourite } from './favourites'

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

  /**
   * Both mutations patch the local list from what they already know, rather
   * than re-running `listFavourites()`/`listRecents()` against IndexedDB
   * after every copy or favourite. Two reasons, not just one: the extra round
   * trip was pure waste at the ~20-row scale these lists actually reach, and
   * — the one that matters — two rapid toggles (a fast double-tap) used to
   * race two `listFavourites()` reads against each other with no ordering
   * guarantee, so the SECOND click's list could be overwritten by the
   * FIRST click's slower read resolving after it. `setFavourites`/
   * `setRecents` here take a plain updater instead, and React guarantees an
   * updater always sees the latest state, so two toggles applied in either
   * order converge on the same, correct result.
   *
   * `createdAt`/`viewedAt` are stamped locally rather than read back from
   * Dexie — they are the sort key the OTHER favourites/recents share, and
   * nothing in this UI reads either field directly, so an approximate
   * timestamp that keeps "most recent first" correct is enough.
   */
  const toggle = useCallback(async (term: GlossaryTerm) => {
    const isNowFavourite = await toggleFavourite(term)
    setFavourites((current) => {
      const withoutTerm = (current ?? []).filter((row) => row.termId !== term.id)
      if (!isNowFavourite) return withoutTerm
      const row: GlossaryFavouriteRow = {
        id: term.id,
        termId: term.id,
        en: term.en,
        hi: term.hi,
        createdAt: new Date().toISOString(),
      }
      return [row, ...withoutTerm]
    })
  }, [])

  const recordUsed = useCallback(async (term: GlossaryTerm) => {
    await recordLookup(term)
    setRecents((current) => {
      const withoutTerm = (current ?? []).filter((row) => row.termId !== term.id)
      const row: GlossaryRecentRow = {
        id: term.id,
        termId: term.id,
        en: term.en,
        hi: term.hi,
        viewedAt: new Date().toISOString(),
      }
      return [row, ...withoutTerm].slice(0, RECENT_LIMIT)
    })
  }, [])

  const favouriteIds = new Set((favourites ?? []).map((row) => row.termId))

  return { favourites: favourites ?? [], recents: recents ?? [], favouriteIds, toggle, recordUsed }
}
