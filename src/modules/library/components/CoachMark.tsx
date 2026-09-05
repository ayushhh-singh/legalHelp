import { X } from 'lucide-react'

import type { CoachMarkId } from '../useLibrary'

import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'
import { cn } from '@/lib/utils'

/**
 * A first-run tip pointing at one control, shown once and then never again.
 *
 * Three of them exist — the "Aa" tray, highlighting by selecting, and the
 * Understand rail — because Session 35 moved or hid all three, and a control an
 * officer used yesterday and cannot find today is worse than one they never had.
 * Each is dismissed on its own and the dismissal is in IndexedDB with every
 * other reading preference, so it survives a reload and does not follow the
 * reader onto another device as a thing they have to dismiss again.
 *
 * ### It is not a dialog
 *
 * `role="note"` and an ordinary Dismiss button. A first-run tip that trapped
 * focus would have to be got out of before the officer could read the rule they
 * came for, and one that appeared over the text would be doing the thing the
 * whole session is removing. Only ONE is ever on screen at a time —
 * `nextCoachMark` in `ReaderPage` decides which — because three tips at once is
 * a tour, and a tour is what a reader dismisses without reading.
 */
export function CoachMark({
  id,
  onDismiss,
  className,
}: {
  id: CoachMarkId
  onDismiss: (id: CoachMarkId) => void
  className?: string
}) {
  const { t } = useT()

  return (
    <div
      role="note"
      data-print-hide
      data-coach={id}
      className={cn(
        'flex items-start gap-3 rounded-lg border-l-[3px] border-marigold bg-marigold/15 px-3 py-2 text-xs text-marigold-foreground',
        className,
      )}
    >
      <p className="min-w-0 flex-1">{t(`library.coach.${id}`)}</p>
      <Button
        variant="ghost"
        size="icon"
        className="-me-1 h-8 w-8 shrink-0 text-marigold-foreground"
        aria-label={t('library.coach.dismiss')}
        onClick={() => onDismiss(id)}
      >
        <X aria-hidden="true" />
      </Button>
    </div>
  )
}
