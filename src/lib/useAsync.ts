import { useCallback, useEffect, useState } from 'react'

/**
 * A generic "load this lazily, only when asked" hook — the same shape
 * `src/modules/utils/glossary/useGlossaryData.ts` and `src/modules/drafting`'s
 * own `useAsync` already use. Only the SETTLED outcome is state, so nothing
 * sets state during an effect body and there is no window in which the two
 * disagree; the settled value carries the request key it answers, which is
 * what lets a key change read as "loading" without the effect clearing state
 * first (a bare clear would render one frame of the previous request's data
 * under the new key).
 *
 * Pulled out to a shared home for the Utilities module's three new datasets
 * (holidays, portals, pension facts) rather than copied a third and fourth
 * time; the glossary and drafting call sites are left as they are rather than
 * migrated, since neither needed to change for this session's work.
 */

export type AsyncState<T> =
  | { status: 'loading'; data: null; error: null }
  | { status: 'ready'; data: T; error: null }
  | { status: 'error'; data: null; error: unknown }

type Settled<T> = { status: 'ready'; data: T; error: null } | { status: 'error'; data: null; error: unknown }
type Keyed<T> = Settled<T> & { key: string }

const LOADING = { status: 'loading', data: null, error: null } as const

export function useAsync<T>(
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
