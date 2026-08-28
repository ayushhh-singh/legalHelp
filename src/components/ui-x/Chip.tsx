import { cn } from '@/lib/utils'

type ChipTone = 'neutral' | 'action' | 'marigold' | 'tulsi' | 'coral' | 'violet'

/**
 * Pill. The accent tones render as that colour's /15 tint with its paired
 * `-foreground` text — never the raw accent as a text colour (see tokens.css).
 */
const TONES: Record<ChipTone, string> = {
  neutral: 'bg-muted text-muted-foreground',
  action: 'bg-action text-action-foreground',
  marigold: 'bg-marigold/15 text-marigold-foreground',
  tulsi: 'bg-tulsi/15 text-tulsi-foreground',
  coral: 'bg-coral/15 text-coral-foreground',
  violet: 'bg-violet/15 text-violet-foreground',
}

interface ChipProps extends React.ComponentPropsWithRef<'span'> {
  tone?: ChipTone
}

export function Chip({ tone = 'neutral', className, ...props }: ChipProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
        TONES[tone],
        className,
      )}
      {...props}
    />
  )
}

export type { ChipTone }
