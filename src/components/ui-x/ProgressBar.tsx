import { cn } from '@/lib/utils'

interface ProgressBarProps {
  /** 0-100. Clamped, so a bad computation cannot overflow the track. */
  value: number
  /** Required: a bar with no accessible name announces only a number. */
  label: string
  className?: string
}

/** Fill is --action, the one theme-inverting token: navy in light, gold in dark. */
export function ProgressBar({ value, label, className }: ProgressBarProps) {
  const pct = Math.min(100, Math.max(0, Math.round(value)))

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn('h-2 w-full overflow-hidden rounded-full bg-muted', className)}
    >
      <div className="h-full rounded-full bg-action transition-[width]" style={{ width: `${pct}%` }} />
    </div>
  )
}
