import { useLiveQuery } from 'dexie-react-hooks'
import {
  BookOpen,
  CalendarClock,
  FilePlus2,
  FileSignature,
  Mail,
  Scale,
  Search,
  Target,
  Wallet,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { AppLink } from '@/app/AppLink'
import { usePaletteStore } from '@/app/paletteStore'
import { PageHeader } from '@/components/common/PageHeader'
import { SectionCard } from '@/components/ui-x'
import { Button } from '@/components/ui/button'
import { db } from '@/db'
import { useT } from '@/i18n/useT'
import { dueFollowUps } from '@/lib/drafting/register'
import { istDay } from '@/lib/istDay'
import { loadLibraryIndex } from '@/lib/library/data'
import { loadExamIndex } from '@/modules/trainer/exam/data'
import { toUnitHref } from '@/modules/library/url'

/**
 * `/home` — where an officer lands, and the one screen that is about THEM
 * rather than about a module.
 *
 * The app had no such screen: `/` went to the Law Converter, so "carry on with
 * the O.M. I was writing" meant remembering which of seven tabs it was under.
 * Every card here answers one question — what was I doing, and what is waiting —
 * and every one of them is a link into the section that owns it. Nothing on this
 * page is a feature of its own (ADR-046 §4).
 *
 * ### What it costs to load
 *
 * Every figure comes from IndexedDB — rows this device has already written —
 * plus two small index files: the Library's 11 KB shelf, to name a rule book,
 * and the exam picker's 2 KB index, to name an examination. It reads NO corpus,
 * no card catalogue, no pay table, no template. A landing page that pulled four
 * megabytes to draw six cards would be the slowest screen in the app.
 *
 * An empty state is ONE line and the action that fills it, never a paragraph
 * explaining a feature: a first-run reader meets six cards, and six paragraphs
 * is a wall.
 */
export default function HomePage() {
  const { t } = useT()
  const openPalette = usePaletteStore((s) => s.openPalette)

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <PageHeader title={t('pages.home.title')} subtitle={t('pages.home.subtitle')} />

      {/*
        The search field. It opens the command palette rather than being a
        second search of its own — the palette already reaches Law sections, job
        posts, the glossary, document types, rule books and portals through each
        module's OWN index, and a second box over the same data is a second set
        of results that can disagree with it.
      */}
      <button
        type="button"
        data-module-search
        onClick={openPalette}
        className="flex min-h-11 w-full items-center gap-2 rounded-[10px] border border-input bg-card px-3 text-start text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
      >
        <Search aria-hidden="true" className="h-4 w-4 shrink-0" />
        {t('home.search.placeholder')}
        <kbd className="ms-auto hidden rounded border border-border px-1 py-0.5 text-[10px] sm:inline">
          Ctrl K
        </kbd>
      </button>

      <QuickActions />

      <div className="grid gap-4 sm:grid-cols-2">
        <ContinueReading />
        <ContinueDrafting />
        <DueToday />
        <FollowUps />
      </div>

      <ExamCountdown />
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * The cards
 * ------------------------------------------------------------------ */

function Card({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof BookOpen
  title: string
  children: React.ReactNode
}) {
  return (
    <SectionCard className="flex h-full flex-col gap-2 p-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
        {title}
      </h2>
      {children}
    </SectionCard>
  )
}

function Empty({ line, to, action }: { line: string; to: string; action: string }) {
  return (
    <>
      <p className="text-sm text-muted-foreground">{line}</p>
      <Button asChild size="sm" variant="outline" className="mt-auto w-fit">
        <Link to={to}>{action}</Link>
      </Button>
    </>
  )
}

function ContinueReading() {
  const { t, language } = useT()
  const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map())

  const last = useLiveQuery(
    async () => (await db.libraryProgress.orderBy('at').reverse().limit(1).toArray())[0] ?? null,
    [],
    undefined,
  )

  useEffect(() => {
    if (!last) return
    let alive = true
    void loadLibraryIndex()
      .then((index) => {
        if (!alive) return
        setNames(new Map(index.works.map((work) => [work.id, work.shortTitle[language]])))
      })
      .catch(() => {
        // A work this device added itself is not in the shelf index, and a
        // failed 11 KB fetch is not a reason to hide the link — the row's own
        // work id is a usable name until the index arrives.
      })
    return () => {
      alive = false
    }
  }, [last, language])

  return (
    <Card icon={BookOpen} title={t('home.reading.title')}>
      {last ? (
        <>
          <p className="text-sm">
            <span className="font-medium">{names.get(last.workId) ?? last.workId}</span>
            <span className="text-muted-foreground"> · {last.unitId}</span>
          </p>
          <Button asChild size="sm" className="mt-auto w-fit">
            <AppLink to={toUnitHref(last.workId, last.unitId)}>{t('home.reading.resume')}</AppLink>
          </Button>
        </>
      ) : (
        <Empty line={t('home.reading.empty')} to="/study/read" action={t('home.reading.browse')} />
      )}
    </Card>
  )
}

function ContinueDrafting() {
  const { t } = useT()
  const last = useLiveQuery(
    async () => (await db.documents.orderBy('updatedAt').reverse().limit(1).toArray())[0] ?? null,
    [],
    undefined,
  )

  return (
    <Card icon={FileSignature} title={t('home.drafting.title')}>
      {last ? (
        <>
          <p className="truncate text-sm font-medium">{last.title || t('draft.editor.untitled')}</p>
          <p className="text-xs text-muted-foreground">
            {t(
              `draft.editor.status.${last.status === 'sent' ? 'sent' : last.status === 'final' ? 'final' : 'draft'}`,
            )}
          </p>
          <Button asChild size="sm" className="mt-auto w-fit">
            <AppLink to={`/draft/d/${last.id}`}>{t('home.drafting.resume')}</AppLink>
          </Button>
        </>
      ) : (
        <Empty line={t('home.drafting.empty')} to="/draft/new" action={t('home.quick.newDocument')} />
      )}
    </Card>
  )
}

function DueToday() {
  const { t } = useT()

  const counts = useLiveQuery(
    async () => {
      const now = new Date().toISOString()
      const [cards, chapters, settings] = await Promise.all([
        db.srsCards.where('due').belowOrEqual(now).count(),
        db.chapterCards.where('due').belowOrEqual(now).count(),
        db.trainerSettings.get('trainer'),
      ])
      return { cards, chapters, narrowed: (settings?.actsEnabled?.length ?? 0) > 0 }
    },
    [],
    undefined,
  )

  if (!counts)
    return (
      <Card icon={Target} title={t('home.due.title')}>
        {null}
      </Card>
    )

  const nothing = counts.cards === 0 && counts.chapters === 0

  return (
    <Card icon={Target} title={t('home.due.title')}>
      {nothing ? (
        <Empty line={t('home.due.empty')} to="/study/practise" action={t('home.due.open')} />
      ) : (
        <>
          <p className="font-display text-2xl tabular-nums">{t('home.due.cards', { count: counts.cards })}</p>
          {counts.chapters > 0 ? (
            <p className="text-xs text-muted-foreground">
              {t('home.due.chapters', { count: counts.chapters })}
            </p>
          ) : null}
          {/*
            Said rather than silently applied. This count is every card
            SCHEDULED for today, which is what the review session shows unless
            the reader has narrowed their rule books — and a home page whose
            number is larger than the session that follows it is a home page
            nobody trusts twice. The exact filtered figure needs the whole
            card catalogue, which this screen deliberately does not load.
          */}
          {counts.narrowed ? <p className="text-xs text-muted-foreground">{t('home.due.narrowed')}</p> : null}
          <Button asChild size="sm" className="mt-auto w-fit">
            <AppLink to="/study/practise/review">{t('home.due.start')}</AppLink>
          </Button>
        </>
      )}
    </Card>
  )
}

function FollowUps() {
  const { t } = useT()
  const due = useLiveQuery(
    async () => {
      const rows = await db.registerEntries.toArray()
      const entries = rows
        .map((row) => row.entry)
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
      return dueFollowUps(entries as never, istDay(Date.now())).length
    },
    [],
    undefined,
  )

  return (
    <Card icon={Mail} title={t('home.followUps.title')}>
      {due === undefined || due === 0 ? (
        <Empty line={t('home.followUps.empty')} to="/draft/register" action={t('home.followUps.open')} />
      ) : (
        <>
          <p className="font-display text-2xl tabular-nums">{t('home.followUps.count', { count: due })}</p>
          <Button asChild size="sm" className="mt-auto w-fit">
            <AppLink to="/draft/register">{t('home.followUps.open')}</AppLink>
          </Button>
        </>
      )}
    </Card>
  )
}

/**
 * The countdown, and it renders NOTHING at all when no examination is set.
 *
 * An "Exam: none" card on the landing screen of an app most of whose readers
 * are not sitting one is a permanent reminder of a feature they did not ask
 * for. It appears when there is something to count down to and not before.
 */
function ExamCountdown() {
  const { t, language } = useT()
  const [name, setName] = useState<string | null>(null)

  /*
    `istDay(Date.now())` is read INSIDE the querier, not during render.

    A component that reads the clock while rendering is a component whose
    output depends on when React happened to call it, which is what
    `react-hooks/purity` refuses — and a countdown does not need the day to
    advance while the screen is open.
  */
  const choice = useLiveQuery(
    async () => {
      const row = (await db.examChoices.where('active').equals(1).toArray())[0] ?? null
      return row ? { row, today: istDay(Date.now()) } : null
    },
    [],
    undefined,
  )

  const profileId = choice?.row.id ?? null
  useEffect(() => {
    if (!profileId) return
    let alive = true
    void loadExamIndex()
      .then((index) => {
        if (!alive) return
        const entry = index.profiles.find((candidate) => candidate.id === profileId)
        setName(entry ? entry.name[language] || entry.name.en : null)
      })
      .catch(() => setName(null))
    return () => {
      alive = false
    }
  }, [profileId, language])

  if (!choice) return null

  const { today } = choice
  const target = choice.row.targetDate

  return (
    <SectionCard active className="flex flex-wrap items-center justify-between gap-3 p-4">
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <CalendarClock aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
          {name ?? t('home.exam.title')}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {!target
            ? t('home.exam.noDate')
            : target < today
              ? t('home.exam.passed')
              : t('home.exam.daysLeft', {
                  count: Math.round(
                    (Date.parse(`${target}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
                  ),
                })}
        </p>
      </div>
      <Button asChild size="sm" variant="outline">
        <Link to="/study/exam">{t('home.exam.open')}</Link>
      </Button>
    </SectionCard>
  )
}

/** Four things an officer starts from a standing start. */
function QuickActions() {
  const { t } = useT()
  const actions = [
    { to: '/draft/new', icon: FilePlus2, label: t('home.quick.newDocument') },
    { to: '/draft/reply', icon: Mail, label: t('home.quick.reply') },
    { to: '/law', icon: Scale, label: t('home.quick.convert') },
    { to: '/tools/salary', icon: Wallet, label: t('home.quick.salary') },
  ]
  return (
    <section aria-labelledby="home-quick" className="flex flex-col gap-3">
      <h2 id="home-quick" className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {t('home.quick.title')}
      </h2>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {actions.map((action) => (
          <li key={action.to} className="contents">
            <Button asChild variant="outline" className="justify-start">
              <Link to={action.to}>
                <action.icon aria-hidden="true" />
                <span className="truncate">{action.label}</span>
              </Link>
            </Button>
          </li>
        ))}
      </ul>
    </section>
  )
}
