import { useLiveQuery } from 'dexie-react-hooks'
import { Download, FileText, Mail, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { createEntry, deleteEntry, listEntriesWithDropped, putEntry, updateEntry } from './registerStore'

import { PageHeader } from '@/components/common/PageHeader'
import { Badge, SectionCard } from '@/components/ui-x'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'
import { istDay } from '@/lib/istDay'
import {
  addDaysIso,
  duplicateNumbers,
  filterEntries,
  followUpState,
  newEntry,
  threadOf,
  toCsv,
  toJsonExport,
  type RegisterDirection,
  type RegisterEntry,
  type RegisterStatus,
} from '@/lib/drafting/register'

/**
 * The correspondence register.
 *
 * ### Everything here works with AI off, because there is no AI here at all
 *
 * The register is a list of facts the officer wrote down or the app recorded
 * when they issued a number. Nothing on this screen asks a model anything, and
 * that is not an omission — a register is exactly the kind of surface
 * `docs/AI.md` §13 says should be a deterministic function over the reader's
 * own rows. Every question it answers ("what is overdue", "what is in this
 * thread", "has this number been used") is arithmetic in
 * `src/lib/drafting/register.ts`.
 *
 * ### Today is computed once, at the top
 *
 * `followUpState` takes a date, so the whole screen shares one answer to "what
 * is today". Computing it per row would let a render that straddles midnight
 * show one entry overdue and the next one due — and the IST day is what this
 * app means by a day, the same boundary the Trainer's streak uses.
 */
const EMPTY: readonly RegisterEntry[] = []

export default function RegisterPage() {
  const { t, language } = useT()
  const [params, setParams] = useSearchParams()
  const listed = useLiveQuery(() => listEntriesWithDropped(), [])
  // A frozen constant rather than a literal: see `DraftHome`'s own note.
  const entries = listed?.entries ?? EMPTY
  const dropped = listed?.dropped ?? 0

  const today = istDay(new Date())
  const [query, setQuery] = useState('')
  const [direction, setDirection] = useState<RegisterDirection | 'all'>('all')
  const [status, setStatus] = useState<RegisterStatus | 'all'>('all')
  const [notice, setNotice] = useState('')
  const [undo, setUndo] = useState<RegisterEntry | null>(null)
  /*
    The entry being edited, which may be one that has never been WRITTEN.

    "Add an entry" used to call `createEntry` and then open the form on the row
    it had just filed — so Add followed by Cancel left a blank entry in the
    register, sorted by its creation instant to the top of the list. A register
    is a record of what happened, and an empty row is a record of the officer
    having pressed a button. `newEntry` is pure, so an unsaved entry is just a
    value; `saveEntry` below decides whether it is a create or an update.
  */
  const [editing, setEditing] = useState<RegisterEntry | null>(null)
  const [isNew, setIsNew] = useState(false)

  const threadId = params.get('thread') ?? ''

  const shown = useMemo(
    () =>
      filterEntries(entries, {
        query,
        direction,
        status,
        ...(threadId ? { threadId } : {}),
      }),
    [entries, query, direction, status, threadId],
  )

  const due = useMemo(
    () =>
      entries.filter((entry) => {
        const state = followUpState(entry, today)
        return state === 'due' || state === 'overdue'
      }),
    [entries, today],
  )

  const download = (name: string, body: string, type: string) => {
    const blob = new Blob([body], { type })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = name
    link.click()
    // Revoked on the next tick rather than immediately: a synchronous revoke
    // can beat the browser's own read of the blob in Firefox.
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <PageHeader as="h2" title={t('draft.register.heading')} subtitle={t('draft.register.lead')} />

      {dropped > 0 ? (
        <p className="rounded-lg border border-marigold/40 bg-marigold/15 p-3 text-sm text-marigold-foreground">
          {t('draft.register.dropped', { count: dropped })}
        </p>
      ) : null}

      {entries.length > 0 ? (
        <SectionCard className="p-4">
          <h2 className="text-sm font-semibold">{t('draft.register.dueList')}</h2>
          {/* Said out loud rather than left as an absent card: "nothing is due"
              and "the register has not loaded" look identical when the card is
              simply not drawn, and a follow-up list that quietly disappears is
              worse than a short one (the `useDueChaptersEverywhere` lesson). */}
          {due.length === 0 ? (
            <p className="mt-1 text-sm text-muted-foreground">{t('draft.register.dueNone')}</p>
          ) : null}
          <ul className="mt-2 flex flex-col gap-2">
            {due.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center gap-2 text-sm">
                <Badge tone={followUpState(entry, today) === 'overdue' ? 'danger' : 'warning'}>
                  {t(
                    followUpState(entry, today) === 'overdue'
                      ? 'draft.register.overdue'
                      : 'draft.register.due',
                  )}
                </Badge>
                <span className="min-w-0 flex-1 truncate">{entry.subject || entry.number || entry.id}</span>
                <span className="text-xs text-muted-foreground tabular-nums">{entry.followUpDate}</span>
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-48 flex-1 flex-col gap-1 text-sm">
          <span className="font-medium">{t('draft.register.search')}</span>
          <input
            data-module-search
            className="min-h-11 w-full rounded-[10px] border border-input bg-card px-3 text-sm"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t('draft.register.filterDirection')}</span>
          <select
            className="min-h-11 rounded-[10px] border border-input bg-card px-3 text-sm"
            value={direction}
            onChange={(event) => setDirection(event.target.value as RegisterDirection | 'all')}
          >
            <option value="all">{t('draft.register.all')}</option>
            <option value="received">{t('draft.register.received')}</option>
            <option value="sent">{t('draft.register.sent')}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t('draft.register.filterStatus')}</span>
          <select
            className="min-h-11 rounded-[10px] border border-input bg-card px-3 text-sm"
            value={status}
            onChange={(event) => setStatus(event.target.value as RegisterStatus | 'all')}
          >
            <option value="all">{t('draft.register.all')}</option>
            <option value="pending">{t('draft.register.statusPending')}</option>
            <option value="replied">{t('draft.register.statusReplied')}</option>
            <option value="closed">{t('draft.register.statusClosed')}</option>
          </select>
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={() => {
            const at = new Date().toISOString()
            setEditing(newEntry({ id: `reg-new-${at}`, direction: 'received', at }))
            setIsNew(true)
          }}
        >
          <Plus aria-hidden="true" className="mr-1 size-4" />
          {t('draft.register.add')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => download('correspondence-register.csv', toCsv(shown), 'text/csv;charset=utf-8')}
        >
          <Download aria-hidden="true" className="mr-1 size-4" />
          {t('draft.register.exportCsv')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            download(
              'correspondence-register.json',
              JSON.stringify(toJsonExport(shown, new Date().toISOString()), null, 2),
              'application/json',
            )
          }
        >
          <Download aria-hidden="true" className="mr-1 size-4" />
          {t('draft.register.exportJson')}
        </Button>
        {threadId ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              params.delete('thread')
              setParams(params, { replace: true })
            }}
          >
            {t('draft.register.all')}
          </Button>
        ) : null}
      </div>

      <p aria-live="polite" className="text-sm text-muted-foreground">
        {notice}
      </p>

      {undo ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/50 p-3 text-sm">
          <span>{t('draft.register.deleted')}</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              void putEntry(undo).then(() => {
                setUndo(null)
              })
            }
          >
            {t('draft.register.undo')}
          </Button>
        </div>
      ) : null}

      {editing ? (
        <EntryForm
          /*
            Keyed on the entry, so pressing Edit on a second row while the form
            is open rebuilds it from THAT row.

            Without it the form kept the first row's values — `useState(entry)`
            runs on mount — and Save wrote them to the second row's id. Nothing
            throws and nothing looks wrong; the officer's correction lands on a
            communication they were not looking at. CLAUDE.md records the same
            shape costing the Library a Feynman attempt saved against the wrong
            provision. A `key`, never an effect that resynchronises.
          */
          key={editing.id}
          entry={editing}
          entries={entries}
          isNew={isNew}
          onCancel={() => {
            setEditing(null)
            setIsNew(false)
          }}
          onSave={(patch) => {
            const at = new Date().toISOString()
            const write = isNew
              ? createEntry({ direction: 'received', at, patch })
              : updateEntry(editing.id, patch, at)
            void write.then(() => {
              setEditing(null)
              setIsNew(false)
              setNotice('')
            })
          }}
        />
      ) : null}

      {entries.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          {t('draft.register.empty')}
        </p>
      ) : shown.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          {t('draft.register.noMatches')}
        </p>
      ) : (
        /*
          A named region around the list.

          The filters above it are `<select>`s whose options carry the same
          words the rows do — "Received", "Sent", "Pending" — so a test, a
          screen-reader user tabbing back, and a "find on page" all meet the
          hidden option first. Naming the list is what tells the three of them
          apart, and it is what `tests/e2e/draft-reply.spec.ts` scopes to after
          matching an `<option value="received">` fourteen times.
        */
        <ul aria-label={t('draft.register.count', { count: shown.length })} className="flex flex-col gap-2">
          {shown.map((entry) => (
            <li key={entry.id}>
              <Row
                entry={entry}
                today={today}
                threadSize={threadOf(entries, entry.id).length}
                language={language}
                onEdit={() => setEditing(entry)}
                onOpenThread={() => {
                  params.set('thread', entry.threadId || entry.id)
                  setParams(params, { replace: false })
                }}
                onDelete={() =>
                  void deleteEntry(entry.id).then((deleted) => {
                    setUndo(deleted)
                    setNotice(t('draft.register.deleted'))
                  })
                }
              />
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-muted-foreground">{t('draft.register.reminderNote')}</p>
    </div>
  )
}

function Row({
  entry,
  today,
  threadSize,
  language,
  onEdit,
  onOpenThread,
  onDelete,
}: {
  entry: RegisterEntry
  today: string
  threadSize: number
  language: 'en' | 'hi'
  onEdit: () => void
  onOpenThread: () => void
  onDelete: () => void
}) {
  const { t } = useT()
  const state = followUpState(entry, today)

  return (
    <article className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border bg-card p-3">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2">
          <Badge tone={entry.direction === 'received' ? 'info' : 'success'}>
            {t(entry.direction === 'received' ? 'draft.register.received' : 'draft.register.sent')}
          </Badge>
          <span className="font-medium break-words">{entry.subject || t('draft.editor.untitled')}</span>
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {[entry.number, entry.date, entry.correspondent.name, entry.correspondent.organisation]
            .filter(Boolean)
            .join(' · ')}
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-xs">
          <Badge
            tone={entry.status === 'replied' ? 'success' : entry.status === 'closed' ? 'neutral' : 'warning'}
          >
            {t(
              `draft.register.status${entry.status === 'replied' ? 'Replied' : entry.status === 'closed' ? 'Closed' : 'Pending'}`,
            )}
          </Badge>
          {state !== 'none' ? (
            <Badge tone={state === 'overdue' ? 'danger' : state === 'due' ? 'warning' : 'neutral'}>
              {t(
                state === 'overdue'
                  ? 'draft.register.overdue'
                  : state === 'due'
                    ? 'draft.register.due'
                    : 'draft.register.upcoming',
              )}{' '}
              <span className="tabular-nums">{entry.followUpDate}</span>
            </Badge>
          ) : null}
          {threadSize > 1 ? (
            <button
              type="button"
              onClick={onOpenThread}
              aria-label={t('draft.register.openThread')}
              className="underline"
            >
              {t('draft.register.threadOf', { count: threadSize })}
            </button>
          ) : null}
        </p>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-1">
        {entry.docId ? (
          <Button asChild variant="ghost" size="sm" aria-label={t('draft.register.openDocument')}>
            <Link to={`/draft/d/${entry.docId}`}>
              <FileText aria-hidden="true" className="size-4" />
            </Link>
          </Button>
        ) : null}
        {entry.intakeId ? (
          <Button asChild variant="ghost" size="sm" aria-label={t('draft.register.openLetter')}>
            <Link to={`/draft/reply/${entry.intakeId}`}>
              <Mail aria-hidden="true" className="size-4" />
            </Link>
          </Button>
        ) : null}
        <Button variant="outline" size="sm" onClick={onEdit}>
          {t('draft.register.edit')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`${t('draft.register.delete')}: ${entry.subject || entry.id}`}
          onClick={onDelete}
        >
          <Trash2 aria-hidden="true" className="size-4" />
        </Button>
      </div>
      <span className="sr-only">{language}</span>
    </article>
  )
}

/**
 * The edit form.
 *
 * The duplicate-number check runs as the officer types, over the register they
 * already have, and it is a WARNING rather than a bar — the same posture
 * `validatePattern`'s `no-seq` case takes, and for the same reason: an office's
 * numbering is the office's, and this app is not the authority on it.
 */
function EntryForm({
  entry,
  entries,
  isNew,
  onCancel,
  onSave,
}: {
  entry: RegisterEntry
  entries: readonly RegisterEntry[]
  /** True for an entry that has never been written; changes the heading only. */
  isNew: boolean
  onCancel: () => void
  onSave: (patch: Partial<RegisterEntry>) => void
}) {
  const { t } = useT()
  const [draft, setDraft] = useState<RegisterEntry>(entry)
  const duplicates = duplicateNumbers(entries, draft.number, draft.id)

  const set = <K extends keyof RegisterEntry>(key: K, value: RegisterEntry[K]) =>
    setDraft((current) => ({ ...current, [key]: value }))

  const field = (label: string, node: React.ReactNode) => (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      {node}
    </label>
  )
  const input = 'min-h-11 w-full rounded-[10px] border border-input bg-card px-3 text-sm'

  return (
    <SectionCard className="flex flex-col gap-3 p-4">
      <h2 className="text-sm font-semibold">{t(isNew ? 'draft.register.add' : 'draft.register.edit')}</h2>

      <div className="grid gap-3 sm:grid-cols-2">
        {field(
          t('draft.register.number'),
          <input
            className={input}
            value={draft.number}
            onChange={(event) => set('number', event.target.value)}
          />,
        )}
        {field(
          t('draft.register.date'),
          <input
            type="date"
            className={input}
            value={draft.date}
            onChange={(event) => set('date', event.target.value)}
          />,
        )}
        {field(
          t('draft.register.receivedOn'),
          <input
            type="date"
            className={input}
            value={draft.receivedOn}
            onChange={(event) => set('receivedOn', event.target.value)}
          />,
        )}
        {field(
          t('draft.register.correspondentName'),
          <input
            className={input}
            value={draft.correspondent.name}
            onChange={(event) => set('correspondent', { ...draft.correspondent, name: event.target.value })}
          />,
        )}
        {field(
          t('draft.register.correspondentOrg'),
          <input
            className={input}
            value={draft.correspondent.organisation}
            onChange={(event) =>
              set('correspondent', { ...draft.correspondent, organisation: event.target.value })
            }
          />,
        )}
        {isNew
          ? field(
              t('draft.register.filterDirection'),
              <select
                className={input}
                value={draft.direction}
                onChange={(event) => set('direction', event.target.value as RegisterEntry['direction'])}
              >
                <option value="received">{t('draft.register.received')}</option>
                <option value="sent">{t('draft.register.sent')}</option>
              </select>,
            )
          : null}
        {field(
          t('draft.register.status'),
          <select
            className={input}
            value={draft.status}
            onChange={(event) => set('status', event.target.value as RegisterStatus)}
          >
            <option value="pending">{t('draft.register.statusPending')}</option>
            <option value="replied">{t('draft.register.statusReplied')}</option>
            <option value="closed">{t('draft.register.statusClosed')}</option>
          </select>,
        )}
        {field(
          t('draft.register.followUp'),
          <input
            type="date"
            className={input}
            value={draft.followUpDate}
            onChange={(event) => set('followUpDate', event.target.value)}
          />,
        )}
        {field(
          t('draft.register.inReplyTo'),
          <select
            className={input}
            value={draft.inReplyTo ?? ''}
            onChange={(event) => set('inReplyTo', event.target.value || null)}
          >
            <option value="">{t('draft.register.inReplyToNone')}</option>
            {entries
              .filter((each) => each.id !== draft.id)
              .map((each) => (
                <option key={each.id} value={each.id}>
                  {[each.number, each.subject].filter(Boolean).join(' — ') || each.id}
                </option>
              ))}
          </select>,
        )}
      </div>

      {field(
        t('draft.register.subject'),
        <input
          className={input}
          value={draft.subject}
          onChange={(event) => set('subject', event.target.value)}
        />,
      )}
      {field(
        t('draft.register.notes'),
        <textarea
          rows={3}
          className="w-full rounded-[10px] border border-input bg-card p-3 text-sm"
          value={draft.notes}
          onChange={(event) => set('notes', event.target.value)}
        />,
      )}

      {duplicates.length > 0 ? (
        <p
          role="status"
          className="rounded-md border border-marigold/40 bg-marigold/15 p-2 text-sm text-marigold-foreground"
        >
          {t('draft.register.duplicateWarning', { count: duplicates.length })}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={() =>
            onSave({
              ...(isNew ? { direction: draft.direction } : {}),
              number: draft.number,
              date: draft.date,
              receivedOn: draft.receivedOn,
              subject: draft.subject,
              status: draft.status,
              followUpDate: draft.followUpDate,
              notes: draft.notes,
              correspondent: draft.correspondent,
              inReplyTo: draft.inReplyTo,
            })
          }
        >
          {t('draft.register.save')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            set('followUpDate', addDaysIso(draft.followUpDate || new Date().toISOString().slice(0, 10), 15))
          }
        >
          {t('draft.register.followUpIn', { days: 15 })}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {t('draft.register.cancel')}
        </Button>
      </div>
    </SectionCard>
  )
}
