import { useT } from '@/i18n/useT'
import { cn } from '@/lib/utils'

interface ProgressRingProps {
  /** 0-100. */
  value: number
  /** Required: a ring with no accessible name announces only a number. */
  label: string
  className?: string
}

const SIZE = 40
const STROKE = 4
const RADIUS = (SIZE - STROKE) / 2
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

/**
 * A work's reading progress on its shelf card.
 *
 * `--action` for the arc, the same token `ProgressBar` fills with — navy in
 * light, gold in dark — over a `--muted` track. Not a gauge: a gauge has a
 * needle and a scale and belongs to Neev; this is a bar bent into a circle
 * because a card has a corner and not a column.
 *
 * The percentage is ALSO written beside it as text, and the ring carries
 * `role="img"` with its own label — state is never colour or shape alone.
 *
 * A reader who has opened one section of the BNSS is at 0.19%, which rounds to
 * zero — and the committed version reported that as "Not started", to somebody
 * who had demonstrably started. The ARC being invisible at that width is
 * honest; the WORDS were not. Anything above zero now reads `<1%` at worst and
 * draws a minimum visible tick.
 */
/** Below this the arc is a hairline nobody can see; it is drawn at this instead. */
const MIN_VISIBLE_PCT = 2

export function ProgressRing({ value, label, className }: ProgressRingProps) {
  const { t } = useT()
  const raw = Number.isNaN(value) ? 0 : Math.min(100, Math.max(0, value))
  const pct = Math.round(raw)
  const started = raw > 0
  const offset = CIRCUMFERENCE * (1 - Math.max(raw, started ? MIN_VISIBLE_PCT : 0) / 100)

  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <svg
        role="img"
        aria-label={label}
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="shrink-0 -rotate-90"
      >
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          strokeWidth={STROKE}
          className="stroke-muted"
        />
        {started ? (
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={offset}
            className="stroke-action"
          />
        ) : null}
      </svg>
      <span className="text-xs text-muted-foreground tabular-nums">
        {started ? (pct > 0 ? `${pct}%` : t('library.underOnePercent')) : t('library.notStarted')}
      </span>
    </span>
  )
}
