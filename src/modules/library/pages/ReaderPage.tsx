import {
  ArrowLeft,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Columns2,
  Copy,
  ExternalLink,
  Flag,
  Headphones,
  Printer,
  Type,
} from 'lucide-react'
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'

import { AddToTrainerDialog } from '../components/AddToTrainerDialog'
import { AmendmentBanner } from '../components/AmendmentBanner'
import { ChapterRevisionCard } from '../components/ChapterRevisionCard'
import { AnnotatedBody } from '../components/AnnotatedBody'
import { AnnotationsPanel } from '../components/AnnotationsPanel'
import { DefinitionPopover } from '../components/DefinitionPopover'
import { KeyboardHelpSheet } from '../components/KeyboardHelpSheet'
import { NoteEditor } from '../components/NoteEditor'
import { CoachMark } from '../components/CoachMark'
import { ReadAloudPill } from '../components/ReadAloudPill'
import { ReaderRail } from '../components/ReaderRail'
import { SourceFooter } from '../components/SourceFooter'
import { UnitActions } from '../components/UnitActions'
import { UnitSwitcher } from '../components/UnitSwitcher'
import { FeynmanBox } from '../components/FeynmanBox'
import { RelatedRail } from '../components/RelatedRail'
import { StudyAidCard } from '../components/StudyAidCard'
import { TestMeCard } from '../components/TestMeCard'
import { SelectionToolbar } from '../components/SelectionToolbar'
import { TypeControls } from '../components/TypeControls'
import { clearSelection, selectionAnchor, selectionOffsets } from '../selection'
import { compareRef, toCompareHref, toLawSearchHref, toUnitHref, toWorkHref, unitIdFromPath } from '../url'
import {
  useBookmark,
  useDefinedTerms,
  useHighlights,
  useNotes,
  useReaderCorpus,
  useReaderWork,
  useUnitProgress,
} from '../useAnnotations'
import { studyAiAvailable } from '../ai-seam'
import {
  COACH_MARKS,
  useBookmarkedUnitIds,
  useReaderPrefs,
  type CoachMarkId,
  type RailTab,
} from '../useLibrary'
import { useStudyAid } from '../useStudy'
import { useReadAloud } from '../useReadAloud'

import { useAi } from '@/ai/useAi'
import { useReservedSpace } from '@/app/useReservedSpace'
import { FOCUS_MENU_ITEM } from '@/app/layouts/FocusLayout'
import { FocusSlot } from '@/app/layouts/FocusSlot'
import { useFocusMenuClose, useFocusStatus } from '@/app/layouts/focusSlots'
import { chapterFor } from '@/lib/study'
import { reportMailto } from '@/lib/reportMailto'

/**
 * The Ask panel is `lazy` and is mounted only when AI is on, so a reader with
 * AI off — every device's default — never downloads it, and neither the agent
 * nor the provider nor the tool registry lands on the device of anyone who has
 * not asked for it (`docs/AI.md`: laziness here is a privacy property, not a
 * performance one). `useAi` itself is safe to import statically — it reads the
 * consent row and nothing else.
 */
const StudyAskPanel = lazy(() =>
  import('../components/StudyAskPanel').then((module) => ({ default: module.StudyAskPanel })),
)

import {
  Popover,
  ProgressBar,
  QueryErrorState,
  SectionCard,
  SectionNumber,
  Skeleton,
} from '@/components/ui-x'
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

/** How close to the foot of the page counts as "you have read this". */
const END_OF_UNIT_PX = 120

/**
 * Has the standing disclaimer been shown as a BANNER yet, this tab?
 *
 * The master context requires the sentence on every data surface and
 * `SourceFooter` renders it on every unit — this only decides how loudly. A
 * reader working through a chapter meets it thirty times in a sitting, and the
 * thirtieth banner is read by nobody.
 *
 * A module variable rather than a stored row, exactly as `src/modules/law/url.ts`
 * holds the offence date: it lasts the tab's life, is written nowhere, and is
 * gone on reload — so every session's FIRST provision gets the full banner.
 *
 * It records WHICH unit was first rather than a boolean, and that is not
 * fussiness: a boolean has to be flipped back to false when the reader moves
 * on, and StrictMode double-invokes the effect that would do it. An id is
 * written once, idempotently, and every render after it is a comparison.
 */
let firstUnitOfSession: string | null = null

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

  /*
    The study layer. All four reads are cheap and none of them blocks the
    render: the aid dataset is 8-30 KB per work behind its own `?raw` chunk,
    the chapter list is derived from the table of contents already in memory,
    and `useAi()` is the consent row this app hydrates at boot.

    A PERSONAL work has none of this — no aids were written for a document the
    reader added, and its `toc` is one node per unit — so `aidWorkId` is null
    there and the rail simply renders fewer cards.
  */
  const aidWorkId = work && work.origin !== 'personal' && isWorkId(work.id) ? work.id : undefined
  const studyAid = useStudyAid(aidWorkId, unitId)
  const chapterWork = work && work.origin !== 'personal' ? work : null
  const chapter = useMemo(
    () => (chapterWork && unitId ? chapterFor(chapterWork, unitId) : null),
    [chapterWork, unitId],
  )
  const ai = useAi()

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

  const byNumber = useMemo(() => {
    const index = new Map<string, string>()
    for (const id of corpus.data?.order ?? []) {
      const number = corpus.data?.units.get(id)?.number
      // First wins: two units printing the same number is a corpus problem,
      // and a citation should open the earlier one rather than the later.
      if (number && !index.has(number)) index.set(number, id)
    }
    return index
  }, [corpus.data])
  const [term, setTerm] = useState<{ term: DefinedTermRecord; at: { top: number; left: number } } | null>(
    null,
  )

  // ------------------------------------------------------------- selection

  const textRef = useRef<HTMLDivElement>(null)
  /*
    A selection carries the UNIT it was made in, and a stale one is never used.

    The DOM selection outlives a navigation, because React reuses the paragraph
    nodes — so after `j` the browser still reports a range, mapped on to
    whatever words now occupy those nodes. Both the floating toolbar and the
    action row offered to highlight it, and what got stored was words the
    officer never marked, in a provision they had just left.

    Derived rather than cleared by an effect: the rule CLAUDE.md records for
    `ReviewPage`'s `wrongAnswer` and `switcherFor` two blocks up — an effect
    that resynchronises is one render late, and one render is all it takes.
  */
  const [rawSelection, setRawSelection] = useState<{
    unitId: string
    start: number
    end: number
    text: string
    at: { top: number; left: number } | null
  } | null>(null)
  /** The selection, only while it still belongs to the provision on screen. */
  const selection = rawSelection && rawSelection.unitId === unitId ? rawSelection : null

  const [pendingNote, setPendingNote] = useState<string | null>(null)
  const [trainerOpen, setTrainerOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  // Focus-bar and overlay state. None of it is remembered across units except
  // the rail, whose tab and open/closed live in `prefs`.
  /*
    Which unit's switcher is open, not whether one is.

    Keyed on the unit so a jump closes it by DERIVATION rather than by an effect
    that resynchronises one render late — the rule CLAUDE.md records for
    `ReviewPage`'s `wrongAnswer` and `TrainerActHint`, and the one
    `react-hooks/set-state-in-effect` is right to enforce.
  */
  const [switcherFor, setSwitcherFor] = useState<string | null>(null)
  const [aloudOpen, setAloudOpen] = useState(false)
  const [railSheetOpen, setRailSheetOpen] = useState(false)
  const [atEnd, setAtEnd] = useState(false)

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
    /*
      The unit comes from the URL at READ time, never from this closure —
      `unitIdFromPath`'s standing rule on this page. This callback has an empty
      dependency array and outlives every navigation, so a captured id would be
      the one the reader was on when the listener was made.
    */
    const here = workId ? unitIdFromPath(window.location.pathname, workId) : null
    if (!offsets || !here) {
      setRawSelection(null)
      return null
    }
    const next = { unitId: here, ...offsets, at: selectionAnchor(textRef.current) }
    setRawSelection(next)
    return next
  }, [workId])

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
        setRawSelection(null)
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

  /**
   * Whether the reader has reached the foot of this provision.
   *
   * "Mark as read" appears there and only there, because a control offered
   * before anybody has read anything is a control that records something
   * untrue. It is its own listener rather than a branch inside the debounced
   * position writer above: this has to answer on every frame of the scroll and
   * that one deliberately answers 400 ms after it stops.
   */
  useEffect(() => {
    const check = () => {
      const room = document.documentElement.scrollHeight - window.innerHeight
      // A unit shorter than the viewport has nothing to scroll, and is read.
      setAtEnd(room <= 0 || window.scrollY >= room - END_OF_UNIT_PX)
    }
    check()
    window.addEventListener('scroll', check, { passive: true })
    window.addEventListener('resize', check)
    return () => {
      window.removeEventListener('scroll', check)
      window.removeEventListener('resize', check)
    }
  }, [unitId])

  /*
    The BROWSER's selection goes with the provision it was made in.

    Keying `rawSelection` on the unit is what stops a stale range being USED;
    this is what stops it being re-read. The DOM range survives a navigation
    because React reuses the paragraph nodes, so the next `mouseup` anywhere —
    pressing the highlighter, for instance — maps it on to whatever words now
    occupy them and hands back a perfectly valid selection of text the officer
    never marked.
  */
  useEffect(() => {
    clearSelection(textRef.current)
  }, [unitId])

  useEffect(() => {
    if (firstUnitOfSession === null && unitId) firstUnitOfSession = unitId
  }, [unitId])

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

  /*
    Where the reader is, in the ONE row that is always on screen.

    A hook, so it has to sit above every early return — which is why it reads
    `around` (computed from the corpus) rather than anything derived after the
    guards. While the corpus is still loading there is no position to state and
    the bar simply carries none.
  */
  useFocusStatus(around ? t('library.reader.of', { position: around.position, total: around.total }) : null)
  const closeFocusMenu = useFocusMenuClose()

  /*
    The action row is `fixed` at the foot of a phone, so everything else that
    wants that edge has to know how much of it is taken. Measured, not assumed:
    the row loses a control on a work no rule book backs, and the rail button
    carries a word below `lg` that is longer in Hindi.
  */
  const actionsRef = useReservedSpace('--reader-actions-space', 8)

  /*
    Copying the citation is the ⋯ menu's cheapest entry and the one most likely
    to be used, and like every other copy affordance in this app it is wrapped:
    a browser that refuses the clipboard — an insecure origin, a denied
    permission, a locked-down managed device — otherwise gives an unhandled
    rejection and a menu entry that silently does nothing, so the officer pastes
    whatever was there before.
  */
  const copyCitation = useCallback(
    (text: string) => {
      closeFocusMenu()
      void navigator.clipboard
        ?.writeText(text)
        .then(() => setNotice(t('library.reader.citationCopied')))
        .catch(() => setNotice(t('library.reader.citationCopyFailed')))
    },
    [closeFocusMenu, t],
  )

  // --------------------------------------------------------------- render

  // A wrong URL, not a failed load — see the same guard in `WorkPage`. A
  // personal work id is equally valid here and is checked separately, because
  // `isWorkId` only knows the fifteen this app ships.
  if (workId !== undefined && !isWorkId(workId) && !isPersonalWorkId(workId)) {
    return <Navigate to="/study/read" replace />
  }

  if (workState.status === 'error' || corpus.status === 'error') {
    return (
      <div className="mx-auto max-w-3xl">
        <QueryErrorState onRetry={workState.status === 'error' ? workState.retry : corpus.retry} />
        <Button asChild variant="outline" size="sm" className="mt-4">
          <Link to="/study/read">
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
    if (workState.status === 'missing') return <Navigate to="/study/read" replace />
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
  // Approved Trainer cards citing anything in this chapter, from the work file
  // itself — never from `data/rules/cards`, which is 1.1 MB (ADR-038 §2).
  const chapterCitedCards = (chapter?.unitIds ?? []).reduce(
    (total, id) => total + (work.practiseCounts[id] ?? 0),
    0,
  )
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

  /**
   * Number → unit id, built once per corpus rather than scanned per citation.
   *
   * The first version walked `corpus.order` for every reference in every
   * paragraph on every render. A BNSS section with ten citations meant five
   * thousand map lookups per render, and the reader re-renders on every
   * selection change.
   */
  const resolveUnitId = (targetWorkId: string, number: string): string | null =>
    targetWorkId === work.id ? (byNumber.get(number) ?? null) : null

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

  /*
    The rail's four tabs, and which of them have anything behind them.

    A tab with nothing under it is not rendered at all: a work with no authored
    aid has no Understand tab, `Related` waits for the corpus, and `Ask` is
    absent unless AI is on AND the work is one its tools can reach. The reader's
    stored tab is honoured only if it is one of the ones actually there —
    otherwise the panel would be empty and the tablist would point at nothing.

    `practise` is ALWAYS available, including on a document the reader added
    themselves: writing a provision out in your own words works on any text, and
    `TestMeCard`/`ChapterRevisionCard` already render nothing when there is no
    chapter. Gating the tab on the work's origin would have taken the one study
    surface that needs no dataset away from the one kind of document that has no
    dataset behind it.
  */
  const railAvailable: Record<RailTab, boolean> = {
    understand: Boolean(studyAid),
    practise: true,
    related: corpus.data !== null,
    ask: studyAiAvailable(ai.enabled) && work.origin !== 'personal',
  }
  const railTab: RailTab = railAvailable[prefs.railTab]
    ? prefs.railTab
    : ((['understand', 'practise', 'related', 'ask'] as RailTab[]).find((tab) => railAvailable[tab]) ??
      'related')
  const railHasAnything = Object.values(railAvailable).some(Boolean)

  /*
    ONE coach mark at a time, in the order they are first needed.

    Three at once is a tour, and a tour is what a reader dismisses without
    reading. `COACH_MARKS` is the order — the "Aa" tray first because it is
    where four controls went, then highlighting, then the rail.
  */
  const nextCoach: CoachMarkId | null = COACH_MARKS.find((mark) => !prefs.coach[mark]) ?? null
  const dismissCoach = (mark: CoachMarkId) => void update({ coach: { ...prefs.coach, [mark]: true } })

  const firstOfSession = firstUnitOfSession === null || firstUnitOfSession === unit.id

  const railPanel = (
    <>
      {railTab === 'understand' && studyAid ? (
        <StudyAidCard aid={studyAid} corpus={corpus.data} workId={work.id} />
      ) : null}

      {railTab === 'practise' ? (
        <>
          {/*
              KEYED ON THE UNIT, and this one is not cosmetic.

              `j`/`k` and the prev/next links navigate between units without
              unmounting this rail, so without the key a reader who starts
              writing about Rule 3, moves to Rule 4 and presses Save has their
              words about Rule 3 stored against **Rule 4** — `saveAttempt`
              takes `unit.id` from the props it has now. Nothing throws and
              both screens look right.

              A key rather than an effect that clears the state, for the reason
              CLAUDE.md records for `ReviewPage`'s `wrongAnswer`: derive or
              remount, never resynchronise one render late.
          */}
          <FeynmanBox key={unit.id} workId={work.id} unit={unit} chapter={chapter} />
          <TestMeCard chapter={chapter} cited={chapterCitedCards} />
          {/*
            The confidence rating sits HERE rather than on a screen of its own,
            because a reader can only judge whether they could use a chapter
            while they are in it. The due list on both hubs links to the
            chapter's first unit for the same reason.
          */}
          {chapter ? <ChapterRevisionCard key={chapter.id} chapter={chapter} /> : null}
        </>
      ) : null}

      {railTab === 'related' && corpus.data ? (
        <RelatedRail work={work} corpus={corpus.data} unit={unit} cardCount={cardCount} />
      ) : null}

      {/*
          A PERSONAL work is excluded, and this is a reachability condition
          rather than a policy one.

          Every tool in `src/ai/tools/library.ts` guards on `isWorkId`, which a
          `my-`-prefixed id fails by construction — so on a document the reader
          added themselves, `get_unit`, `get_study_aid`, `get_definitions`,
          `retrieve` and `get_related_cards` all return "unknown work", the run
          cites nothing, and `groundedRequired` discards it. The panel rendered
          anyway: an input, six intent chips and a button that could only ever
          produce "it could not answer".
      */}
      {railTab === 'ask' && railAvailable.ask ? (
        <Suspense fallback={null}>
          {/*
              Keyed on the unit for the same reason as the two above: an answer
              about the previous provision must not still be sitting under this
              one, and a run in flight for a unit the reader has left is a run
              they are paying for and will not read — the key unmounts the hook,
              whose cleanup aborts it.
          */}
          <StudyAskPanel
            key={unit.id}
            ai={ai}
            workId={work.id}
            unitId={unit.id}
            nodeId={chapter?.nodeId ?? null}
            onOpenCitation={(href) => void navigate(href)}
          />
        </Suspense>
      ) : null}
    </>
  )

  return (
    <div
      className={cn(
        // The focus level already took the sidebar, the tab bar and the app's
        // top bar off this screen; what is left is a reading column and, from
        // 1024px, a rail beside it.
        'mx-auto flex w-full max-w-6xl flex-col gap-4',
        // A reading surface, not a third theme: it repaints what is behind the
        // text and nothing else. See `ReadingSurface` in `../useLibrary.ts`.
        prefs.surface === 'sepia' && 'library-sepia',
      )}
    >
      {/* ------------------------------------------------ the focus bar */}

      <FocusSlot host="title">
        <UnitSwitcher
          work={work}
          corpus={corpus.data}
          currentUnitId={unit.id}
          number={unit.number}
          heading={shownHeading.text}
          open={switcherFor === unit.id}
          onOpenChange={(next) => setSwitcherFor(next ? unit.id : null)}
        />
      </FocusSlot>

      <FocusSlot host="actions">
        {/*
          "Aa" — the five control groups that used to sit permanently between
          the officer and the provision, behind one button. They are set once.
        */}
        <Popover
          label={t('library.type.label')}
          panelClassName="w-[min(20rem,calc(100vw-2rem))]"
          trigger={
            <>
              <Type aria-hidden="true" className="h-4 w-4" />
              <span aria-hidden="true" className="hidden text-xs font-semibold sm:inline">
                Aa
              </span>
            </>
          }
        >
          <TypeControls prefs={prefs} onChange={(patch) => void update(patch)} devanagariShown={hindiShown} />
        </Popover>

        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9"
          aria-pressed={aloudOpen}
          aria-label={aloudOpen ? t('library.tts.close') : t('library.tts.title')}
          onClick={() => setAloudOpen(!aloudOpen)}
        >
          <Headphones aria-hidden="true" />
        </Button>
      </FocusSlot>

      <FocusSlot host="menu">
        <button
          type="button"
          className={FOCUS_MENU_ITEM}
          onClick={() => {
            closeFocusMenu()
            window.print()
          }}
        >
          <Printer aria-hidden="true" className="h-4 w-4" />
          {t('library.reader.print')}
        </button>
        <button
          type="button"
          className={FOCUS_MENU_ITEM}
          onClick={() => copyCitation(unit.citation[language])}
        >
          <Copy aria-hidden="true" className="h-4 w-4" />
          {t('library.reader.copyCitation')}
        </button>
        {work.officialUrl ? (
          <a
            href={work.officialUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={FOCUS_MENU_ITEM}
            onClick={closeFocusMenu}
          >
            <ExternalLink aria-hidden="true" className="h-4 w-4" />
            {t('library.officialText')}
            <span className="sr-only"> ({t('common.opensInNewTab')})</span>
          </a>
        ) : null}
        <Link
          to={toCompareHref({ workId: work.id, unitId: unit.id })}
          className={FOCUS_MENU_ITEM}
          onClick={closeFocusMenu}
        >
          <Columns2 aria-hidden="true" className="h-4 w-4" />
          {t('library.reader.compareWith')}
        </Link>
        {/*
          A prefilled `mailto:`, never a form this app submits — the master
          context rules out a backend for anything the reader types. The
          citation travels in the body so a report names the provision without
          the officer retyping it.
        */}
        <a
          href={reportMailto(language, `${unit.citation[language]} (${compareRef(work.id, unit.id)})`)}
          className={FOCUS_MENU_ITEM}
          onClick={closeFocusMenu}
        >
          <Flag aria-hidden="true" className="h-4 w-4" />
          {t('pages.settings.about.reportError')}
        </a>
      </FocusSlot>

      {/* ------------------------------------------------ the page */}

      <ProgressBar
        data-print-hide
        value={(around.position / Math.max(1, around.total)) * 100}
        label={t('library.progressLabel', { work: work.shortTitle[language] })}
      />

      <div
        className={cn(
          'grid gap-6',
          railHasAnything && prefs.railOpen ? 'lg:grid-cols-[minmax(0,1fr)_20rem]' : '',
        )}
      >
        <article className="library-print-root mx-auto flex w-full min-w-0 flex-col gap-4">
          <SectionCard active className="library-print-page">
            <div className="flex flex-col gap-4 p-4 sm:p-6">
              {/*
                The provision's identity is stated ONCE on screen — the bar's
                switcher carries the number, so a chip repeating it beside the
                heading was the same fact twice on one row. On paper the bar
                does not exist, so the number is printed instead.
              */}
              <div className="hidden print:block">
                <SectionNumber>{unit.number}</SectionNumber>
              </div>
              <h1
                ref={headingRef}
                lang={shownHeading.lang}
                className={cn(
                  'min-w-0 scroll-mt-20 text-xl leading-snug font-semibold sm:text-2xl',
                  // A unit with no published heading is titled by a quotation
                  // of its own opening; it is set apart so nobody reads it as
                  // the heading the Ministry printed.
                  shownHeading.isExcerpt && 'font-sans text-lg font-medium text-muted-foreground italic',
                )}
              >
                {shownHeading.text}
              </h1>

              {/*
                What an officer does to a provision: one row under the title on
                a desktop, and a fixed bar at the foot of a phone, because a
                thumb is not at the top of the screen.
              */}
              <UnitActions
                ref={actionsRef}
                hasSelection={selection !== null}
                onHighlight={(colour) => void highlight(colour)}
                onNote={() => setPendingNote('')}
                bookmarked={isBookmarked}
                onBookmark={() => {
                  void toggleBookmark(work.id, unit.id)
                    .then((now) =>
                      setNotice(now ? t('library.reader.bookmarked') : t('library.reader.bookmark')),
                    )
                    .catch(() => setNotice(t('library.reader.bookmarkFailed')))
                }}
                onAddToTrainer={
                  work.origin === 'dataset' && work.corpus.kind === 'rules'
                    ? () => setTrainerOpen(true)
                    : null
                }
                columnOpen={prefs.railOpen}
                onToggleColumn={() => void update({ railOpen: !prefs.railOpen })}
                sheetOpen={railSheetOpen}
                onToggleSheet={() => setRailSheetOpen(!railSheetOpen)}
                onHelp={() => setHelpOpen(true)}
              />

              {/*
                How long this provision takes, and how much of the CHAPTER is
                left after it — the branch of the table of contents rather than
                the whole work, because "about four hours left in the BNSS" is
                true and useless while "about six minutes left in this chapter"
                is a decision an officer can act on.
              */}
              <p className="text-xs text-muted-foreground tabular-nums">
                {t('library.reader.readTime', { count: readMinutes })}
                {minutesLeft > 0 ? ` · ${t('library.polish.timeLeft', { count: minutesLeft })}` : ''}
              </p>

              <p aria-live="polite" className="sr-only">
                {notice ?? ''}
              </p>

              {nextCoach ? <CoachMark id={nextCoach} onDismiss={dismissCoach} /> : null}

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
                    setRawSelection(null)
                    clearSelection(textRef.current)
                  }}
                />
              ) : null}

              {/*
                68ch, which is the measure a long statutory sentence is
                readable at. It is a max on the COLUMN and not on the card, so
                a side-by-side bilingual reading still gets two of them.
              */}
              <div
                ref={textRef}
                className={cn(
                  prefs.mode === 'both' && (unit.body.hi.length ?? 0) > 0
                    ? 'grid gap-6 lg:grid-cols-2'
                    : 'flex max-w-[68ch] flex-col',
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

              {/*
                "Mark as read" arrives at the FOOT of the provision and only
                there. Offering it beside the title would be offering to record
                something nobody has done yet.
              */}
              {atEnd || markedRead ? (
                <div data-print-hide>
                  <Button
                    variant={markedRead ? 'outline' : 'default'}
                    size="sm"
                    aria-pressed={markedRead}
                    onClick={() => void setMarkedRead(work.id, unit.id, !markedRead)}
                  >
                    {markedRead ? <CheckCircle2 aria-hidden="true" /> : <Circle aria-hidden="true" />}
                    {markedRead ? t('library.polish.unmark') : t('library.polish.markRead')}
                  </Button>
                </div>
              ) : null}

              <SourceFooter
                citation={unit.citation[language]}
                sourceName={work.source?.name ?? null}
                sourceUrl={work.source?.url ?? null}
                personal={work.origin === 'personal'}
                verify={work.verify}
                versionKey={versionKey}
                firstOfSession={firstOfSession}
              />
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

          {/*
            Previous and next: an ordinary pair on a desktop, where `j`/`k` are
            the real controls, and pinned to the bottom edge on a phone, where
            they are the only ones. `lg:static` is what makes that one element
            rather than two, so the two cannot drift apart.
          */}
          <nav
            data-print-hide
            aria-label={t('library.toc.title')}
            className="sticky bottom-[var(--reader-actions-space,0px)] z-30 -mx-4 flex items-stretch gap-3 border-t border-border bg-background/95 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6 lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:px-0 lg:backdrop-filter-none"
          >
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

        {/* Beside the text from 1024px, a bottom sheet below it, off the
            printed page entirely. */}
        {railHasAnything ? (
          <ReaderRail
            className={cn('h-fit lg:sticky lg:top-20', prefs.railOpen ? '' : 'lg:hidden')}
            tab={railTab}
            onTab={(next) => void update({ railTab: next })}
            available={railAvailable}
            sheetOpen={railSheetOpen}
            onSheetOpen={setRailSheetOpen}
          >
            {railPanel}
          </ReaderRail>
        ) : null}
      </div>

      {aloudOpen ? (
        <ReadAloudPill
          aloud={aloud}
          prefs={prefs}
          onPrefs={(patch) => void update(patch)}
          onClose={() => {
            // Stopping first, because a pill that is gone and still speaking
            // is a voice with no control left to silence it.
            aloud.stop()
            setAloudOpen(false)
          }}
        />
      ) : null}

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
