import {
  Bookmark,
  BookmarkCheck,
  GraduationCap,
  Highlighter,
  Keyboard,
  PanelRight,
  StickyNote,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Popover } from '@/components/ui-x'
import { useT } from '@/i18n/useT'
import { HIGHLIGHT_COLOURS, type HighlightColour } from '@/lib/library'
import { cn } from '@/lib/utils'

/**
 * What an officer does to a provision, as one row of icons.
 *
 * On a desktop it sits directly under the unit's title, where the eye already
 * is. On a phone it is `fixed` to the bottom edge, because a phone's thumb is
 * not at the top of the screen and an action bar that scrolls away is one an
 * officer scrolls back for.
 *
 * ### Highlight is disabled without a selection, and says so
 *
 * A colour applies to what is selected, so with nothing selected there is
 * nothing to colour. The alternative — colouring the whole provision — is not
 * what anybody means by "highlight", and the alternative to THAT is hiding the
 * control, which is the "a control that vanishes teaches nothing" line ADR-030
 * settled for the AI tier picker and `TypeControls` repeats for the spacing
 * lock. It is disabled with its reason in the accessible name.
 *
 * The floating `SelectionToolbar` is unchanged and is still what appears when
 * an officer actually drags across a passage; this row is the same four colours
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
  railOpen: boolean
  onToggleRail: () => void
  onHelp: () => void
  className?: string
}

export function UnitActions({
  hasSelection,
  onHighlight,
  onNote,
  bookmarked,
  onBookmark,
  onAddToTrainer,
  railOpen,
  onToggleRail,
  onHelp,
  className,
}: UnitActionsProps) {
  const { t } = useT()

  return (
    <div
      data-print-hide
      role="group"
      aria-label={t('library.reader.actions')}
      className={cn('flex items-center gap-1', className)}
    >
      <Popover
        label={hasSelection ? t('library.highlight.title') : t('library.reader.highlightNoSelection')}
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
              onClick={() => onHighlight(colour)}
              className={cn(
                'h-9 w-9 rounded-md border text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                SWATCH[colour],
              )}
            >
              <span aria-hidden="true">A</span>
            </button>
          ))}
        </div>
        {hasSelection ? null : (
          <p className="mt-2 max-w-48 text-xs text-muted-foreground">
            {t('library.reader.highlightNoSelection')}
          </p>
        )}
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
        <Button
          variant="outline"
          size="icon"
          className="h-9 w-9"
          aria-label={t('library.trainer.add')}
          onClick={onAddToTrainer}
        >
          <GraduationCap aria-hidden="true" />
        </Button>
      ) : null}

      <Button
        variant="outline"
        size="icon"
        className="h-9 w-9"
        aria-pressed={railOpen}
        aria-label={railOpen ? t('library.reader.railHide') : t('library.reader.railShow')}
        onClick={onToggleRail}
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
}
