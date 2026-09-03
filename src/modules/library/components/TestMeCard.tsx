import { ClipboardCheck } from 'lucide-react'
import { Link } from 'react-router-dom'

import { toChapterQuizHref, toRevisionSheetHref } from '../url'

import { Badge, SectionCard } from '@/components/ui-x'
import { useT } from '@/i18n/useT'
import { type Chapter } from '@/lib/study'

export interface TestMeCardProps {
  chapter: Chapter | null
  /**
   * Approved Trainer cards citing any unit in this chapter, summed by the
   * caller from `work.practiseCounts` — a figure the WORK file already carries.
   */
  cited: number
  className?: string
}

/**
 * "Test me on this chapter" — the rail's third entry, and the last one that
 * costs nothing.
 *
 * The figure comes from `work.practiseCounts`, which the work file already
 * carries — `data/rules/cards` is 1.1 MB and downloading it to draw one line in
 * a rail is exactly what `practiseCounts` was put in the dataset to avoid
 * (ADR-038 §2). Zero there means no approved card cites this chapter at all, so
 * the link is not offered: a control that navigates to an empty page is the
 * failure mode ADR-039's second addendum is about.
 *
 * It is an UPPER BOUND rather than the quiz's own count, because the quiz draws
 * only the three kinds that have one right answer (`QUIZ_KINDS`), and a chapter
 * cited solely by cloze and rule cards would show a link to a quiz that then
 * reports none. That page is authoritative and says so in the reader's own
 * language; buying the exact figure here would cost every reader 1.1 MB.
 */
export function TestMeCard({ chapter, cited, className }: TestMeCardProps) {
  const { t, language } = useT()

  if (!chapter) return null

  const heading = chapter.heading[language] || chapter.heading.en || chapter.number

  return (
    <SectionCard className={className}>
      <div className="flex flex-col gap-3 p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <ClipboardCheck aria-hidden="true" className="h-4 w-4" />
          {t('library.study.quiz.title')}
        </h2>

        <p className="text-sm text-muted-foreground">{heading}</p>

        {cited > 0 ? (
          <>
            <Badge tone="neutral">{t('library.study.quiz.available', { count: cited })}</Badge>
            <Link
              to={toChapterQuizHref(chapter.workId, chapter.nodeId)}
              className="inline-flex min-h-11 items-center justify-center rounded-lg bg-action px-4 text-sm font-semibold text-action-foreground"
            >
              {t('library.study.quiz.start')}
            </Link>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{t('library.study.quiz.none')}</p>
        )}

        <Link
          to={toRevisionSheetHref(chapter.workId, chapter.nodeId)}
          className="inline-flex min-h-11 items-center text-sm text-primary hover:underline"
        >
          {t('library.study.sheet.open')}
        </Link>

        <p className="text-xs text-muted-foreground">{t('library.study.quiz.onlyApproved')}</p>
      </div>
    </SectionCard>
  )
}
