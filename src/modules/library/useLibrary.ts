import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useMemo } from 'react'

import { db, SETTING_KEYS, setSetting, type LibraryBookmarkRow, type LibraryProgressRow } from '@/db'
import type { Language } from '@/i18n'
import { useAsync, type AsyncState } from '@/lib/useAsync'
import {
  buildWorkSearchIndex,
  loadCorpus,
  loadLibraryIndex,
  loadWork,
  progressFor,
  type LibraryCorpus,
  type WorkSearchIndex,
} from '@/lib/library'
import type { LibraryIndex, LibraryWork } from '@/schemas/library'

/**
 * The module's data hooks.
 *
 * Three loaders, three costs, and each is gated on the reader having actually
 * asked for the thing it loads — the same lever `useLawEngine(enabled)` pulls.
 * The shelf is ~11 KB, a work's table of contents is 8–220 KB with no
 * statutory text in it, and only the reader page pays for the corpus.
 */

export function useLibraryIndex(enabled = true): AsyncState<LibraryIndex> & { retry: () => void } {
  return useAsync(loadLibraryIndex, 'library-index', enabled)
}

export function useWork(workId: string | undefined): AsyncState<LibraryWork> & { retry: () => void } {
  const load = useCallback(() => (workId ? loadWork(workId) : Promise.reject(new Error('no work'))), [workId])
  return useAsync(load, `library-work:${workId ?? ''}`, Boolean(workId))
}

export function useWorkCorpus(
  work: LibraryWork | null,
  enabled = true,
): AsyncState<LibraryCorpus> & { retry: () => void } {
  const load = useCallback(() => (work ? loadCorpus(work) : Promise.reject(new Error('no work'))), [work])
  return useAsync(load, `library-corpus:${work?.id ?? ''}`, Boolean(work) && enabled)
}

/**
 * The search index for one work, built once per corpus.
 *
 * `useMemo` over the corpus object, which `loadCorpus` caches for the tab's
 * life — so re-entering a work does not re-index 531 sections, and switching
 * works does.
 */
export function useWorkSearchIndex(corpus: LibraryCorpus | null): WorkSearchIndex | null {
  return useMemo(() => (corpus ? buildWorkSearchIndex(corpus) : null), [corpus])
}

/** Which units of a work have been opened. `undefined` while Dexie answers. */
export function useReadUnitIds(workId: string | undefined): Set<string> | undefined {
  const rows = useLiveQuery(
    (): Promise<LibraryProgressRow[]> => (workId ? progressFor(workId) : Promise.resolve([])),
    [workId],
    undefined,
  )
  return useMemo(() => (rows ? new Set(rows.map((row) => row.unitId)) : undefined), [rows])
}

/** Every unit opened, across every work — the hub's per-card progress rings. */
export function useAllProgress() {
  return useLiveQuery(() => db.libraryProgress.toArray(), [], undefined)
}

export function useBookmarkedUnitIds(workId: string | undefined): Set<string> | undefined {
  const rows = useLiveQuery(
    (): Promise<LibraryBookmarkRow[]> =>
      workId ? db.libraryBookmarks.where('workId').equals(workId).toArray() : Promise.resolve([]),
    [workId],
    undefined,
  )
  return useMemo(() => (rows ? new Set(rows.map((row) => row.unitId)) : undefined), [rows])
}

// --------------------------------------------------------------- preferences

export type ReadingMode = Language | 'both'
export type TypeFamily = 'sans' | 'serif'
export type LineHeight = 'normal' | 'relaxed'

export interface ReaderPrefs {
  mode: ReadingMode
  /** 1-4. The step, not a pixel size — the sizes themselves live in the reader. */
  size: number
  family: TypeFamily
  lineHeight: LineHeight
}

export const DEFAULT_READER_PREFS: ReaderPrefs = {
  // `mode` defaults to whatever the app is in, resolved by the caller — a
  // reader who chose Hindi did not also choose to read the English text.
  mode: 'en',
  size: 2,
  family: 'sans',
  lineHeight: 'normal',
}

const clampSize = (value: unknown): number => {
  const n = typeof value === 'number' ? Math.round(value) : NaN
  return Number.isFinite(n) ? Math.min(4, Math.max(1, n)) : DEFAULT_READER_PREFS.size
}

/** A stored row is untrusted input, the same way every other settings row is. */
function normalise(stored: unknown, language: Language): ReaderPrefs {
  const row = (stored ?? {}) as Partial<ReaderPrefs>
  return {
    mode: row.mode === 'en' || row.mode === 'hi' || row.mode === 'both' ? row.mode : language,
    size: clampSize(row.size),
    family: row.family === 'serif' ? 'serif' : 'sans',
    lineHeight: row.lineHeight === 'relaxed' ? 'relaxed' : 'normal',
  }
}

/**
 * The reader's type and language preferences, in IndexedDB like everything else
 * a reader chooses — never `localStorage`, which is not where this app's user
 * state lives (master context).
 *
 * `undefined` while Dexie answers, so the reader can render its default rather
 * than painting one frame at the wrong size and then jumping.
 */
export function useReaderPrefs(language: Language): {
  prefs: ReaderPrefs
  hydrated: boolean
  update: (patch: Partial<ReaderPrefs>) => Promise<void>
} {
  const row = useLiveQuery(() => db.settings.get(SETTING_KEYS.library), [], undefined)
  const prefs = useMemo(() => normalise(row?.value, language), [row, language])

  const update = useCallback(
    async (patch: Partial<ReaderPrefs>) => {
      await setSetting(SETTING_KEYS.library, { ...prefs, ...patch })
    },
    [prefs],
  )

  return { prefs, hydrated: row !== undefined, update }
}
