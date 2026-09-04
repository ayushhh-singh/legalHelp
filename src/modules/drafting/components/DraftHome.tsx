import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowRight, Copy, FileText, Mail, Pencil, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import {
  deleteDocument,
  duplicateDocument,
  getDocument,
  listDocuments,
  putDocument,
  restoreDocument,
} from '../documents'
import { listEntries } from '../register/registerStore'
import { BatchExportBar } from '../batch/BatchExportBar'

import { Badge, SectionCard } from '@/components/ui-x'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'
import { istDay } from '@/lib/istDay'
import { dueFollowUps, followUpState, type RegisterEntry } from '@/lib/drafting/register'
import { DOC_STATUSES, type DocStatus } from '@/lib/drafting/model'
import { textOf } from '@/lib/drafting/proposal'
import type { DocumentRow } from '@/db'

/**
 * The draft library: continue editing, what is waiting for a reply, and search
 * across everything on the device.
 *
 * It IS the `/draft/documents` tab (ADR-046); it used to sit at the top of the
 * picker, above the forty-three template cards, because
 * that is the order an officer actually works in — most visits to this screen
 * are to carry on with something, and only some are to start a new form. The
 * template grid is still on the same screen and still the second thing on it,
 * which is why `tests/e2e/draft.spec.ts`'s assertions about the picker still
 * hold.
 *
 * ### Search reads the body, and that costs a parse
 *
 * "Search across drafts (subject, number, body)" means reading `doc` out of
 * every row and walking it, which is why it is done lazily — only once
 * something has been typed. A register of sixty documents is nothing; the guard
 * is there so that opening this screen never parses sixty documents to draw a
 * list that shows five.
 */

const EMPTY_DOCS: readonly DocumentRow[] = []
const EMPTY_ENTRIES: readonly RegisterEntry[] = []

export function DraftHome() {
  const { t, language } = useT()
  /*
    `?? EMPTY` and not `?? []`: a fresh array literal on every render is a new
    reference, which defeats every `useMemo` below it — the search would re-walk
    every document body on each keystroke ANYWHERE in the tree. One frozen
    constant is what makes "still loading" and "loaded and empty" the same
    stable value.
  */
  const documents = useLiveQuery(() => listDocuments(200), []) ?? EMPTY_DOCS
  const entries = useLiveQuery(() => listEntries(), []) ?? EMPTY_ENTRIES
  const today = istDay(new Date())

  const [query, setQuery] = useState('')
  const [type, setType] = useState('')
  const [status, setStatus] = useState<DocStatus | ''>('')
  const [tag, setTag] = useState('')
  const [thread, setThread] = useState('')
  const [notice, setNotice] = useState('')
  const [undo, setUndo] = useState<Awaited<ReturnType<typeof deleteDocument>>>(null)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())

  const due = useMemo(() => dueFollowUps(entries, today), [entries, today])

  /*
    The body is searched only when a query has been typed, and the parse is
    memoised on the query and the row list rather than done per keystroke over
    every document.
  */
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return documents.filter((row) => {
      if (type && row.templateId !== type) return false
      if (status && row.status !== status) return false
      if (tag && !tagsOf(row).includes(tag)) return false
      if (thread && (row.threadId ?? '') !== thread) return false
      if (!needle) return true
      if (row.title.toLowerCase().includes(needle)) return true
      return bodyText(row).toLowerCase().includes(needle)
    })
  }, [documents, query, type, status, tag, thread])

  const types = useMemo(() => [...new Set(documents.map((row) => row.templateId))].sort(), [documents])
  const tags = useMemo(() => [...new Set(documents.flatMap(tagsOf))].sort(), [documents])
  /*
    Only threads with more than one document in them are offered: a thread of
    one is every document that answers a letter, and a filter whose every option
    selects a single row is a filter nobody uses.
  */
  const threads = useMemo(() => {
    const counted = new Map<string, number>()
    for (const row of documents) {
      if (!row.threadId) continue
      counted.set(row.threadId, (counted.get(row.threadId) ?? 0) + 1)
    }
    return [...counted.entries()]
      .filter(([, count]) => count > 1)
      .map(([id]) => id)
      .sort()
  }, [documents])

  const chosen = matches.filter((row) => selected.has(row.id)).map((row) => row.id)
  const continueWith = documents[0]

  const rename = async (row: DocumentRow) => {
    const title = window.prompt(t('draft.home.renamePrompt'), row.title)
    if (title === null) return
    const read = await getDocument(row.id)
    if (!read.ok) return
    await putDocument({ ...read.doc, title, updatedAt: new Date().toISOString() })
  }

  return (
    <div className="flex flex-col gap-5">
      <SectionCard className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="min-w-0">
          <p className="font-semibold">{t('draft.home.reply')}</p>
          <p className="text-sm text-muted-foreground">{t('draft.home.replyHint')}</p>
        </div>
        <Button asChild size="sm">
          <Link to="/draft/reply">
            <Mail aria-hidden="true" className="mr-1 size-4" />
            {t('draft.home.reply')}
          </Link>
        </Button>
      </SectionCard>

      <nav aria-label={t('draft.home.heading')} className="flex flex-wrap gap-2">
        <Button asChild variant="outline" size="sm">
          <Link to="/draft/register">{t('draft.home.register')}</Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link to="/draft/documents">{t('draft.editor.documents')}</Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link to="/draft/templates">{t('draft.personal.heading')}</Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link to="/settings/profile">{t('draft.profile.heading')}</Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link to="/settings/address-book">{t('draft.addressBook.heading')}</Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link to="/settings/numbering">{t('draft.numbering.heading')}</Link>
        </Button>
      </nav>

      {continueWith ? (
        <SectionCard className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">{t('draft.home.continueHint')}</p>
            <p className="truncate font-semibold">{continueWith.title || t('draft.editor.untitled')}</p>
          </div>
          <Button asChild size="sm">
            <Link to={`/draft/d/${continueWith.id}`}>
              {t('draft.home.continue')}
              <ArrowRight aria-hidden="true" className="ml-1 size-4" />
            </Link>
          </Button>
        </SectionCard>
      ) : null}

      <section aria-labelledby="draft-followups" className="flex flex-col gap-2">
        <h2 id="draft-followups" className="text-sm font-semibold">
          {t('draft.home.followUps')}
        </h2>
        {due.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('draft.home.followUpsNone')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {due.map((entry) => (
              <li
                key={entry.id}
                className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3 text-sm"
              >
                <Badge tone={followUpState(entry, today) === 'overdue' ? 'danger' : 'warning'}>
                  {t(
                    followUpState(entry, today) === 'overdue' ? 'draft.home.overdue' : 'draft.home.dueToday',
                  )}
                </Badge>
                <span className="min-w-0 flex-1 truncate">{entry.subject || entry.number || entry.id}</span>
                <Link to="/draft/register" className="text-primary underline">
                  {t('draft.home.register')}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="draft-search" className="flex flex-col gap-3">
        <h2 id="draft-search" className="text-sm font-semibold">
          {t('draft.home.recent')}
        </h2>

        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-48 flex-1 flex-col gap-1 text-sm">
            <span className="font-medium">{t('draft.home.search')}</span>
            <input
              className="min-h-11 w-full rounded-[10px] border border-input bg-card px-3 text-sm"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-describedby="draft-search-hint"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">{t('draft.home.filterType')}</span>
            <select
              className="min-h-11 rounded-[10px] border border-input bg-card px-3 text-sm"
              value={type}
              onChange={(event) => setType(event.target.value)}
            >
              <option value="">{t('draft.home.allTypes')}</option>
              {types.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">{t('draft.home.filterStatus')}</span>
            <select
              className="min-h-11 rounded-[10px] border border-input bg-card px-3 text-sm"
              value={status}
              onChange={(event) => setStatus(event.target.value as DocStatus | '')}
            >
              <option value="">{t('draft.home.allStatuses')}</option>
              {DOC_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {t(`draft.editor.status.${value}`)}
                </option>
              ))}
            </select>
          </label>
          {/* Both of these are hidden when there is nothing to filter BY: a
              select whose only option is "any tag" is a control that cannot do
              anything, which is the failure ADR-041's addendum spent a session
              finding seven of. */}
          {tags.length > 0 ? (
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{t('draft.home.filterTag')}</span>
              <select
                className="min-h-11 rounded-[10px] border border-input bg-card px-3 text-sm"
                value={tag}
                onChange={(event) => setTag(event.target.value)}
              >
                <option value="">{t('draft.home.allTags')}</option>
                {tags.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {threads.length > 0 ? (
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{t('draft.home.filterThread')}</span>
              <select
                className="min-h-11 rounded-[10px] border border-input bg-card px-3 text-sm"
                value={thread}
                onChange={(event) => setThread(event.target.value)}
              >
                <option value="">{t('draft.home.allTypes')}</option>
                {threads.map((value) => (
                  <option key={value} value={value}>
                    {documents.find((row) => row.threadId === value)?.title || t('draft.editor.untitled')}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
        <p id="draft-search-hint" className="text-xs text-muted-foreground">
          {t('draft.home.searchHint')}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <p aria-live="polite" className="text-sm text-muted-foreground">
            {notice || t('draft.home.results', { count: matches.length })}
          </p>
          {/*
            "Select all" moved here with ADR-046: it was on the old
            `DocumentsPage` list, and this IS that list now. It selects what is
            SHOWN rather than everything on the device — a filter the officer
            has just set is a statement about which documents they mean.
          */}
          {matches.length > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setSelected((current) =>
                  current.size === matches.length ? new Set() : new Set(matches.map((row) => row.id)),
                )
              }
            >
              {t('draft.batch.selectAll')}
            </Button>
          ) : null}
        </div>

        {chosen.length > 0 ? <BatchExportBar ids={chosen} onClear={() => setSelected(new Set())} /> : null}

        {undo ? (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/50 p-3 text-sm">
            <span>{t('draft.editor.deleted', { title: undo.row.title || t('draft.editor.untitled') })}</span>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                void restoreDocument(undo).then(() => {
                  setUndo(null)
                  setNotice('')
                })
              }
            >
              {t('draft.editor.undo')}
            </Button>
          </div>
        ) : null}

        {documents.length === 0 ? null : matches.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            {t('draft.home.noMatches')}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {matches.slice(0, 25).map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-3"
              >
                <input
                  type="checkbox"
                  className="size-4 shrink-0"
                  checked={selected.has(row.id)}
                  aria-label={`${t('draft.batch.select')}: ${row.title || t('draft.editor.untitled')}`}
                  onChange={() =>
                    setSelected((current) => {
                      const next = new Set(current)
                      if (!next.delete(row.id)) next.add(row.id)
                      return next
                    })
                  }
                />
                <Link
                  to={`/draft/d/${row.id}`}
                  className="flex min-w-0 flex-1 items-center gap-2 text-sm hover:underline"
                >
                  <FileText aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">
                      {row.title || t('draft.editor.untitled')}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {new Date(row.updatedAt).toLocaleString(language === 'hi' ? 'hi-IN' : 'en-IN')}
                    </span>
                  </span>
                </Link>
                <span className="flex shrink-0 items-center gap-1">
                  <Badge
                    tone={row.status === 'sent' ? 'success' : row.status === 'final' ? 'info' : 'neutral'}
                  >
                    {t(
                      `draft.editor.status.${row.status === 'sent' ? 'sent' : row.status === 'final' ? 'final' : 'draft'}`,
                    )}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`${t('draft.home.rename')}: ${row.title || row.id}`}
                    onClick={() => void rename(row)}
                  >
                    <Pencil aria-hidden="true" className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`${t('draft.editor.duplicate')}: ${row.title || row.id}`}
                    onClick={() =>
                      void duplicateDocument(row.id, `${row.title || t('draft.editor.untitled')} (2)`)
                    }
                  >
                    <Copy aria-hidden="true" className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`${t('draft.editor.delete')}: ${row.title || row.id}`}
                    onClick={() =>
                      void deleteDocument(row.id).then((bundle) => {
                        setUndo(bundle)
                        setNotice('')
                      })
                    }
                  >
                    <Trash2 aria-hidden="true" className="size-4" />
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

/** A stored row's tags, from the document it holds. Untyped, so it is guarded. */
function tagsOf(row: DocumentRow): string[] {
  const doc = row.doc
  if (!doc || typeof doc !== 'object') return []
  const tags = (doc as { tags?: unknown }).tags
  return Array.isArray(tags) ? tags.filter((tag): tag is string => typeof tag === 'string') : []
}

/**
 * A document's body as one searchable string.
 *
 * `textOf` walks a node and joins every run of text in it, which is what
 * `proposal.ts` already does to match blocks — reusing it means "what the
 * search sees" and "what a diff compares" are the same reading of a document.
 * A row this build cannot parse contributes its title alone rather than
 * throwing: a search that dies on one bad row finds nothing at all.
 */
function bodyText(row: DocumentRow): string {
  const doc = row.doc
  if (!doc || typeof doc !== 'object') return row.title
  const body = (doc as { body?: unknown }).body
  if (!body || typeof body !== 'object') return row.title
  const content = (body as { content?: unknown }).content
  if (!Array.isArray(content)) return row.title
  try {
    return content.map((node) => textOf(node as Parameters<typeof textOf>[0])).join('\n')
  } catch {
    return row.title
  }
}
