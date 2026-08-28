import { Copy, FileText, Pencil, Trash2, Undo2 } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { deleteDraft, duplicateDraft, listDrafts, renameDraft, restoreDraft } from '../drafts'

import { SectionCard } from '@/components/ui-x'
import { Button } from '@/components/ui/button'
import type { DraftRow } from '@/db'
import { useT } from '@/i18n/useT'

/**
 * The drafts on this device, newest first.
 *
 * `useLiveQuery` rather than a load-once effect, for the reason the Law
 * Converter's saved list gives: a delete, a rename or a duplicate must be
 * visible immediately, and the editor writes to this same table on every
 * keystroke — a list that only read once would go stale the moment an officer
 * came back from writing.
 *
 * ### Delete is undoable, and that is not a nicety
 *
 * A draft is work. Everywhere else in this app a destructive action is either
 * reversible or refused (the Pay module refuses an eleventh scenario rather
 * than evicting one), and deleting a document an officer spent an afternoon on
 * has no "refuse" available — so it gets the other treatment. `deleteDraft`
 * hands back the row it removed and that row IS the undo: restoring is the
 * same `put` as any other write, and nothing about the draft lives in a module
 * variable waiting to leak into the next screen.
 *
 * The offer stays until it is used or another one replaces it, deliberately
 * without a timeout. A five-second toast is a race between an officer noticing
 * and the app forgetting, and the app should not win that race.
 */

/** Below this the list is complete; above it, the rest are behind a control. */
const COLLAPSED = 5

export function RecentDrafts() {
  const { t, language } = useT()
  const [undoable, setUndoable] = useState<DraftRow | null>(null)
  const [message, setMessage] = useState('')
  const [expanded, setExpanded] = useState(false)

  // `undefined` while Dexie is answering, `[]` once it has and there is
  // nothing — the two must not render the same thing, or an empty state
  // flashes on every visit before the rows arrive.
  const drafts = useLiveQuery(
    () =>
      listDrafts().catch(() => {
        // Blocked storage (a private window, or site data denied). The picker
        // still works; only the list does not.
        return [] as DraftRow[]
      }),
    [],
    undefined,
  )

  if (drafts === undefined || drafts.length === 0) return null

  const shown = expanded ? drafts : drafts.slice(0, COLLAPSED)

  const remove = async (row: DraftRow) => {
    const deleted = await deleteDraft(row.id)
    if (!deleted) return
    setUndoable(deleted)
    setMessage(t('draft.recent.deleted', { title: title(deleted) }))
  }

  const undo = async () => {
    if (!undoable) return
    await restoreDraft(undoable)
    setMessage(t('draft.recent.restored', { title: title(undoable) }))
    setUndoable(null)
  }

  const rename = async (row: DraftRow) => {
    const next = window.prompt(t('draft.recent.renamePrompt'), title(row))
    if (next === null) return
    await renameDraft(row.id, next)
  }

  const duplicate = async (row: DraftRow) => {
    await duplicateDraft(row.id, t('draft.recent.copyOf', { title: title(row) }))
  }

  const title = (row: DraftRow) => row.title.trim() || t('draft.recent.untitled')

  return (
    <section aria-labelledby="draft-recent" className="flex flex-col gap-3">
      <h2 id="draft-recent" className="text-lg font-semibold">
        {t('draft.recent.title')}
      </h2>

      {/*
        One live region for the whole list. Announcing from inside a row would
        mean the announcement disappearing with the row that was deleted.
      */}
      <p aria-live="polite" className="sr-only">
        {message}
      </p>

      {undoable ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted px-3 py-2">
          <p className="text-sm text-muted-foreground">
            {t('draft.recent.deleted', { title: title(undoable) })}
          </p>
          <Button type="button" variant="outline" size="sm" onClick={() => void undo()}>
            <Undo2 aria-hidden="true" className="h-4 w-4" />
            {t('draft.recent.undo')}
          </Button>
        </div>
      ) : null}

      <SectionCard>
        <ul className="divide-y divide-border">
          {shown.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-2 p-3">
              <Link
                to={`/draft/${row.templateId}?d=${row.id}`}
                className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-md px-1 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <FileText aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{title(row)}</span>
                  <span className="block text-xs text-muted-foreground tabular-nums">
                    {new Date(row.updatedAt).toLocaleString(language === 'hi' ? 'hi-IN' : 'en-IN', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </span>
                </span>
              </Link>

              <span className="flex shrink-0 items-center gap-1">
                <IconButton
                  label={t('draft.recent.rename')}
                  subject={title(row)}
                  onClick={() => void rename(row)}
                >
                  <Pencil aria-hidden="true" className="h-4 w-4" />
                </IconButton>
                <IconButton
                  label={t('draft.recent.duplicate')}
                  subject={title(row)}
                  onClick={() => void duplicate(row)}
                >
                  <Copy aria-hidden="true" className="h-4 w-4" />
                </IconButton>
                <IconButton
                  label={t('draft.recent.delete')}
                  subject={title(row)}
                  onClick={() => void remove(row)}
                >
                  <Trash2 aria-hidden="true" className="h-4 w-4" />
                </IconButton>
              </span>
            </li>
          ))}
        </ul>
      </SectionCard>

      {drafts.length > COLLAPSED ? (
        <div>
          <Button type="button" variant="outline" size="sm" onClick={() => setExpanded(!expanded)}>
            {expanded ? t('draft.recent.showFewer') : t('draft.recent.showAll', { count: drafts.length })}
          </Button>
        </div>
      ) : null}
    </section>
  )
}

/**
 * A 44px icon target with a real accessible name.
 *
 * The accessible name names the DRAFT as well as the action, because a
 * screen-reader user tabbing a list of six drafts otherwise hears "Delete,
 * Delete, Delete" and has to count rows to know which one is in focus. The
 * tooltip stays short, since a sighted user can see which row it is on.
 */
function IconButton({
  label,
  subject,
  onClick,
  children,
}: {
  label: string
  subject: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${label} — ${subject}`}
      title={label}
      className="flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      {children}
    </button>
  )
}
