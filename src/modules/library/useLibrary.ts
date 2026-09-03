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

/**
 * Which units of a work have been opened. `undefined` while Dexie answers —
 * and NO CALLER MAY BLOCK ITS RENDER ON THAT.
 *
 * On a device whose storage is refused — a private window, a managed device
 * with site data blocked — `useLiveQuery` never produces a value at all, and
 * the committed pages each sat on a skeleton for ever waiting for one. Read
 * ticks and a progress ring are conveniences; the table of contents and the
 * rule are what the reader came for, and both are in a precached chunk that
 * needs no database. Treat `undefined` as "nothing yet" for display, and keep
 * it distinguishable for anything that genuinely needs to know.
 */
export function useReadUnitIds(workId: string | undefined): Set<string> | undefined {
  const rows = useLiveQuery(
    (): Promise<LibraryProgressRow[]> => (workId ? progressFor(workId) : Promise.resolve([])),
    [workId],
    undefined,
  )
  return useMemo(() => (rows ? new Set(rows.map((row) => row.unitId)) : undefined), [rows])
}

/**
 * Every unit opened, across every work — the hub's progress rings and its
 * per-work "continue reading" rows. `undefined` while Dexie answers; see
 * `useReadUnitIds` for why the hub must not wait for it.
 */
export function useAllProgress(): LibraryProgressRow[] | undefined {
  return useLiveQuery((): Promise<LibraryProgressRow[]> => db.libraryProgress.toArray(), [], undefined)
}

/**
 * The unit each work was last left on, newest first, plus which work that was.
 *
 * Two questions, one pass over the same rows: the brief asks for "continue
 * reading" on EVERY card that has progress, and for the file tab on the work
 * last opened. The committed hub answered both with one variable and so offered
 * the link only on the card that already had the tab — a reader half way
 * through the CCS (Leave) Rules who then opened the BNS lost their place in the
 * Leave Rules entirely.
 */
export interface ShelfProgress {
  /** workId -> the units of it that have been opened. */
  readByWork: ReadonlyMap<string, ReadonlySet<string>>
  /** workId -> the unit it was last left on. */
  resumeByWork: ReadonlyMap<string, string>
  /** The work opened most recently, which is the one that gets the file tab. */
  latestWorkId: string | null
}

export function shelfProgress(rows: readonly LibraryProgressRow[] | undefined): ShelfProgress {
  const readByWork = new Map<string, Set<string>>()
  const latestPerWork = new Map<string, LibraryProgressRow>()
  let latest: LibraryProgressRow | null = null

  for (const row of rows ?? []) {
    const set = readByWork.get(row.workId)
    if (set) set.add(row.unitId)
    else readByWork.set(row.workId, new Set([row.unitId]))

    const best = latestPerWork.get(row.workId)
    if (!best || row.at > best.at) latestPerWork.set(row.workId, row)
    if (!latest || row.at > latest.at) latest = row
  }

  return {
    readByWork,
    resumeByWork: new Map([...latestPerWork].map(([workId, row]) => [workId, row.unitId])),
    latestWorkId: latest?.workId ?? null,
  }
}

/** The unit one work was last left on — what opens the right branch of its TOC. */
export function useLastReadUnitId(workId: string | undefined): string | undefined {
  const rows = useLiveQuery(
    (): Promise<LibraryProgressRow[]> => (workId ? progressFor(workId) : Promise.resolve([])),
    [workId],
    undefined,
  )
  return useMemo(() => {
    if (!rows || rows.length === 0) return undefined
    return rows.reduce((best, row) => (row.at > best.at ? row : best)).unitId
  }, [rows])
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

  /**
   * Read-modify-write against the STORED row, not against the last render's.
   *
   * `useLiveQuery` lands a tick after the write, so two quick presses of the
   * size stepper both computed their patch from the same stale `prefs` and the
   * second silently undid the first. Reading inside the write closes that
   * window. It also never rejects: a device whose storage is refused must lose
   * a preference, not throw out of an onClick.
   */
  const update = useCallback(async (patch: Partial<ReaderPrefs>) => {
    try {
      const stored = await db.settings.get(SETTING_KEYS.library)
      await setSetting(SETTING_KEYS.library, { ...normalise(stored?.value, language), ...patch })
    } catch {
      // Nothing to tell the reader: the control simply does not stick, and the
      // page they are reading is unaffected.
    }
  }, [language])

  return { prefs, hydrated: row !== undefined, update }
}
