import { useCallback, useEffect, useState } from 'react'

import { loadCorpus } from './data'
import { buildEngine, type LawSearchEngine } from './search'

/**
 * Load the section tables and build the search index, once per tab.
 *
 * Both halves are memoised below the hook — `loadCorpus` keeps its parsed JSON
 * and this keeps the Fuse index built over it — so moving between the
 * converter, "What's new" and the saved list does not re-parse 3.9 MB or
 * re-index 1,059 records.
 *
 * Only the SETTLED outcome is state. `idle` and `loading` are derived from
 * whether the caller has asked for the tables yet, so nothing here sets state
 * during an effect (`react-hooks/set-state-in-effect`) and there is no window
 * in which the two disagree.
 */

let engineCache: LawSearchEngine | null = null

export type LawEngineState =
  /** Nothing has been asked for yet, so nothing has been downloaded. */
  | { status: 'idle'; engine: null; error: null }
  | { status: 'loading'; engine: null; error: null }
  | { status: 'ready'; engine: LawSearchEngine; error: null }
  | { status: 'error'; engine: null; error: unknown }

type Settled =
  | { status: 'ready'; engine: LawSearchEngine; error: null }
  | { status: 'error'; engine: null; error: unknown }

/**
 * @param enabled Whether the section tables are needed YET.
 *
 * The converter passes `false` until the reader has typed something. Opening
 * `/law` and reading the page then downloads nothing at all: 3.9 MB of statute
 * is what makes an offline lookup worth having, and it is dead weight for a
 * reader who has not asked a question. The service worker precaches it in the
 * background either way, so a reader who does search pays for it once.
 */
export function useLawEngine(enabled = true): LawEngineState & { retry: () => void } {
  const [settled, setSettled] = useState<Settled | null>(() =>
    engineCache ? { status: 'ready', engine: engineCache, error: null } : null,
  )
  // Bumped by retry(), which is what re-runs the effect below.
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!enabled) return

    // No `engineCache` early return here, deliberately. Enabling, disabling and
    // re-enabling (clear the query, type again) cancelled the first run before
    // it could report, and a second run that saw the cache already populated
    // and returned early left `settled` null — the hook then said "loading"
    // forever with the data sitting in memory. `loadCorpus` is memoised and
    // `buildEngine` is guarded below, so re-running costs a promise lookup.
    let cancelled = false
    void loadCorpus()
      .then((corpus) => {
        // Two components mounting at once both reach here; the second finds
        // the index already built and reuses it rather than building a second.
        engineCache ??= buildEngine(corpus)
        if (!cancelled) setSettled({ status: 'ready', engine: engineCache, error: null })
      })
      .catch((error: unknown) => {
        if (!cancelled) setSettled({ status: 'error', engine: null, error })
      })

    return () => {
      cancelled = true
    }
  }, [attempt, enabled])

  const retry = useCallback(() => {
    setSettled(null)
    setAttempt((value) => value + 1)
  }, [])

  const state: LawEngineState =
    settled ??
    (enabled
      ? { status: 'loading', engine: null, error: null }
      : { status: 'idle', engine: null, error: null })

  return { ...state, retry }
}

/** Test seam. */
export function resetEngineCache(): void {
  engineCache = null
}
