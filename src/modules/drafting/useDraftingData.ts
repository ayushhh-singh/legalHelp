import { useCallback, useEffect, useState } from 'react'

import { loadDraftingIndex, loadPhrases, loadStructureTerms, loadTemplate } from './data'

import type { DocTemplate, DraftingIndex, PhraseLibrary, StructureTerms } from './schema'

/**
 * Loading the drafting datasets, one at a time and only when asked.
 *
 * `data/drafting` is ~476 KB across seventeen files, and the picker needs
 * exactly one of them. The loaders in `data.ts` already fetch per file through
 * a `?raw` dynamic import (ADR-013/018/020, never a `fetch`); this is the React
 * side of that, and its job is to make sure a screen asks for what it draws and
 * nothing else:
 *
 *  - the picker asks for `index.json` — 6 KB, fourteen names and a line each;
 *  - the editor asks for its one template — 24 KB;
 *  - the phrase library (48 KB) and the Rajbhasha glossary (58 KB) are asked
 *    for only when the reader opens the toolbar sheet that shows them. Those
 *    two are together larger than every template put together, and most drafts
 *    are written without opening either.
 *
 * Only the SETTLED outcome is state, as in `usePayTables`: `loading` is the
 * absence of one, so nothing sets state during an effect and there is no window
 * in which the two disagree.
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
 * effect having to clear the state first. Clearing it there is a setState in
 * an effect body — a cascading render that React's own lint rule rejects — and
 * the version that skipped the clear rendered one frame of the PREVIOUS
 * template's fields under the new template's heading.
 */
type Keyed<T> = Settled<T> & { key: string }

/**
 * `enabled` is what keeps the phrase library and the glossary off the wire for
 * a reader who never opens their sheet — the same lever `useLawEngine(enabled)`
 * pulls, and for the same reason: loading eagerly "so the first click is
 * instant" hands 106 KB to everyone to save one reader a moment.
 */
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

  // A settled outcome from an earlier request is not this request's answer.
  const current = settled?.key === requestKey ? settled : null

  return { ...(current ?? LOADING), retry }
}

export function useDraftingIndex(): AsyncState<DraftingIndex> & { retry: () => void } {
  return useAsync(loadDraftingIndex, 'index')
}

export function useTemplate(id: string): AsyncState<DocTemplate> & { retry: () => void } {
  return useAsync(() => loadTemplate(id), `template:${id}`)
}

export function usePhrases(enabled: boolean): AsyncState<PhraseLibrary> & { retry: () => void } {
  return useAsync(loadPhrases, 'phrases', enabled)
}

export function useStructureTerms(enabled: boolean): AsyncState<StructureTerms> & { retry: () => void } {
  return useAsync(loadStructureTerms, 'terms', enabled)
}
