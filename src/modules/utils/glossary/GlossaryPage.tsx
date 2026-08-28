import { BookMarked } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { buildGlossaryIndex, searchGlossary } from './search'
import { GLOSSARY_CATEGORIES, type GlossaryCategory, type GlossaryTerm } from './schema'
import { parseGlossaryTermParam } from './url'
import { useGlossary } from './useGlossaryData'
import { useGlossaryFavourites } from './useGlossaryFavourites'
import { TermRow } from './TermRow'

import { DataVersion } from '@/components/common/DataVersion'
import { Disclaimer } from '@/components/common/Disclaimer'
import { EmptyState } from '@/components/common/EmptyState'
import { PageHeader } from '@/components/common/PageHeader'
import { QueryErrorState, SectionCard, Skeleton } from '@/components/ui-x'
import { useT } from '@/i18n/useT'
import { cn } from '@/lib/utils'

type View = 'all' | 'favourites' | 'recents'

/**
 * The law module measured its way to NOT virtualising 1,059 six-node rows
 * (ADR-016) — the corpus size is what would change that answer, and this
 * corpus is nearly double that at a heavier ~15 nodes per row (two copy
 * buttons, a favourite toggle, a category chip, a verify badge, a source
 * link, a status region). Rendering all 1,891 unfiltered ran axe-core past a
 * 30s timeout in a real browser and would cost a real reader the same way.
 * Capping the render, not the search, is what `GlossarySheet`'s own full-
 * glossary tab already does (`FULL_GLOSSARY_SHEET_MAX` in that file, a
 * smaller cap because a modal sheet is narrower) — a query still searches
 * every term, only the list on screen is bounded.
 */
const MAX_RENDERED = 100

const EMPTY_MAP: ReadonlyMap<string, GlossaryTerm> = new Map()

/**
 * `/utils/glossary` — the full Hindi administrative glossary.
 *
 * Search, a category filter, favourites and recents all live here rather than
 * in the Drafting Studio's own glossary sheet (`GlossarySheet.tsx`), which
 * stays on the 78-term structural glossary it always had and gained a second
 * tab reaching this same dataset (`data/glossary.json`) through the same
 * `onInsert` callback. This page has no draft to insert into — its actions are
 * copy and save, which is why `TermRow` takes `onCopy`/`onToggleFavourite`
 * rather than an insert callback.
 */
export default function GlossaryPage() {
  const { t, language } = useT()
  const glossary = useGlossary(true)
  const { favourites, recents, favouriteIds, toggle, recordUsed } = useGlossaryFavourites()
  const [searchParams] = useSearchParams()

  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<GlossaryCategory | 'all'>('all')
  const [view, setView] = useState<View>('all')

  /**
   * A share link (`?term=<id>`) puts the term's own English text into the
   * search box — guarded by the term id itself, not a one-shot boolean: this
   * route never remounts when only its search params change (same
   * `/utils/glossary` element throughout), so picking a SECOND term from the
   * palette while already on this page must apply too. `lastTermId` is what
   * makes that "once per distinct id" rather than "once ever" — the same
   * StrictMode-safe shape `useDraft.ts` uses for a restore, extended to cover
   * a later navigation rather than only the first mount. There is no separate
   * "focused term" state: putting it into the search box is what actually
   * surfaces the row, and it stays the ordinary search state the reader can
   * keep typing over.
   */
  const lastTermId = useRef<string | null>(null)
  useEffect(() => {
    if (glossary.status !== 'ready') return
    const termId = parseGlossaryTermParam(searchParams)
    if (!termId || termId === lastTermId.current) return
    lastTermId.current = termId
    // Deferred a tick rather than set directly in the effect body: the value
    // comes from data this effect is only reacting to (the dataset settling,
    // or the URL changing), not something it owns, which is the same
    // "external callback" shape `SectionActions.tsx`'s own effect gets from
    // `isFavourite(...).then(...)`.
    queueMicrotask(() => {
      const term = glossary.status === 'ready' ? glossary.data.terms.find((candidate) => candidate.id === termId) : undefined
      if (term) setQuery(term.en)
    })
  }, [glossary, searchParams])

  /**
   * The settled dataset, or `null` — a STABLE reference once loaded, unlike
   * `glossary` itself (`useGlossary`'s `useAsync` returns a fresh wrapper
   * object on every call, `retry` included, so memoising on `glossary`
   * never actually hits its cache). Building the Fuse index over ~1,891
   * terms is not cheap; keying on `glossaryData` instead is what makes it
   * run once per load rather than once per keystroke.
   */
  const glossaryData = glossary.status === 'ready' ? glossary.data : null

  const index = useMemo(() => (glossaryData ? buildGlossaryIndex(glossaryData) : null), [glossaryData])
  const byId = useMemo(
    () => (glossaryData ? new Map(glossaryData.terms.map((term) => [term.id, term])) : EMPTY_MAP),
    [glossaryData],
  )

  const allResults = useMemo(
    () => (view === 'all' && index ? searchGlossary(index, query, category) : []),
    [view, index, query, category],
  )
  const favouriteResults = useMemo(
    () =>
      view === 'favourites'
        ? favourites.map((row) => byId.get(row.termId)).filter((term): term is GlossaryTerm => term !== undefined)
        : [],
    [view, favourites, byId],
  )
  const recentResults = useMemo(
    () =>
      view === 'recents'
        ? recents.map((row) => byId.get(row.termId)).filter((term): term is GlossaryTerm => term !== undefined)
        : [],
    [view, recents, byId],
  )

  const results = view === 'all' ? allResults : view === 'favourites' ? favouriteResults : recentResults
  const visibleResults = results.slice(0, MAX_RENDERED)

  const toggleFavourite = (term: GlossaryTerm) => {
    void toggle(term).catch(() => {
      // Blocked or full IndexedDB. The button is a no-op rather than
      // throwing an unhandled rejection — the same line `store.ts` and
      // `src/modules/law/ConverterPage.tsx` take for a write that is not
      // worth interrupting the reader over.
    })
  }

  const recordCopy = (term: GlossaryTerm) => {
    void recordUsed(term).catch(() => {
      // Same as above: losing a recent-lookup row is not worth a message.
    })
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <PageHeader title={t('utils.glossary.title')} subtitle={t('utils.glossary.subtitle')} />

      <SectionCard active className="flex flex-col">
        <div
          role="tablist"
          aria-label={t('utils.glossary.title')}
          className="flex flex-wrap gap-1 border-b border-border p-2"
        >
          <ViewTab active={view === 'all'} onClick={() => setView('all')}>
            {t('utils.glossary.view.all')}
          </ViewTab>
          <ViewTab active={view === 'favourites'} onClick={() => setView('favourites')}>
            {t('utils.glossary.view.favourites')} ({favourites.length})
          </ViewTab>
          <ViewTab active={view === 'recents'} onClick={() => setView('recents')}>
            {t('utils.glossary.view.recents')} ({recents.length})
          </ViewTab>
        </div>

        {view === 'all' ? (
          <div className="space-y-3 border-b border-border p-4">
            <label className="sr-only" htmlFor="glossary-search">
              {t('utils.glossary.searchLabel')}
            </label>
            <input
              id="glossary-search"
              data-module-search
              type="search"
              value={query}
              placeholder={t('utils.glossary.searchPlaceholder')}
              onChange={(event) => setQuery(event.target.value)}
              className="h-11 w-full rounded-lg border border-input bg-card px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            />

            <fieldset className="min-w-0">
              <legend className="sr-only">{t('utils.glossary.categoryAll')}</legend>
              <div
                role="radiogroup"
                aria-label={t('utils.glossary.categoryAll')}
                className="flex flex-wrap gap-1.5"
              >
                <CategoryChip checked={category === 'all'} onSelect={() => setCategory('all')}>
                  {t('utils.glossary.categoryAll')}
                </CategoryChip>
                {GLOSSARY_CATEGORIES.map((cat) => (
                  <CategoryChip key={cat} checked={category === cat} onSelect={() => setCategory(cat)}>
                    {t(`utils.glossary.category.${cat}`)}
                  </CategoryChip>
                ))}
              </div>
            </fieldset>
          </div>
        ) : null}

        <div className="min-h-0 flex-1 p-4">
          {/*
            Favourites and recents are IndexedDB rows, independent of
            `data/glossary.json` (`favourites`/`recents` settle before or
            after the ~700 KB dataset does, in either order). Turning a saved
            `termId` into a displayable `GlossaryTerm` needs the full dataset,
            so this view has its OWN loading/error branches keyed on
            `glossary.status`, gated separately from the "All terms" search —
            without them, opening "Favourites" before the dataset has loaded
            fell through to the generic empty-results message and told a
            reader with real saved terms that none matched.
          */}
          {glossary.status === 'error' ? (
            <QueryErrorState body={t('errors.body')} onRetry={glossary.retry} />
          ) : null}

          {glossary.status === 'loading' ? (
            <div className="space-y-3" aria-live="polite" aria-label={t('common.loading')}>
              {Array.from({ length: view === 'all' ? 6 : 3 }, (_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : null}

          {view === 'all' && glossary.status === 'ready' ? (
            <p className="mb-2 text-xs text-muted-foreground tabular-nums">
              {t('utils.glossary.resultCount', { count: results.length })}
              {results.length > MAX_RENDERED
                ? ` — ${t('utils.glossary.truncated', { shown: MAX_RENDERED })}`
                : ''}
            </p>
          ) : null}

          {glossary.status === 'ready' && view === 'favourites' && favourites.length === 0 ? (
            <EmptyState
              icon={BookMarked}
              title={t('utils.glossary.view.favourites')}
              body={t('utils.glossary.favouritesEmpty')}
            />
          ) : null}

          {glossary.status === 'ready' && view === 'recents' && recents.length === 0 ? (
            <EmptyState
              icon={BookMarked}
              title={t('utils.glossary.view.recents')}
              body={t('utils.glossary.recentsEmpty')}
            />
          ) : null}

          {/*
            The generic "nothing matched" message — shown once the relevant
            source has settled (the search index for "All", the favourite/
            recent rows for the other two) and turned out to have nothing to
            show for THIS view specifically. Scoped per view rather than
            `results.length === 0` alone: that alone would also fire for an
            empty favourites/recents list, doubling up with the EmptyState
            above, which already explains how to populate it.
          */}
          {glossary.status === 'ready' &&
          ((view === 'all' && results.length === 0) ||
            (view === 'favourites' && favourites.length > 0 && results.length === 0) ||
            (view === 'recents' && recents.length > 0 && results.length === 0)) ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{t('utils.glossary.empty')}</p>
          ) : null}

          <ul className="space-y-2">
            {visibleResults.map((term) => (
              <TermRow
                key={term.id}
                term={term}
                favourite={favouriteIds.has(term.id)}
                onToggleFavourite={toggleFavourite}
                onCopy={recordCopy}
                language={language}
              />
            ))}
          </ul>
        </div>
      </SectionCard>

      <Disclaimer />
      <DataVersion dataset="glossary" />
    </div>
  )
}

function ViewTab({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'min-h-9 rounded-md px-3 text-xs font-medium whitespace-nowrap transition-colors',
        active ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-muted',
      )}
    >
      {children}
    </button>
  )
}

function CategoryChip({
  checked,
  onSelect,
  children,
}: {
  checked: boolean
  onSelect: () => void
  children: React.ReactNode
}) {
  return (
    <label
      className={cn(
        'inline-flex min-h-9 cursor-pointer items-center justify-center rounded-full border px-3 text-xs font-medium transition-colors',
        checked
          ? 'border-action bg-action text-action-foreground font-semibold'
          : 'border-border bg-card text-muted-foreground hover:border-input hover:text-foreground',
        'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background',
      )}
    >
      <input
        type="radio"
        name="glossary-category"
        checked={checked}
        onChange={onSelect}
        onClick={onSelect}
        className="sr-only"
      />
      {children}
    </label>
  )
}
