import { RotateCcw } from 'lucide-react'
import { useState } from 'react'

import { useChapterCard } from '../useStudy'

import { Badge, SectionCard } from '@/components/ui-x'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'
import { CONFIDENCE_LEVELS, forgetChapter, rateChapterCard, type Chapter, type Confidence } from '@/lib/study'

/**
 * "How confident are you with this chapter?" — the SECOND FSRS deck.
 *
 * The four buttons are FSRS's four grades relabelled. That is a relabelling
 * rather than a translation: 1-4 is exactly the shape of Again/Hard/Good/Easy,
 * and what the labels buy is that the reader does not have to think in the
 * Trainer's vocabulary. "I could not use it" is a thing an officer can answer
 * about a chapter they have just read; "Again" is not.
 *
 * The card explains that this is a separate schedule, because it is: a card
 * asks a question and grades the answer, and this asks whether the reader could
 * USE the chapter. Merging the two counts would make "15 due" mean nothing.
 */
interface ChapterRevisionCardProps {
  chapter: Chapter
  className?: string
}

export function ChapterRevisionCard({ chapter, className }: ChapterRevisionCardProps) {
  const { t, language } = useT()
  const card = useChapterCard(chapter.workId, chapter.nodeId)
  const [ratedUntil, setRatedUntil] = useState<string | null>(null)

  const rate = async (confidence: Confidence) => {
    const next = await rateChapterCard({ chapter, confidence })
    setRatedUntil(next.due.slice(0, 10))
  }

  const heading = chapter.heading[language] || chapter.heading.en || chapter.number

  return (
    <SectionCard className={className} aria-labelledby="chapter-revise-heading">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <RotateCcw aria-hidden="true" className="h-4 w-4 shrink-0" />
        <h2 id="chapter-revise-heading" className="text-sm font-semibold">
          {t('library.study.revise.title')}
        </h2>
        {card === null ? <Badge tone="neutral">{t('library.study.revise.neverRated')}</Badge> : null}
      </div>

      <div className="flex flex-col gap-3 p-4">
        <p className="text-sm">
          <span className="font-semibold">{heading}</span>
        </p>
        <p className="text-sm text-muted-foreground">{t('library.study.revise.confidence')}</p>

        <div role="group" aria-label={t('library.study.revise.confidence')} className="flex flex-col gap-2">
          {CONFIDENCE_LEVELS.map((level) => (
            <button
              key={level}
              type="button"
              onClick={() => void rate(level)}
              className="flex min-h-11 items-center gap-3 rounded-lg border border-border px-3 py-2 text-left text-sm transition-colors hover:border-input hover:bg-accent/50"
            >
              <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-muted font-sans text-xs font-semibold tabular-nums">
                {level}
              </span>
              <span>{t(`library.study.revise.level.${level}`)}</span>
            </button>
          ))}
        </div>

        {ratedUntil ? (
          <p role="status" className="text-sm text-tulsi-foreground">
            {t('library.study.revise.rated', { date: ratedUntil })}
          </p>
        ) : null}

        <p className="border-t border-border pt-3 text-xs text-muted-foreground">
          {t('library.study.revise.separate')}
        </p>

        {card ? (
          <div>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setRatedUntil(null)
                void forgetChapter(card.id)
              }}
            >
              {t('library.study.revise.forget')}
            </Button>
          </div>
        ) : null}
      </div>
    </SectionCard>
  )
}
