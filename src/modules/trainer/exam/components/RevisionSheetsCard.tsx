import { FileText } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { useAsync } from '../../useCatalogue'

import { SectionCard, Skeleton } from '@/components/ui-x'
import { useT } from '@/i18n/useT'
import { actsOf } from '@/lib/exam'

import type { ExamProfile } from '@/schemas/exam'

/**
 * The printable revision sheets, reached from exam mode.
 *
 * **Nothing new is built here.** A sheet is Session 28's — one printable page
 * per chapter, assembled from that chapter's study aids, the reader's own
 * highlights and notes and the quick-reference rows extracted from the same
 * text — and this card is a set of links into `/library/:workId/sheet/:nodeId`.
 * `?mode=24h` is the same route's 24-hour mode, which is a DIFFERENT sheet
 * rather than a shorter one: what survives is the trap, the number and what the
 * reader themselves wrote down.
 *
 * ## Why it is behind a `<details>`
 *
 * Listing the sheets means knowing each work's chapters, and a chapter list
 * comes from the work file — 8 to 220 KB each, and the CSS profile draws on
 * eight of them. Loading all eight to draw a card the reader may not open would
 * charge every visit to the readiness screen for a link list. The `<details>`
 * is what makes the cost the reader's own decision, and `useAsync` is gated on
 * it being open.
 *
 * Works are loaded with `allSettled`, never `Promise.all`: one failed chunk
 * must not make the whole list vanish, which is the defect ADR-040's addendum
 * records `useDueChaptersEverywhere` shipping — a list that disappears is worse
 * than a short one, because the reader concludes there is nothing there.
 */
export function RevisionSheetsCard({ profile }: { profile: ExamProfile }) {
  const { t, language } = useT()
  const [open, setOpen] = useState(false)

  const acts = actsOf(profile)

  const state = useAsync(
    async () => {
      const [library, study] = await Promise.all([import('@/lib/library'), import('@/lib/study')])
      const works = await Promise.allSettled(
        acts.filter((act) => library.isWorkId(act)).map((act) => library.loadWork(act)),
      )
      return works
        .filter((result) => result.status === 'fulfilled')
        .map((result) => result.value)
        .map((work) => ({ work, chapters: study.chaptersOf(work) }))
        .filter((entry) => entry.chapters.length > 0)
    },
    `exam-sheets:${profile.id}`,
    open,
  )

  return (
    <SectionCard className="p-4">
      <details onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
          <FileText aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
          {t('trainer.exam.revision.title')}
        </summary>
        <p className="mt-2 text-sm text-muted-foreground">{t('trainer.exam.revision.subtitle')}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {t('trainer.exam.revision.twentyFourHour')} — {t('trainer.exam.revision.twentyFourHourHint')}
        </p>

        {!open || state.status === 'loading' ? (
          <Skeleton className="mt-3 h-24 w-full" />
        ) : state.status === 'error' || state.data.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">{t('trainer.exam.revision.none')}</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-4">
            {state.data.map(({ work, chapters }) => (
              <li key={work.id}>
                <h3 className="text-sm font-medium">{work.shortTitle[language] || work.shortTitle.en}</h3>
                <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1.5">
                  {chapters.map((chapter) => (
                    <li key={chapter.id} className="flex items-center gap-1.5 text-sm">
                      <Link
                        to={`/library/${work.id}/sheet/${chapter.nodeId}`}
                        className="text-primary underline-offset-4 hover:underline"
                      >
                        {chapter.number}
                      </Link>
                      <Link
                        to={`/library/${work.id}/sheet/${chapter.nodeId}?mode=24h`}
                        className="text-xs text-muted-foreground underline-offset-4 hover:underline"
                        aria-label={`${chapter.number} — ${t('trainer.exam.revision.twentyFourHour')}`}
                      >
                        24h
                      </Link>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </details>
    </SectionCard>
  )
}
