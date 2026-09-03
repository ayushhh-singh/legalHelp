import { GraduationCap, StickyNote, X } from 'lucide-react'
import { useEffect, useRef } from 'react'

import { useT } from '@/i18n/useT'
import { HIGHLIGHT_COLOURS, type HighlightColour } from '@/lib/library'
import { cn } from '@/lib/utils'

/**
 * What appears when the reader selects a passage: four colours, a note, and
 * "add to trainer".
 *
 * POSITIONED, BUT NOT ONLY POSITIONED. A floating toolbar anchored to a
 * selection rectangle is unreachable by keyboard and invisible to a screen
 * reader if that is all it is, so this is a real `role="toolbar"` that takes
 * focus when it opens, traps nothing, closes on Escape and returns focus to the
 * text. `at` is only where it is drawn; when there is no geometry to anchor to
 * — a keyboard selection, or jsdom — it sits under the unit heading instead of
 * in the corner of the screen.
 */

const SWATCH: Readonly<Record<HighlightColour, string>> = {
  marigold: 'bg-marigold/15 text-marigold-foreground border-marigold/40',
  tulsi: 'bg-tulsi/15 text-tulsi-foreground border-tulsi/40',
  violet: 'bg-violet/15 text-violet-foreground border-violet/40',
  coral: 'bg-coral/15 text-coral-foreground border-coral/40',
}

interface SelectionToolbarProps {
  at: { top: number; left: number } | null
  /** What was selected, for the accessible name — an unlabelled toolbar says nothing. */
  quote: string
  onColour: (colour: HighlightColour) => void
  onNote: () => void
  onTrainer: () => void
  onClose: () => void
}

export function SelectionToolbar({ at, quote, onColour, onNote, onTrainer, onClose }: SelectionToolbarProps) {
  const { t } = useT()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    ref.current?.querySelector('button')?.focus()
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const short = quote.length > 60 ? `${quote.slice(0, 58)}…` : quote

  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label={t('library.select.toolbar', { quote: short })}
      data-print-hide
      style={
        at
          ? { position: 'fixed', top: Math.max(8, at.top - 56), left: at.left, transform: 'translateX(-50%)' }
          : undefined
      }
      className={cn(
        'z-40 flex items-center gap-1 rounded-lg border border-border bg-card p-1 shadow-lg',
        !at && 'mb-3',
      )}
    >
      {HIGHLIGHT_COLOURS.map((colour) => (
        <button
          key={colour}
          type="button"
          onClick={() => onColour(colour)}
          aria-label={t(`library.select.colour.${colour}`)}
          className={cn(
            'h-9 w-9 rounded-md border text-xs font-semibold transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
            SWATCH[colour],
          )}
        >
          {/* A letter, not a swatch alone: colour is never the only carrier. */}
          {t(`library.select.colour.${colour}`).slice(0, 1)}
        </button>
      ))}

      <span aria-hidden="true" className="mx-0.5 h-6 w-px bg-border" />

      <button
        type="button"
        onClick={onNote}
        className="inline-flex h-9 items-center gap-1.5 rounded-md px-2 text-xs transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <StickyNote aria-hidden="true" className="h-4 w-4" />
        {t('library.select.note')}
      </button>
      <button
        type="button"
        onClick={onTrainer}
        className="inline-flex h-9 items-center gap-1.5 rounded-md px-2 text-xs transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <GraduationCap aria-hidden="true" className="h-4 w-4" />
        {t('library.select.trainer')}
      </button>
      <button
        type="button"
        onClick={onClose}
        aria-label={t('library.select.close')}
        className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <X aria-hidden="true" className="h-4 w-4" />
      </button>
    </div>
  )
}
