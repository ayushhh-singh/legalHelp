import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft, BookOpen, Brain, FileText, ListChecks } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { knowsProfile, useActiveExam, useExamProfile, useSrsStates } from './useExam'

import { useEffectiveCatalogue } from '../useCatalogue'
import { useNow } from '../useNow'

import { PageHeader } from '@/components/common/PageHeader'
import { db } from '@/db'
import { Chip, InfoCard, QueryErrorState, SectionCard, Skeleton } from '@/components/ui-x'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'
import { buildPlan, DEFAULT_DAILY_MINUTES, type PlanDay, type PlanTask } from '@/lib/exam'
import { WORK_IDS } from '@/lib/library/data'
import { istDay } from '@/lib/srs'

import type { ExamProfile } from '@/schemas/exam'

/** A fortnight is what fits on a phone without a "show all" being a lie. */
const PREVIEW_DAYS = 14

/**
 * `/learn/exam/plan` — the day-by-day plan.
 *
 * Rebuilt on every render from the profile, the live schedule and today's date.
 * **It is never stored**, and the card at the top says so: a stored plan is out
 * of date the moment a card is graded, and a reader who has raced ahead on the
 * Leave Rules should not be sent back to them on Thursday because a plan
 * written on Monday said so.
 *
 * `WORK_IDS` is imported from the Library's own loader map rather than assumed
 * equal to the act ids. They are equal today for all twelve rule books; a plan
 * that relied on that would start pointing at a dead route the first time one
 * is renamed. It is a static array of strings — importing it pulls the loader
 * map, whose values are unevaluated `import()` thunks, and none of the 1.8 MB
 * behind them.
 */
export default function ExamPlanPage() {
  const { t } = useT()
  const choice = useActiveExam()

  // The header renders while the Dexie row is still being read, for the
  // reason `ExamHubPage` states: a screen with no `<h1>` is a screen a
  // reader tabbing in cannot place, and the title is known before the row.
  if (choice === undefined) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <PageHeader title={t('trainer.exam.plan.title')} />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }
  /*
    `null` is "nothing chosen"; an id this build cannot load takes the SAME
    branch, because from the reader's side it is the same situation and the
    picker is the only honest exit. A row naming a withdrawn or renamed profile
    used to leave this screen on a skeleton for ever.
  */
  if (choice === null || !knowsProfile(choice.id)) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <PageHeader title={t('trainer.exam.plan.title')} />
        <p className="text-sm text-muted-foreground">{t('trainer.exam.readiness.empty')}</p>
        <Button asChild size="sm">
          <Link to="/learn/exam">{t('trainer.exam.picker.title')}</Link>
        </Button>
      </div>
    )
  }

  return <PlanFor profileId={choice.id} targetDate={choice.targetDate} dailyMinutes={choice.dailyMinutes} />
}

function PlanFor({
  profileId,
  targetDate,
  dailyMinutes,
}: {
  profileId: string
  targetDate: string | null
  dailyMinutes: number | null
}) {
  const { t, language } = useT()
  const now = useNow(60_000)
  const state = useExamProfile(profileId)
  const catalogue = useEffectiveCatalogue()
  const states = useSrsStates()
  /*
    The reader's Session 28 study goals, which `dailyBudget` reads and which the
    first version of this screen never passed — so the goals branch was dead
    from the only place that calls it, and the card underneath still read "Taken
    from your weekly Library goal" whenever no explicit budget was set. That is
    worse than a hidden branch: it is a false sentence on the screen.

    Read straight off Dexie rather than through `src/lib/study`, which would
    pull the chapter deck, the quiz and the session timer into this chunk to
    answer a question about one number.
  */
  const goals = useLiveQuery(() => db.studyGoals.toArray(), [], undefined)
  const [showAll, setShowAll] = useState(false)

  const plan = useMemo(() => {
    if (state.status !== 'ready' || !catalogue || !states || !goals || !targetDate) return null
    return buildPlan({
      profile: state.data,
      catalogue,
      states,
      now,
      targetDate,
      libraryWorkIds: WORK_IDS,
      goals,
      ...(dailyMinutes === null ? {} : { dailyMinutes }),
    })
  }, [state, catalogue, states, goals, now, targetDate, dailyMinutes])

  const header = (
    <PageHeader
      title={t('trainer.exam.plan.title')}
      subtitle={t('trainer.exam.plan.subtitle')}
      actions={
        <Button asChild variant="outline" size="sm">
          <Link to="/learn/exam">
            <ArrowLeft aria-hidden="true" />
            {t('trainer.exam.title')}
          </Link>
        </Button>
      }
    />
  )

  // Both branches keep the header, for the reason `ExamHubPage` states: this
  // component IS the page, so returning a bare skeleton leaves the route with
  // no level-1 heading at all.
  if (state.status === 'error') {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        {header}
        <QueryErrorState onRetry={state.retry} />
      </div>
    )
  }
  if (state.status === 'loading') {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        {header}
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (!targetDate) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        {header}
        <p className="text-sm text-muted-foreground">{t('trainer.exam.plan.empty')}</p>
        <Button asChild size="sm">
          <Link to="/learn/exam">{t('trainer.exam.target.label')}</Link>
        </Button>
      </div>
    )
  }

  if (plan === null) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        {header}
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  /*
    Three ways a plan can fail to be drawn, and they are three different
    sentences. `expired` is "that day has gone"; `unreadableDate` is "the date
    on this record is not a date", which is only reachable from a row another
    build wrote and which used to produce a full four-hundred-day plan; and a
    truncated window is a plan that IS drawn and stops short, which is the one
    that most needs saying because it otherwise just ends.
  */
  if (plan.expired || plan.unreadableDate) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        {header}
        <p className="text-sm text-coral-foreground">
          {plan.unreadableDate ? t('trainer.exam.plan.unreadableDate') : t('trainer.exam.plan.expired')}
        </p>
        <Button asChild size="sm">
          <Link to="/learn/exam">{t('trainer.exam.target.label')}</Link>
        </Button>
      </div>
    )
  }

  const today = istDay(now)
  const shown = showAll ? plan.days : plan.days.slice(0, PREVIEW_DAYS)
  const sprintDays = plan.days.filter((day) => day.phase === 'revision').length

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      {header}

      <InfoCard title={t('trainer.exam.plan.budget', { minutes: plan.dailyMinutes })} icon={Brain}>
        <p className="text-sm text-muted-foreground">{t('trainer.exam.plan.notStored')}</p>
        {/*
          Only where a goal was actually the source: no explicit budget AND a
          figure that differs from the default. Saying it unconditionally was
          the defect — the sentence was true of the code and false of the run.
        */}
        {dailyMinutes === null && plan.dailyMinutes !== DEFAULT_DAILY_MINUTES ? (
          <p className="mt-1 text-xs text-muted-foreground">{t('trainer.exam.plan.budgetFromGoal')}</p>
        ) : null}
        <p className="mt-2 text-sm">{t('trainer.exam.plan.sprintNote', { count: sprintDays })}</p>
      </InfoCard>

      {plan.truncated ? (
        <p className="text-sm text-muted-foreground">
          {t('trainer.exam.plan.truncated', { count: plan.days.length })}
        </p>
      ) : null}

      {plan.notReached.length > 0 ? (
        /*
          Reported rather than dropped: a plan that quietly covers eleven of
          nineteen topics looks exactly like a plan that covers the syllabus.
        */
        <p className="text-sm text-coral-foreground">
          {t('trainer.exam.plan.notReached', {
            count: plan.notReached.length,
            units: plan.notReached.map((key) => unitName(state.data, key, language)).join(', '),
          })}
        </p>
      ) : null}

      <ol className="flex flex-col gap-3">
        {shown.map((day) => (
          <DayRow key={day.day} day={day} profile={state.data} isToday={day.day === today} />
        ))}
      </ol>

      {plan.days.length > PREVIEW_DAYS ? (
        <Button type="button" variant="outline" size="sm" onClick={() => setShowAll((value) => !value)}>
          {showAll ? t('trainer.exam.plan.showLess') : t('trainer.exam.plan.showAll')}
        </Button>
      ) : null}
    </div>
  )
}

function DayRow({ day, profile, isToday }: { day: PlanDay; profile: ExamProfile; isToday: boolean }) {
  const { t } = useT()

  return (
    <li>
      <SectionCard active={isToday} className="p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-sm tabular-nums">
            {day.day}
            {isToday ? (
              <span className="ml-2 font-sans font-semibold">{t('trainer.exam.plan.today')}</span>
            ) : null}
          </h2>
          <div className="flex items-center gap-2">
            <Chip tone={day.phase === 'revision' ? 'marigold' : 'neutral'}>
              {day.phase === 'revision'
                ? t('trainer.exam.plan.phaseRevision')
                : t('trainer.exam.plan.phaseBuild')}
            </Chip>
            {day.minutes > 0 ? (
              <span className="text-xs text-muted-foreground">
                {t('trainer.exam.plan.minutes', { count: day.minutes })}
              </span>
            ) : null}
          </div>
        </div>

        {day.tasks.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">{t('trainer.exam.plan.restDay')}</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {day.tasks.map((task, index) => (
              <TaskRow key={`${task.kind}:${task.unitKey ?? index}`} task={task} profile={profile} />
            ))}
          </ul>
        )}
      </SectionCard>
    </li>
  )
}

const TASK_ICONS = {
  read: BookOpen,
  drill: Brain,
  revise: FileText,
  mock: ListChecks,
} as const satisfies Record<PlanTask['kind'], unknown>

function TaskRow({ task, profile }: { task: PlanTask; profile: ExamProfile }) {
  const { t, language } = useT()
  const Icon = TASK_ICONS[task.kind]
  const name = task.unitKey ? unitName(profile, task.unitKey, language) : ''

  const label = (): string => {
    switch (task.kind) {
      case 'read':
        return t('trainer.exam.plan.taskRead', { unit: name })
      case 'drill':
        return t('trainer.exam.plan.taskDrill', { unit: name, count: task.cards })
      case 'revise':
        return t('trainer.exam.plan.taskRevise', { unit: name })
      case 'mock': {
        const paper = profile.papers.find((candidate) => candidate.id === task.paperId)
        return t('trainer.exam.plan.taskMock', {
          paper: paper ? paper.name[language] || paper.name.en : '',
        })
      }
    }
  }

  const href = (): string | null => {
    if (task.kind === 'mock') return '/learn/exam/mock'
    if (task.kind === 'read' && task.workId) return `/library/${task.workId}`
    if (task.kind === 'drill' && task.actId) return `/learn/review?act=${task.actId}`
    // A revise task points at the Library work, where the chapter sheets are —
    // a sheet route needs a chapter node id, which only the work page knows.
    if (task.kind === 'revise' && task.workId) return `/library/${task.workId}`
    return null
  }

  const to = href()

  return (
    <li className="flex flex-wrap items-center gap-2 text-sm">
      <Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">{label()}</span>
      {to ? (
        <Button asChild size="sm" variant="outline">
          <Link to={to}>{t('trainer.exam.actions.go')}</Link>
        </Button>
      ) : null}
    </li>
  )
}

function unitName(profile: ExamProfile, key: string, language: 'en' | 'hi'): string {
  for (const paper of profile.papers) {
    for (const unit of paper.units) {
      if (`${paper.id}:${unit.id}` === key) return unit.name[language] || unit.name.en
    }
  }
  return key
}
