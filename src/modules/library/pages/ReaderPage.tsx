import {
  ArrowLeft,
  Bookmark,
  BookmarkCheck,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Keyboard,
  Maximize2,
  Minimize2,
  Printer,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'

import { AddToTrainerDialog } from '../components/AddToTrainerDialog'
import { AmendmentBanner } from '../components/AmendmentBanner'
import { AnnotatedBody } from '../components/AnnotatedBody'
import { AnnotationsPanel } from '../components/AnnotationsPanel'
import { DefinitionPopover } from '../components/DefinitionPopover'
import { KeyboardHelpSheet } from '../components/KeyboardHelpSheet'
import { NoteEditor } from '../components/NoteEditor'
import { ReadAloudBar } from '../components/ReadAloudBar'
import { RelatedRail } from '../components/RelatedRail'
import { SelectionToolbar } from '../components/SelectionToolbar'
import { TypeControls } from '../components/TypeControls'
import { clearSelection, selectionAnchor, selectionOffsets } from '../selection'
import { toLawSearchHref, toUnitHref, toWorkHref, unitIdFromPath } from '../url'
import {
  useBookmark,
  useDefinedTerms,
  useHighlights,
  useNotes,
  useReaderCorpus,
  useReaderWork,
  useUnitProgress,
} from '../useAnnotations'
import { useBookmarkedUnitIds, useReaderPrefs } from '../useLibrary'
import { useReadAloud } from '../useReadAloud'

import { DataVersion } from '@/components/common/DataVersion'
import { Disclaimer } from '@/components/common/Disclaimer'
import { SourceChip } from '@/components/common/SourceChip'
import { Badge, ProgressBar, QueryErrorState, SectionCard, SectionNumber, Skeleton } from '@/components/ui-x'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'
import type { Language } from '@/i18n'
import {
  adjacent,
  anchorParagraphs,
  anchorText,
  colourOf,
  createHighlight,
  estimateReadTime,
  getUnit,
  isPersonalWorkId,
  isWorkId,
  recordProgress,
  rememberScroll,
  resolveHighlights,
  setMarkedRead,
  toggleBookmark,
  tocPath,
  unitLabel,
  type HighlightColour,
  type ReaderWork,
  type UnitReference,
} from '@/lib/library'
import { cn } from '@/lib/utils'
import type { DefinedTermRecord } from '@/schemas/library'

/**
 * `/library/:workId/:unitId` — the reader.
 *
 * Five things here are decisions rather than layout:
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
 * 3. **Every key handler reads the unit from the URL**, never from a render
 *    snapshot — see `unitIdFromPath` in `../url.ts` for the two shapes that
 *    were wrong before it. Session 27 added four more keys to this page and
 *    every one of them obeys it, including the scroll writer, whose key is a
 *    unit id and which fires from a handler that outlives a navigation.
 *
 * 4. **A highlight is anchored to `anchorText(unit.body[lang])`** — one
 *    normalised string per unit per LANGUAGE — and the paragraphs rendered are
 *    slices of exactly that string. `../selection.ts` is the contract; nothing
 *    inside a paragraph may render text the provision does not contain.
 *
 * 5. **A personal work renders here too**, through the same `ReaderWork` type,
 *    with no source chip, no dataset version and a badge saying whose document
 *    it is. It is excluded from anything that presents a source as
 *    authoritative, which is the session brief's own requirement.
 */

/** How long between dwell writes. Long enough not to churn IndexedDB. */
const DWELL_MS = 30_000

/** How long after the reader stops scrolling before the position is stored. */
const SCROLL_DEBOUNCE_MS = 400

const versionKeyFor = (work: ReaderWork): string | null =>
  work.origin === 'personal' ? null : work.corpus.kind === 'law' ? `law-${work.id}` : `rules-${work.id}`

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

  const workState = useReaderWork(workId)
  const work = workState.work
  const corpus = useReaderCorpus(work)
  const { prefs, update } = useReaderPrefs(language)
  const bookmarked = useBookmarkedUnitIds(workId)
  const bookmark = useBookmark(workId, unitId)
  const progress = useUnitProgress(workId, unitId)

  const unit = corpus.data && unitId ? getUnit(corpus.data, unitId) : null
  const around = useMemo(
    () => (corpus.data && unitId ? adjacent(corpus.data, unitId) : null),
    [corpus.data, unitId],
  )

  const shownLanguages: Language[] = prefs.mode === 'both' ? ['en', 'hi'] : [prefs.mode]
  const hindiShown = shownLanguages.includes('hi')
  const hindiTextMissing = hindiShown && (unit?.body.hi.length ?? 0) === 0

  /**
   * The language a highlight is anchored to.
   *
   * "Both" panes and a Hindi setting with no Hindi text both read the ENGLISH
   * string, so a mark made in either indexes into that one. Storing it as `hi`
   * because the toggle says Hindi would give an offset into a string that is
   * not on screen.
   */
  const anchorLang: 'en' | 'hi' = prefs.mode === 'hi' && !hindiTextMissing ? 'hi' : 'en'
  const paragraphs = useMemo(() => (unit ? anchorParagraphs(unit.body[anchorLang]) : []), [unit, anchorLang])
  const unitText = useMemo(() => anchorText(paragraphs), [paragraphs])

  const highlightRows = useHighlights(workId, unitId)
  const noteRows = useNotes(workId, unitId)
  const resolved = useMemo(
    () => resolveHighlights(highlightRows ?? [], unitText, anchorLang),
    [highlightRows, unitText, anchorLang],
  )
  const drawn = useMemo(
    () =>
      resolved
        .filter((entry) => entry.resolution.start !== null)
        .map((entry) => ({
          id: entry.row.id,
          start: entry.resolution.start as number,
          end: entry.resolution.end as number,
          colour: colourOf(entry.row),
        })),
    [resolved],
  )

  const definitions = useDefinedTerms(work, corpus.data, prefs.terms)
  const [term, setTerm] = useState<{ term: DefinedTermRecord; at: { top: number; left: number } } | null>(
    null,
  )

  // ------------------------------------------------------------- selection

  const textRef = useRef<HTMLDivElement>(null)
  const [selection, setSelection] = useState<{
    start: number
    end: number
    text: string
    at: { top: number; left: number } | null
  } | null>(null)
  const [pendingNote, setPendingNote] = useState<string | null>(null)
  const [trainerOpen, setTrainerOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  /**
   * Selections are read on `mouseup`/`keyup` AT THE DOCUMENT, not from handlers
   * on the text.
   *
   * Two reasons, and the second is the one that matters. `selectionchange`
   * fires on every character as a drag moves and would re-render a
   * 4,000-character unit dozens of times per selection. And a drag that starts
   * inside the text very often ENDS outside it — past the last line, in the
   * margin — so a handler bound to the text itself misses exactly the
   * selections a reader makes when they mean to take the whole paragraph.
   * `selectionOffsets` already refuses anything whose endpoints are not inside
   * this unit, so listening wider costs nothing.
   */
  const readSelection = useCallback(() => {
    const offsets = selectionOffsets(textRef.current)
    if (!offsets) {
      setSelection(null)
      return null
    }
    const next = { ...offsets, at: selectionAnchor(textRef.current) }
    setSelection(next)
    return next
  }, [])

  useEffect(() => {
    const onUp = (event: Event) => {
      if (event instanceof KeyboardEvent && !event.shiftKey && event.key !== 'Shift') return
      readSelection()
    }
    document.addEventListener('mouseup', onUp)
    document.addEventListener('keyup', onUp)
    return () => {
      document.removeEventListener('mouseup', onUp)
      document.removeEventListener('keyup', onUp)
    }
  }, [readSelection])

  const highlight = useCallback(
    async (colour: HighlightColour, span?: { start: number; end: number }) => {
      const range = span ?? selection
      if (!workId || !unitId || !range) return
      try {
        const row = await createHighlight({
          workId,
          unitId,
          lang: anchorLang,
          start: range.start,
          end: range.end,
          colour,
          text: unitText,
        })
        setNotice(t('library.highlight.added'))
        setSelection(null)
        clearSelection(textRef.current)
        return row
      } catch {
        // A highlight is something the officer MADE. Unlike a progress write,
        // this must not fail silently — see `src/lib/library/annotations.ts`.
        setNotice(t('library.highlight.failed'))
        return undefined
      }
    },
    [workId, unitId, anchorLang, unitText, selection, t],
  )

  // ------------------------------------------------------------- keyboard

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
      const order = work?.readingOrder ?? []
      const neighbours = adjacent(corpus.data, here)

      const target =
        key === 'j'
          ? neighbours.next?.id
          : key === 'k'
            ? neighbours.previous?.id
            : event.key === 'Home'
              ? order[0]
              : event.key === 'End'
                ? order.at(-1)
                : undefined

      if (target !== undefined && target !== here) {
        event.preventDefault()
        void navigate(toUnitHref(workId, target))
        return
      }

      // The four Session 27 keys. Each reads the CURRENT selection rather than
      // a render snapshot, for the same reason `here` is read from the URL.
      if (key === 'b') {
        event.preventDefault()
        void toggleBookmark(workId, here)
          .then((now) => setNotice(now ? t('library.reader.bookmarked') : t('library.reader.bookmark')))
          .catch(() => setNotice(t('library.reader.bookmarkFailed')))
      } else if (key === 'h') {
        const range = readSelection()
        if (range) {
          event.preventDefault()
          void highlight('marigold', range)
        }
      } else if (key === 'n') {
        event.preventDefault()
        setPendingNote('')
      } else if (event.key === '?') {
        event.preventDefault()
        setHelpOpen(true)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
    // `corpus.data` and `work` change once per WORK, not per unit, so this
    // subscribes about as often as the reader opens a book.
  }, [corpus.data, work, workId, unitId, navigate, readSelection, highlight, t])

  // ------------------------------------------------------------- progress

  useEffect(() => {
    if (!workId || !unitId || !unit) return
    void recordProgress(workId, unitId, 0)
    const timer = setInterval(() => {
      // Only while the tab is actually in front of somebody. A unit left open
      // in a background tab overnight would otherwise record eight hours of
      // "reading" into a field called `secondsRead`, which My Study surfaces.
      // The arrival write above is unconditional, because arriving is what
      // "continue reading" reads back and it happens exactly once.
      if (document.visibilityState !== 'visible') return
      void recordProgress(workId, unitId, DWELL_MS / 1000)
    }, DWELL_MS)
    return () => clearInterval(timer)
  }, [workId, unitId, unit])

  /**
   * Where the reader had got to, stored as a RATIO of the scrollable height.
   *
   * The key comes from the URL at write time, not from this closure. A scroll
   * handler outlives a navigation by a debounce, and a position written under
   * the previous unit's id is a reader sent to the wrong place next time —
   * `unitIdFromPath`'s lesson in a second costume.
   */
  useEffect(() => {
    if (!workId) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const onScroll = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        const here = unitIdFromPath(window.location.pathname, workId)
        if (!here) return
        const max = document.documentElement.scrollHeight - window.innerHeight
        if (max <= 0) return
        void rememberScroll(workId, here, window.scrollY / max)
      }, SCROLL_DEBOUNCE_MS)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      clearTimeout(timer)
      window.removeEventListener('scroll', onScroll)
    }
  }, [workId])

  // Moving between units keeps the page scrolled where the previous unit
  // ended, which reads as a page that did not change. A remembered position
  // wins over the top of the unit — that is what remembering it is for.
  const headingRef = useRef<HTMLHeadingElement>(null)
  const restoredRef = useRef<string | null>(null)
  useEffect(() => {
    // Guarded because an effect that throws takes the whole route down through
    // `App.tsx`'s ErrorBoundary, and moving the viewport is a courtesy. Every
    // browser this app targets implements `scrollIntoView`; jsdom does not, and
    // an environment that cannot scroll must still be able to READ, which is
    // the point.
    headingRef.current?.scrollIntoView?.({ block: 'start', behavior: 'auto' })
  }, [unitId])

  useEffect(() => {
    if (!unitId || !progress || restoredRef.current === unitId) return
    restoredRef.current = unitId ?? null
    const ratio = progress.scrollRatio
    if (!ratio || ratio <= 0.02) return
    const max = document.documentElement.scrollHeight - window.innerHeight
    if (max > 0) window.scrollTo?.({ top: ratio * max, behavior: 'auto' })
  }, [unitId, progress])

  // ------------------------------------------------------------ read aloud

  // Hoisted out of the callback: an optional chain in a dependency array is
  // something the React Compiler cannot preserve, and a `useCallback` it
  // silently drops is a controller rebuilt on every render.
  const nextId = around?.next?.id ?? null
  const autoContinue = prefs.autoContinue
  const onFinishedReading = useCallback(() => {
    if (!autoContinue || !workId || !nextId) return
    void navigate(toUnitHref(workId, nextId))
  }, [autoContinue, workId, nextId, navigate])

  const aloud = useReadAloud(unitText, anchorLang, prefs, onFinishedReading)

  // --------------------------------------------------------------- render

  // A wrong URL, not a failed load — see the same guard in `WorkPage`. A
  // personal work id is equally valid here and is checked separately, because
  // `isWorkId` only knows the fifteen this app ships.
  if (workId !== undefined && !isWorkId(workId) && !isPersonalWorkId(workId)) {
    return <Navigate to="/library" replace />
  }

  if (workState.status === 'error' || corpus.status === 'error') {
    return (
      <div className="mx-auto max-w-3xl">
        <QueryErrorState onRetry={workState.status === 'error' ? workState.retry : corpus.retry} />
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
  if (workState.status === 'loading' || corpus.status === 'loading' || !work) {
    if (workState.status === 'missing') return <Navigate to="/library" replace />
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    )
  }

  if (!unit || !around) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <p role="alert" className="text-sm text-muted-foreground">
          {t('library.reader.notFound')}
        </p>
        <Button asChild variant="outline" size="sm" className="self-start">
          <Link to={toWorkHref(work.id)}>
            <ArrowLeft aria-hidden="true" />
            {t('library.backToWork', { work: work.shortTitle[language] })}
          </Link>
        </Button>
      </div>
    )
  }

  // The Hindi HEADING exists for almost every unit and is authored or curated
  // by this project, never published — which the reader is told wherever it is
  // the thing they are reading.
  const curatedHindiHeading = hindiShown && Boolean(unit.heading.hi) && work.verify

  const shownHeading = unitLabel(unit.heading, unit.excerpt, language)
  const readMinutes = estimateReadTime([...unit.body.en, ...unit.body.hi].join(' '))
  const isBookmarked = (bookmarked ?? new Set<string>()).has(unit.id)
  const cardCount = work.practiseCounts[unit.id] ?? 0
  const amendments = work.amendments[unit.id] ?? []
  const versionKey = versionKeyFor(work)
  const markedRead = Boolean(progress?.markedReadAt)

  /**
   * How much of this chapter is left, from the reader's own position.
   *
   * The branch of the table of contents rather than the whole work: "about four
   * hours left in the BNSS" is true and useless, while "about six minutes left
   * in this chapter" is a decision an officer can act on.
   */
  const branch = tocPath(work, unit.id).at(-2)
  const after = (branch?.unitIds ?? []).slice((branch?.unitIds ?? []).indexOf(unit.id) + 1)
  const minutesLeft = after.reduce((total, id) => {
    const next = corpus.data?.units.get(id)
    return total + (next ? estimateReadTime([...next.body.en, ...next.body.hi].join(' ')) : 0)
  }, 0)

  const resolveUnitId = (targetWorkId: string, number: string): string | null => {
    if (targetWorkId !== work.id || !corpus.data) return null
    for (const id of corpus.data.order) {
      if (corpus.data.units.get(id)?.number === number) return id
    }
    return null
  }

  const resolveWiki = (targetWorkId: string, targetUnitId: string) =>
    targetWorkId === work.id && corpus.data?.units.has(targetUnitId)
      ? {
          href: toUnitHref(targetWorkId, targetUnitId),
          label: corpus.data.units.get(targetUnitId)?.citation[language] ?? targetUnitId,
        }
      : isWorkId(targetWorkId) || isPersonalWorkId(targetWorkId)
        ? { href: toUnitHref(targetWorkId, targetUnitId), label: `${targetWorkId} ${targetUnitId}` }
        : null

  const onReference = (
    target: { kind: 'unit'; workId: string; unitId: string } | { kind: 'law'; query: string },
    _reference: UnitReference,
  ) => {
    void navigate(
      target.kind === 'law' ? toLawSearchHref(target.query) : toUnitHref(target.workId, target.unitId),
    )
  }

  return (
    <div
      className={cn(
        'mx-auto flex max-w-6xl flex-col gap-4',
        // A reading surface, not a third theme: it repaints what is behind the
        // text and nothing else. See `ReadingSurface` in `../useLibrary.ts`.
        prefs.surface === 'sepia' && 'library-sepia',
      )}
    >
      <div
        data-print-hide
        className="sticky top-14 z-20 -mx-4 border-b border-border bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6"
      >
        <div className="mx-auto flex max-w-6xl flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Link
              to={toWorkHref(work.id)}
              className="inline-flex min-h-9 items-center gap-1.5 text-sm text-primary underline-offset-4 hover:underline"
            >
              <ArrowLeft aria-hidden="true" className="h-4 w-4" />
              {work.shortTitle[language]}
            </Link>
            <span className="text-xs text-muted-foreground tabular-nums">
              {t('library.reader.of', { position: around.position, total: around.total })} ·{' '}
              {t('library.reader.readTime', { count: readMinutes })}
              {minutesLeft > 0 ? ` · ${t('library.polish.timeLeft', { count: minutesLeft })}` : ''}
            </span>
          </div>
          <ProgressBar
            value={(around.position / Math.max(1, around.total)) * 100}
            label={t('library.progressLabel', { work: work.shortTitle[language] })}
          />
        </div>
      </div>

      {/* Focus mode hides the controls, not the text. */}
      {prefs.focus ? null : (
        <>
          <TypeControls prefs={prefs} onChange={(patch) => void update(patch)} devanagariShown={hindiShown} />
          <ReadAloudBar aloud={aloud} prefs={prefs} onPrefs={(patch) => void update(patch)} />
        </>
      )}

      <div className={cn('grid gap-6', prefs.focus ? '' : 'lg:grid-cols-[minmax(0,1fr)_20rem]')}>
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
                    aria-pressed={markedRead}
                    aria-label={markedRead ? t('library.polish.unmark') : t('library.polish.markRead')}
                    onClick={() => void setMarkedRead(work.id, unit.id, !markedRead)}
                  >
                    {markedRead ? (
                      <CheckCircle2 aria-hidden="true" className="text-tulsi-foreground" />
                    ) : (
                      <Circle aria-hidden="true" />
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-9 w-9"
                    aria-pressed={isBookmarked}
                    aria-label={
                      isBookmarked ? t('library.reader.removeBookmark') : t('library.reader.bookmark')
                    }
                    onClick={() => {
                      void toggleBookmark(work.id, unit.id)
                        .then((now) =>
                          setNotice(now ? t('library.reader.bookmarked') : t('library.reader.bookmark')),
                        )
                        .catch(() => setNotice(t('library.reader.bookmarkFailed')))
                    }}
                  >
                    {isBookmarked ? <BookmarkCheck aria-hidden="true" /> : <Bookmark aria-hidden="true" />}
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-9 w-9"
                    aria-pressed={prefs.focus}
                    aria-label={prefs.focus ? t('library.polish.focusOff') : t('library.polish.focusOn')}
                    onClick={() => void update({ focus: !prefs.focus })}
                  >
                    {prefs.focus ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-9 w-9"
                    aria-label={t('library.polish.help')}
                    onClick={() => setHelpOpen(true)}
                  >
                    <Keyboard aria-hidden="true" />
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
                {notice ?? ''}
              </p>

              {unit.chapter ? (
                <p className="text-xs text-muted-foreground">
                  {unit.chapter.number}
                  {unit.chapter.title[language] || unit.chapter.title.en
                    ? ` — ${unit.chapter.title[language] || unit.chapter.title.en}`
                    : ''}
                </p>
              ) : null}

              {work.origin === 'personal' ? (
                <p className="rounded-md border-l-[3px] border-marigold bg-marigold/15 px-3 py-2 text-xs text-marigold-foreground">
                  {t('library.add.notOfficial')}
                </p>
              ) : null}

              <AmendmentBanner notes={amendments} language={language} />

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

              {selection ? (
                <SelectionToolbar
                  at={selection.at}
                  quote={selection.text}
                  onColour={(colour) => void highlight(colour)}
                  onNote={() => {
                    void highlight('marigold').then((row) => {
                      if (row) setPendingNote(row.id)
                    })
                  }}
                  onTrainer={() => setTrainerOpen(true)}
                  onClose={() => {
                    setSelection(null)
                    clearSelection(textRef.current)
                  }}
                />
              ) : null}

              <div
                ref={textRef}
                className={cn(
                  prefs.mode === 'both' && (unit.body.hi.length ?? 0) > 0
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
                ).map((lang) => {
                  const pane: 'en' | 'hi' = lang === 'hi' && unit.body.hi.length === 0 ? 'en' : lang
                  return (
                    <div key={lang} className="min-w-0">
                      {prefs.mode === 'both' && unit.body.hi.length > 0 ? (
                        <h2 className="mb-2 font-sans text-xs font-semibold text-muted-foreground uppercase">
                          {t(`library.lang.${lang}`)}
                        </h2>
                      ) : null}
                      <AnnotatedBody
                        paragraphs={pane === anchorLang ? paragraphs : anchorParagraphs(unit.body[pane])}
                        // A Hindi reader with no Hindi text reads the English,
                        // announced. `lang` on the element is what it actually
                        // is, so a screen reader does not read English in a
                        // Hindi voice.
                        lang={pane}
                        prefs={prefs}
                        // Only the pane a highlight was made on carries it.
                        highlights={pane === anchorLang ? drawn : []}
                        terms={definitions.terms}
                        workId={work.id}
                        resolveUnitId={resolveUnitId}
                        onTerm={(chosen, at) => setTerm({ term: chosen, at })}
                        onReference={onReference}
                        onHighlight={(id) => setPendingNote(id)}
                        speaking={pane === anchorLang ? aloud.speaking : null}
                      />
                    </div>
                  )
                })}
              </div>

              <footer className="flex flex-col gap-2 border-t border-border pt-4">
                <p className="text-xs text-muted-foreground">{unit.citation[language]}</p>
                <div className="flex flex-wrap items-center gap-2">
                  {work.source ? <SourceChip name={work.source.name} url={work.source.url} /> : null}
                  {work.origin === 'personal' ? (
                    <Badge tone="warning">{t('library.add.yourDocument')}</Badge>
                  ) : null}
                  {work.verify ? <Badge tone="warning">{t('common.verifyWithDdo')}</Badge> : null}
                </div>
                {versionKey ? <DataVersion dataset={versionKey} /> : null}
                <Disclaimer className="mt-1" />
              </footer>
            </div>
          </SectionCard>

          {pendingNote !== null && pendingNote !== '' ? null : pendingNote === '' ? (
            <NoteEditor
              workId={work.id}
              unitId={unit.id}
              note={null}
              stored={undefined}
              focusOnOpen
              onClose={() => setPendingNote(null)}
            />
          ) : null}

          <AnnotationsPanel
            workId={work.id}
            unitId={unit.id}
            highlights={resolved}
            notes={noteRows ?? []}
            resolveWiki={resolveWiki}
            openNoteFor={pendingNote && pendingNote !== '' ? pendingNote : null}
            onOpenNoteFor={setPendingNote}
          />

          <nav data-print-hide aria-label={t('library.toc.title')} className="flex items-stretch gap-3">
            {around.previous ? (
              <Button asChild variant="outline" className="h-auto flex-1 justify-start py-2 text-left">
                <Link to={toUnitHref(work.id, around.previous.id)}>
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
                <Link to={toUnitHref(work.id, around.next.id)}>
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

        {/* Below the text on a phone, beside it from 1024px, off the printed
            page entirely, and gone in focus mode. */}
        {prefs.focus ? null : (
          <div data-print-hide className="h-fit lg:sticky lg:top-40">
            {corpus.data ? (
              <RelatedRail work={work} corpus={corpus.data} unit={unit} cardCount={cardCount} />
            ) : null}
          </div>
        )}
      </div>

      {term ? (
        <DefinitionPopover
          term={term.term}
          at={term.at}
          workId={work.id}
          definitionsUnitId={definitions.unitId}
          extractedHere={definitions.extractedHere}
          onClose={() => setTerm(null)}
        />
      ) : null}

      <KeyboardHelpSheet open={helpOpen} onOpenChange={setHelpOpen} />

      <AddToTrainerDialog
        open={trainerOpen}
        onOpenChange={setTrainerOpen}
        // Only a rule book this app ships: a card citing a law section or a
        // personal document would sit in the review queue with nothing to check
        // it against. `AddToTrainerDialog` says so rather than hiding.
        actId={work.origin === 'dataset' && work.corpus.kind === 'rules' ? work.id : null}
        unit={unit}
        quote={selection?.text ?? ''}
        source={work.source ?? { name: work.title[language], url: '' }}
      />

      {bookmark?.label ? <p className="sr-only">{bookmark.label}</p> : null}
    </div>
  )
}
