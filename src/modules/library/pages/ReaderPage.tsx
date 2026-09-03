import { ArrowLeft, Bookmark, BookmarkCheck, ChevronLeft, ChevronRight, Printer } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'

import { RelatedRail } from '../components/RelatedRail'
import { TypeControls } from '../components/TypeControls'
import { UnitBody } from '../components/UnitBody'
import { toUnitHref, toWorkHref, unitIdFromPath } from '../url'
import { useBookmarkedUnitIds, useReaderPrefs, useWork, useWorkCorpus } from '../useLibrary'

import { DataVersion } from '@/components/common/DataVersion'
import { Disclaimer } from '@/components/common/Disclaimer'
import { SourceChip } from '@/components/common/SourceChip'
import { Badge, ProgressBar, QueryErrorState, SectionCard, SectionNumber, Skeleton } from '@/components/ui-x'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'
import type { Language } from '@/i18n'
import {
  adjacent,
  estimateReadTime,
  getUnit,
  isWorkId,
  recordProgress,
  toggleBookmark,
  unitLabel,
} from '@/lib/library'
import { cn } from '@/lib/utils'
import type { LibraryWork } from '@/schemas/library'

/**
 * `/library/:workId/:unitId` — the reader.
 *
 * Three things here are decisions rather than layout:
 *
 * 1. **A missing Hindi TEXT is stated, never filled.** Not one of the fifteen
 *    works has a Hindi text layer worth reading (ADR-023, and NCRB publishes
 *    none for the Sanhitas), so `mode: 'hi'` would render an empty page for
 *    every unit in the app. It renders the English text under a bilingual
 *    notice instead — the master context forbids a silent fallback, not an
 *    announced one, and a machine translation of a penal provision is the one
 *    thing this project must never print.
 *
 * 2. **Progress is written on arrival AND on a 30-second dwell**, so "continue
 *    reading" points at the unit the reader actually stopped in rather than the
 *    last one they finished. The interval is cleared on unmount and the arrival
 *    write is keyed on the unit, so StrictMode's double mount writes the same
 *    row twice rather than two rows — `secondsRead` only accumulates from the
 *    timer, which StrictMode's cleanup cancels.
 *
 * 3. **J/K and Home/End move between units**, and none of them fires while the
 *    reader is typing — the same rule `src/app/useGlobalShortcuts.ts` states,
 *    applied locally because these keys mean something only on this page.
 */

/** How long between dwell writes. Long enough not to churn IndexedDB. */
const DWELL_MS = 30_000

const versionKeyFor = (work: LibraryWork): string =>
  work.corpus.kind === 'law' ? `law-${work.id}` : `rules-${work.id}`

const isTypingTarget = (target: EventTarget | null): boolean => {
  const element = target as HTMLElement | null
  if (!element) return false
  const tag = element.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || element.isContentEditable
}

/**
 * Is a dialog open over this page — the command palette, the shortcuts-help
 * sheet, the AI consent modal?
 *
 * `src/app/useGlobalShortcuts.ts` learned this the hard way (ADR-029's
 * addendum, defect six): a bare-key shortcut fired underneath an open sheet
 * navigates away and leaves the sheet showing over a page it was never opened
 * on. This handler shipped without the guard and repeated it — `j` with the
 * shortcuts sheet open moved the reader to the next section behind it.
 *
 * Stricter than `useGlobalShortcuts`'s version, which deliberately excludes the
 * palette because it owns that one. Nothing here should work under ANY dialog.
 */
const dialogOpen = (): boolean => document.querySelector('[role="dialog"]') !== null

export default function ReaderPage() {
  const { t, language } = useT()
  const navigate = useNavigate()
  const { workId, unitId } = useParams<{ workId: string; unitId: string }>()

  const work = useWork(workId)
  const corpus = useWorkCorpus(work.data)
  const { prefs, update } = useReaderPrefs(language)
  const bookmarked = useBookmarkedUnitIds(workId)

  const unit = corpus.data && unitId ? getUnit(corpus.data, unitId) : null
  const around = useMemo(
    () => (corpus.data && unitId ? adjacent(corpus.data, unitId) : null),
    [corpus.data, unitId],
  )

  /**
   * The current unit is read from the URL at press time, not from this render.
   *
   * Two shapes were tried before this one and both were wrong in the same way.
   * A mount-only listener reading a "latest ref" (the shape
   * `useGlobalShortcuts` uses) and a listener re-subscribed on every unit are
   * BOTH swapped in a passive effect, so between React Router committing a
   * navigation and that effect running, the attached handler still closes over
   * the previous unit's neighbours: `j` then `k` from Rule 2 lands on Rule 1.
   * Forward one, back two. The ref version failed every time; the
   * re-subscribing version failed about one run in six, which is worse.
   *
   * `unitIdFromPath(window.location.pathname, …)` is authoritative because the
   * navigation updates the URL synchronously, before any of that. The rendered
   * `unitId` stays as the fallback for `MemoryRouter`, which does not touch
   * `window.location` — and where effects flush between interactions anyway, so
   * the window never opens.
   *
   * `useGlobalShortcuts`'s own latest-ref shape is right THERE and wrong here,
   * and the difference is worth naming: it carries state across keypresses (a
   * pending `g` and its timer) that a re-subscription would destroy, and its
   * targets are static paths that cannot go stale. This handler is stateless
   * and its target depends entirely on where the reader currently is.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (isTypingTarget(event.target) || dialogOpen()) return
      if (!workId || !corpus.data) return

      const here = unitIdFromPath(window.location.pathname, workId) ?? unitId
      if (!here) return

      // Case-folded: CapsLock made `useGlobalShortcuts` miss every chord until
      // ADR-029's edge-case pass, and the same key would miss here.
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
      const order = work.data?.readingOrder ?? []
      const neighbours = adjacent(corpus.data, here)

      const target =
        key === 'j' ? neighbours.next?.id
        : key === 'k' ? neighbours.previous?.id
        : event.key === 'Home' ? order[0]
        : event.key === 'End' ? order.at(-1)
        : undefined

      if (target !== undefined && target !== here) {
        event.preventDefault()
        void navigate(toUnitHref(workId, target))
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
    // `corpus.data` and `work.data` change once per WORK, not per unit, so this
    // subscribes about as often as the reader opens a book.
  }, [corpus.data, work.data, workId, unitId, navigate])

  // Arrival, then every 30 seconds of dwell. The first write carries no
  // seconds — the reader has not read for any yet — which is what makes an
  // arrival idempotent across StrictMode's double mount.
  useEffect(() => {
    if (!workId || !unitId || !unit) return
    void recordProgress(workId, unitId, 0)
    const timer = setInterval(() => {
      // Only while the tab is actually in front of somebody. A unit left open
      // in a background tab overnight would otherwise record eight hours of
      // "reading" into a field called `secondsRead`, which Session 27 is going
      // to surface. The arrival write above is unconditional, because arriving
      // is what "continue reading" reads back and it happens exactly once.
      if (document.visibilityState !== 'visible') return
      void recordProgress(workId, unitId, DWELL_MS / 1000)
    }, DWELL_MS)
    return () => clearInterval(timer)
  }, [workId, unitId, unit])

  // Moving between units keeps the page scrolled where the previous unit
  // ended, which reads as a page that did not change.
  const headingRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    // Guarded because an effect that throws takes the whole route down through
    // `App.tsx`'s ErrorBoundary, and moving the viewport is a courtesy. Every
    // browser this app targets implements `scrollIntoView`; jsdom does not, and
    // an environment that cannot scroll must still be able to READ, which is
    // the point. It also means the reader can be driven in a component test at
    // all — the first version crashed on the first `j` press.
    headingRef.current?.scrollIntoView?.({ block: 'start', behavior: 'auto' })
  }, [unitId])

  const [copyNotice, setCopyNotice] = useState<string | null>(null)

  const onBookmark = async () => {
    if (!workId || !unitId) return
    try {
      const now = await toggleBookmark(workId, unitId)
      setCopyNotice(now ? t('library.reader.bookmarked') : t('library.reader.bookmark'))
    } catch {
      // A blocked or full IndexedDB must not throw out of a click handler.
      setCopyNotice(t('library.reader.bookmarkFailed'))
    }
  }

  // A wrong URL, not a failed load — see the same guard in `WorkPage`.
  if (workId !== undefined && !isWorkId(workId)) return <Navigate to="/library" replace />

  if (work.status === 'error' || corpus.status === 'error') {
    return (
      <div className="mx-auto max-w-3xl">
        <QueryErrorState onRetry={work.status === 'error' ? work.retry : corpus.retry} />
        <Button asChild variant="outline" size="sm" className="mt-4">
          <Link to="/library">
            <ArrowLeft aria-hidden="true" />
            {t('library.back')}
          </Link>
        </Button>
      </div>
    )
  }

  // NOT `|| bookmarked === undefined`. Whether this section is bookmarked is a
  // decoration on a control; the SECTION is what the reader came for, and on a
  // device whose storage is refused that query never resolves at all.
  if (work.status === 'loading' || corpus.status === 'loading') {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    )
  }

  const data = work.data

  if (!unit || !around) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <p role="alert" className="text-sm text-muted-foreground">
          {t('library.reader.notFound')}
        </p>
        <Button asChild variant="outline" size="sm" className="self-start">
          <Link to={toWorkHref(data.id)}>
            <ArrowLeft aria-hidden="true" />
            {t('library.backToWork', { work: data.shortTitle[language] })}
          </Link>
        </Button>
      </div>
    )
  }

  const shownLanguages: Language[] = prefs.mode === 'both' ? ['en', 'hi'] : [prefs.mode]
  const hindiShown = shownLanguages.includes('hi')
  /**
   * Whether the reader asked for Hindi and there is none.
   *
   * `unit.body.hi` is the ONLY test. The first version also required
   * `unit.parts.length === 0`, and `parts` is a re-segmentation of the same
   * English text — so every rule with sub-rules (219 of 818) silently rendered
   * the English under no notice at all, which is precisely the fallback the
   * master context forbids. A real browser found it; nothing in jsdom would
   * have, because both halves were individually correct.
   */
  const hindiTextMissing = hindiShown && unit.body.hi.length === 0
  // The Hindi HEADING exists for almost every unit and is authored or curated
  // by this project, never published — which the reader is told wherever it is
  // the thing they are reading.
  const curatedHindiHeading = hindiShown && Boolean(unit.heading.hi) && data.verify

  const shownHeading = unitLabel(unit.heading, unit.excerpt, language)
  const readMinutes = estimateReadTime([...unit.body.en, ...unit.body.hi].join(' '))
  const isBookmarked = bookmarked?.has(unit.id) ?? false
  const cardCount = data.practiseCounts[unit.id] ?? 0

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      {/*
        Sticky, and it carries the work, the unit number and the position — the
        three things a reader deep in a 531-section code stops being able to
        answer from the text alone.
      */}
      <div
        data-print-hide
        className="sticky top-14 z-20 -mx-4 border-b border-border bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6"
      >
        <div className="mx-auto flex max-w-6xl flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Link
              to={toWorkHref(data.id)}
              className="inline-flex min-h-9 items-center gap-1.5 text-sm text-primary underline-offset-4 hover:underline"
            >
              <ArrowLeft aria-hidden="true" className="h-4 w-4" />
              {data.shortTitle[language]}
            </Link>
            <span className="text-xs text-muted-foreground tabular-nums">
              {t('library.reader.of', { position: around.position, total: around.total })} ·{' '}
              {t('library.reader.readTime', { count: readMinutes })}
            </span>
          </div>
          <ProgressBar
            value={(around.position / Math.max(1, around.total)) * 100}
            label={t('library.progressLabel', { work: data.shortTitle[language] })}
          />
        </div>
      </div>

      <TypeControls prefs={prefs} onChange={(patch) => void update(patch)} devanagariShown={hindiShown} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <article className="library-print-root flex min-w-0 flex-col gap-4">
          <SectionCard active className="library-print-page">
            <div className="flex flex-col gap-4 p-4 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <SectionNumber className="mt-1 shrink-0">{unit.number}</SectionNumber>
                  <h1
                    ref={headingRef}
                    lang={shownHeading.lang}
                    className={cn(
                      'min-w-0 scroll-mt-32 text-xl leading-snug font-semibold sm:text-2xl',
                      // A unit with no published heading is titled by a
                      // quotation of its own opening; it is set apart so
                      // nobody reads it as the heading the Ministry printed.
                      shownHeading.isExcerpt && 'font-sans text-lg font-medium text-muted-foreground italic',
                    )}
                  >
                    {shownHeading.text}
                  </h1>
                </div>
                <div data-print-hide className="flex shrink-0 items-center gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-9 w-9"
                    aria-pressed={isBookmarked}
                    aria-label={
                      isBookmarked ? t('library.reader.removeBookmark') : t('library.reader.bookmark')
                    }
                    onClick={() => void onBookmark()}
                  >
                    {isBookmarked ? <BookmarkCheck aria-hidden="true" /> : <Bookmark aria-hidden="true" />}
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-9 w-9"
                    aria-label={t('library.reader.print')}
                    onClick={() => window.print()}
                  >
                    <Printer aria-hidden="true" />
                  </Button>
                </div>
              </div>

              <p aria-live="polite" className="sr-only">
                {copyNotice ?? ''}
              </p>

              {unit.chapter ? (
                <p className="text-xs text-muted-foreground">
                  {unit.chapter.number}
                  {unit.chapter.title[language] || unit.chapter.title.en
                    ? ` — ${unit.chapter.title[language] || unit.chapter.title.en}`
                    : ''}
                </p>
              ) : null}

              {curatedHindiHeading ? (
                <p className="rounded-md border-l-[3px] border-marigold bg-marigold/15 px-3 py-2 text-xs text-marigold-foreground">
                  {t('library.reader.curatedHindi')}
                </p>
              ) : null}

              {hindiTextMissing ? (
                <p
                  role="note"
                  className="rounded-md border-l-[3px] border-marigold bg-marigold/15 px-3 py-2 text-sm text-marigold-foreground"
                >
                  {t('library.reader.noHindi')}
                </p>
              ) : null}

              <div
                className={cn(
                  prefs.mode === 'both' && unit.body.hi.length > 0
                    ? 'grid gap-6 lg:grid-cols-2'
                    : 'flex flex-col',
                )}
              >
                {/*
                  When Hindi has no text there is nothing to put beside the
                  English, so "Both" shows one column and the notice above says
                  why — an empty second pane would read as a rendering failure.
                */}
                {(prefs.mode === 'both' && unit.body.hi.length === 0
                  ? (['en'] as Language[])
                  : shownLanguages
                ).map((lang) => (
                  <div key={lang} className="min-w-0">
                    {prefs.mode === 'both' && unit.body.hi.length > 0 ? (
                      <h2 className="mb-2 font-sans text-xs font-semibold text-muted-foreground uppercase">
                        {t(`library.lang.${lang}`)}
                      </h2>
                    ) : null}
                    <UnitBody
                      unit={unit}
                      // A Hindi reader with no Hindi text reads the English,
                      // announced. `lang` on the element is what it actually
                      // is, so a screen reader does not read English in a
                      // Hindi voice.
                      lang={lang === 'hi' && unit.body.hi.length === 0 ? 'en' : lang}
                      prefs={prefs}
                    />
                  </div>
                ))}
              </div>

              <footer className="flex flex-col gap-2 border-t border-border pt-4">
                <p className="text-xs text-muted-foreground">{unit.citation[language]}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <SourceChip name={data.source.name} url={data.source.url} />
                  {data.verify ? <Badge tone="warning">{t('common.verifyWithDdo')}</Badge> : null}
                </div>
                <DataVersion dataset={versionKeyFor(data)} />
                <Disclaimer className="mt-1" />
              </footer>
            </div>
          </SectionCard>

          <nav data-print-hide aria-label={t('library.toc.title')} className="flex items-stretch gap-3">
            {around.previous ? (
              <Button asChild variant="outline" className="h-auto flex-1 justify-start py-2 text-left">
                <Link to={toUnitHref(data.id, around.previous.id)}>
                  <ChevronLeft aria-hidden="true" />
                  <span className="flex min-w-0 flex-col">
                    <span className="text-xs text-muted-foreground">{t('library.reader.previous')}</span>
                    <span className="truncate">{around.previous.number}</span>
                  </span>
                </Link>
              </Button>
            ) : (
              <p className="flex-1 self-center text-xs text-muted-foreground">{t('library.reader.first')}</p>
            )}
            {around.next ? (
              <Button asChild variant="outline" className="h-auto flex-1 justify-end py-2 text-right">
                <Link to={toUnitHref(data.id, around.next.id)}>
                  <span className="flex min-w-0 flex-col">
                    <span className="text-xs text-muted-foreground">{t('library.reader.next')}</span>
                    <span className="truncate">{around.next.number}</span>
                  </span>
                  <ChevronRight aria-hidden="true" />
                </Link>
              </Button>
            ) : (
              <p className="flex-1 self-center text-right text-xs text-muted-foreground">
                {t('library.reader.last')}
              </p>
            )}
          </nav>
        </article>

        {/* Below the text on a phone, beside it from 1024px, and off the
            printed page entirely — a printed unit is a citation, not a screen. */}
        <div data-print-hide className="h-fit lg:sticky lg:top-40">
          <RelatedRail work={data} corpus={corpus.data} unit={unit} cardCount={cardCount} />
        </div>
      </div>
    </div>
  )
}
