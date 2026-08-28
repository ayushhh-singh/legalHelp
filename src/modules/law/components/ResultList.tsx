import { useEffect, useRef, useState } from 'react'

import type { LawHit } from '../search'
import type { LawCorpus } from '../types'

import { Badge, SectionNumber } from '@/components/ui-x'
import { useT } from '@/i18n/useT'
import { cn } from '@/lib/utils'

/**
 * The ranked result list: a plain list of buttons with roving focus, windowed
 * once it gets long.
 *
 * Not a combobox and not an `aria-activedescendant` listbox. Both are correct
 * patterns for a picker that closes; this list stays on screen beside the
 * section it opened, real DOM focus is what a reader's screen reader follows
 * through it, and a button that can be tabbed to and pressed needs no ARIA at
 * all to be operable.
 */

/** Fixed, because the windowing arithmetic below depends on it. */
const ROW_HEIGHT = 76
/** Rows above and below the visible window, so a fast scroll shows no gap. */
const OVERSCAN = 6
/** Below this many results, windowing costs more than it saves. */
export const VIRTUALISE_ABOVE = 50
/**
 * The pane's height before it has been measured — one render's worth, and only
 * on the very first frame. Everything after that uses the MEASURED height, so
 * the window cannot be too small for a tall screen or wastefully large for a
 * short one. Guessing here was how the list ended in blank space.
 */
const ASSUMED_VIEWPORT_PX = 8 * ROW_HEIGHT
/** Never fewer rows in the DOM than this, whatever the measurement says. */
const MIN_PAGE = 30

interface ResultListProps {
  id: string
  hits: readonly LawHit[]
  corpus: LawCorpus
  selectedId: string | null
  onSelect: (hit: LawHit) => void
  /** -1 means the reader has not moved into the list; nothing is focused. */
  activeIndex: number
  onActiveIndexChange: (index: number) => void
  /** ArrowUp from the first row goes back to the search field. */
  onLeaveTop: () => void
  /** Height of the scrolling pane, so the page can size it per breakpoint. */
  className?: string
  /**
   * True when the list is the whole Act rather than a set of matches. The
   * per-row "why" badge is about ranking, and there is no ranking to explain
   * when every section of a code is present in number order.
   */
  browsing?: boolean
}

export function ResultList({
  id,
  hits,
  corpus,
  selectedId,
  onSelect,
  activeIndex,
  onActiveIndexChange,
  onLeaveTop,
  browsing = false,
  className,
}: ResultListProps) {
  const { t, language } = useT()
  const containerRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewport, setViewport] = useState(ASSUMED_VIEWPORT_PX)

  const virtualised = hits.length > VIRTUALISE_ABOVE

  /**
   * How many rows to keep in the DOM is derived from how tall the pane
   * actually is, because the page sizes it per breakpoint — a narrow phone and
   * a 1440px desktop column are not the same number of rows. A fixed guess is
   * either short (blank space at the bottom of a tall pane) or wasteful.
   */
  useEffect(() => {
    const element = containerRef.current
    if (!element || !virtualised || typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver((entries) => {
      const height = entries[0]?.contentRect.height ?? 0
      if (height > 0) setViewport(height)
      // And re-read where the pane ACTUALLY is. Opening a section reflows this
      // list from full width to a column, and the browser clamps or resets its
      // scroll position when it does — leaving the remembered `scrollTop`
      // pointing at rows that are no longer where the reader is looking. That
      // is what made the list go blank on a click.
      setScrollTop(element.scrollTop)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [virtualised])

  /**
   * A floor as well as a measurement. Thirty rows is nothing for React to hold,
   * and it means that even if the pane were measured at zero — a display:none
   * ancestor, a browser without ResizeObserver — the list still renders enough
   * to scroll through rather than appearing to stop after a screenful.
   */
  const page = Math.max(MIN_PAGE, Math.ceil(viewport / ROW_HEIGHT) + OVERSCAN * 2)

  /**
   * `activeIndex` is owned by the page, and the page can hand over one that no
   * longer exists — a new query returns fewer rows than the old one. Two things
   * broke when it did: NO row got `tabIndex={0}`, so the whole list dropped out
   * of the tab order; and `last` was computed from `activeIndex + 1`, which
   * expanded the window to every row and switched virtualisation off.
   */
  const active = hits.length === 0 ? -1 : Math.min(activeIndex, hits.length - 1)

  /**
   * The window is a fixed-size slice that follows the scroll position, and is
   * re-centred on the focused row when that row falls outside it.
   *
   * The first attempt clamped `first` to `min(fromScroll, active - OVERSCAN)`,
   * which does not move a window — it STRETCHES one, from row 0 down to the
   * focused row. With a row near the end focused that rendered every row and
   * turned virtualisation off entirely, and with nothing focused (`active` of
   * -1, the usual state) it pinned `first` to 0 so scrolling showed blank
   * space. Both are gone: the slice is `page` rows wide, always.
   */
  let first = 0
  let last = hits.length
  if (virtualised) {
    first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
    last = Math.min(hits.length, first + page)

    if (active >= 0 && (active < first || active >= last)) {
      first = Math.max(0, active - OVERSCAN)
      last = Math.min(hits.length, first + page)
    }
  }

  // Move real focus to the active row. `.focus()` scrolls it into view itself,
  // which is also what keeps the windowed container in sync.
  useEffect(() => {
    if (active < 0) return
    const row = containerRef.current?.querySelector<HTMLButtonElement>(`[data-index="${active}"]`)
    row?.focus()
  }, [active, hits])

  /**
   * Arrow keys live on the ROW, not on the container. A keydown handler on the
   * scroll container would be a listener on a non-interactive element (which
   * `jsx-a11y/no-static-element-interactions` correctly objects to); the row is
   * a real button, it already has focus when the key is pressed, and the event
   * would reach the container by bubbling anyway.
   */
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      onActiveIndexChange(Math.min(active + 1, hits.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (active <= 0) onLeaveTop()
      else onActiveIndexChange(active - 1)
    } else if (event.key === 'Home') {
      event.preventDefault()
      onActiveIndexChange(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      onActiveIndexChange(hits.length - 1)
    }
  }

  const rows = hits.slice(first, last).map((hit, offset) => {
    const index = first + offset
    const record = hit.doc.ref.record
    const dataset = corpus.datasets[hit.doc.ref.code]
    const heading = record.heading[language] || record.heading.en
    const selected = hit.doc.id === selectedId

    return (
      <li key={hit.doc.id}>
        <button
          type="button"
          data-index={index}
          onKeyDown={onKeyDown}
          // Only the active row is tabbable, so Tab leaves the list rather than
          // walking through every one of a thousand results.
          tabIndex={index === Math.max(active, 0) ? 0 : -1}
          aria-current={selected ? 'true' : undefined}
          onClick={() => {
            onActiveIndexChange(index)
            onSelect(hit)
          }}
          className={cn(
            'flex h-[76px] w-full flex-col justify-center gap-1 border-b border-border px-4 text-left transition-colors',
            'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset',
            selected ? 'bg-accent' : 'hover:bg-muted',
          )}
        >
          <span className="flex items-center gap-2">
            <SectionNumber>
              {record.act} {record.section}
            </SectionNumber>
            {browsing ? null : (
              <Badge tone={hit.reason === 'section-other-direction' ? 'warning' : 'neutral'}>
                {hit.reason === 'section'
                  ? t('law.results.reasonSection')
                  : hit.reason === 'section-other-direction'
                    ? t('law.results.reasonOther')
                    : t('law.results.reasonText')}
              </Badge>
            )}
          </span>
          {/*
            On the selected row the surface is --accent, and --muted-foreground
            does not clear 4.5:1 on it — the pairing rule again (tokens.css).
            --accent-foreground is the token for text on that surface, so the
            hierarchy between the two lines is carried by SIZE and WEIGHT
            rather than by dimming, which is the same fix OptionRow needed.
          */}
          <span
            className={cn(
              'line-clamp-1 text-sm',
              selected ? 'font-semibold text-accent-foreground' : 'text-foreground',
            )}
          >
            {heading}
          </span>
          <span
            className={cn(
              'line-clamp-1 text-xs',
              selected ? 'text-accent-foreground' : 'text-muted-foreground',
            )}
          >
            {dataset.newAct.name[language]}
          </span>
        </button>
      </li>
    )
  })

  return (
    <div
      ref={containerRef}
      onScroll={
        virtualised
          ? (event) => {
              setScrollTop(event.currentTarget.scrollTop)
              // Re-measure here as well as in the ResizeObserver. The observer
              // is the fast path; this is the one that cannot fail to run,
              // because it fires on the very interaction whose correctness
              // depends on the measurement. A pane measured too short renders
              // too few rows and the list appears to stop.
              const height = event.currentTarget.clientHeight
              if (height > 0) setViewport(height)
            }
          : undefined
      }
      className={cn(
        'overflow-hidden rounded-lg border border-border bg-card',
        // The pane scrolls only when there is more than a pane's worth. A short
        // list is just a card, with no nested scrollbar to trap a phone.
        virtualised && 'overflow-y-auto',
        className,
      )}
    >
      <ul id={id} aria-label={t('law.search.resultsLabel')}>
        {/*
          Two spacers rather than absolutely-positioned rows.

          Both give the scrollbar the right size. The difference is the failure
          mode: with absolute positioning, a window computed from a stale scroll
          offset puts every row at a coordinate the reader is not looking at,
          and the list appears EMPTY. In normal flow the same mistake shows the
          wrong rows for one frame, which is recoverable and obvious. A list
          that silently goes blank is neither.
        */}
        {first > 0 ? <li aria-hidden="true" style={{ height: first * ROW_HEIGHT }} /> : null}
        {rows}
        {last < hits.length ? (
          <li aria-hidden="true" style={{ height: (hits.length - last) * ROW_HEIGHT }} />
        ) : null}
      </ul>
    </div>
  )
}
