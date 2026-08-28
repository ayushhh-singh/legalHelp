import { useCallback, useEffect, useState } from 'react'

import { loadGlossary } from './data'

import type { Glossary } from './schema'

/**
 * Loading `data/glossary.json`, only when asked.
 *
 * Same shape as `useDraftingData.ts`'s `useAsync`: only the SETTLED outcome is
 * state, so nothing sets state during an effect body and there is no window in
 * which the two disagree. `enabled` is what keeps the ~700 KB glossary off the
 * wire for a reader who opens `/utils` but never opens the glossary card, and
 * for a reader drafting a document who never opens the toolbar's term sheet.
 */

export type AsyncState<T> =
  | { status: 'loading'; data: null; error: null }
  | { status: 'ready'; data: T; error: null }
  | { status: 'error'; data: null; error: unknown }

type Settled<T> = { status: 'ready'; data: T; error: null } | { status: 'error'; data: null; error: unknown }

const LOADING = { status: 'loading', data: null, error: null } as const

/**
 * The settled outcome, TAGGED with the request it settled.
 *
 * Carrying the key is what lets a key change read as "loading" without the
 * effect having to clear state first — a setState in an effect body is a
 * cascading render React's own lint rule rejects, and clearing without tagging
 * rendered one frame of the previous request's data under the new key.
 */
type Keyed<T> = Settled<T> & { key: string }

function useAsync<T>(
  load: () => Promise<T>,
  key: string,
  enabled = true,
): AsyncState<T> & { retry: () => void } {
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
    // `load` is a fresh closure on every render; `requestKey` is what actually
    // identifies the request, which is why it is the dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey, enabled])

  const retry = useCallback(() => {
    setSettled((current) => (current?.status === 'error' ? null : current))
    setAttempt((value) => value + 1)
  }, [])

  const current = settled?.key === requestKey ? settled : null
  return { ...(current ?? LOADING), retry }
}

export function useGlossary(enabled: boolean): AsyncState<Glossary> & { retry: () => void } {
  return useAsync(loadGlossary, 'glossary', enabled)
}
