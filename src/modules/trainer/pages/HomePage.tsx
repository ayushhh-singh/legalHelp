import { useLiveQuery } from 'dexie-react-hooks'
import { BookMarked, FileText, Flag, GraduationCap, ListChecks, Settings } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { useEffectiveCatalogue, useRulesIndex } from '../useCatalogue'
import { useNow } from '../useNow'
import { useTrainerSettings } from '../useTrainerSettings'
import { toTrainerTopicHref } from '../url'

import { EmptyState } from '@/components/common/EmptyState'
import { PageHeader } from '@/components/common/PageHeader'
import { Chip, ProgressBar, QueryErrorState, SectionCard, Skeleton, StatCard } from '@/components/ui-x'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'
import { allStreaks, currentStreak, getDueQueue, longestStreak, saveSettings, statsForDay, weakAreasFor } from '@/lib/srs'

/**
 * `/learn` — the Trainer's dashboard: due count, streak, today's goal, weak
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
    () => (catalogue && settings ? statsForDay(catalogue, now, undefined, settings.actsEnabled) : Promise.resolve(null)),
    [catalogue, settings, now],
    undefined,
  )
  const weakAreas = useLiveQuery(
    () => (catalogue ? weakAreasFor(catalogue, { by: 'rule', minReviews: 3, acts: settings?.actsEnabled }) : Promise.resolve(null)),
    [catalogue, settings],
    undefined,
  )
  const streaks = useLiveQuery(() => allStreaks(), [], undefined)

  const [savingActs, setSavingActs] = useState(false)

  if (index.status === 'error') {
    return <QueryErrorState onRetry={index.retry} />
  }

  const loading = index.status !== 'ready' || !catalogue || !settings || !stats || queue === undefined || streaks === undefined

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

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <PageHeader
        title={t('pages.learn.title')}
        subtitle={t('pages.learn.subtitle')}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/learn/settings">
              <Settings aria-hidden="true" />
              {t('trainer.home.settingsLink')}
            </Link>
          </Button>
        }
      />

      {loading ? (
        <Skeleton className="h-64 w-full" />
      ) : isFirstRun ? (
        <EmptyState
          icon={GraduationCap}
          title={t('pages.learn.emptyTitle')}
          body={t('pages.learn.emptyBody')}
          action={
            <Button asChild>
              <Link to="/learn/review">{t('trainer.home.startReview')}</Link>
            </Button>
          }
        />
      ) : (
        <>
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

          <SectionCard className="p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium">{t('trainer.home.goalRingLabel')}</p>
              <p className="font-display text-sm">{goalPct}%</p>
            </div>
            <ProgressBar className="mt-2" value={goalPct} label={t('trainer.home.goalRingLabel')} />
            <p className="mt-2 text-xs text-muted-foreground">
              {remaining === 0 ? t('trainer.home.allCaughtUp') : t('trainer.home.nothingDue')}
            </p>
          </SectionCard>

          <div className="grid gap-3 sm:grid-cols-2">
            <Button asChild size="lg">
              <Link to="/learn/review">{t('trainer.home.startReview')}</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to="/learn/mock">{t('trainer.home.startMock')}</Link>
            </Button>
          </div>

          <SectionCard className="p-4">
            <h2 className="text-sm font-semibold">{t('trainer.home.weakAreasTitle')}</h2>
            {weakAreas && weakAreas.length > 0 ? (
              <>
                <p className="mt-1 text-xs text-muted-foreground">{t('trainer.home.weakAreasHint')}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {weakAreas.slice(0, 8).map((area) => (
                    <Link key={area.key} to={toTrainerTopicHref(area.act)}>
                      <Chip tone="coral">
                        {(area.citation?.[language] || area.citation?.en || area.key)} · {Math.round(area.rate * 100)}%
                      </Chip>
                    </Link>
                  ))}
                </div>
              </>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">{t('trainer.home.weakAreasEmpty')}</p>
            )}
          </SectionCard>

          <SectionCard className="p-4">
            <h2 className="text-sm font-semibold">{t('trainer.home.actsTitle')}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{t('trainer.home.actsHint')}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {index.status === 'ready'
                ? index.data.acts.map((act) => {
                    const active = settings.actsEnabled.length === 0 || settings.actsEnabled.includes(act.id)
                    return (
                      <button key={act.id} type="button" disabled={savingActs} onClick={() => void toggleAct(act.id)}>
                        <Chip tone={active ? 'action' : 'neutral'}>{act.short[language] || act.short.en}</Chip>
                      </button>
                    )
                  })
                : null}
            </div>
          </SectionCard>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Button asChild variant="outline">
              <Link to="/learn/browse">
                <FileText aria-hidden="true" />
                {t('trainer.home.browse')}
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/learn/bookmarks">
                <BookMarked aria-hidden="true" />
                {t('trainer.home.bookmarks')}
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/learn/review-queue">
                <ListChecks aria-hidden="true" />
                {t('trainer.home.reviewQueue')}
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/learn/reports">
                <Flag aria-hidden="true" />
                {t('trainer.home.reports')}
              </Link>
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
