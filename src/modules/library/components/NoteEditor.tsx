import { Check, Loader2, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'
import { deleteNote, isStale, saveNote } from '@/lib/library'
import { cn } from '@/lib/utils'
import type { LibraryNoteRow } from '@/db'

/**
 * Writing a margin note: a textarea, a debounce and an honest indicator.
 *
 * AUTOSAVE IS 500 ms AND THE INDICATOR TELLS THE TRUTH. "Saved" is set from the
 * write RESOLVING, never from the debounce firing — the same rule the drafting
 * agent's checklist follows one layer up: report what happened, not what was
 * attempted. A write that fails says so, because the alternative is an officer
 * closing the tab on a note that was never stored.
 *
 * TWO TABS ON ONE UNIT is a real case — it is how an officer compares two rules
 * — and both autosave. Last write wins, which is the only resolution available
 * without a merge interface nobody asked for. What this does provide is
 * NOTICE: `isStale` compares the row in the database with the one this tab last
 * wrote, and when the other tab got there second the reader is told and offered
 * the stored version, rather than typing on for ten minutes against text that
 * is no longer there.
 */

const DEBOUNCE_MS = 500

interface NoteEditorProps {
  workId: string
  unitId: string
  /** The row being edited, or `null` for a new note. */
  note: LibraryNoteRow | null
  /** The row as it is in the database RIGHT NOW — how a second tab is noticed. */
  stored: LibraryNoteRow | undefined
  highlightId?: string
  part?: string
  /** The passage this note is about, for the heading. */
  quote?: string
  onClose: () => void
  /**
   * Take focus when this opens.
   *
   * Not called `autoFocus`: `jsx-a11y/no-autofocus` matches on the prop NAME
   * whatever element it lands on, and the rule is about focus stolen on page
   * load. This editor only ever appears because the reader pressed a button to
   * open it, and leaving focus behind on that button is the worse behaviour.
   */
  focusOnOpen?: boolean
}

export function NoteEditor({
  workId,
  unitId,
  note,
  stored,
  highlightId,
  part,
  quote,
  onClose,
  focusOnOpen,
}: NoteEditorProps) {
  const { t } = useT()
  const [body, setBody] = useState(note?.body ?? '')
  const [saved, setSaved] = useState<LibraryNoteRow | null>(note)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'failed'>(note ? 'saved' : 'idle')
  const areaRef = useRef<HTMLTextAreaElement>(null)

  /**
   * The row's id and body come from STATE, not from a ref.
   *
   * A ref read during render can tear, and `react-hooks/refs` refuses it — the
   * delete button's presence is a question about this render. Keeping them in
   * state also makes the debounce below correct without a dependency
   * suppression: `write` changes when the id does, the effect re-runs, and its
   * own guard stops the second write because by then the saved body IS the
   * typed body.
   */
  const savedId = saved?.id
  const savedBody = saved?.body ?? ''

  useEffect(() => {
    if (focusOnOpen) areaRef.current?.focus()
  }, [focusOnOpen])

  /**
   * Derived at read time, not synchronised in an effect.
   *
   * `react-hooks/set-state-in-effect` refuses the effect version and is right
   * to: a conflict is a fact about two values this render already has, and an
   * effect that copied it into state would paint one frame without it.
   */
  const conflicted = isStale(saved, stored) && stored?.body !== body

  const write = useCallback(
    async (value: string) => {
      setStatus('saving')
      try {
        const row = await saveNote({ id: savedId, workId, unitId, highlightId, part, body: value })
        setSaved(row)
        // "Saved" is set from the write RESOLVING, never from the debounce
        // firing. Reporting an intention as an outcome is how an officer closes
        // a tab on a note that was never stored.
        setStatus(row ? 'saved' : 'idle')
      } catch {
        setStatus('failed')
      }
    },
    [savedId, workId, unitId, highlightId, part],
  )

  useEffect(() => {
    if (body === savedBody) return
    const timer = setTimeout(() => void write(body), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [body, savedBody, write])

  const remove = async () => {
    if (savedId) await deleteNote(savedId)
    onClose()
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-muted-foreground">
          {quote
            ? t('library.note.onHighlight', { quote: quote.length > 48 ? `${quote.slice(0, 46)}…` : quote })
            : t('library.note.on')}
        </p>
        <p aria-live="polite" className="flex items-center gap-1 text-xs text-muted-foreground">
          {status === 'saving' ? (
            <>
              <Loader2 aria-hidden="true" className="h-3 w-3 animate-spin" />
              {t('library.note.saving')}
            </>
          ) : status === 'saved' ? (
            <>
              <Check aria-hidden="true" className="h-3 w-3 text-tulsi-foreground" />
              {t('library.note.saved')}
            </>
          ) : status === 'failed' ? (
            <span className="text-destructive">{t('library.highlight.failed')}</span>
          ) : (
            ''
          )}
        </p>
      </div>

      <label htmlFor={`library-note-${unitId}`} className="sr-only">
        {t('library.note.add')}
      </label>
      <textarea
        id={`library-note-${unitId}`}
        ref={areaRef}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        rows={4}
        placeholder={t('library.note.placeholder')}
        className={cn(
          'w-full resize-y rounded-md border border-input bg-background p-2 text-sm',
          'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        )}
      />

      {conflicted ? (
        <div
          role="alert"
          className="rounded-md border-l-[3px] border-marigold bg-marigold/15 px-3 py-2 text-xs text-marigold-foreground"
        >
          <p>{t('library.note.conflict')}</p>
          <button
            type="button"
            onClick={() => {
              setBody(stored?.body ?? '')
              setSaved(stored ?? null)
            }}
            className="mt-1 underline underline-offset-4"
          >
            {t('library.note.conflictReload')}
          </button>
        </div>
      ) : null}

      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">{t('library.note.help')}</summary>
        <p className="mt-1">{t('library.note.helpBody')}</p>
      </details>

      <div className="flex items-center justify-between gap-2">
        <Button variant="outline" size="sm" onClick={onClose}>
          {t('library.terms.close')}
        </Button>
        {savedId ? (
          <Button variant="outline" size="sm" onClick={() => void remove()}>
            <Trash2 aria-hidden="true" className="h-4 w-4" />
            {t('library.note.delete')}
          </Button>
        ) : null}
      </div>
    </div>
  )
}
