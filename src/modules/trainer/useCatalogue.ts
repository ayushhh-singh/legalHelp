import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { loadAllCards, loadRulesIndex } from './data'
import { effectiveCatalogue } from './reviewQueue'

import { db } from '@/db'

import type { Card, RulesIndex } from './schema'

/**
 * Loading `data/rules`, only when the Trainer route is actually open.
 *
 * Identical shape to `useDraftingData.ts`'s `useAsync` and
 * `useGlossaryData.ts`'s: only the SETTLED outcome is state, tagged with the
 * request key, so a retry cannot render a stale result under a fresh key.
 * Duplicated rather than imported — each module owns its own copy for the
 * reason `src/modules/drafting/data.ts` is not imported by `src/modules/law`:
 * a shared hook would still pull in nothing extra here, but keeping the
 * pattern local is what every other module in this repo already does.
 */
export type AsyncState<T> =
  | { status: 'loading'; data: null; error: null }
  | { status: 'ready'; data: T; error: null }
  | { status: 'error'; data: null; error: unknown }

type Settled<T> = { status: 'ready'; data: T; error: null } | { status: 'error'; data: null; error: unknown }
type Keyed<T> = Settled<T> & { key: string }

const LOADING = { status: 'loading', data: null, error: null } as const

function useAsync<T>(load: () => Promise<T>, key: string, enabled = true): AsyncState<T> & { retry: () => void } {
  const [settled, setSettled] = useState<Keyed<T> | null>(null)
  const [attempt, setAttempt] = useState(0)
  const requestKey = `${key}#${attempt}`

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    void load()
      .then((data) => {
        if (!cancelled) setSettled({ status: 'ready', data, error: null, key: requestKey })
      })
      .catch((error: unknown) => {
        if (!cancelled) setSettled({ status: 'error', data: null, error, key: requestKey })
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey, enabled])

  const retry = useCallback(() => {
    setSettled((current) => (current?.status === 'error' ? null : current))
    setAttempt((value) => value + 1)
  }, [])

  const current = settled?.key === requestKey ? settled : null
  return { ...(current ?? LOADING), retry }
}

export function useRulesIndex(enabled = true): AsyncState<RulesIndex> & { retry: () => void } {
  return useAsync(loadRulesIndex, 'rules-index', enabled)
}

/** Every card in `data/rules`, exactly as shipped — before any local override. */
export function useRawCards(enabled = true): AsyncState<Card[]> & { retry: () => void } {
  return useAsync(loadAllCards, 'rules-cards', enabled)
}

/**
 * The catalogue `src/lib/srs` should actually schedule: the dataset's approved
 * cards, plus anything a reader has locally approved through the Local Review
 * Queue. `null` while the dataset has not loaded yet or no decisions have been
 * read — every caller already treats "no catalogue yet" as "show a skeleton".
 *
 * `useLiveQuery` over the two override tables is what makes an approval in the
 * Review Queue show up in the very next review session with no navigation or
 * manual refetch: approving a card writes `cardOverrides`, and every `Table`
 * read inside `db.cardOverrides.toArray()`/`db.proposedCards.toArray()` is
 * tracked, so this hook re-runs the moment either table changes.
 */
export function useEffectiveCatalogue(enabled = true): Card[] | null {
  const raw = useRawCards(enabled)
  const overrides = useLiveQuery(() => db.cardOverrides.toArray(), [], undefined)
  const proposed = useLiveQuery(() => db.proposedCards.toArray(), [], undefined)
  const rawCards = raw.status === 'ready' ? raw.data : null

  return useMemo(() => {
    if (!rawCards || !overrides || !proposed) return null
    return effectiveCatalogue(rawCards, overrides, proposed)
  }, [rawCards, overrides, proposed])
}
