import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft, Bookmark } from 'lucide-react'
import { Link } from 'react-router-dom'

import { toggleBookmark } from '../store'
import { useEffectiveCatalogue } from '../useCatalogue'

import { EmptyState } from '@/components/common/EmptyState'
import { PageHeader } from '@/components/common/PageHeader'
import { Chip, Skeleton } from '@/components/ui-x'
import { Button } from '@/components/ui/button'
import { db } from '@/db'
import { useT } from '@/i18n/useT'

/** `/learn/bookmarks` — cards saved outside the FSRS schedule, newest first. */
export default function BookmarksPage() {
  const { t, language } = useT()
  const catalogue = useEffectiveCatalogue()
  const bookmarks = useLiveQuery(
    () => db.trainerBookmarks.orderBy('createdAt').reverse().toArray(),
    [],
    undefined,
  )

  if (!catalogue || bookmarks === undefined) {
    return (
      <div className="mx-auto max-w-2xl">
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  const cardById = new Map(catalogue.map((card) => [card.id, card]))
  const rows = bookmarks.map((row) => ({ row, card: cardById.get(row.qId) })).filter((entry) => entry.card)

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <PageHeader
        title={t('trainer.bookmarks.title')}
        subtitle={t('trainer.bookmarks.subtitle')}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/learn">
              <ArrowLeft aria-hidden="true" />
              {t('trainer.review.backHome')}
            </Link>
          </Button>
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={Bookmark}
          title={t('trainer.bookmarks.emptyTitle')}
          body={t('trainer.bookmarks.emptyBody')}
        />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
          {rows.map(({ row, card }) => (
            <li key={row.qId} className="flex items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <Chip tone="marigold">{card!.ruleRef.citation[language] || card!.ruleRef.citation.en}</Chip>
                <p className="mt-1 truncate text-sm">{card!.front[language] || card!.front.en}</p>
              </div>
              <Button asChild size="sm" variant="outline">
                <Link to={`/learn/review?act=${encodeURIComponent(card!.act)}`}>
                  {t('trainer.bookmarks.reviewThis')}
                </Link>
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label={t('trainer.bookmarks.remove')}
                onClick={() => void toggleBookmark(row.qId)}
              >
                <Bookmark aria-hidden="true" className="fill-marigold text-marigold" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
