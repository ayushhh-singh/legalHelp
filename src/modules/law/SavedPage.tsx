import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft, Bookmark, Clock, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'

import { clearRecents, listFavourites, listRecents, removeFavouriteById } from './saved'
import { toLawHref } from './url'

import { EmptyState } from '@/components/common/EmptyState'
import { PageHeader } from '@/components/common/PageHeader'
import { SectionCard, SectionNumber } from '@/components/ui-x'
import { Button } from '@/components/ui/button'
import type { Language } from '@/i18n'
import { useT } from '@/i18n/useT'

/**
 * `/law/saved` — saved sections and recent lookups.
 *
 * `useLiveQuery` rather than a load-once effect: removing a favourite from this
 * page must update the list without a refetch, and saving one from a card in
 * another tab of the same browser should show up here too. Both lists render
 * from the snapshot stored in the row, so this page works with no section
 * tables loaded at all — the point of storing the heading alongside the key.
 */
export default function SavedPage() {
  const { t, language } = useT()

  const favourites = useLiveQuery(() => listFavourites(), [], undefined)
  const recents = useLiveQuery(() => listRecents(), [], undefined)

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <PageHeader
        as="h2"
        title={t('law.saved.title')}
        subtitle={t('law.saved.subtitle')}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/law">
              <ArrowLeft aria-hidden="true" />
              {t('law.nav.converter')}
            </Link>
          </Button>
        }
      />

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Bookmark aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
          {t('law.saved.favourites')}
        </h2>

        {favourites && favourites.length === 0 ? (
          <SectionCard>
            <EmptyState
              icon={Bookmark}
              title={t('law.saved.favouritesEmptyTitle')}
              body={t('law.saved.favouritesEmptyBody')}
              className="border-0 bg-transparent"
            />
          </SectionCard>
        ) : null}

        {favourites && favourites.length > 0 ? (
          <ul
            aria-label={t('law.saved.favourites')}
            className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card"
          >
            {favourites.map((row) => (
              <li key={row.id} className="flex items-center gap-3 p-3">
                <Link
                  to={hrefFor(row.act, row.section)}
                  className="flex min-h-11 min-w-0 flex-1 flex-col justify-center rounded-md"
                >
                  <span className="flex items-center gap-2">
                    <SectionNumber>
                      {row.act} {row.section}
                    </SectionNumber>
                  </span>
                  <span className="mt-1 line-clamp-1 text-sm text-muted-foreground">
                    {headingOf(row.heading, language)}
                  </span>
                </Link>
                <button
                  type="button"
                  onClick={() => void removeFavouriteById(row.id)}
                  aria-label={t('law.saved.remove', { act: row.act, section: row.section })}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <Trash2 aria-hidden="true" className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Clock aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
            {t('law.saved.recents')}
          </h2>
          {recents && recents.length > 0 ? (
            <Button type="button" variant="outline" size="sm" onClick={() => void clearRecents()}>
              {t('law.saved.clearRecents')}
            </Button>
          ) : null}
        </div>

        {recents && recents.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('law.saved.recentsEmpty')}</p>
        ) : null}

        {recents && recents.length > 0 ? (
          <ul
            aria-label={t('law.saved.recents')}
            className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card"
          >
            {recents.map((row) => (
              <li key={row.id}>
                <Link
                  to={row.query ? hrefForQuery(row.query) : hrefFor(row.act, row.section)}
                  className="flex min-h-14 flex-col justify-center gap-1 px-3 py-2"
                >
                  <span className="flex items-center gap-2">
                    <SectionNumber>
                      {row.act} {row.section}
                    </SectionNumber>
                  </span>
                  <span className="line-clamp-1 text-sm text-muted-foreground">
                    {headingOf(row.heading, language)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  )
}

const headingOf = (heading: { en: string; hi: string }, language: Language) => heading[language] || heading.en

/** Opening a saved section is a new-Act lookup by its own number. */
const hrefFor = (act: string, section: string) =>
  toLawHref({ query: `${act} ${section}`, code: null, direction: 'new-old', date: null })

/** A recent lookup replays the search that produced it. */
const hrefForQuery = (query: string) => toLawHref({ query, code: null, direction: 'old-new', date: null })
