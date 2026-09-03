import { useCallback, useEffect, useRef, useState } from 'react'

import { db } from '@/db'
import { AUTO_SNAPSHOT_EVERY } from '@/lib/drafting/versions'
import type { OfficialDoc } from '@/lib/drafting/model'

import { getDocument, putDocument, snapshot } from './documents'

/**
 * One document, autosaved.
 *
 * Four behaviours, and three of them exist because of something that actually
 * goes wrong on a real device:
 *
 * 1. **Autosave, debounced.** 700 ms after the last keystroke, and `savedAt`
 *    is what the "saved 3 s ago" line reads.
 * 2. **A snapshot every twenty saved edits** (`AUTO_SNAPSHOT_EVERY`), plus the
 *    ones the caller takes on export and on a manual save.
 * 3. **Two-tab conflict detection.** Before every write, the row's `updatedAt`
 *    is compared against the one this tab last saw. A newer one means another
 *    tab (or a restored version in another window) has written since, and the
 *    write is held and reported rather than clobbering it. The officer chooses:
 *    keep mine, take theirs, or open theirs beside mine.
 * 4. **A storage-quota warning.** `navigator.storage.estimate()` is checked
 *    when a save fails AND on a schedule, because a device that is nearly full
 *    fails the save that matters rather than the one before it. A failure whose
 *    name is `QuotaExceededError` is reported as one — the officer is told to
 *    export, not told "something went wrong".
 *
 * Nothing here is cosmetic: an editor that silently drops an officer's
 * paragraphs because a second tab was open, or because the disk filled up, is
 * an editor that loses work.
 */

const SAVE_DEBOUNCE_MS = 700
const QUOTA_WARN_RATIO = 0.9

export type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: number }
  | { kind: 'conflict'; theirs: OfficialDoc }
  | { kind: 'quota' }
  | { kind: 'error' }

export interface UseOfficialDoc {
  doc: OfficialDoc | null
  status: 'loading' | 'ready' | 'missing' | 'malformed' | 'too-new'
  storedVersion?: number
  save: SaveState
  dirty: boolean
  /** Replace the document. Debounced write; call it on every keystroke. */
  update: (next: OfficialDoc) => void
  /** Write now — what Ctrl+S, an export and a navigation guard use. */
  flush: () => Promise<void>
  /** Take a labelled snapshot of what is on screen. */
  saveVersion: (label: string) => Promise<void>
  /** Conflict resolution: keep what is in this tab, or take the other tab's. */
  resolveConflict: (choice: 'mine' | 'theirs') => Promise<void>
  reload: () => void
}

export function useOfficialDoc(id: string): UseOfficialDoc {
  const [doc, setDoc] = useState<OfficialDoc | null>(null)
  /**
   * `loading` is the initial value rather than something an effect sets, and
   * the read is keyed on `[id, nonce]` — so opening a second document resets
   * through the key rather than through a synchronous `setStatus` inside the
   * effect body, which `react-hooks/set-state-in-effect` rejects and which
   * would cascade a render on every reload.
   */
  const [status, setStatus] = useState<UseOfficialDoc['status']>('loading')
  const [storedVersion, setStoredVersion] = useState<number | undefined>(undefined)
  const [save, setSave] = useState<SaveState>({ kind: 'idle' })
  const [dirty, setDirty] = useState(false)
  const [nonce, setNonce] = useState(0)
  /**
   * Which document the state above belongs to.
   *
   * Opening a second document resets through a render-time comparison rather
   * than through a `setStatus('loading')` inside the read effect: the effect
   * form cascades a render on every load and is what
   * `react-hooks/set-state-in-effect` rejects. Adjusting state during render
   * when a prop changes is React's own documented pattern for exactly this.
   */
  const [readingId, setReadingId] = useState(id)
  if (readingId !== id) {
    setReadingId(id)
    setStatus('loading')
    setDoc(null)
    setSave({ kind: 'idle' })
    setDirty(false)
  }

  /**
   * The `updatedAt` this tab last wrote or read. The conflict check compares
   * against it, so it is a ref rather than state: it must be current inside the
   * debounce timer's closure, and a re-render is not what should move it.
   */
  const seenAt = useRef<string | null>(null)
  const pending = useRef<OfficialDoc | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const editsSinceSnapshot = useRef(0)

  useEffect(() => {
    let alive = true
    void getDocument(id).then((result) => {
      if (!alive) return
      if (result.ok) {
        seenAt.current = result.row.updatedAt
        setDoc(result.doc)
        setStatus('ready')
        return
      }
      setStoredVersion(result.storedVersion)
      setStatus(result.reason === 'missing' ? 'missing' : result.reason)
    })
    return () => {
      alive = false
    }
  }, [id, nonce])

  const write = useCallback(async (next: OfficialDoc) => {
    setSave({ kind: 'saving' })
    try {
      // The conflict check and the write are NOT in one transaction, and that
      // is deliberate: Dexie's `rw` lock is per tab, so a transaction would not
      // exclude the other tab anyway. What makes this safe enough is that the
      // window between the read and the write is a single microtask, and that
      // the losing side is reported rather than silently overwritten.
      const current = await db.documents.get(next.id)
      if (current && seenAt.current && current.updatedAt > seenAt.current) {
        const theirs = await getDocument(next.id)
        setSave(theirs.ok ? { kind: 'conflict', theirs: theirs.doc } : { kind: 'error' })
        return
      }
      const row = await putDocument(next)
      seenAt.current = row.updatedAt
      setDirty(false)
      setSave({ kind: 'saved', at: Date.now() })

      editsSinceSnapshot.current += 1
      if (editsSinceSnapshot.current >= AUTO_SNAPSHOT_EVERY) {
        editsSinceSnapshot.current = 0
        await snapshot(next, 'auto')
      }
    } catch (error) {
      setSave(isQuotaError(error) ? { kind: 'quota' } : { kind: 'error' })
    }
  }, [])

  const update = useCallback(
    (next: OfficialDoc) => {
      setDoc(next)
      setDirty(true)
      pending.current = next
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        const value = pending.current
        pending.current = null
        if (value) void write(value)
      }, SAVE_DEBOUNCE_MS)
    },
    [write],
  )

  const flush = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    const value = pending.current
    pending.current = null
    if (value) await write(value)
  }, [write])

  const saveVersion = useCallback(
    async (label: string) => {
      await flush()
      if (doc) {
        editsSinceSnapshot.current = 0
        await snapshot(doc, 'manual', label)
      }
    },
    [doc, flush],
  )

  const resolveConflict = useCallback(
    async (choice: 'mine' | 'theirs') => {
      if (save.kind !== 'conflict') return
      if (choice === 'theirs') {
        seenAt.current = save.theirs.updatedAt
        setDoc(save.theirs)
        setDirty(false)
        setSave({ kind: 'idle' })
        return
      }
      // "Keep mine" snapshots THEIRS first, so the other tab's work is
      // recoverable from the version list rather than gone. Overwriting
      // somebody's paragraphs with no way back is not a choice this editor
      // offers.
      await snapshot(save.theirs, 'auto', '')
      seenAt.current = save.theirs.updatedAt
      if (doc) await write(doc)
    },
    [save, doc, write],
  )

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  return {
    doc,
    status,
    ...(storedVersion !== undefined ? { storedVersion } : {}),
    save,
    dirty,
    update,
    flush,
    saveVersion,
    resolveConflict,
    reload: () => setNonce((value) => value + 1),
  }
}

const isQuotaError = (error: unknown): boolean =>
  error instanceof Error && (error.name === 'QuotaExceededError' || /quota/i.test(error.message))

export interface QuotaState {
  /** Null while unknown, or on a browser that does not implement the API. */
  ratio: number | null
  low: boolean
}

/**
 * How full the origin's storage is.
 *
 * `navigator.storage.estimate()` is absent on some browsers and throws on
 * others behind a privacy setting, so both are treated as "unknown" rather than
 * as "fine" — an absent measurement is not evidence of space, the same rule
 * `fitFor()` follows for `navigator.deviceMemory` (ADR-037).
 */
export function useStorageQuota(pollMs = 60_000): QuotaState {
  const [ratio, setRatio] = useState<number | null>(null)

  useEffect(() => {
    let alive = true
    const read = async () => {
      try {
        const estimate = await navigator.storage?.estimate?.()
        if (!alive || !estimate?.quota) return
        setRatio((estimate.usage ?? 0) / estimate.quota)
      } catch {
        // Unknown stays unknown.
      }
    }
    void read()
    const handle = setInterval(() => void read(), pollMs)
    return () => {
      alive = false
      clearInterval(handle)
    }
  }, [pollMs])

  return { ratio, low: ratio !== null && ratio >= QUOTA_WARN_RATIO }
}
