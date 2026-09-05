import {
  Bookmark,
  BookmarkCheck,
  GraduationCap,
  Highlighter,
  Keyboard,
  PanelRight,
  StickyNote,
} from 'lucide-react'
import { forwardRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Popover } from '@/components/ui-x'
import { useT } from '@/i18n/useT'
import { HIGHLIGHT_COLOURS, type HighlightColour } from '@/lib/library'
import { cn } from '@/lib/utils'

/**
 * What an officer does to a provision, as one row of icons.
 *
 * ### ONE element, positioned two ways
 *
 * Under the unit's title on a desktop, where the eye already is; pinned to the
 * bottom edge on a phone, because a thumb is not at the top of the screen and
 * an action bar that scrolls away is one an officer scrolls back for. It is
 * `fixed` below `lg` and `lg:static`, rather than two copies chosen by
 * `hidden lg:flex` — that is the mistake `ReaderRail` was built out of and this
 * component was built with: two subtrees are in the DOM at every width, so a
 * screen reader meets each action twice and every assertion about them resolves
 * to two elements.
 *
 * ### Two controls are DISABLED without a selection, and say why
 *
 * A colour applies to what is selected, and the trainer card's answer IS the
 * selected words — offered with nothing selected, that second one would store a
 * card whose answer is the empty string. The alternative to disabling them is
 * hiding them, which is the "a control that vanishes teaches nothing" line
 * ADR-030 settled for the AI tier picker and `TypeControls` repeats for the
 * spacing lock.
 *
 * The reason is the DESCRIPTION and not the name. A name says what a control
 * IS; the highlighter was called "Select some words in the provision first,
 * then choose a colour", which is a sentence about what to do — the same
 * mistake CLAUDE.md records on three of the numbering fields.
 *
 * The floating `SelectionToolbar` is unchanged and is still what appears when
 * an officer drags across a passage; this row is the same four colours
 * reachable from a fixed place, which is what a keyboard-only reader who
 * selected with Shift+Arrow needs.
 */

const SWATCH: Readonly<Record<HighlightColour, string>> = {
  marigold: 'bg-marigold/15 text-marigold-foreground border-marigold/40',
  tulsi: 'bg-tulsi/15 text-tulsi-foreground border-tulsi/40',
  violet: 'bg-violet/15 text-violet-foreground border-violet/40',
  coral: 'bg-coral/15 text-coral-foreground border-coral/40',
}

export interface UnitActionsProps {
  /** True when there is a live selection inside the provision. */
  hasSelection: boolean
  onHighlight: (colour: HighlightColour) => void
  onNote: () => void
  bookmarked: boolean
  onBookmark: () => void
  /** Null on a work no rule book backs — a personal document, or a law code. */
  onAddToTrainer: (() => void) | null
  /** The sticky column beside the text, from 1024px. */
  columnOpen: boolean
  onToggleColumn: () => void
  /** The sheet over the page, below 1024px. */
  sheetOpen: boolean
  onToggleSheet: () => void
  onHelp: () => void
  className?: string
}

export const UnitActions = forwardRef<HTMLDivElement, UnitActionsProps>(function UnitActions(
  {
    hasSelection,
    onHighlight,
    onNote,
    bookmarked,
    onBookmark,
    onAddToTrainer,
    columnOpen,
    onToggleColumn,
    sheetOpen,
    onToggleSheet,
    onHelp,
    className,
  },
  ref,
) {
  const { t } = useT()
  // Controlled, so choosing a colour puts the tray away — a menu that stays
  // open over the words it has just marked is a menu the officer dismisses.
  const [swatchesOpen, setSwatchesOpen] = useState(false)

  const needsSelection = hasSelection ? undefined : t('library.reader.needsSelection')

  return (
    <div
      ref={ref}
      data-print-hide
      role="group"
      aria-label={t('library.reader.actions')}
      className={cn(
        // Pinned on a phone, in the flow of the card on a desktop.
        'fixed inset-x-0 bottom-0 z-40 flex items-center justify-center gap-1 border-t border-border bg-card px-2 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))]',
        'lg:static lg:z-auto lg:justify-start lg:border-0 lg:bg-transparent lg:p-0',
        className,
      )}
    >
      <Popover
        label={t('library.reader.highlight')}
        {...(needsSelection ? { description: needsSelection } : {})}
        open={swatchesOpen}
        onOpenChange={setSwatchesOpen}
        triggerClassName="border border-input"
        align="start"
        panelClassName="w-auto p-2"
        trigger={<Highlighter aria-hidden="true" className="h-4 w-4" />}
      >
        <div role="group" aria-label={t('library.highlight.title')} className="flex gap-1">
          {HIGHLIGHT_COLOURS.map((colour) => (
            <button
              key={colour}
              type="button"
              disabled={!hasSelection}
              aria-label={t(`library.select.colour.${colour}`)}
              onClick={() => {
                onHighlight(colour)
                setSwatchesOpen(false)
              }}
              className={cn(
                'h-9 w-9 rounded-md border text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                SWATCH[colour],
              )}
            >
              <span aria-hidden="true">A</span>
            </button>
          ))}
        </div>
        {needsSelection ? (
          <p className="mt-2 max-w-48 text-xs text-muted-foreground">{needsSelection}</p>
        ) : null}
      </Popover>

      <Button
        variant="outline"
        size="icon"
        className="h-9 w-9"
        aria-label={t('library.note.add')}
        onClick={onNote}
      >
        <StickyNote aria-hidden="true" />
      </Button>

      <Button
        variant="outline"
        size="icon"
        className="h-9 w-9"
        aria-pressed={bookmarked}
        aria-label={bookmarked ? t('library.reader.removeBookmark') : t('library.reader.bookmark')}
        onClick={onBookmark}
      >
        {bookmarked ? <BookmarkCheck aria-hidden="true" /> : <Bookmark aria-hidden="true" />}
      </Button>

      {onAddToTrainer ? (
        <>
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9"
            disabled={!hasSelection}
            aria-label={t('library.select.trainer')}
            aria-describedby={needsSelection ? 'unit-actions-trainer-hint' : undefined}
            onClick={onAddToTrainer}
          >
            <GraduationCap aria-hidden="true" />
          </Button>
          {needsSelection ? (
            <span id="unit-actions-trainer-hint" className="sr-only">
              {needsSelection}
            </span>
          ) : null}
        </>
      ) : null}

      {/*
        The way into the study panel — TWO buttons, one per width, and that is
        not the duplication this session spent a day removing.

        Below `lg` the panel is a sheet over the page and above it a column
        beside the text: different things, separately remembered, and a single
        control cannot carry a state that is "hidden" on one and "showing" on
        the other. Only one is ever in the accessibility tree, because the other
        is `display: none` at that width.

        The phone's carries its label, because there it is the whole entry point
        and a bare icon is not something an officer discovers. It replaced a
        floating "Understand" button that did the same job and, pinned to the
        same corner, sat on top of both this row and the "Next" link.
      */}
      <Button
        variant="outline"
        size="sm"
        className="h-9 gap-1.5 px-2 lg:hidden"
        aria-pressed={sheetOpen}
        aria-label={sheetOpen ? t('library.reader.railHide') : t('library.reader.railShow')}
        onClick={onToggleSheet}
      >
        <PanelRight aria-hidden="true" />
        <span className="text-xs">{t('library.railTabs.understand')}</span>
      </Button>
      <Button
        variant="outline"
        size="icon"
        className="hidden h-9 w-9 lg:inline-flex"
        aria-pressed={columnOpen}
        aria-label={columnOpen ? t('library.reader.railHide') : t('library.reader.railShow')}
        onClick={onToggleColumn}
      >
        <PanelRight aria-hidden="true" />
      </Button>

      <Button
        variant="outline"
        size="icon"
        className="h-9 w-9"
        aria-label={t('library.polish.help')}
        onClick={onHelp}
      >
        <Keyboard aria-hidden="true" />
      </Button>
    </div>
  )
})
