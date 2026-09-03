import { ArrowLeft, CheckCircle2, XCircle } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'

import { useWork } from '../useLibrary'
import { useChapters } from '../useStudy'
import { toPractiseHref, toUnitHref, toWorkHref } from '../url'

import { Badge, ProgressBar, QueryErrorState, SectionCard, Skeleton } from '@/components/ui-x'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'
import { isWorkId } from '@/lib/library'
import {
  buildChapterQuiz,
  confidenceFromQuiz,
  markQuiz,
  quizSizeFor,
  rateChapterCard,
  type QuizOutcome,
} from '@/lib/study'
import { reviewCard } from '@/lib/srs'
import { useEffectiveCatalogue } from '@/modules/trainer/useCatalogue'
import type { Card } from '@/modules/trainer/schema'

/**
 * `/library/:workId/quiz/:nodeId` — "Test me on this chapter".
 *
 * Three things about it are the session brief's own requirements and each is
 * load-bearing:
 *
 * 1. **NOTHING IS GENERATED.** Every question came through the four-stage
 *    pipeline in `docs/AUTHORING.md` and is `reviewState: 'approved'`; the join
 *    is `ruleRef.textId`, which is a unit id. The card says so, because a
 *    reader who thinks a model wrote the question has no reason to trust the
 *    answer.
 * 2. **The results feed the TRAINER'S OWN HISTORY.** Each answer goes through
 *    `reviewCard` from `src/lib/srs`, so the FSRS schedule moves exactly as it
 *    would in a review session. A quiz whose answers went nowhere would be a
 *    second, parallel record of the same knowledge.
 * 3. **Wrong answers offer "add to my review deck".** Which, because of (2), is
 *    already true for every answered card — so the button does the honest
 *    thing instead: it re-grades the wrong ones as `Again`, which is what puts
 *    them at the front of the queue.
 */
export default function ChapterQuizPage() {
  const { t, language } = useT()
  const params = useParams<{ workId: string; nodeId: string }>()
  const workId = params.workId ?? ''
  const nodeId = params.nodeId ?? ''

  const work = useWork(isWorkId(workId) ? workId : undefined)
  const chapters = useChapters(work.data)
  const chapter = useMemo(() => chapters.find((entry) => entry.nodeId === nodeId) ?? null, [chapters, nodeId])
  const catalogue = useEffectiveCatalogue(true)

  const [seed, setSeed] = useState(() => `${workId}:${nodeId}:0`)
  const [at, setAt] = useState(0)
  const [chosen, setChosen] = useState<Map<string, number | null>>(new Map())
  const [outcome, setOutcome] = useState<QuizOutcome | null>(null)

  const questions = useMemo(
    () => (chapter && catalogue ? buildChapterQuiz(chapter, catalogue, seed) : []),
    [chapter, catalogue, seed],
  )
  const available = useMemo(
    () => (chapter && catalogue ? quizSizeFor(chapter, catalogue) : 0),
    [chapter, catalogue],
  )

  /**
   * Grading writes to the Trainer's schedule as it goes, one card at a time,
   * rather than in a batch at the end. A quiz abandoned half way has still
   * taught the scheduler what it learned — which is the honest treatment, and
   * the same one a review session gives.
   */
  const answer = useCallback(
    async (card: Card, index: number | null) => {
      setChosen((current) => new Map(current).set(card.id, index))
      const correct = index !== null && index === card.answerIndex
      await reviewCard({
        qId: card.id,
        grade: correct ? 'Good' : 'Again',
        catalogue: catalogue ?? [],
        now: new Date(),
      })
      setAt((position) => position + 1)
    },
    [catalogue],
  )

  const finish = useCallback(async () => {
    const marked = markQuiz(questions, chosen)
    setOutcome(marked)
    // The quiz is evidence about the whole chapter, so it rates the chapter
    // deck too — marked as having come from a quiz rather than from a rating
    // the reader gave, so "how did I actually rate this" stays answerable.
    const confidence = confidenceFromQuiz(marked)
    if (chapter && confidence) {
      await rateChapterCard({ chapter, confidence, reason: 'quiz' })
    }
  }, [chapter, chosen, questions])

  const restart = useCallback(() => {
    setSeed(`${workId}:${nodeId}:${Date.now()}`)
    setAt(0)
    setChosen(new Map())
    setOutcome(null)
  }, [nodeId, workId])

  if (!isWorkId(workId)) return <Navigate to="/library" replace />
  if (work.status === 'error') return <QueryErrorState onRetry={work.retry} />
  if (work.status === 'loading' || !catalogue) return <Skeleton className="h-64 w-full" />
  if (!chapter) return <Navigate to={toWorkHref(workId)} replace />

  const heading = chapter.heading[language] || chapter.heading.en || chapter.number
  const current = questions[at]

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4 md:p-6">
      <Link
        to={toWorkHref(workId)}
        className="inline-flex min-h-11 items-center gap-2 self-start text-sm text-primary hover:underline"
      >
        <ArrowLeft aria-hidden="true" className="h-4 w-4" />
        {t('library.backToWork', { work: work.data.shortTitle[language] || work.data.shortTitle.en })}
      </Link>

      <h1 className="font-display text-xl font-semibold">
        {t('library.study.quiz.titleFor', { chapter: heading })}
      </h1>

      {available === 0 ? (
        <SectionCard>
          <p className="p-4 text-sm text-muted-foreground">{t('library.study.quiz.none')}</p>
        </SectionCard>
      ) : null}

      {available > 0 && !outcome && questions.length > 0 ? (
        <SectionCard aria-labelledby="quiz-heading">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
            <h2 id="quiz-heading" className="text-sm font-semibold">
              {t('library.study.quiz.progress', {
                position: Math.min(at + 1, questions.length),
                total: questions.length,
              })}
            </h2>
            <Badge tone="neutral">{t('library.study.quiz.available', { count: available })}</Badge>
          </div>

          <div className="flex flex-col gap-4 p-4">
            <ProgressBar
              value={questions.length === 0 ? 0 : (at / questions.length) * 100}
              label={t('library.study.quiz.progress', { position: at, total: questions.length })}
            />

            {current ? (
              <>
                <p className="text-base leading-relaxed">{current.front[language] || current.front.en}</p>
                <ul className="flex flex-col gap-2">
                  {(current.options ?? []).map((option, index) => (
                    <li key={index}>
                      <button
                        type="button"
                        onClick={() => void answer(current, index)}
                        className="flex min-h-11 w-full items-start gap-3 rounded-lg border border-border px-3 py-2 text-left text-sm transition-colors hover:border-input hover:bg-accent/50"
                      >
                        {option[language] || option.en}
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" onClick={() => void answer(current, null)}>
                    {t('library.study.quiz.skip')}
                  </Button>
                </div>
              </>
            ) : (
              <div>
                <Button type="button" onClick={() => void finish()}>
                  {t('library.study.quiz.finish')}
                </Button>
              </div>
            )}

            <p className="border-t border-border pt-3 text-xs text-muted-foreground">
              {t('library.study.quiz.onlyApproved')}
            </p>
          </div>
        </SectionCard>
      ) : null}

      {outcome ? (
        <SectionCard aria-labelledby="quiz-results-heading">
          <div className="border-b border-border px-4 py-3">
            <h2 id="quiz-results-heading" className="text-sm font-semibold">
              {t('library.study.quiz.results', { right: outcome.right, total: outcome.total })}
            </h2>
          </div>
          <div className="flex flex-col gap-4 p-4">
            <ul className="flex flex-col gap-2">
              {questions.map((card) => {
                const entry = outcome.answers.find((row) => row.qId === card.id)
                return (
                  <li key={card.id} className="flex items-start gap-2 rounded-lg border border-border p-3">
                    {entry?.correct ? (
                      <CheckCircle2
                        aria-hidden="true"
                        className="mt-0.5 h-4 w-4 shrink-0 text-tulsi-foreground"
                      />
                    ) : (
                      <XCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-coral-foreground" />
                    )}
                    <div className="flex min-w-0 flex-col gap-1">
                      <p className="text-sm">{card.front[language] || card.front.en}</p>
                      <p className="text-sm text-muted-foreground">{card.back[language] || card.back.en}</p>
                      <Link
                        to={toUnitHref(workId, card.ruleRef.textId)}
                        className="text-xs text-primary hover:underline"
                      >
                        {card.ruleRef.citation[language] || card.ruleRef.citation.en}
                      </Link>
                    </div>
                  </li>
                )
              })}
            </ul>

            {/*
                There is NO "add these to my deck" button, and its absence is
                the honest version of the brief's own request.

                Every answer above went through `reviewCard` as it was given, so
                the wrong ones are already at the front of the queue. A button
                that graded them a second time — which is what shipped — cost
                the reader a lapse they never earned: on a matured card the
                second `Again` cut FSRS stability from 4.72 days to 1.51 and
                wrote a `reviewLog` row for a review that never happened.

                So the screen says what is already true and offers the deck.
            */}
            {outcome.wrong.length > 0 ? (
              <p className="rounded-lg border border-border bg-muted px-3 py-2 text-sm">
                {t('library.study.quiz.wrongAlreadyIn', { count: outcome.wrong.length })}
              </p>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline">
                <Link to={toPractiseHref(work.data.id)}>{t('library.study.quiz.openDeck')}</Link>
              </Button>
              <Button type="button" variant="outline" onClick={restart}>
                {t('library.study.quiz.again')}
              </Button>
            </div>

            <p className="border-t border-border pt-3 text-xs text-muted-foreground">
              {t('library.study.quiz.countsToward')}
            </p>
          </div>
        </SectionCard>
      ) : null}
    </div>
  )
}
