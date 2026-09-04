import { useLiveQuery } from 'dexie-react-hooks'
import { BookMarked, ChevronRight, FileText, Flag, GraduationCap, ListChecks, Settings } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { FocusPlanCard } from '../components/FocusPlanCard'

import { DueChaptersCard } from '@/modules/library/components/DueChaptersCard'
import { useEffectiveCatalogue, useRulesIndex } from '../useCatalogue'
import { useNow } from '../useNow'
import { useTrainerSettings } from '../useTrainerSettings'
import { toTrainerTopicHref } from '../url'

import { useAi } from '@/ai/useAi'
import { PageHeader } from '@/components/common/PageHeader'
import { Chip, ProgressBar, QueryErrorState, SectionCard, Skeleton, StatCard } from '@/components/ui-x'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'
import {
  allStreaks,
  currentStreak,
  getDueQueue,
  longestStreak,
  saveSettings,
  statsForDay,
  weakAreasFor,
} from '@/lib/srs'
import { isServed } from '@/modules/trainer/schema'

/**
 * The mock test's own eligible-card kinds (`MockPage.tsx`), duplicated rather
 * than imported: each `/learn/*` page is its own lazy chunk
 * (`LearnPage.tsx`), and importing from `MockPage.tsx` here would pull that
 * whole page — its `CardView`, `AccuracyChart`, results screen — into Home's
 * chunk too.
 */
const MOCK_KINDS = new Set(['mcq', 'trueFalse', 'scenario'])

/**
 * `/study/practise` — the Trainer's dashboard: due count, streak, today's goal, weak
 * areas and the act toggles, plus the two entry points into a session.
 *
 * Every number here is a `useLiveQuery` over the FSRS store, so a grade given
 * in the review session updates this page's counts the instant the reader
 * navigates back to it — `src/lib/srs/store.ts`'s functions read
 * `srsCards`/`reviewLog`/`streaks`, and Dexie's live query tracks exactly
 * those tables regardless of this component's own dependency array.
 */
export default function HomePage() {
  const { t, language } = useT()
  const ai = useAi()
  const now = useNow()
  const index = useRulesIndex()
  const catalogue = useEffectiveCatalogue()
  const settings = useTrainerSettings()

  const queue = useLiveQuery(
    () => (catalogue && settings ? getDueQueue(catalogue, now, settings.actsEnabled) : Promise.resolve(null)),
    [catalogue, settings, now],
    undefined,
  )
  const stats = useLiveQuery(
    () =>
      catalogue && settings
        ? statsForDay(catalogue, now, undefined, settings.actsEnabled)
        : Promise.resolve(null),
    [catalogue, settings, now],
    undefined,
  )
  const weakAreas = useLiveQuery(
    () =>
      catalogue
        ? weakAreasFor(catalogue, { by: 'rule', minReviews: 3, acts: settings?.actsEnabled })
        : Promise.resolve(null),
    [catalogue, settings],
    undefined,
  )
  const streaks = useLiveQuery(() => allStreaks(), [], undefined)

  const [savingActs, setSavingActs] = useState(false)

  if (index.status === 'error') {
    return <QueryErrorState onRetry={index.retry} />
  }

  const loading =
    index.status !== 'ready' ||
    !catalogue ||
    !settings ||
    !stats ||
    queue === undefined ||
    streaks === undefined

  const toggleAct = async (actId: string) => {
    if (!settings) return
    setSavingActs(true)
    const current = settings.actsEnabled
    const next = current.includes(actId) ? current.filter((id) => id !== actId) : [...current, actId]
    await saveSettings({ actsEnabled: next })
    setSavingActs(false)
  }

  const isFirstRun = streaks !== undefined && streaks !== null && streaks.length === 0

  const remaining = queue?.length ?? 0
  const goalPct = stats
    ? stats.reviewed + remaining === 0
      ? 100
      : Math.round((stats.reviewed / (stats.reviewed + remaining)) * 100)
    : 0

  const streakCount = streaks ? currentStreak(streaks, now) : 0
  const bestStreak = streaks ? longestStreak(streaks) : 0

  const mockPool =
    catalogue && settings
      ? catalogue.filter(
          (card) =>
            isServed(card) &&
            MOCK_KINDS.has(card.kind) &&
            (settings.actsEnabled.length === 0 || settings.actsEnabled.includes(card.act)),
        )
      : []
  const mockDisabled = mockPool.length === 0

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <PageHeader
        as="h2"
        title={t('pages.learn.title')}
        subtitle={t('pages.learn.subtitle')}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/settings/trainer">
              <Settings aria-hidden="true" />
              {t('trainer.home.settingsLink')}
            </Link>
          </Button>
        }
      />

      {loading ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <>
          {isFirstRun ? (
            <SectionCard className="flex items-start gap-3 p-4">
              <GraduationCap aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
              <div>
                <h2 className="text-sm font-semibold">{t('trainer.home.firstRunTitle')}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{t('trainer.home.firstRunBody')}</p>
              </div>
            </SectionCard>
          ) : null}

          {/* Today: one card, one decision. */}
          <SectionCard active className="flex flex-col gap-4 p-4">
            <h2 className="text-sm font-semibold">{t('trainer.home.todayTitle')}</h2>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard label={t('trainer.home.dueLabel')} value={String(remaining)} />
              <StatCard
                label={t('trainer.home.streakLabel')}
                value={t('trainer.home.streakDays', { count: streakCount })}
                hint={t('trainer.home.longestStreakLabel') + ': ' + bestStreak}
              />
              <StatCard label={t('trainer.home.reviewedTodayLabel')} value={String(stats?.reviewed ?? 0)} />
              <StatCard label={t('trainer.home.newTodayLabel')} value={String(stats?.newIntroduced ?? 0)} />
            </div>

            <div>
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium">{t('trainer.home.goalRingLabel')}</p>
                <p className="font-display text-sm">{goalPct}%</p>
              </div>
              <ProgressBar className="mt-2" value={goalPct} label={t('trainer.home.goalRingLabel')} />
              <p className="mt-2 text-xs text-muted-foreground">
                {remaining === 0 ? t('trainer.home.allCaughtUp') : t('trainer.home.nothingDue')}
              </p>
            </div>

            <Button asChild size="lg" className="w-full sm:w-fit">
              <Link to="/study/practise/review">{t('trainer.home.startReview')}</Link>
            </Button>
          </SectionCard>

          {/*
            The five secondary destinations, always visible.

            The mock used to be a large button beside Start review that went
            DISABLED when no eligible card existed, which put a dead control in
            the most prominent place on the screen. It is a row here like the
            others, and the reason it cannot run yet is a sentence under it
            rather than an `aria-describedby` on a button nobody can press
            (Session 25's rule: disabled with a reason, never hidden).
          */}
          <nav aria-label={t('trainer.home.moreTitle')}>
            <ul className="flex flex-col gap-2">
              <DestinationRow
                to="/study/practise/mock"
                icon={ListChecks}
                label={t('trainer.home.startMock')}
                {...(mockDisabled ? { note: t('trainer.home.mockUnavailableReason') } : {})}
              />
              <DestinationRow to="/study/practise/browse" icon={FileText} label={t('trainer.home.browse')} />
              <DestinationRow
                to="/study/practise/bookmarks"
                icon={BookMarked}
                label={t('trainer.home.bookmarks')}
              />
              <DestinationRow to="/study/practise/reports" icon={Flag} label={t('trainer.home.reports')} />
              <DestinationRow
                to="/study/practise/review-queue"
                icon={ListChecks}
                label={t('trainer.home.reviewQueue')}
              />
            </ul>
          </nav>

          <SectionCard className="p-4">
            <h2 className="text-sm font-semibold">{t('trainer.home.weakAreasTitle')}</h2>
            {weakAreas && weakAreas.length > 0 ? (
              <>
                <p className="mt-1 text-xs text-muted-foreground">{t('trainer.home.weakAreasHint')}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {weakAreas.slice(0, 8).map((area) => (
                    <Link key={area.key} to={toTrainerTopicHref(area.act)}>
                      <Chip tone="coral">
                        {area.citation?.[language] || area.citation?.en || area.key} ·{' '}
                        {Math.round(area.rate * 100)}%
                      </Chip>
                    </Link>
                  ))}
                </div>
              </>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">{t('trainer.home.weakAreasEmpty')}</p>
            )}
            <FocusPlanCard ai={ai} />
          </SectionCard>

          {/*
            The Library's chapter deck, surfaced here as well as on its own hub.
            It is a SEPARATE schedule from this page's cards — a card asks a
            question, a chapter asks whether the reader could use it — and the
            hint under the list says so, because two "due" counts on one screen
            that mean different things is exactly how a reader stops trusting
            either. Nothing renders when nothing is due.
          */}
          <DueChaptersCard />

          <SectionCard className="p-4">
            <h2 className="text-sm font-semibold">{t('trainer.home.actsTitle')}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{t('trainer.home.actsHint')}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {index.status === 'ready'
                ? index.data.acts.map((act) => {
                    const active = settings.actsEnabled.length === 0 || settings.actsEnabled.includes(act.id)
                    return (
                      <button
                        key={act.id}
                        type="button"
                        disabled={savingActs}
                        onClick={() => void toggleAct(act.id)}
                      >
                        <Chip tone={active ? 'action' : 'neutral'}>
                          {act.short[language] || act.short.en}
                        </Chip>
                      </button>
                    )
                  })
                : null}
            </div>
          </SectionCard>
        </>
      )}
    </div>
  )
}

/**
 * One secondary destination: a full-width row with its own reason, if it has
 * one.
 *
 * A row rather than a button in a grid, because five equal buttons in a grid
 * read as five equal choices — and after "Start review" none of these is the
 * thing an officer came here to do.
 */
function DestinationRow({
  to,
  icon: Icon,
  label,
  note,
}: {
  to: string
  icon: typeof BookMarked
  label: string
  note?: string
}) {
  return (
    <li>
      <SectionCard className="transition-colors hover:border-input">
        <Link
          to={to}
          className="flex min-h-11 items-center gap-3 rounded-lg px-4 py-3 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">{label}</span>
            {note ? <span className="block text-xs text-muted-foreground">{note}</span> : null}
          </span>
          <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Link>
      </SectionCard>
    </li>
  )
}
