import { ArrowLeft, BookOpen, Clock, Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'

import { TocTree } from '../components/TocTree'
import { toUnitHref } from '../url'
import {
  useLastReadUnitId,
  useReadUnitIds,
  useWork,
  useWorkCorpus,
  useWorkSearchIndex,
} from '../useLibrary'

import { DataVersion } from '@/components/common/DataVersion'
import { Disclaimer } from '@/components/common/Disclaimer'
import { PageHeader } from '@/components/common/PageHeader'
import { SourceChip } from '@/components/common/SourceChip'
import { Badge, Chip, QueryErrorState, SectionCard, SectionNumber, Skeleton } from '@/components/ui-x'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'
import { firstUnitId, isSearchable, isWorkId, searchWithin, tagLabel, unitLabel } from '@/lib/library'
import { cn } from '@/lib/utils'
import type { LibraryWork } from '@/schemas/library'

/**
 * `/library/:workId` — one work's table of contents, and search inside it.
 *
 * The TOC needs the WORK only (8–220 KB, no statutory text). The search box
 * needs the CORPUS, and so it loads it — but only once the reader has typed
 * something, which is the same `useLawEngine(enabled)` lever the Law Converter
 * pulls and the reason opening a Sanhita to look at its chapters does not pull
 * 1.9 MB down a train connection.
 */

const SEARCH_LIMIT = 50

const versionKeyFor = (work: LibraryWork): string =>
  work.corpus.kind === 'law' ? `law-${work.id}` : `rules-${work.id}`

function minutesLabel(minutes: number, t: ReturnType<typeof useT>['t']): string {
  return minutes >= 90
    ? t('library.aboutHours', { count: Math.round(minutes / 60) })
    : t('library.aboutMinutes', { count: minutes })
}

export default function WorkPage() {
  const { t, language } = useT()
  const { workId } = useParams<{ workId: string }>()
  const work = useWork(workId)
  const [query, setQuery] = useState('')

  // `isSearchable` is the same rule the index uses, so the corpus is not
  // loaded for a query that would match nothing — and a one-digit query, which
  // IS searchable, is not turned away before it gets there.
  const searching = isSearchable(query)
  const corpus = useWorkCorpus(work.data, searching)
  const index = useWorkSearchIndex(corpus.data)
  const readIds = useReadUnitIds(workId)
  const lastRead = useLastReadUnitId(workId)

  const hits = useMemo(
    () => (index && searching ? searchWithin(index, query, SEARCH_LIMIT) : []),
    [index, query, searching],
  )

  /**
   * An id that names no work is a wrong URL, not a failed load, and the two
   * deserve different answers. `tests/route-coverage.test.ts` exempts
   * `/library/:workId` on the stated grounds that a literal ":workId" renders
   * the not-found redirect — which it did not, until now: it rendered a red
   * failure card, and an exemption whose reason is untrue excuses nothing while
   * looking as though it does.
   */
  if (workId !== undefined && !isWorkId(workId)) return <Navigate to="/library" replace />

  if (work.status === 'error') {
    return (
      <div className="mx-auto max-w-4xl">
        <QueryErrorState onRetry={work.retry} />
        <Button asChild variant="outline" size="sm" className="mt-4">
          <Link to="/library">
            <ArrowLeft aria-hidden="true" />
            {t('library.back')}
          </Link>
        </Button>
      </div>
    )
  }

  // NOT `|| readIds === undefined`. Read ticks are a decoration over a table
  // of contents that came from a precached chunk; a device whose storage is
  // refused never resolves that query and used to sit on this skeleton for
  // ever. See `useReadUnitIds`.
  if (work.status === 'loading') {
    return (
      <div className="mx-auto flex max-w-4xl flex-col gap-4">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    )
  }

  const data = work.data
  const first = firstUnitId(data)
  const read = readIds ?? new Set<string>()
  const readCount = data.readingOrder.filter((id) => read.has(id)).length

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <PageHeader
        title={data.title[language]}
        subtitle={data.description[language]}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/library">
              <ArrowLeft aria-hidden="true" />
              {t('library.back')}
            </Link>
          </Button>
        }
      />

      <SectionCard>
        <div className="flex flex-col gap-4 p-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground tabular-nums">
            <span className="inline-flex items-center gap-1.5">
              <BookOpen aria-hidden="true" className="h-4 w-4" />
              {t('library.unitsCount', { count: data.readingOrder.length })}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Clock aria-hidden="true" className="h-4 w-4" />
              {minutesLabel(data.estimatedMinutes, t)}
            </span>
            <span>{t('library.readCount', { read: readCount, total: data.readingOrder.length })}</span>
            {data.verify ? <Badge tone="warning">{t('common.verifyWithDdo')}</Badge> : null}
          </div>

          <ul className="flex flex-wrap gap-1.5" aria-label={t('library.tag.label')}>
            {data.examTags.map((tag) => (
              <li key={tag}>
                <Chip>{tagLabel(tag, language)}</Chip>
              </li>
            ))}
          </ul>

          {first ? (
            <div>
              <Button asChild>
                <Link to={toUnitHref(data.id, first)}>{t('library.startReading')}</Link>
              </Button>
            </div>
          ) : null}

          <p className="text-xs text-muted-foreground">
            {t('library.publishedBy', { publisher: data.publisher })}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <SourceChip name={data.source.name} url={data.source.url} />
            <a
              href={data.officialUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary underline-offset-4 hover:underline"
            >
              {t('library.officialText')}
            </a>
          </div>
        </div>
      </SectionCard>

      <div>
        <label htmlFor="library-search" className="mb-1 block text-sm font-medium">
          {t('library.search.within')}
        </label>
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          />
          <input
            id="library-search"
            type="search"
            // `/` focuses a page's own search; the shortcut looks for this.
            data-module-search
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('library.search.placeholder')}
            className="h-11 w-full rounded-lg border border-input bg-card pr-11 pl-10 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label={t('library.search.clear')}
              className="absolute top-1/2 right-1 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </div>

      {searching ? (
        <section aria-label={t('library.search.within')}>
          {corpus.status === 'loading' ? (
            <Skeleton className="h-40 w-full" />
          ) : corpus.status === 'error' ? (
            <QueryErrorState onRetry={corpus.retry} />
          ) : (
            <>
              <p role="status" className="mb-3 text-sm text-muted-foreground tabular-nums">
                {t('library.search.resultsCount', { count: hits.length })}
                {hits.length === SEARCH_LIMIT
                  ? ` · ${t('library.search.capped', { count: SEARCH_LIMIT })}`
                  : ''}
              </p>
              {hits.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('library.search.none')}</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {hits.map((hit) => (
                    <li key={hit.unit.id}>
                      <Link
                        to={toUnitHref(data.id, hit.unit.id)}
                        className={cn(
                          'flex flex-col gap-1 rounded-lg border border-border bg-card p-3 transition-colors',
                          'hover:border-input',
                        )}
                      >
                        <span className="flex items-center gap-2">
                          <SectionNumber className="text-xs">{hit.unit.number}</SectionNumber>
                          <span className="text-sm font-medium">
                            {/* `unitLabel`, not a hand-rolled fallback: FR/SR
                                and CSMOP publish no heading at all, and the
                                committed `heading[language] || heading.en`
                                rendered a section number beside an empty
                                string for every hit in either of them. */}
                            {unitLabel(hit.unit.heading, hit.unit.excerpt, language).text}
                          </span>
                        </span>
                        <span className="text-xs text-muted-foreground">{hit.snippet}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>
      ) : (
        <section aria-labelledby="library-toc-heading">
          <h2 id="library-toc-heading" className="mb-3 text-lg font-semibold">
            {t('library.toc.title')}
          </h2>
          {/*
            Keyed on the resume point so the branch the reader was last in is
            the one that opens. `Chapter` seeds its own `useState` from
            `defaultOpen`, so a `currentUnitId` that arrives from IndexedDB a
            tick after first paint would otherwise be ignored — and a reader
            who stopped at BNSS section 300 would come back to chapter I.
            Remounting a contents list nobody has touched yet costs nothing.
          */}
          <TocTree key={lastRead ?? ''} work={data} readIds={read} currentUnitId={lastRead} />
        </section>
      )}

      <Disclaimer />
      <DataVersion dataset={versionKeyFor(data)} />
    </div>
  )
}
