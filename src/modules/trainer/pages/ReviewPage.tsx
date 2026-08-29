import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft, PartyPopper } from 'lucide-react'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { CardAiActions } from '../components/CardAiActions'
import { CardView } from '../components/CardView'
import { submitReport, toggleBookmark } from '../store'
import { useEffectiveCatalogue } from '../useCatalogue'
import { useNow } from '../useNow'
import { useTrainerSettings } from '../useTrainerSettings'
import { activeWrongAnswerFor, type WrongAnswerRecord } from '../wrongAnswer'

import { useAi } from '@/ai/useAi'
import { EmptyState } from '@/components/common/EmptyState'
import { PageHeader } from '@/components/common/PageHeader'
import { SectionCard, Skeleton } from '@/components/ui-x'
import { Button } from '@/components/ui/button'
import { db } from '@/db'
import { useT } from '@/i18n/useT'
import { getDueQueue, reviewCard, type Grade } from '@/lib/srs'

const REPORT_REASONS = ['wrongAnswer', 'unclear', 'typo', 'duplicate', 'other'] as const

/**
 * `/learn/review?act=<id>` — one card at a time.
 *
 * The queue is a `useLiveQuery` over `getDueQueue`, so grading a card (which
 * writes `srsCards`/`reviewLog`/`streaks` inside one Dexie transaction) makes
 * the live query re-run on its own and hand back the next item — there is no
 * "advance the index" state here at all, which is what keeps this correct
 * when a card graded `Again` comes straight back a minute later.
 */
export default function ReviewPage() {
  const { t, language } = useT()
  const ai = useAi()
  const now = useNow(5_000)
  const [searchParams] = useSearchParams()
  const actFilter = searchParams.get('act')

  const catalogue = useEffectiveCatalogue()
  const settings = useTrainerSettings()
  const acts = actFilter ? [actFilter] : settings?.actsEnabled

  const queue = useLiveQuery(
    () => (catalogue && settings ? getDueQueue(catalogue, now, acts) : Promise.resolve(null)),
    [catalogue, settings, now, actFilter],
    undefined,
  )
  const current = queue?.[0] ?? null
  const bookmarked = useLiveQuery(
    () => (current ? db.trainerBookmarks.get(current.qId).then((row) => Boolean(row)) : Promise.resolve(false)),
    [current?.qId],
    false,
  )

  const [reportOpen, setReportOpen] = useState(false)
  const [reportReason, setReportReason] = useState<(typeof REPORT_REASONS)[number]>('wrongAnswer')
  const [reportNote, setReportNote] = useState('')
  const [reportSaved, setReportSaved] = useState(false)
  /**
   * Filtered at read time below via `activeWrongAnswerFor` — not reset by an
   * effect watching `current?.qId`, which `react-hooks/set-state-in-effect`
   * is right to reject: a `setState` inside an effect body cascades a render
   * for state that is trivially derivable from props already in hand.
   */
  const [wrongAnswer, setWrongAnswer] = useState<WrongAnswerRecord | null>(null)
  const activeWrongAnswer = activeWrongAnswerFor(wrongAnswer, current)

  if (!catalogue || !settings || queue == null) {
    return (
      <div className="mx-auto max-w-2xl">
        <Skeleton className="h-80 w-full" />
      </div>
    )
  }

  const handleGrade = async (grade: Grade, durationMs: number) => {
    if (!current) return
    setReportOpen(false)
    setReportSaved(false)
    await reviewCard({ catalogue, qId: current.qId, grade, now: new Date(), durationMs })
  }

  const handleReportSubmit = async () => {
    if (!current) return
    await submitReport(current.qId, reportReason, reportNote)
    setReportNote('')
    setReportOpen(false)
    setReportSaved(true)
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <PageHeader
        title={t('trainer.review.title')}
        subtitle={queue.length > 0 ? t('trainer.review.remaining', { count: queue.length }) : undefined}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/learn">
              <ArrowLeft aria-hidden="true" />
              {t('trainer.review.backHome')}
            </Link>
          </Button>
        }
      />

      {reportSaved ? (
        <p role="status" className="rounded-md bg-tulsi/15 p-2 text-sm text-tulsi-foreground">
          {t('trainer.review.reportSaved')}
        </p>
      ) : null}

      {current ? (
        <>
          <CardView
            key={current.qId}
            card={current.card}
            language={language}
            srsRow={current.srs}
            now={now}
            desiredRetention={settings.desiredRetention}
            bookmarked={Boolean(bookmarked)}
            onGrade={(grade, durationMs) => void handleGrade(grade, durationMs)}
            onToggleBookmark={() => void toggleBookmark(current.qId)}
            onReport={() => setReportOpen((open) => !open)}
            onAnswered={(result) =>
              setWrongAnswer(result.correct ? null : { qId: current.qId, due: current.srs?.due ?? null, ...result })
            }
          />

          {ai.enabled ? (
            <CardAiActions key={current.qId} ai={ai} card={current.card} wrongAnswer={activeWrongAnswer} />
          ) : null}

          {reportOpen ? (
            <SectionCard className="p-4">
              <h2 className="text-sm font-semibold">{t('trainer.review.reportTitle')}</h2>
              <label className="mt-3 block text-xs font-medium text-muted-foreground" htmlFor="report-reason">
                {t('trainer.review.reportReasonLabel')}
              </label>
              <select
                id="report-reason"
                value={reportReason}
                onChange={(event) => setReportReason(event.target.value as (typeof REPORT_REASONS)[number])}
                className="mt-1 h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {REPORT_REASONS.map((reason) => (
                  <option key={reason} value={reason}>
                    {t(`trainer.review.reasons.${reason}`)}
                  </option>
                ))}
              </select>
              <label className="mt-3 block text-xs font-medium text-muted-foreground" htmlFor="report-note">
                {t('trainer.review.reportNoteLabel')}
              </label>
              <textarea
                id="report-note"
                value={reportNote}
                onChange={(event) => setReportNote(event.target.value)}
                placeholder={t('trainer.review.reportNotePlaceholder')}
                rows={3}
                className="mt-1 w-full rounded-md border border-input bg-background p-3 text-sm"
              />
              <div className="mt-3 flex gap-2">
                <Button type="button" size="sm" onClick={() => void handleReportSubmit()}>
                  {t('trainer.review.reportSubmit')}
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => setReportOpen(false)}>
                  {t('trainer.review.reportCancel')}
                </Button>
              </div>
            </SectionCard>
          ) : null}
        </>
      ) : (
        <EmptyState
          icon={PartyPopper}
          title={t('trainer.review.sessionComplete')}
          body={t('trainer.review.sessionCompleteBody')}
          action={
            <Button asChild>
              <Link to="/learn">{t('trainer.review.backHome')}</Link>
            </Button>
          }
        />
      )}
    </div>
  )
}
