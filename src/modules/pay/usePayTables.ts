import { useCallback, useEffect, useState } from 'react'

import { loadPayTables } from './data'

import type { PayTables } from '@/lib/pay/tables'

/**
 * The eleven datasets, once per tab.
 *
 * Unlike `useLawEngine`, this takes no `enabled` flag. The Law Converter can
 * render a useful page — the search box and the code chips — before it has any
 * statute, so it waits until the reader types. This form cannot: the Level
 * select needs the matrix, the pickers need the posts and the cities, and the
 * first thing on screen is already a figure. Holding the load back would buy a
 * faster empty page and a slower answer.
 *
 * Only the SETTLED outcome is state. `loading` is the absence of one, so
 * nothing here sets state during an effect and there is no window in which the
 * two disagree.
 */

let cache: PayTables | null = null

/**
 * Start the download the moment this module is evaluated, not on the first
 * effect.
 *
 * The route chunk arrives, React renders a skeleton, an effect runs, and only
 * then does the first dataset request leave — four serial steps, and on a
 * throttled connection the last two are a round trip of dead time. Calling it
 * here overlaps the datasets with React's first render instead.
 *
 * It is in THIS module rather than in `data.ts` deliberately: `data.ts` is also
 * imported by `src/ai/tools/pay.ts`, and registering a tool must not start a
 * 1.2 MB download for a reader who never opens the calculator.
 */
void loadPayTables().catch(() => {
  // Swallowed here; `usePayTables` awaits the same promise and reports the
  // failure to the reader with a retry. An unhandled rejection at module scope
  // would be a console error on a route that recovers perfectly well.
})

export type PayTablesState =
  | { status: 'loading'; tables: null; error: null }
  | { status: 'ready'; tables: PayTables; error: null }
  | { status: 'error'; tables: null; error: unknown }

type Settled =
  { status: 'ready'; tables: PayTables; error: null } | { status: 'error'; tables: null; error: unknown }

export function usePayTables(): PayTablesState & { retry: () => void } {
  const [settled, setSettled] = useState<Settled | null>(() =>
    cache ? { status: 'ready', tables: cache, error: null } : null,
  )
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    void loadPayTables()
      .then((tables) => {
        cache = tables
        if (!cancelled) setSettled({ status: 'ready', tables, error: null })
      })
      .catch((error: unknown) => {
        if (!cancelled) setSettled({ status: 'error', tables: null, error })
      })
    return () => {
      cancelled = true
    }
  }, [attempt])

  const retry = useCallback(() => {
    setSettled(null)
    setAttempt((value) => value + 1)
  }, [])

  return { ...(settled ?? { status: 'loading', tables: null, error: null }), retry }
}

/** Test seam. */
export function resetPayTablesState(): void {
  cache = null
}
