import { cn } from '@/lib/utils'

interface ProgressBarProps {
  /**
   * 0-100. Clamped, and NaN reads as 0 — `0/0` upstream would otherwise render
   * `aria-valuenow="NaN"` and drop the width declaration entirely, leaving a
   * bar that looks empty but announces garbage. Infinity is left to the clamp,
   * which pins it to 100: an overflow really is "full", not "empty".
   */
  value: number
  /** Required: a bar with no accessible name announces only a number. */
  label: string
  className?: string
}

/** Fill is --action, the one theme-inverting token: navy in light, gold in dark. */
export function ProgressBar({ value, label, className }: ProgressBarProps) {
  const pct = Number.isNaN(value) ? 0 : Math.min(100, Math.max(0, Math.round(value)))

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
