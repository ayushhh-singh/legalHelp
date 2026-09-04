import { ArrowLeft, Search } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { toUnitHref } from '../url'
import { useLibraryIndex } from '../useLibrary'
import { usePersonalWorks } from '../useAnnotations'

import { PageHeader } from '@/components/common/PageHeader'
import { ProgressBar, SectionCard, SectionNumber, Skeleton } from '@/components/ui-x'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'
import {
  buildPersonalCorpus,
  buildWorkSearchIndex,
  isSearchable,
  loadCorpus,
  loadWork,
  searchWithin,
  unitLabel,
  type WorkSearchHit,
} from '@/lib/library'

/**
 * `/study/read/search` — one query across every work on this device.
 *
 * IT IS A DELIBERATE ACT, not something a keystroke triggers. Searching the
 * whole Library means parsing 5.5 MB of statute, and while none of it is
 * DOWNLOADED — every chunk is precached, which is why this works on a train —
 * parsing it is seconds of a phone's attention. So the reader presses a button,
 * the page says what that costs, and results arrive work by work with a
 * progress bar rather than after one long freeze.
 *
 * Personal works are searched first and cost nothing: they are already rows in
 * IndexedDB, and they are the ones a reader is most likely to be looking for.
 */

const PER_WORK = 5

interface Group {
  workId: string
  name: string
  hits: WorkSearchHit[]
}

export default function LibrarySearchPage() {
  const { t, language } = useT()
  const [params, setParams] = useSearchParams()
  const index = useLibraryIndex()
  const personal = usePersonalWorks()

  const [query, setQuery] = useState(params.get('q') ?? '')
  const [groups, setGroups] = useState<Group[]>([])
  const [done, setDone] = useState(0)
  const [total, setTotal] = useState(0)
  const [running, setRunning] = useState(false)
  /** Bumped on every new run, so a slow work from the previous one is ignored. */
  const runRef = useRef(0)

  useEffect(() => () => void (runRef.current += 1), [])

  const run = useCallback(async () => {
    const needle = query.trim()
    if (!isSearchable(needle) || !index.data) return

    runRef.current += 1
    const run = runRef.current
    setRunning(true)
    setGroups([])
    setDone(0)

    const personalWorks = personal ?? []
    const shelf = index.data.works
    setTotal(personalWorks.length + shelf.length)

    const push = (group: Group) => {
      if (runRef.current !== run) return
      if (group.hits.length > 0) setGroups((current) => [...current, group])
      setDone((current) => current + 1)
    }

    for (const row of personalWorks) {
      const corpus = buildPersonalCorpus(row)
      push({
        workId: row.id,
        name: row.title,
        hits: searchWithin(buildWorkSearchIndex(corpus), needle, PER_WORK),
      })
    }

    for (const entry of shelf) {
      if (runRef.current !== run) return
      try {
        const work = await loadWork(entry.id)
        const corpus = await loadCorpus(work)
        push({
          workId: entry.id,
          name: entry.shortTitle[language],
          hits: searchWithin(buildWorkSearchIndex(corpus), needle, PER_WORK),
        })
      } catch {
        // One book that will not parse must not stop the other fourteen.
        if (runRef.current === run) setDone((current) => current + 1)
      }
    }

    if (runRef.current === run) setRunning(false)
  }, [query, index.data, personal, language])

  const submit = () => {
    const next = new URLSearchParams(params)
    if (query.trim()) next.set('q', query.trim())
    else next.delete('q')
    setParams(next, { replace: true })
    void run()
  }

  const matches = groups.reduce((count, group) => count + group.hits.length, 0)

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <PageHeader
        title={t('library.search.allTitle')}
        subtitle={t('library.search.allSubtitle')}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/study/read">
              <ArrowLeft aria-hidden="true" />
              {t('library.back')}
            </Link>
          </Button>
        }
      />

      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-56 flex-1">
          <label htmlFor="library-search-all" className="mb-1 block text-sm font-medium">
            {t('library.search.allTitle')}
          </label>
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            />
            <input
              id="library-search-all"
              type="search"
              data-module-search
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submit()
              }}
              placeholder={t('library.search.allPlaceholder')}
              className="h-11 w-full rounded-lg border border-input bg-card pl-10 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            />
          </div>
        </div>
        <Button onClick={submit} disabled={!isSearchable(query) || running}>
          {t('library.search.start')}
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">{t('library.search.cost')}</p>

      {running ? (
        <div className="flex flex-col gap-2">
          <p role="status" className="text-sm text-muted-foreground tabular-nums">
            {t('library.search.searching', { done, total })}
          </p>
          <ProgressBar
            value={total > 0 ? (done / total) * 100 : 0}
            label={t('library.search.searching', { done, total })}
          />
        </div>
      ) : null}

      {index.status === 'loading' ? <Skeleton className="h-40 w-full" /> : null}

      {!running && done > 0 && matches === 0 ? (
        <p className="text-sm text-muted-foreground">{t('library.search.noneAll')}</p>
      ) : null}

      <ul className="flex flex-col gap-4">
        {groups.map((group) => (
          <li key={group.workId}>
            <SectionCard aria-labelledby={`library-group-${group.workId}`}>
              <div className="flex items-baseline justify-between gap-2 border-b border-border px-4 py-2">
                <h2 id={`library-group-${group.workId}`} className="text-sm font-semibold">
                  {group.name}
                </h2>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {t('library.search.groupCount', { count: group.hits.length })}
                </span>
              </div>
              <ul className="flex flex-col p-2">
                {group.hits.map((hit) => {
                  const shown = unitLabel(hit.unit.heading, hit.unit.excerpt, language)
                  return (
                    <li key={hit.unit.id}>
                      <Link
                        to={toUnitHref(group.workId, hit.unit.id)}
                        className="flex flex-col gap-1 rounded-md p-2 transition-colors hover:bg-accent/50"
                      >
                        <span className="flex items-center gap-2">
                          <SectionNumber className="text-xs">{hit.unit.number}</SectionNumber>
                          <span lang={shown.lang} className="text-sm font-medium">
                            {shown.text}
                          </span>
                        </span>
                        <span className="text-xs text-muted-foreground">{hit.snippet}</span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </SectionCard>
          </li>
        ))}
      </ul>
    </div>
  )
}
