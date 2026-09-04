import { BookOpen, Bookmark, Clock, Highlighter, Plus, Search } from 'lucide-react'
import { useMemo } from 'react'
import { Link } from 'react-router-dom'

import { ProgressRing } from '../components/ProgressRing'
import {
  toAddWorkHref,
  toBookmarksHref,
  toLibrarySearchHref,
  toMineHref,
  toUnitHref,
  toWorkHref,
} from '../url'
import { usePersonalWorks } from '../useAnnotations'
import { shelfProgress, useAllProgress, useLibraryIndex } from '../useLibrary'

import { DataVersion } from '@/components/common/DataVersion'
import { Disclaimer } from '@/components/common/Disclaimer'
import { PageHeader } from '@/components/common/PageHeader'
import { DueChaptersCard } from '../components/DueChaptersCard'

import { Badge, Chip, QueryErrorState, SectionCard, Skeleton } from '@/components/ui-x'
import { useT } from '@/i18n/useT'
import { LIBRARY_CATEGORIES, tagLabel } from '@/lib/library'
import { cn } from '@/lib/utils'
import type { LibraryIndexEntry } from '@/schemas/library'

/**
 * `/study/read` — the shelf.
 *
 * Loads `data/library/index.json` and NOTHING else: fifteen names, counts and
 * citations, ~11 KB. A work's table of contents (8–220 KB) and its corpus (up
 * to 1.9 MB) are both behind the card the reader presses, the same lever
 * `useLawEngine(enabled)` pulls on the Law Converter.
 *
 * THE FILE TAB MARKS THE WORK LAST OPENED — one card per screen, which is the
 * whole rule for that signature. "Continue reading" is a DIFFERENT question and
 * is offered on every card that has progress: the committed version answered
 * both with one variable, so a reader half way through the CCS (Leave) Rules
 * who then opened the BNS lost their place in the Leave Rules entirely — the
 * ring said 40% and there was nothing to press.
 *
 * The shelf renders whether or not the progress read ever lands. It is a set
 * of rings and resume links over a list that came from a precached chunk; a
 * device whose storage is refused gets the library without them rather than a
 * skeleton for ever.
 */

function minutesLabel(minutes: number, t: ReturnType<typeof useT>['t']): string {
  return minutes >= 90
    ? t('library.aboutHours', { count: Math.round(minutes / 60) })
    : t('library.aboutMinutes', { count: minutes })
}

interface WorkCardProps {
  work: LibraryIndexEntry
  readCount: number
  active: boolean
  continueTo: string | null
}

function WorkCard({ work, readCount, active, continueTo }: WorkCardProps) {
  const { t, language } = useT()
  const pct = work.unitCount > 0 ? (readCount / work.unitCount) * 100 : 0

  return (
    <SectionCard active={active} className="flex flex-col">
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-base leading-snug font-semibold">
            <Link
              to={toWorkHref(work.id)}
              className="rounded-sm after:absolute after:inset-0 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {work.title[language]}
            </Link>
          </h3>
          {work.verify ? (
            <Badge tone="warning" className="shrink-0">
              {t('common.verifyWithDdo')}
            </Badge>
          ) : null}
        </div>

        <p className="text-sm text-muted-foreground">{work.description[language]}</p>

        <ul className="flex flex-wrap gap-1.5" aria-label={t('library.tag.label')}>
          {work.examTags.map((tag) => (
            <li key={tag}>
              <Chip>{tagLabel(tag, language)}</Chip>
            </li>
          ))}
        </ul>

        <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-2">
          <p className="flex items-center gap-3 text-xs text-muted-foreground tabular-nums">
            <span className="inline-flex items-center gap-1">
              <BookOpen aria-hidden="true" className="h-3.5 w-3.5" />
              {t('library.unitsCount', { count: work.unitCount })}
            </span>
            <span className="inline-flex items-center gap-1">
              <Clock aria-hidden="true" className="h-3.5 w-3.5" />
              {minutesLabel(work.estimatedMinutes, t)}
            </span>
          </p>
          <ProgressRing value={pct} label={t('library.progressLabel', { work: work.shortTitle[language] })} />
        </div>
      </div>

      {/*
        `relative z-10` so this sits above the card-wide stretched link on the
        title: a "continue reading" that the whole-card link swallowed would
        take the reader to the top of the book instead of back to where they
        stopped, which is the one thing this row exists to prevent.
      */}
      {continueTo ? (
        <Link
          to={continueTo}
          className="relative z-10 flex min-h-11 items-center justify-between gap-2 border-t border-border px-4 text-sm font-medium text-primary transition-colors hover:bg-accent/50"
        >
          {t('library.continueReading')}
          <span aria-hidden="true">→</span>
        </Link>
      ) : null}
    </SectionCard>
  )
}

export default function LibraryHubPage() {
  const { t } = useT()
  const index = useLibraryIndex()
  const progress = useAllProgress()
  const personal = usePersonalWorks()

  const { readByWork, resumeByWork, latestWorkId } = useMemo(() => shelfProgress(progress), [progress])

  if (index.status === 'error') {
    return (
      <div className="mx-auto max-w-5xl">
        <QueryErrorState onRetry={index.retry} />
      </div>
    )
  }

  if (index.status === 'loading') {
    return (
      <div className="mx-auto flex max-w-5xl flex-col gap-4">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  const { works, totals } = index.data
  const grouped = LIBRARY_CATEGORIES.map((category) => ({
    category,
    works: works.filter((work) => work.category === category),
  })).filter((group) => group.works.length > 0)

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <PageHeader as="h2" title={t('library.title')} subtitle={t('library.subtitle')} />

      <p className="text-sm text-muted-foreground tabular-nums">
        {t('library.shelfSummary', {
          works: totals.works,
          units: totals.units,
          hours: Math.round(totals.minutes / 60),
        })}
      </p>

      {/*
        The chapter deck's due list, above the shelf: a reader who is behind on
        a chapter they have already rated is being told before they are offered
        fifteen new books. It renders nothing at all when nothing is due
        (`DueChaptersCard`), which on a fresh device is every day.
      */}
      <DueChaptersCard />

      {/*
        The four screens that are ABOUT the shelf rather than on it. Plain links
        rather than a second nav: `src/lib/nav.ts` is the one list of
        destinations, and a work and a unit are screens inside this module.
      */}
      <nav aria-label={t('library.mine.title')} className="flex flex-wrap gap-2">
        {(
          [
            [toMineHref(), Highlighter, t('library.mine.title')],
            [toBookmarksHref(), Bookmark, t('library.bookmark.title')],
            [toLibrarySearchHref(), Search, t('library.search.allTitle')],
            [toAddWorkHref(), Plus, t('library.add.cta')],
          ] as const
        ).map(([href, Icon, label]) => (
          <Link
            key={href}
            to={href}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-input px-3 text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <Icon aria-hidden="true" className="h-4 w-4" />
            {label}
          </Link>
        ))}
      </nav>

      {/*
        The reader's own documents, first and separately. They are not one of
        the fifteen categories and must never be grouped with them: everything
        here is unverified by construction, and the badge says so on every card.
      */}
      {(personal ?? []).length > 0 ? (
        <section aria-labelledby="library-personal-heading">
          <h2
            id="library-personal-heading"
            className="mb-3 font-sans text-xs font-semibold text-muted-foreground uppercase"
          >
            {t('library.add.mine')}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(personal ?? []).map((row) => (
              <SectionCard key={row.id} className="flex flex-col">
                <div className="flex flex-1 flex-col gap-2 p-4">
                  <h3 className="text-base leading-snug font-semibold">
                    <Link
                      to={toWorkHref(row.id)}
                      className="rounded-sm after:absolute after:inset-0 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      {row.title}
                    </Link>
                  </h3>
                  <Badge tone="warning">{t('library.add.yourDocument')}</Badge>
                  {row.note ? <p className="text-sm text-muted-foreground">{row.note}</p> : null}
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {t('library.unitsCount', { count: row.units.length })}
                  </p>
                </div>
              </SectionCard>
            ))}
          </div>
        </section>
      ) : null}

      {grouped.map((group) => (
        <section key={group.category} aria-labelledby={`library-cat-${group.category}`}>
          <h2
            id={`library-cat-${group.category}`}
            className="mb-3 font-sans text-xs font-semibold text-muted-foreground uppercase"
          >
            {t(`library.category.${group.category}`)}
          </h2>
          <div className={cn('grid gap-4', 'sm:grid-cols-2 lg:grid-cols-3')}>
            {group.works.map((work) => {
              const resume = resumeByWork.get(work.id)
              return (
                <WorkCard
                  key={work.id}
                  work={work}
                  readCount={readByWork.get(work.id)?.size ?? 0}
                  // The file tab, and only on the work last opened. A
                  // DIFFERENT question from whether there is a place to
                  // resume — which is the conflation this fixed.
                  active={latestWorkId === work.id}
                  continueTo={resume ? toUnitHref(work.id, resume) : null}
                />
              )
            })}
          </div>
        </section>
      ))}

      <Disclaimer />
      <DataVersion dataset="library" />
    </div>
  )
}
