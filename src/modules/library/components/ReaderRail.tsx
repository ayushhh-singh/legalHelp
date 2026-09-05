import { Lightbulb, X } from 'lucide-react'
import { useEffect, useRef } from 'react'

import { RAIL_TABS, type RailTab } from '../useLibrary'

import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'
import { cn } from '@/lib/utils'

/**
 * The reader's rail, as four tabs instead of a column of six cards.
 *
 * ### These ARE `role="tab"`, and the sub-tab strips are not
 *
 * ADR-046 §6 refuses the ARIA tab pattern for `SegmentedTabs`, because a router
 * swaps a whole page rather than a panel and does not own its own focus. Both
 * halves of that objection are false here: one panel is swapped in place, in
 * the same document, with no navigation and no URL change, and the widget owns
 * arrow-key focus. This is what the pattern is actually for, so it uses it.
 *
 * ### The order is `docs/AI.md` §13's order, preserved
 *
 * Understand (the hand-authored aid — zero cost, no key, works offline), then
 * Practise (the reader's own words and cards that already exist), then Related,
 * then Ask, which is the only one that reaches a model and is present only when
 * AI is on. Turning AI off costs the rail one tab out of four, which is the
 * test `src/modules/library/ai-seam.ts` states.
 *
 * ### Two presentations, one panel
 *
 * Desktop: a sticky column beside the text, collapsible, with the choice
 * remembered. Phone: the same tablist and the same panel in a sheet over the
 * page, opened by a floating "Understand" button — because a rail below a
 * 4,000-character provision is a rail nobody scrolls to.
 */

export interface ReaderRailProps {
  tab: RailTab
  onTab: (next: RailTab) => void
  /** Which tabs have anything behind them. A tab with nothing is not rendered. */
  available: Readonly<Record<RailTab, boolean>>
  /** The panel for the current tab. */
  children: React.ReactNode
  /** Phone only: whether the sheet is open. */
  sheetOpen: boolean
  onSheetOpen: (next: boolean) => void
  className?: string
}

function TabList({ tab, onTab, available }: Pick<ReaderRailProps, 'tab' | 'onTab' | 'available'>) {
  const { t } = useT()
  const list = useRef<HTMLDivElement>(null)
  const shown = RAIL_TABS.filter((entry) => available[entry])

  /*
    Left/Right/Home/End move between the tabs, ON THE TABS.

    The handler is on each button rather than on the tablist, which is both what
    `jsx-a11y/interactive-supports-focus` wants (a `role="tablist"` carrying a
    key handler would have to be focusable itself, and in this pattern it is
    not — the selected TAB holds the tab stop) and what the pattern actually
    describes.
  */
  const onKeyDown = (event: React.KeyboardEvent) => {
    const index = shown.indexOf(tab)
    const next =
      event.key === 'ArrowRight'
        ? shown[(index + 1) % shown.length]
        : event.key === 'ArrowLeft'
          ? shown[(index - 1 + shown.length) % shown.length]
          : event.key === 'Home'
            ? shown[0]
            : event.key === 'End'
              ? shown.at(-1)
              : undefined
    if (!next) return
    event.preventDefault()
    onTab(next)
    // Focus follows selection, which is the automatic-activation form of the
    // pattern — right here because switching costs nothing and renders no route.
    list.current?.querySelector<HTMLButtonElement>(`[data-rail-tab="${next}"]`)?.focus()
  }

  return (
    <div
      ref={list}
      role="tablist"
      aria-label={t('library.railTabs.label')}
      className="flex gap-1 border-b border-border"
    >
      {shown.map((entry) => (
        <button
          key={entry}
          type="button"
          role="tab"
          data-rail-tab={entry}
          id={`rail-tab-${entry}`}
          aria-selected={tab === entry}
          aria-controls="rail-panel"
          tabIndex={tab === entry ? 0 : -1}
          onClick={() => onTab(entry)}
          onKeyDown={onKeyDown}
          className={cn(
            'min-h-11 flex-1 border-b-[3px] px-2 text-xs transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
            tab === entry
              ? 'border-marigold font-semibold text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
        >
          {t(`library.railTabs.${entry}`)}
        </button>
      ))}
    </div>
  )
}

export function ReaderRail({
  tab,
  onTab,
  available,
  children,
  sheetOpen,
  onSheetOpen,
  className,
}: ReaderRailProps) {
  const { t } = useT()
  const sheet = useRef<HTMLDivElement>(null)

  /*
    Escape shuts the sheet, and stops there.

    `FocusLayout` leaves the whole route on Escape and checks for an open
    `[role="dialog"]` first — which this is not, deliberately: a sheet the
    reader can still scroll the page behind is not a dialog, and giving it
    `role="dialog"` to borrow that exclusion would be claiming a focus trap it
    does not have.

    Stopping propagation is NOT what makes this work, and believing it did cost
    a browser run: that handler is on `window` and this one is on `window` too,
    so which fires first is registration order — and the layout mounts first.
    `data-focus-overlay` on the open sheet is what it actually reads. ADR-029's
    "two Escape handlers on one press", for the fourth time.
  */
  useEffect(() => {
    if (!sheetOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      event.preventDefault()
      onSheetOpen(false)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [sheetOpen, onSheetOpen])

  useEffect(() => {
    if (sheetOpen) sheet.current?.focus()
  }, [sheetOpen])

  return (
    <>
      {/*
        The floating opener — below `lg` only, and only while the sheet is shut.
      */}
      {sheetOpen ? null : (
        <Button
          data-print-hide
          className="fixed end-4 bottom-[calc(1rem+env(safe-area-inset-bottom,0px)+var(--pwa-toast-space,0px))] z-45 rounded-full shadow-lg lg:hidden"
          onClick={() => onSheetOpen(true)}
        >
          <Lightbulb aria-hidden="true" />
          {t('library.railTabs.open')}
        </Button>
      )}

      {/*
        ONE panel, styled two ways.

        The first version rendered the desktop column and the phone sheet as two
        subtrees and let `hidden lg:block` pick — which is correct on screen and
        wrong everywhere else: both are in the DOM at every width, so every
        assertion about the rail matched twice, a screen reader met the aid
        twice, and the study panel's own tablist existed twice with two
        different tabs selected. The overrides below are the price of having one
        of it, and they are pure CSS — a viewport branch in React disagrees with
        the rendered layout for a frame after every resize (`src/lib/nav.ts`).
      */}
      <div
        ref={sheet}
        data-print-hide
        {...(sheetOpen
          ? { tabIndex: -1, 'aria-label': t('library.railTabs.label'), 'data-focus-overlay': '' }
          : {})}
        className={cn(
          'lg:static lg:z-auto lg:block lg:max-h-none lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none',
          sheetOpen
            ? 'fixed inset-x-0 bottom-0 z-45 max-h-[70vh] overflow-y-auto rounded-t-xl border-t border-border bg-card px-4 pt-2 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] shadow-lg'
            : 'hidden',
          className,
        )}
      >
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <TabList tab={tab} onTab={onTab} available={available} />
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0 lg:hidden"
            aria-label={t('library.railTabs.close')}
            onClick={() => onSheetOpen(false)}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
        <div
          role="tabpanel"
          id="rail-panel"
          aria-labelledby={`rail-tab-${tab}`}
          tabIndex={-1}
          className="flex flex-col gap-4 pt-4"
        >
          {children}
        </div>
      </div>
    </>
  )
}
