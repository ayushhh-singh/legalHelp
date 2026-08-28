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
/** The height of the scroll container once windowing is on. */
const VIEWPORT_ROWS = 8

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
}: ResultListProps) {
  const { t, language } = useT()
  const containerRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)

  const virtualised = hits.length > VIRTUALISE_ABOVE

  // The window ALWAYS contains activeIndex, whatever the scroll position is.
  // Deriving it from scrollTop alone would mean arrowing past the bottom of the
  // window focused an element that had not been rendered yet, and the focus
  // would land nowhere.
  let first = 0
  let last = hits.length
  if (virtualised) {
    const fromScroll = Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN
    // Only pull the window back to activeIndex when there IS one. With
    // activeIndex at -1 (nothing focused, the usual state) the clamp made
    // `first` 0 at every scroll position, so scrolling a long list revealed
    // blank space instead of rows.
    const anchor = activeIndex >= 0 ? Math.min(fromScroll, activeIndex - OVERSCAN) : fromScroll
    first = Math.max(0, anchor)
    last = Math.min(hits.length, Math.max(first + VIEWPORT_ROWS + OVERSCAN * 2, activeIndex + 1))
  }

  // Move real focus to the active row. `.focus()` scrolls it into view itself,
  // which is also what keeps the windowed container in sync.
  useEffect(() => {
    if (activeIndex < 0) return
    const row = containerRef.current?.querySelector<HTMLButtonElement>(`[data-index="${activeIndex}"]`)
    row?.focus()
  }, [activeIndex, hits])

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
      onActiveIndexChange(Math.min(activeIndex + 1, hits.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (activeIndex <= 0) onLeaveTop()
      else onActiveIndexChange(activeIndex - 1)
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
      <li
        key={hit.doc.id}
        style={virtualised ? { position: 'absolute', top: index * ROW_HEIGHT, left: 0, right: 0 } : undefined}
      >
        <button
          type="button"
          data-index={index}
          onKeyDown={onKeyDown}
          // Only the active row is tabbable, so Tab leaves the list rather than
          // walking through every one of a thousand results.
          tabIndex={index === Math.max(activeIndex, 0) ? 0 : -1}
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
            <Badge tone={hit.reason === 'section-other-direction' ? 'warning' : 'neutral'}>
              {hit.reason === 'section'
                ? t('law.results.reasonSection')
                : hit.reason === 'section-other-direction'
                  ? t('law.results.reasonOther')
                  : t('law.results.reasonText')}
            </Badge>
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
      onScroll={virtualised ? (event) => setScrollTop(event.currentTarget.scrollTop) : undefined}
      className={cn(
        'overflow-hidden rounded-lg border border-border bg-card',
        virtualised && 'overflow-y-auto',
      )}
      style={virtualised ? { maxHeight: VIEWPORT_ROWS * ROW_HEIGHT } : undefined}
    >
      <ul
        id={id}
        aria-label={t('law.search.resultsLabel')}
        // The spacer height is what gives the scrollbar the right size when
        // only a window of the rows is in the DOM.
        style={virtualised ? { position: 'relative', height: hits.length * ROW_HEIGHT } : undefined}
      >
        {rows}
      </ul>
    </div>
  )
}
