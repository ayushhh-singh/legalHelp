import { useCallback, useEffect, useRef, useState } from 'react'

import { draftId as newDraftId, getDraft, putDraft, readDefaults } from './drafts'
import { blankValues, draftTitle } from './values'

import type { DocTemplate } from './schema'
import type { DraftValues, Lang } from '@/lib/drafting/types'

/**
 * One draft's contents, loaded from IndexedDB and saved back as it is typed.
 *
 * ### The load
 *
 * Three ways in, and they are checked in this order:
 *
 *  1. `?d=<id>` in the URL — resume that row. This is what a reload restores
 *     from and what the "Resume" link in the recent list uses.
 *  2. No id, but the officer has saved defaults for this form — start from
 *     their letterhead (`draftDefaults`).
 *  3. Neither — start blank.
 *
 * A blank start is deliberately blank and NOT the template's worked example.
 * The engine used to fall back to `field.sample` per field, which meant a form
 * with one field edited produced a complete document signed by the specimen's
 * "(A.B.C.), Under Secretary" with the specimen's telephone number, reporting
 * no issue at all. That fallback is gone; the example is now something an
 * officer asks for by pressing "Fill with the worked example", which calls
 * `sampleValues(template)`.
 *
 * ### The save
 *
 * Debounced, because the alternative is an IndexedDB write per keystroke, and
 * a draft with three hundred words of body text is a write of the whole
 * document each time. 600ms is long enough to coalesce typing and short enough
 * that a reader who types a sentence and closes the tab keeps the sentence.
 *
 * The row is created on the FIRST change, not on arrival: opening a form and
 * walking away must not leave an empty draft in the recent list. When it is
 * created its id goes into the URL with `replace`, so a reload resumes it and
 * the back button is not filled with one entry per keystroke.
 *
 * A failed write is surfaced rather than swallowed. Everywhere else in this app
 * blocked storage costs a convenience — a remembered theme, a recent lookup —
 * and is ignored on purpose. Here it costs the officer's work, so `saveState`
 * goes to `error` and the editor says so.
 */

export type SaveState = 'idle' | 'saving' | 'saved' | 'error'

const DEBOUNCE_MS = 600

export interface DraftHandle {
  /** Null until the row (or the blank form) is ready — the editor shows a skeleton. */
  values: DraftValues | null
  setValues: (next: DraftValues) => void
  /** Replaces everything and saves at once, for "fill with the example". */
  replaceValues: (next: DraftValues) => void
  saveState: SaveState
  /** True once defaults were applied, so the editor can say so. */
  appliedDefaults: boolean
}

export function useDraft({
  template,
  draftId,
  lang,
  onCreated,
}: {
  template: DocTemplate | null
  draftId: string | null
  lang: Lang
  /** Called once, with the id of a row this hook has just created. */
  onCreated: (id: string) => void
}): DraftHandle {
  const [values, setStateValues] = useState<DraftValues | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [appliedDefaults, setAppliedDefaults] = useState(false)

  /** The row being written to. Held in a ref so the debounce closure sees it. */
  const rowId = useRef<string | null>(draftId)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Edits typed but not yet written, so leaving the page can flush them. */
  const pending = useRef<DraftValues | null>(null)
  /**
   * The row THIS hook created, as opposed to one it was asked to resume.
   *
   * Only a row in the first category may be skipped when it reappears as
   * `?d=` — see the effect below. `rowId` cannot answer that question: it is
   * seeded from the `draftId` prop, so on a resumed draft it already equals it
   * before anything has been read.
   */
  const createdHere = useRef<string | null>(null)
  /** Always the CURRENT save, for a cleanup that must not close over render 1. */
  const latestSave = useRef<(values: DraftValues) => void>(() => undefined)
  /**
   * False once the editor has gone.
   *
   * The flush below finishes writing AFTER the officer has navigated away, and
   * the write's completion is what puts the new draft's id in the URL. Doing
   * that from an editor that is no longer on screen navigates the reader
   * BACK to it — press "All forms", watch the list appear, and get thrown into
   * the editor half a second later. The row is written either way; only the
   * URL update is skipped.
   */
  const alive = useRef(true)
  /** What has been loaded, so a re-render cannot re-load over live typing. */
  const loadedFor = useRef<string | null>(null)

  const templateId = template?.id ?? null

  useEffect(() => {
    if (!template || !templateId) return

    const key = `${templateId}:${draftId ?? 'new'}`

    /*
      Our own `?d=` write coming back is not a reason to reload.

      The first save creates the row and puts its id in the URL, which changes
      `draftId` from null to that id and re-runs this effect. Re-reading the row
      we just wrote would clobber anything typed since with a snapshot of the
      document one debounce older. A draft the reader asked to RESUME is a
      different case and must still be read, which is why this asks
      `createdHere` and not `rowId`.
    */
    if (draftId !== null && draftId === createdHere.current) {
      loadedFor.current = key
      return
    }

    if (loadedFor.current === key) return
    loadedFor.current = key
    rowId.current = draftId

    let cancelled = false

    const start = async (): Promise<DraftValues> => {
      if (draftId) {
        const row = await getDraft(draftId)
        // A row whose templateId does not match the route is a hand-edited
        // URL, not a draft of this form. Starting blank beats rendering one
        // form's values through another form's layout.
        if (row && row.templateId === templateId) return row.values as DraftValues
      }
      const defaults = await readDefaults(templateId)
      if (defaults) {
        if (!cancelled) setAppliedDefaults(true)
        return { ...blankValues(template), ...defaults }
      }
      return blankValues(template)
    }

    void start()
      .then((loaded) => {
        if (!cancelled) setStateValues(loaded)
      })
      .catch(() => {
        // Blocked storage. An empty form is still a usable form.
        if (!cancelled) setStateValues(blankValues(template))
      })

    return () => {
      cancelled = true
      /*
        A CANCELLED attempt must not leave the guard armed.

        `src/main.tsx` renders under `<StrictMode>`, which in development mounts
        an effect, cleans it up, and mounts it again. The first mount armed
        `loadedFor` and started the read; the cleanup set `cancelled`, so its
        result was thrown away; and the second mount then found the guard
        already set for its own key and returned without loading anything. The
        form sat on its three skeletons forever, with no field to type into and
        a checklist that could never pass.

        It never appeared in `pnpm test:e2e` because StrictMode double-invokes
        in development only, and Playwright runs against a production build.
      */
      if (loadedFor.current === key) loadedFor.current = null
    }
  }, [template, templateId, draftId])

  const save = useCallback(
    (next: DraftValues) => {
      if (!template) return
      pending.current = null
      setSaveState('saving')
      const id = rowId.current ?? newDraftId()
      const created = rowId.current === null
      rowId.current = id
      if (created) createdHere.current = id

      void putDraft({
        id,
        templateId: template.id,
        title: draftTitle(template, next, lang),
        values: next,
      })
        .then(() => {
          setSaveState('saved')
          // Only after the row exists: putting the id in the URL first would
          // mean a reload landing on `?d=` for a row that was never written.
          // And only while the editor is still on screen — see `alive`.
          if (created && alive.current) onCreated(id)
        })
        .catch(() => {
          setSaveState('error')
        })
    },
    [template, lang, onCreated],
  )

  /*
    The ref is written in an effect, not during render: React's own lint rule
    rejects the latter, and rightly — a ref assigned while rendering is a value
    a concurrent re-render can tear.
  */
  useEffect(() => {
    latestSave.current = save
  }, [save])

  /**
   * Write anything still in the debounce window when the editor goes away.
   *
   * Cancelling the timer without writing — which is what this did first — loses
   * every character typed in the 600ms before an officer pressed "All forms".
   * A small window, and the most annoying possible bug: the draft in the recent
   * list is a sentence behind the one that was on screen.
   *
   * The effect has no dependencies, so its cleanup would otherwise close over
   * the FIRST render's `save`. `latestSave` is what makes it call the current
   * one, with the current template and the current language.
   */
  useEffect(() => {
    /*
      Re-armed on every mount, not just assumed true from the initial ref.

      StrictMode mounts, cleans up, and mounts again in development. The cleanup
      sets `alive` to false, and without this line nothing ever set it back — so
      `onCreated` never fired, the new draft's id never reached the URL, and a
      reload in `pnpm dev` opened an empty form instead of the draft that was
      just written.
    */
    alive.current = true
    return () => {
      alive.current = false
      if (timer.current) clearTimeout(timer.current)
      if (pending.current) latestSave.current(pending.current)
    }
  }, [])

  const setValues = useCallback(
    (next: DraftValues) => {
      setStateValues(next)
      pending.current = next
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => save(next), DEBOUNCE_MS)
    },
    [save],
  )

  const replaceValues = useCallback(
    (next: DraftValues) => {
      setStateValues(next)
      if (timer.current) clearTimeout(timer.current)
      save(next)
    },
    [save],
  )

  return { values, setValues, replaceValues, saveState, appliedDefaults }
}
