import { AlertTriangle, Columns2, Download, Pencil } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { NoteBody } from '../components/NoteBody'
import { toUnitHref } from '../url'
import { useLibraryIndex } from '../useLibrary'
import { usePersonalWorks, useStudyContext, useStudyRows } from '../useAnnotations'

import { EmptyState } from '@/components/common/EmptyState'
import { PageHeader } from '@/components/common/PageHeader'
import { allAttempts } from '@/lib/study'
import { Badge, SectionCard, SectionNumber, Skeleton } from '@/components/ui-x'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'
import {
  colourOf,
  HIGHLIGHT_COLOURS,
  setBookmarkLabel,
  noteToPlainText,
  toMarkdown,
  type ExportableAnnotation,
  type HighlightColour,
} from '@/lib/library'
import { cn } from '@/lib/utils'

/**
 * `/study/notes` — everything the reader has written, in one place.
 *
 * Three things it must do that a plain list would not:
 *
 * 1. **Show a highlight whose anchor was lost.** A dataset refresh can move the
 *    text out from under a mark; `resolveAnchor` reports that as `lost` and the
 *    quote survives on the row. Those are listed FIRST, under "needs
 *    attention", because they are the only entries the reader can do anything
 *    about. Never dropped: an officer's own mark is not this app's to expire.
 * 2. **Export with citations.** The Markdown carries each entry's citation and
 *    an absolute link back, because the file leaves this app and "Rule 11"
 *    means nothing a month later without them.
 * 3. **Load no corpus.** Every row already carries its quote and its work id.
 *    Resolving each one against 5.5 MB of statute to draw a list would make
 *    the screen unusable on the device it is for.
 */

type Kind = 'highlight' | 'note' | 'bookmark' | 'feynman'

/** The kinds a `?type=` in the URL may name — anything else is ignored. */
const KINDS: readonly Kind[] = ['highlight', 'note', 'bookmark', 'feynman']

interface Entry {
  id: string
  kind: Kind
  workId: string
  unitId: string
  createdAt: string
  colour: HighlightColour | null
  /** The quoted passage, the note body, or the bookmark label. */
  text: string
  /** True only for a highlight whose text could not be found again. */
  lost: boolean
}

const DAY_MS = 86_400_000

export default function MyStudyPage() {
  const { t, language } = useT()
  const rows = useStudyRows()
  const index = useLibraryIndex()
  const personal = usePersonalWorks()
  /**
   * Which highlights can no longer be found in the text they marked.
   *
   * The one thing on this screen a reader can act on, and it needs the corpus —
   * which this screen otherwise deliberately does not load. `useHighlightHealth`
   * loads only the works the reader has actually annotated. Until it settles
   * the screen says nothing rather than "none", which are different answers.
   */
  const health = useStudyContext(rows, language)

  /*
    The reader's own-words attempts, the fourth kind.

    Read here rather than through `useStudyRows` because that hook is the
    Library's three annotation tables and this one belongs to the study layer —
    a screen that shows all four is not a reason to make one hook know about
    both. `allAttempts` is a plain Dexie read of a small table.
  */
  const attempts = useLiveQuery(() => allAttempts(), [], undefined)

  const [params, setParams] = useSearchParams()
  const work = params.get('work') ?? ''
  const colour = params.get('colour') ?? ''
  const requested = params.get('type') ?? ''
  const kind: '' | Kind = (KINDS as readonly string[]).includes(requested) ? (requested as Kind) : ''

  /*
    The three filters that identify WHAT is being looked at live in the URL, so
    "my bookmarks" is a link somebody can keep — which is what the redirect from
    `/library/bookmarks` relies on. The date window and the search box do not:
    they are how a reader narrows a list they are already looking at, and a
    history entry per keystroke is what `replace` exists to avoid.
  */
  const setFilter = (name: 'work' | 'colour' | 'type', value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(name, value)
    else next.delete(name)
    setParams(next, { replace: true })
  }
  const [within, setWithin] = useState('')
  const [query, setQuery] = useState('')
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set())
  const [notice, setNotice] = useState<string | null>(null)
  /**
   * "Now" is read once, at mount, not inside the filter.
   *
   * `react-hooks/purity` refuses `Date.now()` in a `useMemo` and is right to:
   * a memo whose result depends on the clock is a memo that is wrong as soon
   * as it is cached. A filter reading "last 7 days" does not need to advance
   * while the screen is open, and this is one screen visit.
   */
  const [openedAt] = useState(() => Date.now())

  const names = useMemo(() => {
    const map = new Map<string, string>()
    for (const entry of index.data?.works ?? []) map.set(entry.id, entry.shortTitle[language])
    for (const entry of personal ?? []) map.set(entry.id, entry.title)
    return map
  }, [index.data, personal, language])

  const entries = useMemo((): Entry[] => {
    if (!rows) return []
    return [
      ...rows.highlights.map((row) => ({
        id: row.id,
        kind: 'highlight' as const,
        workId: row.workId,
        unitId: row.unitId,
        createdAt: row.createdAt,
        colour: colourOf(row),
        text: row.quote,
        lost: health.lost.has(row.id),
      })),
      ...rows.notes.map((row) => ({
        id: row.id,
        kind: 'note' as const,
        workId: row.workId,
        unitId: row.unitId,
        createdAt: row.updatedAt,
        colour: null,
        text: row.body,
        lost: false,
      })),
      ...rows.bookmarks.map((row) => ({
        id: row.id,
        kind: 'bookmark' as const,
        workId: row.workId,
        unitId: row.unitId,
        createdAt: row.createdAt,
        colour: null,
        text: row.label ?? '',
        lost: false,
      })),
      ...(attempts ?? []).map((row) => ({
        id: row.id,
        kind: 'feynman' as const,
        workId: row.workId,
        unitId: row.unitId,
        createdAt: row.at,
        colour: null,
        text: row.body,
        lost: false,
      })),
    ].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  }, [rows, attempts, health.lost])

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const cutoff = within ? openedAt - Number(within) * DAY_MS : null
    return entries.filter((entry) => {
      if (work && entry.workId !== work) return false
      if (colour && entry.colour !== colour) return false
      if (kind && entry.kind !== kind) return false
      if (cutoff !== null && new Date(entry.createdAt).getTime() < cutoff) return false
      if (needle) {
        const haystack = entry.kind === 'note' ? noteToPlainText(entry.text) : entry.text
        if (!haystack.toLowerCase().includes(needle)) return false
      }
      return true
    })
  }, [entries, work, colour, kind, within, query, openedAt])

  const attention = shown.filter((entry) => entry.lost)

  /**
   * The ones that need attention come FIRST, because they are the only entries
   * on this screen the reader can do anything about — and because a highlight
   * whose text has moved is the one thing here that looks fine in a list sorted
   * by date and is not.
   */
  const ordered = health.checked ? [...attention, ...shown.filter((entry) => !entry.lost)] : shown

  const exportSelected = () => {
    const picked = shown.filter((entry) => chosen.has(entry.id))
    const byUnit = new Map<string, ExportableAnnotation>()

    for (const entry of picked) {
      const key = `${entry.workId}:${entry.unitId}`
      const resolved = health.units.get(key)
      const existing = byUnit.get(key) ?? {
        workTitle: names.get(entry.workId) ?? entry.workId,
        unitNumber: resolved?.number ?? entry.unitId,
        unitHeading: '',
        // The unit's OWN citation where the corpus could be read, and the work
        // plus the internal id where it could not — never the id alone, which
        // means nothing outside this app.
        citation: resolved?.citation ?? `${names.get(entry.workId) ?? entry.workId} — ${entry.unitId}`,
        path: toUnitHref(entry.workId, entry.unitId),
        highlights: [],
        notes: [],
        bookmarkLabel: null,
      }
      if (entry.kind === 'highlight') {
        existing.highlights.push({ colour: entry.colour ?? 'marigold', quote: entry.text, lost: entry.lost })
      } else if (entry.kind === 'note') {
        existing.notes.push({ body: entry.text, updatedAt: entry.createdAt })
      } else if (entry.text) {
        existing.bookmarkLabel = entry.text
      }
      byUnit.set(key, existing)
    }

    const markdown = toMarkdown(
      [...byUnit.values()],
      t('library.mine.title'),
      t('common.disclaimer'),
      window.location.origin,
    )

    try {
      const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'sahayak-my-study.md'
      link.click()
      URL.revokeObjectURL(url)
      setNotice(t('library.mine.exported'))
    } catch {
      // A managed device can refuse a blob download; a button that silently
      // does nothing is how a reader comes to think their work was lost.
      setNotice(t('library.mine.exportFailed'))
    }
  }

  if (rows === undefined) {
    return (
      <div className="mx-auto flex max-w-4xl flex-col gap-4">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  const select = 'h-9 rounded-md border border-input bg-background px-2 text-sm'

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <PageHeader
        as="h2"
        title={t('library.mine.title')}
        subtitle={t('library.mine.subtitle')}
        /* The compare screen's entry point. It belongs on this tab rather than
           on its own, because comparing two provisions is something a reader
           does WITH what they have marked. */
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/study/notes/compare">
              <Columns2 aria-hidden="true" />
              {t('library.compare.title')}
            </Link>
          </Button>
        }
      />

      {entries.length === 0 ? (
        <EmptyState title={t('library.mine.title')} body={t('library.mine.none')} />
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              {t('library.mine.filterWork')}
              <select
                value={work}
                onChange={(event) => setFilter('work', event.target.value)}
                className={select}
              >
                <option value="">{t('library.mine.allWorks')}</option>
                {[...names.entries()].map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              {t('library.mine.filterColour')}
              <select
                value={colour}
                onChange={(event) => setFilter('colour', event.target.value)}
                className={select}
              >
                <option value="">{t('library.mine.allColours')}</option>
                {HIGHLIGHT_COLOURS.map((option) => (
                  <option key={option} value={option}>
                    {t(`library.select.colour.${option}`)}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              {t('library.mine.filterKind')}
              <select
                value={kind}
                onChange={(event) => setFilter('type', event.target.value)}
                className={select}
              >
                <option value="">{t('library.mine.allKinds')}</option>
                {KINDS.map((option) => (
                  <option key={option} value={option}>
                    {t(`library.mine.kind.${option}`)}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              {t('library.mine.filterDate')}
              <select value={within} onChange={(event) => setWithin(event.target.value)} className={select}>
                <option value="">{t('library.mine.anyDate')}</option>
                <option value="7">{t('library.mine.last7')}</option>
                <option value="30">{t('library.mine.last30')}</option>
              </select>
            </label>

            <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs text-muted-foreground">
              {t('library.mine.search')}
              <input
                type="search"
                data-module-search
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('library.mine.searchPlaceholder')}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <p role="status" className="text-sm text-muted-foreground tabular-nums">
              {t('library.mine.resultsCount', { count: shown.length })}
              {health.checked && attention.length > 0
                ? ` · ${t('library.mine.needsAttentionCount', { count: attention.length })}`
                : ''}
            </p>
            <span className="flex-1" />
            <Button
              variant="outline"
              size="sm"
              onClick={() => setChosen(new Set(shown.map((entry) => entry.id)))}
            >
              {t('library.mine.selectAll')}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setChosen(new Set())}>
              {t('library.mine.clearSelection')}
            </Button>
            <Button size="sm" disabled={chosen.size === 0} onClick={exportSelected}>
              <Download aria-hidden="true" />
              {t('library.mine.export')}
            </Button>
          </div>

          <p aria-live="polite" className="sr-only">
            {notice ?? ''}
          </p>

          {shown.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('library.mine.noneFiltered')}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {ordered.map((entry) => (
                <li key={entry.id}>
                  <SectionCard active={entry.lost}>
                    <div className="flex items-start gap-3 p-3">
                      <input
                        type="checkbox"
                        checked={chosen.has(entry.id)}
                        onChange={(event) => {
                          const next = new Set(chosen)
                          if (event.target.checked) next.add(entry.id)
                          else next.delete(entry.id)
                          setChosen(next)
                        }}
                        aria-label={t('library.mine.select')}
                        className="mt-1 h-4 w-4 shrink-0 accent-[var(--action)]"
                      />
                      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <SectionNumber className="text-xs">
                            {health.units.get(`${entry.workId}:${entry.unitId}`)?.number ?? entry.unitId}
                          </SectionNumber>
                          <Link
                            to={toUnitHref(entry.workId, entry.unitId)}
                            className="text-xs text-primary underline-offset-4 hover:underline"
                          >
                            {names.get(entry.workId) ?? entry.workId}
                          </Link>
                          <Badge>{t(`library.mine.kind.${entry.kind}`)}</Badge>
                          {entry.lost ? (
                            <Badge tone="warning">
                              <AlertTriangle aria-hidden="true" className="mr-1 inline h-3 w-3" />
                              {t('library.mine.needsAttention')}
                            </Badge>
                          ) : null}
                        </div>

                        {/*
                          A bookmark's label is editable HERE, because the
                          screen that used to hold that control was the Library's
                          own bookmarks list and ADR-046 merged it into this one.
                          A label is what tells a reader why they marked
                          something, and a list that shows it and cannot change
                          it is a list that goes stale.
                        */}
                        {entry.kind === 'bookmark' ? (
                          <BookmarkLabel entry={entry} />
                        ) : entry.kind === 'note' ? (
                          <NoteBody
                            body={entry.text}
                            resolveWiki={(workId, unitId) => ({
                              href: toUnitHref(workId, unitId),
                              label: `${workId} ${unitId}`,
                            })}
                            unresolvedLabel={t('library.note.unresolved')}
                          />
                        ) : entry.text ? (
                          <blockquote
                            className={cn(
                              'rounded-md border-l-[3px] px-3 py-1.5 text-sm',
                              entry.colour === 'marigold' &&
                                'border-marigold/40 bg-marigold/15 text-marigold-foreground',
                              entry.colour === 'tulsi' && 'border-tulsi/40 bg-tulsi/15 text-tulsi-foreground',
                              entry.colour === 'violet' &&
                                'border-violet/40 bg-violet/15 text-violet-foreground',
                              entry.colour === 'coral' && 'border-coral/40 bg-coral/15 text-coral-foreground',
                              !entry.colour && 'border-border bg-muted/40',
                            )}
                          >
                            {entry.text}
                          </blockquote>
                        ) : null}
                      </div>
                    </div>
                  </SectionCard>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}

/**
 * The label on one bookmark, editable in place.
 *
 * Keyed on the row by its own `entry.id` through the parent's `key`, so the
 * draft cannot follow the reader on to a different bookmark — the family
 * CLAUDE.md records for `FeynmanBox` and the register's edit form.
 */
function BookmarkLabel({ entry }: { entry: Entry }) {
  const { t } = useT()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(entry.text)

  if (!editing) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {entry.text ? <p className="min-w-0 flex-1 text-sm">{entry.text}</p> : null}
        <button
          type="button"
          onClick={() => {
            setDraft(entry.text)
            setEditing(true)
          }}
          className="inline-flex min-h-8 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <Pencil aria-hidden="true" className="h-3.5 w-3.5" />
          {entry.text ? t('library.bookmark.edit') : t('library.bookmark.label')}
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor={`library-bookmark-${entry.id}`} className="sr-only">
        {t('library.bookmark.label')}
      </label>
      <input
        id={`library-bookmark-${entry.id}`}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder={t('library.bookmark.labelPlaceholder')}
        className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      />
      <Button
        size="sm"
        onClick={() => {
          void setBookmarkLabel(entry.workId, entry.unitId, draft)
          setEditing(false)
        }}
      >
        {t('library.bookmark.save')}
      </Button>
    </div>
  )
}
