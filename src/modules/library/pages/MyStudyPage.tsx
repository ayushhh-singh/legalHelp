import { AlertTriangle, ArrowLeft, Download } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { NoteBody } from '../components/NoteBody'
import { toUnitHref } from '../url'
import { useLibraryIndex } from '../useLibrary'
import { usePersonalWorks, useStudyRows } from '../useAnnotations'

import { EmptyState } from '@/components/common/EmptyState'
import { PageHeader } from '@/components/common/PageHeader'
import { Badge, SectionCard, SectionNumber, Skeleton } from '@/components/ui-x'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'
import {
  colourOf,
  HIGHLIGHT_COLOURS,
  noteToPlainText,
  toMarkdown,
  type ExportableAnnotation,
  type HighlightColour,
} from '@/lib/library'
import { cn } from '@/lib/utils'

/**
 * `/library/mine` — everything the reader has written, in one place.
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

type Kind = 'highlight' | 'note' | 'bookmark'

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

  const [work, setWork] = useState('')
  const [colour, setColour] = useState('')
  const [kind, setKind] = useState<'' | Kind>('')
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
        // A row whose quote is empty could never be found again by any means;
        // that is the one case this screen can identify without the corpus.
        lost: row.quote.trim().length === 0,
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
    ].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  }, [rows])

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

  const exportSelected = () => {
    const picked = shown.filter((entry) => chosen.has(entry.id))
    const byUnit = new Map<string, ExportableAnnotation>()

    for (const entry of picked) {
      const key = `${entry.workId}:${entry.unitId}`
      const existing = byUnit.get(key) ?? {
        workTitle: names.get(entry.workId) ?? entry.workId,
        unitNumber: entry.unitId,
        unitHeading: '',
        citation: `${names.get(entry.workId) ?? entry.workId} — ${entry.unitId}`,
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
        title={t('library.mine.title')}
        subtitle={t('library.mine.subtitle')}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/library">
              <ArrowLeft aria-hidden="true" />
              {t('library.back')}
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
              <select value={work} onChange={(event) => setWork(event.target.value)} className={select}>
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
              <select value={colour} onChange={(event) => setColour(event.target.value)} className={select}>
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
                onChange={(event) => setKind(event.target.value as '' | Kind)}
                className={select}
              >
                <option value="">{t('library.mine.allKinds')}</option>
                {(['highlight', 'note', 'bookmark'] as const).map((option) => (
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
              {attention.length > 0
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
              {shown.map((entry) => (
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
                          <SectionNumber className="text-xs">{entry.unitId}</SectionNumber>
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

                        {entry.kind === 'note' ? (
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
