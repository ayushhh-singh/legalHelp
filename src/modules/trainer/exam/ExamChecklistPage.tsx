import { ArrowLeft, Printer } from 'lucide-react'
import { Link } from 'react-router-dom'

import { useActiveExam, useExamProfile } from './useExam'

import { PageHeader } from '@/components/common/PageHeader'
import { QueryErrorState, SectionCard, Skeleton } from '@/components/ui-x'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'
import { CHECKLIST_GROUPS, checklistFor, type ChecklistGroup, type ChecklistItem } from '@/lib/exam'

import type { ExamProfile } from '@/schemas/exam'

/**
 * `/learn/exam/checklist` — the exam-day list.
 *
 * Every item is something the fetched notification actually says, and
 * `src/lib/exam/checklist.ts` names the clause each one comes from. Nothing
 * here is general examination advice: a checklist a candidate follows on the
 * morning of an examination is the worst place in this app to be confidently
 * wrong, so an item this app cannot source is not on the list.
 *
 * It prints against the app's own page box rather than the Drafting Studio's
 * `a4-page`. That class paints fixed white paper with `#111` text in both
 * themes because it is a FACSIMILE of a Government letter; this is a checklist,
 * a facsimile of nothing, and using it would put `--muted-foreground` on white
 * in the dark theme (ADR-040's own note, in a new file).
 */
export default function ExamChecklistPage() {
  const { t } = useT()
  const choice = useActiveExam()

  // The header renders while the Dexie row is still being read, for the
  // reason `ExamHubPage` states: a screen with no `<h1>` is a screen a
  // reader tabbing in cannot place, and the title is known before the row.
  if (choice === undefined) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <PageHeader title={t('trainer.exam.checklist.title')} />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }
  if (choice === null) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <PageHeader title={t('trainer.exam.checklist.title')} />
        <p className="text-sm text-muted-foreground">{t('trainer.exam.readiness.empty')}</p>
        <Button asChild size="sm">
          <Link to="/learn/exam">{t('trainer.exam.picker.title')}</Link>
        </Button>
      </div>
    )
  }
  return <ChecklistFor profileId={choice.id} />
}

const GROUP_LABELS = {
  before: 'trainer.exam.checklist.groupBefore',
  carry: 'trainer.exam.checklist.groupCarry',
  inside: 'trainer.exam.checklist.groupInside',
} as const satisfies Record<ChecklistGroup, string>

/**
 * Item id → the i18n leaf, as a literal map.
 *
 * A map rather than a template, so an item added to `checklist.ts` without a
 * sentence beside it is a COMPILE error rather than a row rendering its own id.
 */
const ITEM_LABELS = {
  'admission-certificate': 'trainer.exam.checklist.item.admissionCertificate',
  'photo-id': 'trainer.exam.checklist.item.photoId',
  'prohibited-articles': 'trainer.exam.checklist.item.prohibitedArticles',
  'all-papers': 'trainer.exam.checklist.item.allPapers',
  'venue-and-time': 'trainer.exam.checklist.item.venueAndTime',
  'medium-is-final': 'trainer.exam.checklist.item.mediumIsFinal',
  'international-numerals': 'trainer.exam.checklist.item.internationalNumerals',
  'legible-handwriting': 'trainer.exam.checklist.item.legibleHandwriting',
  'negative-marking': 'trainer.exam.checklist.item.negativeMarking',
  'blank-costs-nothing': 'trainer.exam.checklist.item.blankCostsNothing',
  'confirm-circular': 'trainer.exam.checklist.item.confirmCircular',
} as const

function ChecklistFor({ profileId }: { profileId: string }) {
  const { t, language } = useT()
  const state = useExamProfile(profileId)

  if (state.status === 'error' || state.status === 'loading') {
    // Same rule: the header before the data, so the route always has an `<h1>`.
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <PageHeader title={t('trainer.exam.checklist.title')} />
        {state.status === 'error' ? (
          <QueryErrorState onRetry={state.retry} />
        ) : (
          <Skeleton className="h-64 w-full" />
        )}
      </div>
    )
  }

  const profile: ExamProfile = state.data
  const items = checklistFor(profile)

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <PageHeader
        title={t('trainer.exam.checklist.title')}
        subtitle={t('trainer.exam.checklist.subtitle')}
        actions={
          <div className="flex gap-2 print:hidden">
            <Button type="button" variant="outline" size="sm" onClick={() => window.print()}>
              <Printer aria-hidden="true" />
              {t('trainer.exam.checklist.print')}
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/learn/exam">
                <ArrowLeft aria-hidden="true" />
                {t('trainer.exam.title')}
              </Link>
            </Button>
          </div>
        }
      />

      <p className="text-sm text-muted-foreground">{profile.name[language] || profile.name.en}</p>

      {CHECKLIST_GROUPS.map((group) => {
        const rows = items.filter((item) => item.group === group)
        if (rows.length === 0) return null
        return (
          <SectionCard key={group} className="p-4">
            <h2 className="text-sm font-semibold">{t(GROUP_LABELS[group])}</h2>
            <ul className="mt-3 flex flex-col gap-3">
              {rows.map((item) => (
                <Row key={item.id} item={item} />
              ))}
            </ul>
          </SectionCard>
        )
      })}

      <p className="text-xs text-muted-foreground">
        {t('trainer.exam.checklist.source', { source: profile.patternSource.name })}
      </p>
    </div>
  )
}

function Row({ item }: { item: ChecklistItem }) {
  const { t } = useT()
  const key = ITEM_LABELS[item.id as keyof typeof ITEM_LABELS]

  // An id with no sentence renders nothing rather than its own id. The map is
  // exhaustive over what `checklist.ts` emits today; this is the guard for the
  // one it emits tomorrow.
  if (!key) return null

  return (
    <li className="flex items-start gap-3 text-sm">
      {/*
        A real checkbox, not a bullet: a candidate works down this list and
        ticks things off, and it is per-device state that outlives nothing —
        the page is printed or read once on one morning.
      */}
      <input type="checkbox" className="mt-1 h-4 w-4 shrink-0" id={`check-${item.id}`} />
      <label htmlFor={`check-${item.id}`} className="min-w-0 flex-1">
        {t(key, item.params)}
      </label>
    </li>
  )
}
