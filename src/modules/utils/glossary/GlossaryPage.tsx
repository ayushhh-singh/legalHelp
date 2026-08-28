import { BookMarked } from 'lucide-react'
import { useMemo, useState } from 'react'

import { buildGlossaryIndex, searchGlossary } from './search'
import { GLOSSARY_CATEGORIES, type GlossaryCategory, type GlossaryTerm } from './schema'
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
 * glossary tab already does (`results.slice(0, 60)`) — a query still searches
 * every term, only the list on screen is bounded.
 */
const MAX_RENDERED = 100

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

  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<GlossaryCategory | 'all'>('all')
  const [view, setView] = useState<View>('all')

  const index = useMemo(
    () => (glossary.status === 'ready' ? buildGlossaryIndex(glossary.data) : null),
    [glossary],
  )

  const byId = useMemo(() => {
    if (glossary.status !== 'ready') return new Map<string, GlossaryTerm>()
    return new Map(glossary.data.terms.map((term) => [term.id, term]))
  }, [glossary])

  const allResults = index ? searchGlossary(index, query, category) : []
  const favouriteResults = favourites
    .map((row) => byId.get(row.termId))
    .filter((term): term is GlossaryTerm => term !== undefined)
  const recentResults = recents
    .map((row) => byId.get(row.termId))
    .filter((term): term is GlossaryTerm => term !== undefined)

  const results = view === 'all' ? allResults : view === 'favourites' ? favouriteResults : recentResults
  const visibleResults = results.slice(0, MAX_RENDERED)

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
          {view === 'all' && glossary.status === 'error' ? (
            <QueryErrorState body={t('errors.body')} onRetry={glossary.retry} />
          ) : null}

          {view === 'all' && glossary.status === 'loading' ? (
            <div className="space-y-3" aria-live="polite" aria-label={t('common.loading')}>
              {Array.from({ length: 6 }, (_, i) => (
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

          {view === 'favourites' && favourites.length === 0 ? (
            <EmptyState
              icon={BookMarked}
              title={t('utils.glossary.view.favourites')}
              body={t('utils.glossary.favouritesEmpty')}
            />
          ) : null}

          {view === 'recents' && recents.length === 0 ? (
            <EmptyState
              icon={BookMarked}
              title={t('utils.glossary.view.recents')}
              body={t('utils.glossary.recentsEmpty')}
            />
          ) : null}

          {(view !== 'all' || glossary.status === 'ready') &&
          results.length === 0 &&
          (view === 'all' ||
            (view === 'favourites' && favourites.length > 0) ||
            (view === 'recents' && recents.length > 0)) ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{t('utils.glossary.empty')}</p>
          ) : null}

          <ul className="space-y-2">
            {visibleResults.map((term) => (
              <TermRow
                key={term.id}
                term={term}
                favourite={favouriteIds.has(term.id)}
                onToggleFavourite={(picked) => void toggle(picked)}
                onCopy={(picked) => void recordUsed(picked)}
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
          ? 'border-action bg-action font-semibold text-action-foreground'
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
