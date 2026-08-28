import { useEffect, useRef } from 'react'

import type { LawHit } from '../search'
import type { LawCorpus } from '../types'

import { Badge, SectionNumber } from '@/components/ui-x'
import { useT } from '@/i18n/useT'
import { cn } from '@/lib/utils'

/**
 * The ranked result list: a plain list of buttons with roving focus.
 *
 * Not a combobox and not an `aria-activedescendant` listbox. Both are correct
 * patterns for a picker that closes; this list stays on screen beside the
 * section it opened, real DOM focus is what a reader's screen reader follows
 * through it, and a button that can be tabbed to and pressed needs no ARIA at
 * all to be operable.
 *
 * ## Why there is no virtualisation here any more
 *
 * There was, and it produced three user-visible defects in a row: a window
 * pinned to the first row, so scrolling a browse list showed blank space; a
 * window computed from a scroll offset the browser had silently reset during a
 * reflow, so the list went BLANK when a row was clicked; and then, with both
 * fixed, a list that still looked capped because only thirty rows were ever in
 * the DOM.
 *
 * The measurement that settled it: a row is six DOM nodes, and the longest list
 * this module can produce is the whole corpus — 1,059 sections, roughly 6,400
 * nodes — while search results are capped at 200 before they reach here. That
 * is an ordinary amount of DOM. Rendering all of it costs less than the
 * windowing cost in defects, and it cannot go blank.
 *
 * This is a deliberate departure from the brief's "results virtualised if > 50"
 * (ADR-016). The condition that makes virtualisation worth its complexity — an
 * unbounded list — is not true here: the corpus is fixed, known and small.
 * Measure before reintroducing it.
 */

/** One row. Fixed so a pane's max-height is a whole number of rows. */
const ROW_HEIGHT = 76

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
  /**
   * True when the list is the whole Act rather than a set of matches. The
   * per-row "why" badge is about ranking, and there is no ranking to explain
   * when every section of a code is present in number order.
   */
  browsing?: boolean
  /** Height of the scrolling pane, so the page can size it per breakpoint. */
  className?: string
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

  /**
   * `activeIndex` is owned by the page, and the page can hand over one that no
   * longer exists — a new query returns fewer rows than the old one. Left
   * unclamped, NO row got `tabIndex={0}` and the whole list dropped out of the
   * tab order.
   */
  const active = hits.length === 0 ? -1 : Math.min(activeIndex, hits.length - 1)

  // Move real focus to the active row. `.focus()` scrolls it into view itself.
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

  return (
    <div
      ref={containerRef}
      className={cn('overflow-y-auto rounded-lg border border-border bg-card', className)}
    >
      <ul id={id} aria-label={t('law.search.resultsLabel')}>
        {hits.map((hit, index) => {
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
                // Only the active row is tabbable, so Tab leaves the list
                // rather than walking through a thousand results.
                tabIndex={index === Math.max(active, 0) ? 0 : -1}
                aria-current={selected ? 'true' : undefined}
                onClick={() => {
                  onActiveIndexChange(index)
                  onSelect(hit)
                }}
                style={{ height: ROW_HEIGHT }}
                className={cn(
                  'flex w-full flex-col justify-center gap-1 border-b border-border px-4 text-left transition-colors',
                  'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none',
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
                  On the selected row the surface is --accent, and
                  --muted-foreground does not clear 4.5:1 on it — the pairing
                  rule again (tokens.css). --accent-foreground is the token for
                  text on that surface, so the hierarchy between the two lines is
                  carried by SIZE and WEIGHT rather than by dimming, which is the
                  same fix OptionRow needed.
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
        })}
      </ul>
    </div>
  )
}
