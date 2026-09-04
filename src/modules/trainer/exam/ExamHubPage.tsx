import { CalendarDays, ClipboardCheck, ListChecks, Target } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { loadExamProfile } from './data'
import { ExamChecklistSection } from './ExamChecklistSection'
import { ExamPlanSection } from './ExamPlanSection'
import { ExamBanner } from './components/ExamBanner'
import { ReadinessBars } from './components/ReadinessBars'
import { RevisionSheetsCard } from './components/RevisionSheetsCard'
import { knowsProfile, useActiveExam, useExamIndex, useExamProfile, useSrsStates } from './useExam'

import { useEffectiveCatalogue } from '../useCatalogue'
import { useNow } from '../useNow'

import { PageHeader } from '@/components/common/PageHeader'
import { Badge, Chip, InfoCard, ProgressBar, QueryErrorState, SectionCard, Skeleton } from '@/components/ui-x'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'
import {
  clearActiveExam,
  MAX_DAILY_MINUTES,
  mappedMarksShare,
  nextActions,
  readinessFor,
  setActiveExam,
  setDailyMinutes,
  setTargetDate,
  type NextAction,
} from '@/lib/exam'
import { isIstDay, istDay, loadSettings, saveSettings } from '@/lib/srs'
import { trainerActHintsForProfile, type TrainerActHint } from '@/modules/onboarding/actHints'

import type { ExamIndexEntry, ExamProfile } from '@/schemas/exam'

const pct = (value: number) => Math.round(value * 100)

/**
 * The floor `dailyBudget` clamps to. Taken from the same place the ceiling is,
 * rather than typed twice: an input whose bounds disagree with the clamp behind
 * it silently accepts a figure the plan then changes.
 */
const MIN_DAILY_MINUTES = 10

/**
 * `/study/exam` — pick an examination, set a date, see where you stand.
 *
 * Two screens in one route, and which one renders is the reader's own choice
 * rather than a tab: with nothing chosen this is the picker, and with a profile
 * chosen it is the readiness screen with "change examination" on it. A reader
 * who has chosen one wants their numbers, not a list.
 *
 * Every figure is recomputed on render from the profile, the catalogue and the
 * live schedule. Nothing derived is stored — `examChoices` holds the profile
 * id, the date and the minute budget, and that is all (ADR-044 §3).
 */
export default function ExamHubPage() {
  const { t } = useT()
  const index = useExamIndex()
  const choice = useActiveExam()
  /*
    The Trainer act hint, if choosing a profile produced one.

    Held HERE rather than in the picker, because the picker unmounts the moment
    a profile is chosen and the note has to be read on the readiness screen that
    replaces it. `null` covers both "nothing was applied" and "nothing has been
    chosen yet", which is the same thing from the reader's side.
  */
  const [actsHint, setActsHint] = useState<TrainerActHint | null>(null)

  /*
    The header renders in EVERY state, including while loading and on an error.

    The first version returned a bare `<Skeleton />` from both, so the page had
    no `<h1>` at all until `data/exams` and the Dexie row had both resolved —
    which `tests/e2e/a11y.spec.ts` found, because that sweep waits for a
    level-1 heading on every route and reported "element(s) not found" rather
    than a slow one. A screen with no heading is a screen a reader tabbing in
    cannot place, and the fix is the same one every other page here already
    has: the title is known before the data is.
  */
  const header = <PageHeader as="h2" title={t('trainer.exam.title')} subtitle={t('trainer.exam.subtitle')} />

  if (index.status === 'error') {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        {header}
        <QueryErrorState onRetry={index.retry} />
      </div>
    )
  }

  // `undefined` is "still asking"; `null` is "nothing chosen". Telling them
  // apart is what stops the picker flashing over a reader's own choice.
  if (index.status === 'loading' || choice === undefined) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        {header}
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      {header}
      {/*
        `null` is "nothing chosen"; an id this build cannot load takes the SAME
        branch, because from the reader's side it is the same situation and the
        picker is the only honest exit. A row naming a withdrawn or renamed profile
        used to leave this screen on a skeleton for ever.
          */}
      {choice === null || !knowsProfile(choice.id) ? (
        <ProfilePicker entries={index.data.profiles} onApplied={setActsHint} />
      ) : (
        <ChosenExam
          profileId={choice.id}
          targetDate={choice.targetDate}
          dailyMinutes={choice.dailyMinutes}
          actsHint={actsHint}
        />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * The picker
 * ------------------------------------------------------------------ */

function ProfilePicker({
  entries,
  onApplied,
}: {
  entries: readonly ExamIndexEntry[]
  onApplied: (hint: TrainerActHint | null) => void
}) {
  const { t, language } = useT()
  const [busy, setBusy] = useState<string | null>(null)

  /*
    Choosing a profile also offers the Trainer a set of rule books — but only
    where the reader has not chosen their own, and never silently.

    `actsEnabled: []` is the default and means EVERY rule book, so an empty list
    is "this reader has not decided" and anything else is a decision they made.
    Overwriting a decision because somebody tapped a card on a different screen
    is a change they would never connect to the action, so it is applied only to
    the default — and the note the hint carries is then rendered on the screen
    that replaces this one, which is the arrangement `OnboardingPage` already
    uses for the job-derived version of the same hint.

    The profile is loaded here rather than passed in because the picker only has
    the 2 KB index entry; `ChosenExam` is about to load it anyway, and
    `loadExamProfile` caches, so this costs the fetch that was coming next.
  */
  const choose = async (id: string) => {
    setBusy(id)
    try {
      await setActiveExam(id)
      const [profile, settings] = await Promise.all([loadExamProfile(id), loadSettings()])
      if (settings.actsEnabled.length > 0) {
        onApplied(null)
        return
      }
      const hint = trainerActHintsForProfile(profile)
      if (hint.acts.length === 0) {
        onApplied(null)
        return
      }
      await saveSettings({ actsEnabled: hint.acts })
      onApplied(hint)
    } catch {
      // Choosing the profile is the thing the reader asked for and it has
      // already happened; a failed hint must not undo it or surface as an
      // error about something they did not do.
      onApplied(null)
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <InfoCard title={t('trainer.exam.picker.title')} icon={Target}>
        <p className="text-sm text-muted-foreground">{t('trainer.exam.picker.boundary')}</p>
      </InfoCard>

      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('trainer.exam.picker.empty')}</p>
      ) : null}

      <ul className="flex flex-col gap-3">
        {entries.map((entry) => {
          const total = entry.mappedUnits + entry.externalUnits
          return (
            <li key={entry.id}>
              <SectionCard className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-base font-semibold">{entry.name[language] || entry.name.en}</h3>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {entry.organisation[language] || entry.organisation.en}
                    </p>
                  </div>
                  {entry.verify ? <Badge tone="warning">{t('trainer.exam.verifyBadge')}</Badge> : null}
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <Chip>
                    {t('trainer.exam.picker.papersAndMarks', {
                      papers: entry.paperCount,
                      marks: entry.totalMarks,
                    })}
                  </Chip>
                  <Chip tone="tulsi">{t('trainer.exam.picker.mapped', { count: entry.mappedUnits })}</Chip>
                  <Chip tone="marigold">
                    {t('trainer.exam.picker.external', { count: entry.externalUnits })}
                  </Chip>
                </div>

                {/*
                  The honest ratio, before the reader chooses rather than after.
                  For `railway-so-ldce` it is two mapped units against eleven,
                  and a reader deserves to know that on the card.
                */}
                <p className="mt-2 text-xs text-muted-foreground">
                  {t('trainer.exam.picker.share', {
                    percent: total === 0 ? 0 : Math.round((entry.mappedUnits / total) * 100),
                  })}
                </p>

                <div className="mt-3">
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy !== null}
                    onClick={() => void choose(entry.id)}
                  >
                    {t('trainer.exam.picker.choose')}
                  </Button>
                </div>
              </SectionCard>
            </li>
          )
        })}
      </ul>

      <p className="text-xs text-muted-foreground">{t('trainer.exam.picker.missing')}</p>
    </>
  )
}

/* ------------------------------------------------------------------ *
 * The readiness screen
 * ------------------------------------------------------------------ */

function ChosenExam({
  profileId,
  targetDate,
  dailyMinutes,
  actsHint,
}: {
  profileId: string
  targetDate: string | null
  dailyMinutes: number | null
  actsHint: TrainerActHint | null
}) {
  const { t, language } = useT()
  const now = useNow(60_000)
  const state = useExamProfile(profileId)
  const catalogue = useEffectiveCatalogue()
  const states = useSrsStates()

  const readiness = useMemo(() => {
    if (state.status !== 'ready' || !catalogue || !states) return null
    return readinessFor({
      profile: state.data,
      catalogue,
      states,
      now,
      targetDate,
    })
  }, [state, catalogue, states, now, targetDate])

  if (state.status === 'error') return <QueryErrorState onRetry={state.retry} />
  if (state.status === 'loading') return <Skeleton className="h-64 w-full" />

  const profile = state.data

  return (
    <>
      <SectionCard active className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">{profile.name[language] || profile.name.en}</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {profile.organisation[language] || profile.organisation.en}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              void clearActiveExam()
            }}
          >
            {t('trainer.exam.picker.change')}
          </Button>
        </div>
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-medium">
            {t('trainer.exam.picker.eligibility')}
          </summary>
          <p className="mt-2 text-sm text-muted-foreground">
            {profile.eligibilityNote[language] || profile.eligibilityNote.en}
          </p>
        </details>
      </SectionCard>

      <ExamBanner profile={profile} />

      {/*
        Applied AND said, in the same view — never applied silently. A reader
        whose Trainer has just narrowed from twelve rule books to eight needs to
        know why, and needs to know where to change it back.
      */}
      {actsHint?.note ? (
        <p className="rounded-md bg-marigold/15 p-3 text-sm text-marigold-foreground" role="status">
          {actsHint.note[language] || actsHint.note.en}
        </p>
      ) : null}

      <TargetDateCard profileId={profileId} targetDate={targetDate} dailyMinutes={dailyMinutes} />

      {readiness === null ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <>
          <SectionCard className="p-4">
            <h2 className="text-sm font-semibold">{t('trainer.exam.readiness.title')}</h2>
            <p className="font-display mt-1 text-3xl tabular-nums">
              {t('trainer.exam.readiness.overall', { percent: pct(readiness.overall) })}
            </p>
            <div className="mt-2">
              <ProgressBar
                value={pct(readiness.overall)}
                label={t('trainer.exam.readiness.overall', { percent: pct(readiness.overall) })}
              />
            </div>
            {/*
              The caveat travels with the number and is never a tooltip. It is
              the difference between "80% ready" and "80% ready over three
              tenths of the paper", and only the second is true.
            */}
            <p className="mt-3 text-sm text-muted-foreground">
              {t('trainer.exam.readiness.caveat', { percent: pct(mappedMarksShare(profile)) })}
            </p>
          </SectionCard>

          <NextActionsCard
            actions={nextActions({ ...readiness, profile, elapsedFraction: null })}
            profile={profile}
          />

          {/*
            Two of these three move the reader down THIS page and one leaves it.
            An anchor and a route look alike and behave differently, so the one
            that leaves is the one that is not styled as the primary action: the
            mock is a focus screen an officer sits inside, and the plan and the
            checklist are sections a few hundred pixels below.
          */}
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="outline">
              <Link to="#plan">
                <CalendarDays aria-hidden="true" />
                {t('trainer.exam.plan.title')}
              </Link>
            </Button>
            <Button asChild size="sm">
              <Link to="/study/exam/mock">
                <ListChecks aria-hidden="true" />
                {t('trainer.exam.mock.title')}
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link to="#checklist">
                <ClipboardCheck aria-hidden="true" />
                {t('trainer.exam.checklist.title')}
              </Link>
            </Button>
          </div>

          <RevisionSheetsCard profile={profile} />

          <h2 className="mt-2 text-sm font-semibold">{t('trainer.exam.readiness.unitsTitle')}</h2>
          <ReadinessBars readiness={readiness} papers={profile.papers} />

          {/*
            `scroll-mt-16` because the app's top bar is sticky: without it an
            anchor lands the section's heading underneath the chrome, which
            reads as "the link did nothing".
          */}
          <section id="plan" aria-labelledby="exam-plan-heading" className="scroll-mt-16 pt-4">
            <span id="exam-plan-heading" className="sr-only">
              {t('trainer.exam.plan.title')}
            </span>
            <ExamPlanSection profileId={profileId} targetDate={targetDate} dailyMinutes={dailyMinutes} />
          </section>

          <section id="checklist" className="scroll-mt-16 pt-4">
            <ExamChecklistSection profileId={profileId} />
          </section>
        </>
      )}
    </>
  )
}

function NextActionsCard({ actions, profile }: { actions: NextAction[]; profile: ExamProfile }) {
  const { t, language } = useT()
  if (actions.length === 0) return null

  const nameOf = (action: NextAction): string => {
    const paper = profile.papers.find((candidate) => candidate.id === action.paperId)
    const unit = paper?.units.find((candidate) => candidate.id === action.unitId)
    return unit ? unit.name[language] || unit.name.en : ''
  }

  return (
    <SectionCard className="p-4">
      <h2 className="text-sm font-semibold">{t('trainer.exam.actions.title')}</h2>
      <ol className="mt-3 flex flex-col gap-3">
        {actions.map((action, index) => (
          <li key={`${action.kind}:${action.unitKey ?? index}`} className="flex flex-wrap items-center gap-3">
            <span className="font-display flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs tabular-nums">
              {index + 1}
            </span>
            <span className="min-w-0 flex-1 text-sm">
              {t(ACTION_KEYS[action.kind], { count: action.count, unit: nameOf(action) })}
            </span>
            {action.actId ? (
              <Button asChild size="sm" variant="outline">
                <Link to={`/study/practise/review?act=${action.actId}`}>{t('trainer.exam.actions.go')}</Link>
              </Button>
            ) : null}
            {action.kind === 'take-mock' ? (
              <Button asChild size="sm" variant="outline">
                <Link to="/study/exam/mock">{t('trainer.exam.actions.go')}</Link>
              </Button>
            ) : null}
          </li>
        ))}
      </ol>
    </SectionCard>
  )
}

/**
 * `NextActionKind` → the i18n leaf, as a literal map.
 *
 * A map rather than a template of the kind string, so a kind added to
 * `readiness.ts` without a sentence beside it is a COMPILE error rather than a
 * row rendering its own key — the arrangement `AiDraftPanel.tsx` uses for its
 * per-tool progress labels, and for the same reason.
 */
const ACTION_KEYS = {
  'meet-new-cards': 'trainer.exam.actions.meetNewCards',
  'drill-weak-unit': 'trainer.exam.actions.drillWeakUnit',
  'take-mock': 'trainer.exam.actions.takeMock',
  'read-outside': 'trainer.exam.actions.readOutside',
  'set-target-date': 'trainer.exam.actions.setTargetDate',
} as const satisfies Record<NextAction['kind'], string>

/* ------------------------------------------------------------------ *
 * The date and the budget
 * ------------------------------------------------------------------ */

function TargetDateCard({
  profileId,
  targetDate,
  dailyMinutes,
}: {
  profileId: string
  targetDate: string | null
  dailyMinutes: number | null
}) {
  const { t } = useT()
  const now = useNow(60_000)
  const [draft, setDraft] = useState(targetDate ?? '')
  const [minutes, setMinutes] = useState(dailyMinutes === null ? '' : String(dailyMinutes))
  const [error, setError] = useState(false)

  const days = (() => {
    if (!targetDate) return null
    const today = istDay(now)
    if (targetDate === today) return t('trainer.exam.target.today')
    if (targetDate < today) return t('trainer.exam.target.passed')
    // Both sides are IST calendar days, so this is a difference of two dates
    // and not of two instants — the +05:30 offset cancels.
    const count = Math.round(
      (Date.parse(`${targetDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
    )
    return count === 1 ? t('trainer.exam.target.tomorrow') : t('trainer.exam.target.daysLeft', { count })
  })()

  const save = async () => {
    if (draft === '') {
      setError(false)
      await setTargetDate(profileId, null)
      return
    }
    // Refused rather than clamped, in the store — and the screen has to say so
    // rather than silently doing nothing, which is what a null return looks
    // like from here. `2027-02-31` parses in JavaScript, as the 3rd of March.
    if (!isIstDay(draft)) {
      setError(true)
      return
    }
    setError(false)
    const saved = await setTargetDate(profileId, draft)
    if (!saved) setError(true)
  }

  const saveMinutes = async () => {
    if (minutes.trim() === '') {
      await setDailyMinutes(profileId, null)
      return
    }
    await setDailyMinutes(profileId, Number(minutes))
  }

  return (
    <SectionCard id="exam-target" className="scroll-mt-16 p-4">
      <h2 className="text-sm font-semibold">{t('trainer.exam.target.label')}</h2>
      <p className="mt-1 text-sm text-muted-foreground" id="exam-date-hint">
        {t('trainer.exam.target.hint')}
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor="exam-target-date" className="block text-xs font-medium">
            {t('trainer.exam.target.label')}
          </label>
          <input
            id="exam-target-date"
            type="date"
            value={draft}
            aria-describedby="exam-date-hint"
            aria-invalid={error || undefined}
            onChange={(event) => setDraft(event.target.value)}
            className="mt-1 h-10 rounded-[10px] border border-input bg-card px-3 text-sm"
          />
        </div>
        <Button type="button" size="sm" onClick={() => void save()}>
          {t('trainer.exam.target.save')}
        </Button>
        {targetDate ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setDraft('')
              setError(false)
              void setTargetDate(profileId, null)
            }}
          >
            {t('trainer.exam.target.clear')}
          </Button>
        ) : null}
        <div>
          <label htmlFor="exam-daily-minutes" className="block text-xs font-medium">
            {t('trainer.exam.target.minutesLabel')}
          </label>
          <input
            id="exam-daily-minutes"
            type="number"
            min={MIN_DAILY_MINUTES}
            max={MAX_DAILY_MINUTES}
            inputMode="numeric"
            value={minutes}
            aria-describedby="exam-minutes-hint"
            onChange={(event) => setMinutes(event.target.value)}
            className="mt-1 h-10 w-24 rounded-[10px] border border-input bg-card px-3 text-sm"
          />
        </div>
        <Button type="button" size="sm" variant="outline" onClick={() => void saveMinutes()}>
          {t('trainer.exam.target.minutesSave')}
        </Button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground" id="exam-minutes-hint">
        {t('trainer.exam.target.minutesHint')}
      </p>
      <p className="mt-2 text-sm" role="status">
        {error ? (
          <span className="text-coral-foreground">{t('trainer.exam.target.invalid')}</span>
        ) : (
          (days ?? t('trainer.exam.target.none'))
        )}
      </p>
    </SectionCard>
  )
}
