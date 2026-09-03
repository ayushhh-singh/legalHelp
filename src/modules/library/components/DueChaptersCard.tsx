import { RotateCcw } from 'lucide-react'
import { Link } from 'react-router-dom'

import { useDueChaptersEverywhere } from '../useStudy'
import { toUnitHref } from '../url'

import { Badge, SectionCard } from '@/components/ui-x'
import { useT } from '@/i18n/useT'
import { useNow } from '@/modules/trainer/useNow'
import { cn } from '@/lib/utils'

export interface DueChaptersCardProps {
  /** How many rows to draw. The rest are behind the count. */
  limit?: number
  className?: string
}

/**
 * "Chapters to revise" — the chapter deck's own due list, on both hubs.
 *
 * Each row opens the chapter's FIRST UNIT rather than a dedicated revision
 * screen, because revising a chapter is reading it again: the rating control is
 * in the reader's rail, where the reader is when they can actually judge their
 * own confidence.
 *
 * Renders nothing when there is nothing due. A card that says "nothing to
 * revise" on the busiest screen in the app is a row of chrome that will be true
 * for most readers most days.
 */
export function DueChaptersCard({ limit = 5, className }: DueChaptersCardProps) {
  const { t, language } = useT()
  const now = useNow(60_000)
  const due = useDueChaptersEverywhere(now)

  // `undefined` is "still asking" — Dexie, or a work file still arriving.
  // Nothing blocks on it; the card simply is not there yet.
  if (!due || due.length === 0) return null

  const shown = due.slice(0, limit)

  return (
    <SectionCard className={cn('flex flex-col gap-3 p-4', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <RotateCcw aria-hidden="true" className="h-4 w-4" />
          {t('library.study.revise.heading')}
        </h2>
        <Badge tone="warning">{t('library.study.revise.due', { count: due.length })}</Badge>
      </div>

      <ul className="flex flex-col gap-1">
        {shown.map(({ chapter }) => {
          const heading = chapter.heading[language] || chapter.heading.en || chapter.number
          const first = chapter.unitIds[0]
          if (!first) return null
          return (
            <li key={chapter.id}>
              <Link
                to={toUnitHref(chapter.workId, first)}
                className="flex min-h-11 items-center rounded-lg px-2 text-sm text-primary hover:bg-accent/50 hover:underline"
              >
                {t('library.study.revise.dueIn', { chapter: heading })}
              </Link>
            </li>
          )
        })}
      </ul>

      <p className="text-xs text-muted-foreground">{t('library.study.revise.separate')}</p>
    </SectionCard>
  )
}
