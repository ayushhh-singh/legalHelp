import { ArrowLeft, BookOpen, Clock, Download, Search, Trash2, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'

import { AppLink } from '@/app/AppLink'

import { ChapterStudyList } from '../components/ChapterStudyList'
import { CoverageMap } from '../components/CoverageMap'
import { QuickRefTables } from '../components/QuickRefTables'
import { SessionTimer } from '../components/SessionTimer'
import { TocTree } from '../components/TocTree'
import { toCompareHref, toUnitHref } from '../url'
import { useLastReadUnitId, useReadUnitIds, useWorkSearchIndex } from '../useLibrary'
import { useQuickRef, useReaderCorpus, useReaderWork } from '../useAnnotations'

import { DataVersion } from '@/components/common/DataVersion'
import { Disclaimer } from '@/components/common/Disclaimer'
import { PageHeader } from '@/components/common/PageHeader'
import { SourceChip } from '@/components/common/SourceChip'
import { Badge, Chip, QueryErrorState, SectionCard, SectionNumber, Skeleton } from '@/components/ui-x'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'
import {
  deletePersonalWork,
  firstUnitId,
  getPersonalWork,
  isPersonalWorkId,
  isSearchable,
  isWorkId,
  personalFileName,
  searchWithin,
  tagLabel,
  toPersonalFile,
  unitLabel,
  type ReaderWork,
} from '@/lib/library'
import { useAsync } from '@/lib/useAsync'
import { loadCardsForAct } from '@/modules/trainer/data'
import type { Card } from '@/modules/trainer/schema'
import { cn } from '@/lib/utils'

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

const versionKeyFor = (work: ReaderWork): string | null =>
  work.origin === 'personal' ? null : work.corpus.kind === 'law' ? `law-${work.id}` : `rules-${work.id}`

function minutesLabel(minutes: number, t: ReturnType<typeof useT>['t']): string {
  return minutes >= 90
    ? t('library.aboutHours', { count: Math.round(minutes / 60) })
    : t('library.aboutMinutes', { count: minutes })
}

export default function WorkPage() {
  const { t, language } = useT()
  const { workId } = useParams<{ workId: string }>()
  const work = useReaderWork(workId)
  const [query, setQuery] = useState('')
  const [view, setView] = useState<'contents' | 'quickref'>('contents')

  // `isSearchable` is the same rule the index uses, so the corpus is not
  // loaded for a query that would match nothing — and a one-digit query, which
  // IS searchable, is not turned away before it gets there. The quick-reference
  // tables need it too, and only once that view has been asked for: on a
  // personal document they are extracted from the corpus in the browser.
  const searching = isSearchable(query)
  const corpus = useReaderCorpus(work.work, searching || view === 'quickref')
  const quickref = useQuickRef(work.work, corpus.data, view === 'quickref')
  const index = useWorkSearchIndex(corpus.data)
  /*
    This work's own Trainer cards, for the coverage map's "quizzed" flag.

    ONE act (`loadCardsForAct`), not the Trainer's 1.1 MB catalogue: the
    question is which of THIS work's rules the reader has been asked about, and
    eleven other acts cannot help answer it. `data/rules/cards/<act>.json` is
    precached, so after the first visit it costs nothing, and it is fetched
    after this page has painted rather than on the way to it.

    The map shipped with `cards={null}` hard-coded at its call site, which made
    `quizzed` false for every unit — the badge read 0 for ever and
    `readNotQuizzed`, the figure the summary exists to produce, was `read` under
    a second name.

    Declared HERE, above the early returns, rather than beside the JSX that uses
    it: hooks run in the same order on every render or they run in the wrong
    order on one of them.
  */
  const cardsWorkId = work.work && work.work.origin !== 'personal' ? work.work.id : null
  const actCardsState = useAsync(
    useMemo(
      () => () =>
        cardsWorkId === null
          ? Promise.resolve([] as Card[])
          : loadCardsForAct(cardsWorkId)
              .then((file) => file.cards)
              // A work with no rule book behind it — BNS/BNSS/BSA — simply has
              // no cards. That is not an error, and the heat-map still has two
              // of its three dimensions.
              .catch(() => [] as Card[]),
      [cardsWorkId],
    ),
    `coverage-cards:${cardsWorkId ?? 'none'}`,
    cardsWorkId !== null,
  )
  const actCards = actCardsState.status === 'ready' ? actCardsState.data : null

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
  if (workId !== undefined && !isWorkId(workId) && !isPersonalWorkId(workId)) {
    return <Navigate to="/study/read" replace />
  }

  if (work.status === 'error') {
    return (
      <div className="mx-auto max-w-4xl">
        <QueryErrorState onRetry={work.retry} />
        <Button asChild variant="outline" size="sm" className="mt-4">
          <Link to="/study/read">
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
  if (work.status === 'missing') return <Navigate to="/study/read" replace />

  if (work.status === 'loading' || !work.work) {
    return (
      <div className="mx-auto flex max-w-4xl flex-col gap-4">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    )
  }

  const data = work.work
  const versionKey = versionKeyFor(data)

  /**
   * Export the reader's own document as a file they can keep or pass on.
   *
   * A plain JSON blob, saved by the reader — not sent anywhere. `parsePersonalFile`
   * reissues the id on the way back in, so importing a copy of a document
   * somebody already has adds a second one rather than overwriting the first
   * along with every highlight keyed to it.
   */
  const exportWork = async () => {
    const row = await getPersonalWork(data.id)
    if (!row) return
    try {
      const blob = new Blob([JSON.stringify(toPersonalFile(row), null, 2)], {
        type: 'application/json;charset=utf-8',
      })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = personalFileName(row)
      link.click()
      URL.revokeObjectURL(url)
    } catch {
      // A managed device can refuse a blob download. Nothing is lost; the
      // document is still on the shelf.
    }
  }
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
            <Link to="/study/read">
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
            {data.origin === 'personal' ? (
              <Badge tone="warning">{t('library.add.yourDocument')}</Badge>
            ) : null}
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
                <AppLink to={toUnitHref(data.id, first)}>{t('library.startReading')}</AppLink>
              </Button>
            </div>
          ) : null}

          {data.origin === 'personal' ? (
            <>
              <p className="rounded-md border-l-[3px] border-marigold bg-marigold/15 px-3 py-2 text-xs text-marigold-foreground">
                {t('library.add.notOfficial')}
              </p>
              {data.originNote ? <p className="text-xs text-muted-foreground">{data.originNote}</p> : null}
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => void exportWork()}>
                  <Download aria-hidden="true" />
                  {t('library.add.export')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    // A typed confirmation would be theatre for one document;
                    // a plain confirm names it and says the annotations go too,
                    // which is the part a reader would not otherwise expect.
                    if (!window.confirm(t('library.add.deleteWorkConfirm', { title: data.title.en }))) return
                    void deletePersonalWork(data.id)
                  }}
                >
                  <Trash2 aria-hidden="true" />
                  {t('library.add.deleteWork')}
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                {t('library.publishedBy', { publisher: data.publisher })}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {data.source ? <SourceChip name={data.source.name} url={data.source.url} /> : null}
                {data.officialUrl ? (
                  <a
                    href={data.officialUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-primary underline-offset-4 hover:underline"
                  >
                    {t('library.officialText')}
                  </a>
                ) : null}
                <Link
                  to={toCompareHref(first ? { workId: data.id, unitId: first } : null)}
                  className="text-xs text-primary underline-offset-4 hover:underline"
                >
                  {t('library.compare.title')}
                </Link>
              </div>
            </>
          )}
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

      {searching ? null : (
        <div
          role="group"
          aria-label={t('library.toc.title')}
          className="flex rounded-md border border-input p-0.5"
        >
          {(['contents', 'quickref'] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={view === option}
              onClick={() => setView(option)}
              className={cn(
                'min-h-9 flex-1 rounded-sm px-3 text-xs transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                view === option
                  ? 'bg-action font-semibold text-action-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              )}
            >
              {t(option === 'contents' ? 'library.toc.title' : 'library.quickref.title')}
            </button>
          ))}
        </div>
      )}

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
                      <AppLink
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
                      </AppLink>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>
      ) : view === 'quickref' ? (
        corpus.status === 'loading' || quickref.loading ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <QuickRefTables
            workId={data.id}
            rows={quickref.data.rows}
            counts={quickref.data.counts}
            extractedHere={quickref.extractedHere}
          />
        )
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

      {/*
        The study layer, below the contents rather than above it: this page's
        job is still "open this book", and a reader who has never studied here
        sees a timer and an empty coverage grid, not a wall of analytics.

        A PERSONAL work gets none of it — no chapters worth revising, no
        approved cards citing it, and `practiseCounts` is empty by construction.
      */}
      {data.origin === 'personal' ? null : (
        <div className="flex flex-col gap-4">
          <SessionTimer workId={data.id} workLabel={data.shortTitle[language] || data.shortTitle.en} />
          <ChapterStudyList work={data} />
          <CoverageMap workId={data.id} unitIds={data.readingOrder} toc={data.toc} cards={actCards} />
        </div>
      )}

      <Disclaimer />
      {versionKey ? <DataVersion dataset={versionKey} /> : null}
    </div>
  )
}
