import { ArrowLeft, Flag } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { useActiveExam, useExamProfile } from './useExam'

import { bookmarkMany } from '../store'
import { useEffectiveCatalogue } from '../useCatalogue'
import { useNow } from '../useNow'

import { PageHeader } from '@/components/common/PageHeader'
import { InfoCard, ProgressBar, QueryErrorState, SectionCard, Skeleton } from '@/components/ui-x'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'
import {
  blankCount,
  drawPaper,
  emptyAnswers,
  flaggedIndices,
  markPaper,
  nextToRevisit,
  wrongCards,
  type AnswerRow,
  type MockPaper,
} from '@/lib/exam'

import type { ExamProfile } from '@/schemas/exam'

const COUNT_OPTIONS = [15, 30, 50] as const

const formatTime = (ms: number): string => {
  const seconds = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

const round1 = (value: number) => Math.round(value * 10) / 10

type Stage =
  | { phase: 'setup' }
  | { phase: 'active'; paper: MockPaper; at: number; rows: AnswerRow[]; deadline: number }
  | { phase: 'results'; paper: MockPaper; rows: AnswerRow[] }

/**
 * `/learn/exam/mock` — a weighted mock paper.
 *
 * Its own screen rather than a mode of `/learn/mock`, because an examination
 * paper has affordances a study test does not: sections weighted by the
 * syllabus, a real clock taken from the notification, a penalty for a wrong
 * answer, marking for review, and an answer sheet a candidate can jump around.
 *
 * **The paper is labelled generated on every screen it appears on.** Every
 * question is one of this app's own cards; no question paper of any examination
 * is in this repository. The shortfall list under the setup is the honest half
 * of that: it says which topics had fewer approved questions than the weights
 * asked for, and which had none because they are studied elsewhere.
 */
export default function ExamMockPage() {
  const { t } = useT()
  const choice = useActiveExam()

  // The header renders while the Dexie row is still being read, for the
  // reason `ExamHubPage` states: a screen with no `<h1>` is a screen a
  // reader tabbing in cannot place, and the title is known before the row.
  if (choice === undefined) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <PageHeader title={t('trainer.exam.mock.title')} />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }
  if (choice === null) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <PageHeader title={t('trainer.exam.mock.title')} />
        <p className="text-sm text-muted-foreground">{t('trainer.exam.readiness.empty')}</p>
        <Button asChild size="sm">
          <Link to="/learn/exam">{t('trainer.exam.picker.title')}</Link>
        </Button>
      </div>
    )
  }
  return <MockFor profileId={choice.id} />
}

function MockFor({ profileId }: { profileId: string }) {
  const { t, language } = useT()
  const now = useNow(1_000)
  const state = useExamProfile(profileId)
  const catalogue = useEffectiveCatalogue()

  const [stage, setStage] = useState<Stage>({ phase: 'setup' })
  const [paperId, setPaperId] = useState<string | null>(null)
  const [count, setCount] = useState<(typeof COUNT_OPTIONS)[number]>(30)
  const [added, setAdded] = useState<number | null>(null)

  const profile = state.status === 'ready' ? state.data : null
  const objective = useMemo(() => profile?.papers.filter((paper) => paper.objective) ?? [], [profile])

  /*
    The default is the objective paper with the most MAPPED weight, not the
    first one.

    Found in a browser. `ib-so-ldce`'s Paper I maps one of its five topics (the
    RTI Act), so defaulting to the first objective paper offered a fifteen-
    question mock that drew three — correct, honest, and a poor first
    impression of a feature whose Paper II maps eight topics out of ten. The
    reader can still pick either; this only decides which is selected when they
    arrive.
  */
  const bestId = useMemo(() => {
    let best: { id: string; share: number } | null = null
    for (const paper of objective) {
      const share = paper.units.reduce(
        (sum, unit) => sum + (Array.isArray(unit.coverage) ? unit.weight : 0),
        0,
      )
      if (!best || share > best.share) best = { id: paper.id, share }
    }
    return best?.id ?? null
  }, [objective])

  const chosenId = paperId ?? bestId

  const preview = useMemo(() => {
    if (!profile || !catalogue || !chosenId) return null
    // The seed is fixed here so the preview's shortfall figures do not shimmer
    // while the reader is reading them; `start` mints a fresh one.
    return drawPaper({ profile, paperId: chosenId, catalogue, count, seed: 'preview' })
  }, [profile, catalogue, chosenId, count])

  const header = (
    <PageHeader
      title={t('trainer.exam.mock.title')}
      subtitle={stage.phase === 'setup' ? t('trainer.exam.mock.subtitle') : undefined}
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

  // After `header`, not before it: this component IS the page in both states,
  // and a bare skeleton would leave the route with no level-1 heading.
  if (state.status === 'error') {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        {header}
        <QueryErrorState onRetry={state.retry} />
      </div>
    )
  }
  if (!profile || !catalogue) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        {header}
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  const start = () => {
    if (!chosenId) return
    const paper = drawPaper({
      profile,
      paperId: chosenId,
      catalogue,
      count,
      // A fresh seed per attempt, so two mocks are two papers — and one attempt
      // survives a re-render because the paper is held in state, not redrawn.
      seed: new Date().toISOString(),
    })
    if (!paper || paper.questions.length === 0) return
    setAdded(null)
    setStage({
      phase: 'active',
      paper,
      at: 0,
      rows: emptyAnswers(paper.questions.length),
      deadline: now.getTime() + paper.paper.durationMinutes * 60_000,
    })
  }

  // Derived during render rather than in an effect: "the clock ran out" is a
  // value of `now` and `stage`, not a subscription — the reasoning `MockPage`
  // records, and finishing here means the reader never sees a frame of a paper
  // that is already over.
  if (stage.phase === 'active' && now.getTime() >= stage.deadline) {
    setStage({ phase: 'results', paper: stage.paper, rows: stage.rows })
  }

  if (stage.phase === 'setup') {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        {header}
        <InfoCard title={t('trainer.exam.mock.generated')}>
          <p className="text-sm text-muted-foreground">{t('trainer.exam.mock.generatedNote')}</p>
        </InfoCard>

        {objective.length === 0 ? (
          <p className="text-sm text-coral-foreground">{t('trainer.exam.mock.noObjective')}</p>
        ) : (
          <SectionCard className="space-y-5 p-4">
            <div>
              <h2 className="text-sm font-semibold" id="mock-paper-label">
                {t('trainer.exam.mock.paperLabel')}
              </h2>
              <div className="mt-2 flex flex-wrap gap-2" role="group" aria-labelledby="mock-paper-label">
                {objective.map((paper) => (
                  <Button
                    key={paper.id}
                    type="button"
                    size="sm"
                    variant={chosenId === paper.id ? 'default' : 'outline'}
                    aria-pressed={chosenId === paper.id}
                    onClick={() => setPaperId(paper.id)}
                  >
                    {paper.name[language] || paper.name.en}
                  </Button>
                ))}
              </div>
            </div>

            <div>
              <h2 className="text-sm font-semibold" id="mock-count-label">
                {t('trainer.exam.mock.countLabel')}
              </h2>
              <div className="mt-2 flex gap-2" role="group" aria-labelledby="mock-count-label">
                {COUNT_OPTIONS.map((option) => (
                  <Button
                    key={option}
                    type="button"
                    size="sm"
                    variant={count === option ? 'default' : 'outline'}
                    aria-pressed={count === option}
                    onClick={() => setCount(option)}
                  >
                    {option}
                  </Button>
                ))}
              </div>
            </div>

            {preview ? <ShortfallNotes paper={preview} profile={profile} /> : null}

            <Button
              type="button"
              size="lg"
              disabled={!preview || preview.questions.length === 0}
              onClick={start}
            >
              {t('trainer.exam.mock.start')}
            </Button>
          </SectionCard>
        )}
      </div>
    )
  }

  if (stage.phase === 'results') {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        {header}
        <Results
          paper={stage.paper}
          rows={stage.rows}
          added={added}
          onAddWrong={() => {
            const wrong = wrongCards(stage.paper, stage.rows)
            void bookmarkMany(wrong.map((card) => card.id)).then(() => setAdded(wrong.length))
          }}
          onRetake={() => setStage({ phase: 'setup' })}
        />
      </div>
    )
  }

  const question = stage.paper.questions[stage.at]
  const row = stage.rows[stage.at] ?? { answer: null, flagged: false }
  const unitName = stage.paper.paper.units.find((unit) => unit.id === question?.unitId)?.name[language] ?? ''

  const update = (next: Partial<AnswerRow>) =>
    setStage({
      ...stage,
      rows: stage.rows.map((current, index) => (index === stage.at ? { ...current, ...next } : current)),
    })

  const goTo = (index: number) => setStage({ ...stage, at: index })

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      {header}

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <span>
          {t('trainer.exam.mock.questionOf', { current: stage.at + 1, total: stage.paper.questions.length })}
        </span>
        <span className="font-display tabular-nums" role="timer">
          {t('trainer.exam.mock.timeLeft', { time: formatTime(stage.deadline - now.getTime()) })}
        </span>
      </div>
      <ProgressBar
        value={((stage.at + 1) / stage.paper.questions.length) * 100}
        label={t('trainer.exam.mock.title')}
      />

      {question ? (
        <SectionCard className="p-4">
          <p className="text-xs text-muted-foreground">
            {t('trainer.exam.mock.unitLabel')}: {unitName}
          </p>
          <h2 className="mt-2 text-base font-medium">
            {question.card.front[language] || question.card.front.en}
          </h2>

          <fieldset className="mt-4">
            <legend className="sr-only">{question.card.front[language] || question.card.front.en}</legend>
            <div className="flex flex-col gap-2">
              {(question.card.options ?? []).map((option, index) => (
                <label
                  key={index}
                  className="flex cursor-pointer items-start gap-3 rounded-[10px] border border-border p-3 text-sm hover:bg-muted"
                >
                  <input
                    type="radio"
                    name={`mock-${stage.at}`}
                    className="mt-0.5"
                    checked={row.answer === index}
                    onChange={() => update({ answer: index })}
                  />
                  <span>{option[language] || option.en}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant={row.flagged ? 'default' : 'outline'}
              aria-pressed={row.flagged}
              onClick={() => update({ flagged: !row.flagged })}
            >
              <Flag aria-hidden="true" />
              {row.flagged ? t('trainer.exam.mock.unflag') : t('trainer.exam.mock.flag')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={row.answer === null}
              onClick={() => update({ answer: null })}
            >
              {t('trainer.exam.mock.clear')}
            </Button>
          </div>
        </SectionCard>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={stage.at === 0}
          onClick={() => goTo(stage.at - 1)}
        >
          {t('trainer.exam.mock.previous')}
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={stage.at + 1 >= stage.paper.questions.length}
          onClick={() => goTo(stage.at + 1)}
        >
          {t('trainer.exam.mock.next')}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={nextToRevisit(stage.rows, stage.at) === null}
          onClick={() => {
            const next = nextToRevisit(stage.rows, stage.at)
            if (next !== null) goTo(next)
          }}
        >
          {t('trainer.exam.mock.revisit')}
        </Button>
      </div>

      <AnswerSheet rows={stage.rows} at={stage.at} onGo={goTo} />

      <p className="text-xs text-muted-foreground">
        {stage.paper.paper.negativeMarking
          ? t('trainer.exam.mock.negativeWarning')
          : t('trainer.exam.mock.noNegative')}
      </p>

      <Button
        type="button"
        size="lg"
        onClick={() => setStage({ phase: 'results', paper: stage.paper, rows: stage.rows })}
      >
        {t('trainer.exam.mock.submit')}
      </Button>
    </div>
  )
}

/* ------------------------------------------------------------------ */

function ShortfallNotes({ paper, profile }: { paper: MockPaper; profile: ExamProfile }) {
  const { t, language } = useT()
  const nameOf = (unitId: string) => {
    const unit = paper.paper.units.find((candidate) => candidate.id === unitId)
    return unit ? unit.name[language] || unit.name.en : unitId
  }

  const external = paper.shortfall.filter((entry) => entry.external)
  const thin = paper.shortfall.filter((entry) => !entry.external)
  const short = thin.reduce((sum, entry) => sum + (entry.wanted - entry.drawn), 0)

  const skipped = paper.skippedPapers
    .map((id) => profile.papers.find((candidate) => candidate.id === id))
    .filter(Boolean)
    .map((candidate) => candidate!.name[language] || candidate!.name.en)

  if (external.length === 0 && thin.length === 0 && skipped.length === 0) return null

  return (
    <div className="space-y-1.5 text-xs text-muted-foreground">
      {skipped.length > 0 ? <p>{t('trainer.exam.mock.skipped', { papers: skipped.join(', ') })}</p> : null}
      {external.map((entry) => (
        <p key={entry.unitKey}>{t('trainer.exam.mock.shortfallExternal', { unit: nameOf(entry.unitId) })}</p>
      ))}
      {thin.length > 0 ? (
        <p>
          {t('trainer.exam.mock.shortfall', {
            count: short,
            units: thin.map((entry) => nameOf(entry.unitId)).join(', '),
          })}
        </p>
      ) : null}
    </div>
  )
}

function AnswerSheet({
  rows,
  at,
  onGo,
}: {
  rows: readonly AnswerRow[]
  at: number
  onGo: (index: number) => void
}) {
  const { t } = useT()

  return (
    <SectionCard className="p-4">
      <h2 className="text-sm font-semibold" id="answer-sheet-label">
        {t('trainer.exam.mock.answerSheet')}
      </h2>
      <p className="mt-1 text-xs text-muted-foreground" id="answer-sheet-hint">
        {t('trainer.exam.mock.answerSheetHint')}
      </p>
      <ul
        className="mt-3 flex flex-wrap gap-1.5"
        aria-labelledby="answer-sheet-label"
        aria-describedby="answer-sheet-hint"
      >
        {rows.map((row, index) => {
          const status = row.flagged
            ? t('trainer.exam.mock.statusFlagged')
            : row.answer !== null
              ? t('trainer.exam.mock.statusAnswered')
              : t('trainer.exam.mock.statusBlank')
          return (
            <li key={index}>
              <button
                type="button"
                onClick={() => onGo(index)}
                aria-current={index === at ? 'true' : undefined}
                // Status is in the accessible NAME and not in colour alone:
                // "answered", "marked for review" and "blank" are three states
                // a reader has to be able to tell apart without seeing them.
                aria-label={`${index + 1}, ${status}`}
                className={[
                  'font-display flex h-11 w-11 items-center justify-center rounded-[10px] border text-sm tabular-nums',
                  index === at ? 'border-action ring-2 ring-primary' : 'border-border',
                  row.flagged
                    ? 'bg-marigold/15 text-marigold-foreground'
                    : row.answer !== null
                      ? 'bg-action text-action-foreground'
                      : 'bg-card',
                ].join(' ')}
              >
                {index + 1}
              </button>
            </li>
          )
        })}
      </ul>
      <p className="mt-3 text-xs text-muted-foreground">
        {t('trainer.exam.mock.remaining', {
          blank: blankCount(rows),
          flagged: flaggedIndices(rows).length,
        })}
      </p>
    </SectionCard>
  )
}

function Results({
  paper,
  rows,
  added,
  onAddWrong,
  onRetake,
}: {
  paper: MockPaper
  rows: readonly AnswerRow[]
  added: number | null
  onAddWrong: () => void
  onRetake: () => void
}) {
  const { t, language } = useT()
  const result = markPaper(paper, rows)
  const wrong = wrongCards(paper, rows)

  const nameOf = (unitId: string) => {
    const unit = paper.paper.units.find((candidate) => candidate.id === unitId)
    return unit ? unit.name[language] || unit.name.en : unitId
  }

  return (
    <>
      <SectionCard className="p-4">
        <h2 className="text-lg font-semibold">{t('trainer.exam.mock.resultsTitle')}</h2>
        <p className="font-display mt-1 text-3xl tabular-nums">
          {t('trainer.exam.mock.resultsScore', {
            marks: round1(result.marks),
            max: result.maxMarks,
          })}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('trainer.exam.mock.resultsBreakdown', {
            correct: result.correct,
            wrong: result.wrong,
            blank: result.blank,
          })}
        </p>
        {/*
          The penalty is shown as its own line rather than folded into the
          total. A candidate deciding whether to guess needs to see what the
          guessing cost, and "37 of 150" hides it.
        */}
        <p className="mt-1 text-sm text-muted-foreground">
          {t('trainer.exam.mock.resultsRaw', { raw: round1(result.rawMarks) })}
          {result.penalty > 0
            ? ` · ${t('trainer.exam.mock.resultsPenalty', { penalty: round1(result.penalty) })}`
            : ''}
        </p>
        <p className="mt-3 text-xs text-muted-foreground">{t('trainer.exam.mock.practiceOnly')}</p>
      </SectionCard>

      <SectionCard className="p-4">
        <h3 className="text-sm font-semibold">{t('trainer.exam.mock.resultsByUnit')}</h3>
        {/* A list, not a `<dl>` — see `ReadinessBars.tsx` for what axe said. */}
        <ul className="mt-3 flex flex-col gap-4">
          {result.units.map((unit) => (
            <li key={unit.unitKey}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm font-medium">{nameOf(unit.unitId)}</span>
                <span className="font-display text-sm tabular-nums">
                  {t('trainer.exam.mock.resultsAccuracy', { percent: Math.round(unit.accuracy * 100) })}
                </span>
              </div>
              <div className="mt-1.5">
                <ProgressBar
                  value={unit.accuracy * 100}
                  label={`${nameOf(unit.unitId)} — ${Math.round(unit.accuracy * 100)}%`}
                />
              </div>
              {/*
                Asked against weight, side by side. A topic that is 50% of the
                syllabus and 20% of the paper the app could draw is a fact about
                the app's bank, and it is the reason the score is a practice
                figure rather than a prediction.
              */}
              <p className="mt-1 text-xs text-muted-foreground">
                {t('trainer.exam.mock.resultsAsked', {
                  asked: unit.asked,
                  askedShare: Math.round(unit.askedShare * 100),
                  weight: Math.round(unit.weight * 100),
                })}
              </p>
            </li>
          ))}
        </ul>
      </SectionCard>

      <SectionCard className="p-4">
        {wrong.length === 0 ? (
          <p className="text-sm text-tulsi-foreground">{t('trainer.exam.mock.resultsNothingWrong')}</p>
        ) : added === null ? (
          <Button type="button" size="sm" variant="outline" onClick={onAddWrong}>
            {t('trainer.exam.mock.resultsAddWrong')}
          </Button>
        ) : (
          <p className="text-sm text-tulsi-foreground" role="status">
            {t('trainer.exam.mock.resultsAddedWrong', { count: added })}
          </p>
        )}
      </SectionCard>

      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={onRetake}>
          {t('trainer.exam.mock.resultsRetake')}
        </Button>
        <Button asChild variant="outline">
          <Link to="/learn/exam">{t('trainer.exam.title')}</Link>
        </Button>
      </div>
    </>
  )
}
