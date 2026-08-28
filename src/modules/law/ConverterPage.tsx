import { BookOpen, Bookmark, Scale, Sparkles } from 'lucide-react'
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { CodeChips, DirectionToggle } from './components/Filters'
import { OffenceDateField } from './components/OffenceDateField'
import { ResultList } from './components/ResultList'
import { SectionResultCard } from './components/SectionResultCard'
import { NoteBanner } from './components/NoteBanner'
import { SearchBar } from './components/SearchBar'
import { recordLookup } from './saved'
import { browseCode, searchLaw, type LawHit, type LawSearchEngine } from './search'
import { SEARCH_RESULT_LIMIT } from '@/lib/search'
import type { LawCode } from './types'
import { useLawEngine } from './useLawEngine'
import { parseLawParams, recallOffenceDate, rememberOffenceDate, toLawParams } from './url'

import { EmptyState } from '@/components/common/EmptyState'
import { PageHeader } from '@/components/common/PageHeader'
import { Badge, QueryErrorState, SectionCard, SectionNumber, Skeleton } from '@/components/ui-x'
import { Button } from '@/components/ui/button'
import type { Language } from '@/i18n'
import { useT } from '@/i18n/useT'
import { cn } from '@/lib/utils'

/**
 * The Law Converter.
 *
 * **The URL is the state.** Query, code, direction and offence date all live in
 * `useSearchParams` and every control writes straight to it, so there is no
 * second copy to fall out of sync and no effect mirroring one into the other.
 * `/law?code=bns&q=302&dir=old-new&date=2024-08-01` restores exactly this
 * screen, which is what makes a shared link worth sending.
 *
 * The one exception is the offence date, which is ALSO held in memory for the
 * browsing session (see `url.ts`) so that walking to the saved list and back
 * does not silently drop the fact that the offence was in 2023. It is never
 * written to storage.
 */
/** How long a section must stay on screen before it counts as "looked at". */
const LOOKUP_DWELL_MS = 1500

/** The Act a code chip names, in the reader's language, for the count line. */
function actNameFor(engine: LawSearchEngine | null, code: LawCode | null, language: Language): string {
  if (!engine || !code) return ''
  return engine.corpus.datasets[code].newAct.name[language]
}

export default function ConverterPage() {
  const { t, language } = useT()
  const [params, setParams] = useSearchParams()

  const fromUrl = parseLawParams(params)

  /**
   * The search field is LOCALLY stateful, with the URL as an output.
   *
   * Driving the input straight from `useSearchParams` looked cleaner and lost
   * keystrokes: a router update is not synchronous, so typing "420" quickly
   * re-rendered the field with a stale value and left "2" in the box. Anyone
   * typing at speed hits it, and a Devanagari IME — which commits several
   * characters at once — hits it harder.
   *
   * `syncedFrom` is what keeps the two honest without an effect. While the URL
   * still holds the value this draft was started from, the draft wins (we are
   * ahead of the router). The moment the URL says something else — a link, the
   * back button, a shared deep link — that is an external change, and it wins.
   */
  const [draft, setDraft] = useState({ text: fromUrl.query, syncedFrom: fromUrl.query })
  const query = draft.syncedFrom === fromUrl.query ? draft.text : fromUrl.query

  const view = { ...fromUrl, query }
  // A date carried over from earlier in this session, when the URL has none.
  const date = view.date ?? recallOffenceDate()

  /**
   * Two things ask for the section tables: a query, and picking a code to
   * browse. Both are explicit actions by the reader, which is what keeps a bare
   * `/law` free of the 3.9 MB download (ADR-013).
   */
  const browsing = !query.trim() && view.browse
  const engine = useLawEngine(Boolean(query.trim()) || browsing)

  const update = (patch: Partial<typeof view>) => {
    const next = { ...view, date, ...patch }
    if ('date' in patch) rememberOffenceDate(next.date)
    if (patch.query !== undefined) setDraft({ text: patch.query, syncedFrom: fromUrl.query })
    // replace, not push: typing a query must not fill the back button with a
    // history entry per keystroke.
    setParams(toLawParams(next), { replace: true })
  }

  /**
   * The search runs against the DEFERRED query, not the typed one.
   *
   * A search over 1,059 records costs 25-60 ms for a word and up to ~200 ms for
   * a four-word phrase (measured). Running that synchronously on every
   * keystroke drops frames in the input, which on a Devanagari keyboard means
   * dropped matras. `useDeferredValue` keeps the field rendering at once and
   * lets React abandon a stale search when another character arrives — a
   * debounce timer would add a fixed delay even when there is time to spare.
   */
  const deferredQuery = useDeferredValue(view.query)

  const result = useMemo(() => {
    if (!engine.engine || !deferredQuery.trim()) return null
    return searchLaw(engine.engine, {
      query: deferredQuery,
      code: view.code ?? undefined,
      direction: view.direction,
    })
  }, [engine.engine, deferredQuery, view.code, view.direction])

  /**
   * With a code chip picked and nothing typed, the list is that Act end to end
   * — 358 to 531 rows, which is exactly what `ResultList`'s windowing is for.
   */
  const browseHits = useMemo(
    () => (browsing && engine.engine ? browseCode(engine.engine, view.code) : []),
    [browsing, engine.engine, view.code],
  )

  const hits = result?.hits ?? browseHits

  /**
   * Which result is open. Derived rather than stored wherever it can be: a
   * chosen id that is no longer in the results falls back to the first hit, so
   * changing the query never leaves a card from the previous search on screen.
   */
  const [chosenId, setChosenId] = useState<string | null>(null)
  /**
   * A SEARCH opens its best result straight away — that is the answer the
   * reader asked for. BROWSING does not: the whole Act is on screen and
   * nothing in it has been asked for yet, so opening section 1 (and recording
   * it as a lookup) would be the app answering a question nobody put.
   */
  /**
   * Closing the card needs its own state, because "nothing chosen" already
   * means "show the best hit". `dismissedFor` records the query the reader
   * closed the card ON, so a NEW query opens its best result again rather than
   * staying shut — the derived-stale shape the More sheet uses.
   */
  const [dismissedFor, setDismissedFor] = useState<string | null>(null)
  const chosen = hits.find((hit) => hit.doc.id === chosenId)
  const selected: LawHit | undefined =
    chosen ?? (browsing || dismissedFor === deferredQuery ? undefined : hits[0])
  const [activeIndex, setActiveIndex] = useState(-1)

  /**
   * "Recent lookups" means sections the reader LOOKED AT, so a section has to
   * stay on screen for a moment before it counts.
   *
   * Without the dwell, typing "302" wrote three rows — the first hit for "3",
   * for "30" and for "302" — and a list of twenty was mostly sections nobody
   * had read. The timer is cleared by the same effect cleanup that runs when
   * the selection changes, so only what survived the pause is written.
   *
   * This is the only thing this module records about what was read. It is
   * capped at 20 rows and never leaves the device.
   */
  useEffect(() => {
    if (!selected) return
    const timer = setTimeout(() => {
      void recordLookup(selected.doc.ref.code, selected.doc.ref.record, deferredQuery).catch(() => {
        // Blocked storage. Losing a recent-lookup row is not worth a message.
      })
    }, LOOKUP_DWELL_MS)
    return () => clearTimeout(timer)
  }, [selected, deferredQuery])

  /**
   * Bring the opened section into view — but only when it is not already there.
   *
   * The test is the card's own top edge, not a breakpoint. Beside the list on a
   * wide screen the top is already on screen and nothing moves; stacked under a
   * long result list on a phone it is far below the fold, and that is the case
   * where a reader taps a row and cannot tell that anything happened.
   *
   * `block: 'nearest'` alone was not enough: the card is taller than the
   * viewport, so "nearest" aligns its top and scrolled the search box away on a
   * desktop where the card was perfectly visible already.
   */
  const cardRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!chosenId) return
    const card = cardRef.current
    if (!card) return

    const { top } = card.getBoundingClientRect()
    const alreadyInView = top >= 0 && top < window.innerHeight * 0.6
    if (!alreadyInView) card.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [chosenId])

  const openSection = (code: LawCode, section: string) => {
    setChosenId(`${code}:${section}`)
    setDismissedFor(null)
    setActiveIndex(-1)
  }

  return (
    <div className={cn('mx-auto flex flex-col gap-6', selected ? 'max-w-6xl' : 'max-w-4xl')}>
      <div data-print-hide>
        <PageHeader
          title={t('pages.law.title')}
          subtitle={t('pages.law.subtitle')}
          actions={
            <>
              <Button asChild variant="outline" size="sm">
                <Link to="/law/whats-new">
                  <Sparkles aria-hidden="true" />
                  {t('law.nav.whatsNew')}
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link to="/law/saved">
                  <Bookmark aria-hidden="true" />
                  {t('law.nav.saved')}
                </Link>
              </Button>
            </>
          }
        />
      </div>

      <div data-print-hide className="flex flex-col gap-5">
        <OffenceDateField value={date} onChange={(value) => update({ date: value })} />

        <SearchBar
          value={view.query}
          onChange={(query) => {
            update({ query })
            setChosenId(null)
            setActiveIndex(-1)
          }}
          onArrowDown={() => setActiveIndex(0)}
          onSubmit={() => {
            const first = hits[0]
            if (first) setChosenId(first.doc.id)
          }}
          resultsId={hits.length > 0 ? 'law-results' : undefined}
          resultCount={hits.length}
          busy={engine.status === 'loading'}
        />

        <div className="flex flex-wrap gap-x-8 gap-y-4">
          {/* Pressing a chip with an empty box is a request to read that Act,
              not merely to filter nothing — see LawViewState.browse. */}
          <CodeChips value={view.code} onChange={(code) => update({ code, browse: true })} />
          <DirectionToggle
            value={result?.direction ?? view.direction}
            onChange={(direction) => update({ direction })}
            overriddenBy={result && result.direction !== view.direction ? result.parsed.act : null}
            disabled={browsing}
          />
        </div>
      </div>

      {engine.status === 'loading' ? (
        <div data-print-hide className="space-y-3" aria-busy="true">
          <p className="text-sm text-muted-foreground">{t('law.results.loading')}</p>
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : null}

      {engine.status === 'error' ? (
        <QueryErrorState
          title={t('law.results.errorTitle')}
          body={t('law.results.errorBody')}
          onRetry={engine.retry}
        />
      ) : null}

      {engine.status !== 'error' && !view.query.trim() && !browsing ? (
        <SectionCard data-print-hide>
          <EmptyState
            icon={Scale}
            title={t('law.results.startTitle')}
            body={t('law.results.startBody')}
            className="border-0 bg-transparent"
            action={
              <Button type="button" variant="outline" onClick={() => update({ browse: true })}>
                <BookOpen aria-hidden="true" />
                {t('law.results.browseAll')}
              </Button>
            }
          />
        </SectionCard>
      ) : null}

      {engine.status === 'ready' && view.query.trim() && hits.length === 0 && !result?.dropped.length ? (
        <SectionCard data-print-hide>
          <EmptyState
            title={t('law.results.emptyTitle')}
            body={t('law.results.emptyBody')}
            className="border-0 bg-transparent"
          />
        </SectionCard>
      ) : null}

      {/*
        A repealed provision the new Act simply dropped. Shown ABOVE the result
        list, because a reader who typed "377" and sees a list of loosely
        matching headings would reasonably conclude the app had found it.
      */}
      {result?.dropped.map((provision) => (
        <SectionCard key={`${provision.oldAct}:${provision.section}`} className="p-5">
          <div className="flex flex-wrap items-center gap-2">
            <SectionNumber className="text-base">
              {provision.oldAct} {provision.section}
            </SectionNumber>
            <Badge tone="danger">{t('law.status.dropped')}</Badge>
          </div>
          <h2 className="mt-3 text-lg leading-snug font-semibold">
            {t('law.card.deletedTitle', { act: provision.oldAct, section: provision.section })}
          </h2>
          {provision.entry.heading.en ? (
            <p className="mt-1 text-sm text-muted-foreground">
              {provision.entry.heading[language] || provision.entry.heading.en}
            </p>
          ) : null}
          {provision.entry.note ? (
            <p className="mt-3 text-sm">{provision.entry.note[language] || provision.entry.note.en}</p>
          ) : null}
          {provision.entry.warnings?.map((note) => (
            <NoteBanner key={note.title.en} note={note} className="mt-3" />
          ))}
        </SectionCard>
      ))}

      {/*
        List and section side by side from 1024px, stacked below it.

        Stacked, opening a result put the card BELOW the fold and the reader
        had no idea anything had happened — the complaint that produced this
        layout. Two panes fix it outright on a desktop, where a law reference
        is mostly read; on a phone the card is scrolled into view instead (see
        the effect above) and announced, which is the same fix by other means.

        `lg:items-start` is what lets the list stick while the card scrolls.
      */}
      <div
        className={cn(
          'grid gap-6',
          // Two panes ONLY once a section is open. While browsing with nothing
          // selected, a 24rem column of sections beside an empty half-page
          // reads as a broken layout — until something is opened the list has
          // the width to itself.
          selected && 'lg:grid-cols-[24rem_minmax(0,1fr)] lg:items-start',
        )}
      >
        {hits.length > 0 && engine.engine ? (
          <div data-print-hide className="min-w-0 space-y-2 lg:sticky lg:top-20">
            <p className="text-sm text-muted-foreground tabular-nums">
              {browsing
                ? view.code
                  ? t('law.results.browsing', {
                      count: hits.length,
                      act: actNameFor(engine.engine, view.code, language),
                    })
                  : t('law.results.browsingAll', { count: hits.length })
                : t('law.results.count', { count: hits.length })}
            </p>
            {/* The search caps its result list; say so rather than presenting a
              truncated list as if it were everything. */}
            {!browsing && hits.length >= SEARCH_RESULT_LIMIT ? (
              <p className="text-xs text-muted-foreground">
                {t('law.results.truncated', { count: hits.length })}
              </p>
            ) : null}
            <ResultList
              id="law-results"
              hits={hits}
              corpus={engine.engine.corpus}
              selectedId={selected?.doc.id ?? null}
              onSelect={(hit) => {
                setChosenId(hit.doc.id)
                setDismissedFor(null)
              }}
              activeIndex={activeIndex}
              onActiveIndexChange={setActiveIndex}
              browsing={browsing}
              // Below `lg` the pane is a short box inside a scrolling page; from
              // `lg` it is a column of its own and fills the screen.
              className={cn(
                'max-h-[26rem]',
                // Beside an open section the pane follows that column; on its
                // own it has the page to itself and is worth more of the screen.
                selected ? 'lg:max-h-[calc(100dvh-11rem)]' : 'lg:max-h-[calc(100dvh-19rem)]',
              )}
              onLeaveTop={() => {
                setActiveIndex(-1)
                document.getElementById('law-search')?.focus()
              }}
            />
          </div>
        ) : null}

        {/*
          `min-w-0` on both grid children is load-bearing, not tidiness. A grid
          item defaults to `min-width: auto`, which is its MIN-CONTENT width —
          and the card contains a 36rem-wide classification table. Without it
          the card was 576px wide inside a 390px phone and the whole page
          scrolled sideways, which the design system forbids outright.
        */}
        {selected && engine.engine ? (
          <div ref={cardRef} className="min-w-0">
            <SectionResultCard
              key={selected.doc.id}
              code={selected.doc.ref.code}
              record={selected.doc.ref.record}
              corpus={engine.engine.corpus}
              onOpenSection={openSection}
              onClose={() => {
                setChosenId(null)
                setDismissedFor(deferredQuery)
              }}
            />
          </div>
        ) : null}
      </div>

      {/*
        Where the section went, for a reader who cannot see it scroll. Focus is
        deliberately NOT moved: it would strand anyone arrowing through the
        list, and the announcement carries the same information without it.
      */}
      <p role="status" aria-live="polite" className="sr-only">
        {selected
          ? t('law.results.opened', {
              act: selected.doc.ref.record.act,
              section: selected.doc.ref.record.section,
              heading: selected.doc.ref.record.heading[language] || selected.doc.ref.record.heading.en,
            })
          : ''}
      </p>
    </div>
  )
}
