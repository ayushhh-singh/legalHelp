import { ArrowLeft } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { AccuracyChart, type AccuracyDatum } from '../components/AccuracyChart'
import { CardView } from '../components/CardView'
import { bookmarkMany } from '../store'
import { useEffectiveCatalogue, useRulesIndex } from '../useCatalogue'
import { useNow } from '../useNow'
import { useTrainerSettings } from '../useTrainerSettings'

import { PageHeader } from '@/components/common/PageHeader'
import { Chip, ProgressBar, SectionCard, Skeleton } from '@/components/ui-x'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'
import { isServed } from '@/modules/trainer/schema'

import type { Card } from '../schema'

const COUNT_OPTIONS = [10, 25, 50] as const
const TIMER_OPTIONS = [0, 10, 20, 30] as const
const MOCK_KINDS = new Set(['mcq', 'trueFalse', 'scenario'])

interface Answered {
  card: Card
  correct: boolean
}

type Stage =
  | { phase: 'setup' }
  | { phase: 'active'; questions: Card[]; index: number; answers: Answered[]; deadline: number | null }
  | { phase: 'results'; answers: Answered[] }

function shuffled<T>(items: T[]): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    const a = copy[i]
    const b = copy[j]
    if (a !== undefined && b !== undefined) {
      copy[i] = b
      copy[j] = a
    }
  }
  return copy
}

const formatTime = (ms: number): string => {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/**
 * `/learn/mock` — setup, a timed run with no explanations, then results.
 *
 * Scoped to `mcq` / `trueFalse` / `scenario` cards only: those are the ones
 * with an objective right answer, and they are exactly `data/rules`'s
 * "authored questions" (CLAUDE.md: 141 approved) — a rule-flip or cloze card
 * has no single correct pick a mock test could score.
 */
export default function MockPage() {
  const { t, language } = useT()
  const now = useNow(1_000)
  const index = useRulesIndex()
  const catalogue = useEffectiveCatalogue()
  const settings = useTrainerSettings()

  const [stage, setStage] = useState<Stage>({ phase: 'setup' })
  const [selectedActs, setSelectedActs] = useState<string[]>([])
  const [count, setCount] = useState<(typeof COUNT_OPTIONS)[number]>(10)
  const [timerMinutes, setTimerMinutes] = useState<(typeof TIMER_OPTIONS)[number]>(0)
  const [addedCount, setAddedCount] = useState<number | null>(null)

  const pool = useMemo(() => {
    if (!catalogue) return []
    return catalogue.filter(
      (card) => isServed(card) && MOCK_KINDS.has(card.kind) && (selectedActs.length === 0 || selectedActs.includes(card.act)),
    )
  }, [catalogue, selectedActs])

  if (!catalogue || !settings || index.status === 'loading') {
    return (
      <div className="mx-auto max-w-2xl">
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  const toggleAct = (actId: string) =>
    setSelectedActs((current) => (current.includes(actId) ? current.filter((id) => id !== actId) : [...current, actId]))

  const start = () => {
    const questions = shuffled(pool).slice(0, count)
    setAddedCount(null)
    setStage({
      phase: 'active',
      questions,
      index: 0,
      answers: [],
      deadline: timerMinutes > 0 ? Date.now() + timerMinutes * 60_000 : null,
    })
  }

  const finish = (answers: Answered[]) => setStage({ phase: 'results', answers })

  const answerCurrent = (correct: boolean) => {
    if (stage.phase !== 'active') return
    const card = stage.questions[stage.index]
    if (!card) return
    const answers = [...stage.answers.filter((a) => a.card.id !== card.id), { card, correct }]
    setStage({ ...stage, answers })
  }

  const advance = () => {
    if (stage.phase !== 'active') return
    if (stage.index + 1 >= stage.questions.length) {
      finish(stage.answers)
      return
    }
    setStage({ ...stage, index: stage.index + 1 })
  }

  // Adjusted during render rather than in an effect — "the timer ran out" is a
  // value derived from `now` and `stage`, not a subscription to an external
  // system, and finishing here (rather than in an effect after the paint)
  // means the reader never sees one frame of a still-active test past the
  // deadline. React bails out of the extra render this triggers before
  // painting, so this runs once per real deadline crossing, not on a loop —
  // the guard is `stage.phase === 'active'`, which `finish` itself clears.
  if (stage.phase === 'active' && stage.deadline !== null && now.getTime() >= stage.deadline) {
    finish(stage.answers)
  }

  const addWrongToReview = async (answers: Answered[]) => {
    const wrong = answers.filter((a) => !a.correct).map((a) => a.card.id)
    await bookmarkMany(wrong)
    setAddedCount(wrong.length)
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <PageHeader
        title={t('trainer.mock.title')}
        subtitle={stage.phase === 'setup' ? t('trainer.mock.subtitle') : undefined}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/learn">
              <ArrowLeft aria-hidden="true" />
              {t('trainer.review.backHome')}
            </Link>
          </Button>
        }
      />

      {stage.phase === 'setup' ? (
        <SectionCard className="p-4 space-y-5">
          <div>
            <h2 className="text-sm font-semibold">{t('trainer.mock.setupActsLabel')}</h2>
            <div className="mt-2 flex flex-wrap gap-2">
              {index.status === 'ready'
                ? index.data.acts.map((act) => (
                    <button key={act.id} type="button" onClick={() => toggleAct(act.id)}>
                      <Chip tone={selectedActs.length === 0 || selectedActs.includes(act.id) ? 'action' : 'neutral'}>
                        {act.short[language] || act.short.en}
                      </Chip>
                    </button>
                  ))
                : null}
            </div>
          </div>

          <div>
            <h2 className="text-sm font-semibold">{t('trainer.mock.setupCountLabel')}</h2>
            <div className="mt-2 flex gap-2">
              {COUNT_OPTIONS.map((n) => (
                <Button key={n} type="button" size="sm" variant={count === n ? 'default' : 'outline'} onClick={() => setCount(n)}>
                  {n}
                </Button>
              ))}
            </div>
          </div>

          <div>
            <h2 className="text-sm font-semibold">{t('trainer.mock.setupTimerLabel')}</h2>
            <div className="mt-2 flex flex-wrap gap-2">
              {TIMER_OPTIONS.map((minutes) => (
                <Button
                  key={minutes}
                  type="button"
                  size="sm"
                  variant={timerMinutes === minutes ? 'default' : 'outline'}
                  onClick={() => setTimerMinutes(minutes)}
                >
                  {minutes === 0 ? t('trainer.mock.setupTimerOff') : t('trainer.mock.setupTimerMinutes', { count: minutes })}
                </Button>
              ))}
            </div>
          </div>

          {pool.length < count ? (
            <p className="text-sm text-coral-foreground">{t('trainer.mock.setupNotEnough', { available: pool.length })}</p>
          ) : null}

          <Button type="button" size="lg" disabled={pool.length === 0} onClick={start}>
            {t('trainer.mock.setupStart')}
          </Button>
        </SectionCard>
      ) : null}

      {stage.phase === 'active' ? (
        <>
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>{t('trainer.mock.questionProgress', { current: stage.index + 1, total: stage.questions.length })}</span>
            {stage.deadline !== null ? (
              <span>{t('trainer.mock.timeRemaining', { time: formatTime(stage.deadline - now.getTime()) })}</span>
            ) : null}
          </div>
          <ProgressBar value={(stage.index / stage.questions.length) * 100} label={t('trainer.mock.title')} />

          {stage.questions[stage.index] ? (
            <CardView
              key={stage.questions[stage.index]!.id}
              card={stage.questions[stage.index]!}
              language={language}
              srsRow={null}
              now={now}
              desiredRetention={settings.desiredRetention}
              bookmarked={false}
              mode="mock"
              onAnswer={answerCurrent}
              onGrade={() => undefined}
              onToggleBookmark={() => undefined}
              onReport={() => undefined}
            />
          ) : null}

          <Button type="button" onClick={advance} disabled={!stage.answers.some((a) => a.card.id === stage.questions[stage.index]?.id)}>
            {stage.index + 1 >= stage.questions.length ? t('trainer.mock.finish') : t('trainer.mock.next')}
          </Button>
        </>
      ) : null}

      {stage.phase === 'results' ? (
        <ResultsView
          answers={stage.answers}
          addedCount={addedCount}
          onAddWrong={() => void addWrongToReview(stage.answers)}
          onRetake={() => setStage({ phase: 'setup' })}
        />
      ) : null}
    </div>
  )
}

function ResultsView({
  answers,
  addedCount,
  onAddWrong,
  onRetake,
}: {
  answers: Answered[]
  addedCount: number | null
  onAddWrong: () => void
  onRetake: () => void
}) {
  const { t, language } = useT()
  const correct = answers.filter((a) => a.correct).length
  const wrong = answers.filter((a) => !a.correct)

  const byAct = new Map<string, { correct: number; total: number }>()
  for (const a of answers) {
    const bucket = byAct.get(a.card.act) ?? { correct: 0, total: 0 }
    bucket.total += 1
    if (a.correct) bucket.correct += 1
    byAct.set(a.card.act, bucket)
  }
  const chartData: AccuracyDatum[] = [...byAct.entries()].map(([act, v]) => ({ act, label: act, ...v }))

  return (
    <div className="flex flex-col gap-4">
      <SectionCard className="p-4">
        <h2 className="text-lg font-semibold">{t('trainer.mock.resultsTitle')}</h2>
        <p className="font-display mt-1 text-2xl">{t('trainer.mock.resultsScore', { correct, total: answers.length })}</p>
      </SectionCard>

      <SectionCard className="p-4">
        <h3 className="text-sm font-semibold">{t('trainer.mock.resultsAccuracyByAct')}</h3>
        <div className="mt-3">
          <AccuracyChart data={chartData} />
        </div>
      </SectionCard>

      <SectionCard className="p-4">
        <h3 className="text-sm font-semibold">{t('trainer.mock.resultsWrongAnswers')}</h3>
        {wrong.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">{t('trainer.mock.resultsWrongEmpty')}</p>
        ) : (
          <ul className="mt-2 divide-y divide-border">
            {wrong.map((a) => (
              <li key={a.card.id} className="py-3">
                <p className="text-sm font-medium">{a.card.front[language] || a.card.front.en}</p>
                {a.card.explanation ? (
                  <p className="mt-1 text-xs text-muted-foreground">{a.card.explanation[language] || a.card.explanation.en}</p>
                ) : null}
                <p className="mt-1 text-xs text-muted-foreground">{a.card.ruleRef.citation[language] || a.card.ruleRef.citation.en}</p>
              </li>
            ))}
          </ul>
        )}
        {wrong.length > 0 ? (
          <div className="mt-3">
            {addedCount === null ? (
              <Button type="button" size="sm" variant="outline" onClick={onAddWrong}>
                {t('trainer.mock.resultsAddWrong')}
              </Button>
            ) : (
              <p className="text-sm text-tulsi-foreground">{t('trainer.mock.resultsAddedWrong', { count: addedCount })}</p>
            )}
          </div>
        ) : null}
      </SectionCard>

      <div className="flex gap-2">
        <Button type="button" onClick={onRetake}>
          {t('trainer.mock.resultsRetake')}
        </Button>
        <Button asChild variant="outline">
          <Link to="/learn">{t('trainer.mock.resultsBackHome')}</Link>
        </Button>
      </div>
    </div>
  )
}
