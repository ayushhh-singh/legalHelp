import { ClipboardCheck, FileText } from 'lucide-react'
import { useMemo } from 'react'
import { Link } from 'react-router-dom'

import { useChapterCards, useChapters } from '../useStudy'
import { toChapterQuizHref, toRevisionSheetHref, toUnitHref } from '../url'

import { Badge, SectionCard } from '@/components/ui-x'
import { useT } from '@/i18n/useT'
import type { LibraryWork } from '@/schemas/library'
import { cn } from '@/lib/utils'

export interface ChapterStudyListProps {
  /** Narrow on purpose: nothing here needs a work's text, source or citation. */
  work: Pick<LibraryWork, 'id' | 'toc' | 'practiseCounts'>
  className?: string
}

/**
 * The work's chapters, each with a quiz link, a sheet link and its own place in
 * the revision schedule.
 *
 * The quiz link is shown only where an approved card actually cites something
 * in the chapter — `practiseCounts` from the work file, never a 1.1 MB card
 * catalogue this page has no other reason to download (ADR-038 §2).
 */
export function ChapterStudyList({ work, className }: ChapterStudyListProps) {
  const { t, language } = useT()
  const chapters = useChapters(work)
  const cards = useChapterCards(work.id)

  const byId = useMemo(() => new Map((cards ?? []).map((card) => [card.id, card])), [cards])

  if (chapters.length === 0) return null

  return (
    <SectionCard className={className} aria-labelledby="chapter-study-heading">
      <div className="border-b border-border px-4 py-3">
        <h2 id="chapter-study-heading" className="text-sm font-semibold">
          {t('library.study.hub.reviseAndPlan')}
        </h2>
      </div>

      <ul className="flex flex-col divide-y divide-border">
        {chapters.map((chapter) => {
          const card = byId.get(chapter.id)
          const cited = chapter.unitIds.reduce((total, id) => total + (work.practiseCounts[id] ?? 0), 0)
          const first = chapter.unitIds[0]
          const heading = chapter.heading[language] || chapter.heading.en || chapter.number
          return (
            <li key={chapter.id} className="flex flex-wrap items-center gap-2 px-4 py-3">
              <span className="min-w-0 flex-1">
                {first ? (
                  <Link to={toUnitHref(work.id, first)} className="text-sm text-primary hover:underline">
                    {heading}
                  </Link>
                ) : (
                  <span className="text-sm">{heading}</span>
                )}
              </span>

              <Badge tone={card ? 'success' : 'neutral'}>
                {card
                  ? t('library.study.revise.rated', { date: card.due.slice(0, 10) })
                  : t('library.study.revise.neverRated')}
              </Badge>

              {cited > 0 ? (
                <Link
                  to={toChapterQuizHref(work.id, chapter.nodeId)}
                  className={cn(
                    'inline-flex min-h-11 items-center gap-1 rounded-full border border-border px-3 text-xs',
                    'transition-colors hover:border-input hover:bg-accent/50',
                  )}
                >
                  <ClipboardCheck aria-hidden="true" className="h-3 w-3" />
                  {t('library.study.quiz.title')}
                </Link>
              ) : null}

              <Link
                to={toRevisionSheetHref(work.id, chapter.nodeId)}
                className="inline-flex min-h-11 items-center gap-1 rounded-full border border-border px-3 text-xs transition-colors hover:border-input hover:bg-accent/50"
              >
                <FileText aria-hidden="true" className="h-3 w-3" />
                {t('library.study.sheet.open')}
              </Link>
            </li>
          )
        })}
      </ul>
    </SectionCard>
  )
}
