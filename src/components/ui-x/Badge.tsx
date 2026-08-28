import { cn } from '@/lib/utils'

type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

/**
 * Status marker. Squarer than a Chip and always semantic — a Chip is a filter
 * or a label the reader can act on, a Badge only reports state.
 *
 * Every tone is a /15 tint with the paired `-foreground` on top, so none of
 * them relies on the raw accent as a text colour.
 */
const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-muted text-muted-foreground',
  info: 'bg-accent text-accent-foreground',
  success: 'bg-tulsi/15 text-tulsi-foreground',
  warning: 'bg-marigold/15 text-marigold-foreground',
  danger: 'bg-coral/15 text-coral-foreground',
}

interface BadgeProps extends React.ComponentPropsWithRef<'span'> {
  tone?: BadgeTone
}

export function Badge({ tone = 'neutral', className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-sm px-2 py-0.5 text-xs font-semibold',
        TONES[tone],
        className,
      )}
      {...props}
    />
  )
}

export type { BadgeTone }
