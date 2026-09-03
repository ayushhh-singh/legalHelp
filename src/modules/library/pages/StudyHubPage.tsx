import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'

import { useAllProgress, useLibraryIndex } from '../useLibrary'
import { useAllAttempts, useAllChapterLog, useAllSessions, useGoals } from '../useStudy'
import { toWorkHref } from '../url'

import { Badge, ProgressBar, SectionCard, Skeleton, StatCard } from '@/components/ui-x'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'
import { db } from '@/db'
import { goalProgress, weeklyReview, saveGoal } from '@/lib/study'
import { useNow } from '@/modules/trainer/useNow'

/**
 * `/library/study` — the weekly review and the goals.
 *
 * Everything here is arithmetic over rows this device already holds, and the
 * screen says so: there is no server that could know any of it. Nothing on it
 * blocks its render on a `useLiveQuery` — a device whose storage is refused
 * gets zeroes and an explanation, not a skeleton that never resolves.
 */
export default function StudyHubPage() {
  const { t, language } = useT()
  const now = useNow(60_000)

  const index = useLibraryIndex()
  const progress = useAllProgress()
  const sessions = useAllSessions()
  const chapterLog = useAllChapterLog()
  const attempts = useAllAttempts()
  const goals = useGoals()
  const reviewLog = useLiveQuery(() => db.reviewLog.toArray(), [], undefined)

  const review = useMemo(
    () =>
      weeklyReview({
        now,
        sessions: sessions ?? [],
        progress: progress ?? [],
        reviewLog: reviewLog ?? [],
        chapterLog: chapterLog ?? [],
        attempts: attempts ?? [],
      }),
    [attempts, chapterLog, now, progress, reviewLog, sessions],
  )

  const workLabel = (workId: string): string => {
    const entry = index.status === 'ready' ? index.data.works.find((row) => row.id === workId) : undefined
    return entry ? entry.shortTitle[language] || entry.shortTitle.en : workId
  }

  const unitsReadInWork = (workId: string): number =>
    (progress ?? []).filter((row) => row.workId === workId).length

  const byWork = Object.entries(review.minutesByWork).sort((a, b) => b[1] - a[1])
  const nothing =
    review.minutes === 0 &&
    review.unitsRead === 0 &&
    review.cardsReviewed === 0 &&
    review.chaptersRevised === 0 &&
    review.feynmanAttempts === 0

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4 md:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-xl font-semibold">{t('library.study.review.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('library.study.review.subtitle')}</p>
        <p className="text-sm text-muted-foreground">
          {t('library.study.review.week', { from: review.from, to: review.to })}
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <StatCard label={t('library.study.review.minutes')} value={String(review.minutes)} />
        <StatCard label={t('library.study.review.unitsRead')} value={String(review.unitsRead)} />
        <StatCard label={t('library.study.review.cardsReviewed')} value={String(review.cardsReviewed)} />
        <StatCard label={t('library.study.review.chaptersRevised')} value={String(review.chaptersRevised)} />
        <StatCard label={t('library.study.review.attempts')} value={String(review.feynmanAttempts)} />
        <StatCard
          label={t('library.study.revise.title')}
          value={
            review.streak > 0
              ? t('library.study.review.streak', { count: review.streak })
              : t('library.study.review.noStreak')
          }
        />
      </div>

      {nothing ? (
        <SectionCard>
          <p className="p-4 text-sm text-muted-foreground">{t('library.study.review.empty')}</p>
        </SectionCard>
      ) : null}

      {byWork.length > 0 ? (
        <SectionCard aria-labelledby="by-work-heading">
          <div className="border-b border-border px-4 py-3">
            <h2 id="by-work-heading" className="text-sm font-semibold">
              {t('library.study.review.byWork')}
            </h2>
          </div>
          <ul className="flex flex-col gap-3 p-4">
            {byWork.map(([workId, minutes]) => (
              <li key={workId} className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <Link to={toWorkHref(workId)} className="text-primary hover:underline">
                    {workLabel(workId)}
                  </Link>
                  <span className="font-sans tabular-nums">{minutes}</span>
                </div>
                <ProgressBar
                  value={review.minutes === 0 ? 0 : (minutes / review.minutes) * 100}
                  label={`${workLabel(workId)} — ${minutes}`}
                />
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}

      <SectionCard aria-labelledby="goals-heading">
        <div className="border-b border-border px-4 py-3">
          <h2 id="goals-heading" className="text-sm font-semibold">
            {t('library.study.goal.title')}
          </h2>
        </div>
        <div className="flex flex-col gap-4 p-4">
          {(goals ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('library.study.goal.none')}</p>
          ) : null}

          {(goals ?? []).map((goal) => {
            const state = goalProgress(goal, review, unitsReadInWork(goal.id))
            return (
              <div key={goal.id} className="flex flex-col gap-2 rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link
                    to={toWorkHref(goal.id)}
                    className="text-sm font-semibold text-primary hover:underline"
                  >
                    {workLabel(goal.id)}
                  </Link>
                  {state.met ? <Badge tone="success">{t('library.study.goal.met')}</Badge> : null}
                </div>
                {state.minutesTarget ? (
                  <p className="text-sm text-muted-foreground">
                    {t('library.study.goal.minutes')}:{' '}
                    {t('library.study.goal.progress', {
                      done: state.minutesDone,
                      target: state.minutesTarget,
                    })}
                  </p>
                ) : null}
                {state.unitsTarget ? (
                  <p className="text-sm text-muted-foreground">
                    {t('library.study.goal.units')}:{' '}
                    {t('library.study.goal.progress', { done: state.unitsDone, target: state.unitsTarget })}
                  </p>
                ) : null}
                {state.fraction !== null ? (
                  <ProgressBar value={state.fraction * 100} label={workLabel(goal.id)} />
                ) : null}
                <div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void saveGoal(goal.id, { minutesPerWeek: null, unitsPerWeek: null })}
                  >
                    {t('library.study.goal.clear')}
                  </Button>
                </div>
              </div>
            )
          })}

          {index.status === 'loading' ? <Skeleton className="h-10 w-full" /> : null}
          {index.status === 'ready' ? (
            <GoalEditor workIds={index.data.works.map((w) => w.id)} label={workLabel} />
          ) : null}

          <p className="text-xs text-muted-foreground">{t('library.study.goal.hint')}</p>
        </div>
      </SectionCard>

      <p className="text-xs text-muted-foreground">{t('library.study.review.localOnly')}</p>
    </div>
  )
}

function GoalEditor({ workIds, label }: { workIds: readonly string[]; label: (id: string) => string }) {
  const { t } = useT()
  const [workId, setWorkId] = useState(workIds[0] ?? '')
  const [minutes, setMinutes] = useState('')
  const [units, setUnits] = useState('')

  const save = async () => {
    if (!workId) return
    await saveGoal(workId, {
      minutesPerWeek: minutes.trim() ? Number(minutes) : null,
      unitsPerWeek: units.trim() ? Number(units) : null,
    })
    setMinutes('')
    setUnits('')
  }

  return (
    <div className="flex flex-wrap items-end gap-3 border-t border-border pt-4">
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-xs font-semibold text-muted-foreground uppercase">
          {t('library.mine.filterWork')}
        </span>
        <select
          value={workId}
          onChange={(event) => setWorkId(event.target.value)}
          className="min-h-11 rounded-lg border border-input bg-card px-3 text-sm"
        >
          {workIds.map((id) => (
            <option key={id} value={id}>
              {label(id)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-xs font-semibold text-muted-foreground uppercase">
          {t('library.study.goal.minutes')}
        </span>
        <input
          type="number"
          min={0}
          inputMode="numeric"
          value={minutes}
          onChange={(event) => setMinutes(event.target.value)}
          className="min-h-11 w-28 rounded-lg border border-input bg-card px-3 text-sm tabular-nums"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-xs font-semibold text-muted-foreground uppercase">
          {t('library.study.goal.units')}
        </span>
        <input
          type="number"
          min={0}
          inputMode="numeric"
          value={units}
          onChange={(event) => setUnits(event.target.value)}
          className="min-h-11 w-28 rounded-lg border border-input bg-card px-3 text-sm tabular-nums"
        />
      </label>
      <Button type="button" onClick={() => void save()}>
        {t('library.study.goal.save')}
      </Button>
    </div>
  )
}
