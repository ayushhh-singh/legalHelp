import { SectionCard } from './SectionCard'

import { cn } from '@/lib/utils'

interface StatCardProps {
  label: string
  /** Pre-formatted. Formatting is the caller's job — it is locale-dependent. */
  value: string
  hint?: string
  className?: string
}

/**
 * One figure with its name. The value uses `.font-display` — Inter 800 with
 * tabular numerals — so a row of figures aligns and a counting number does not
 * jitter. That is why it is not the Poppins heading face.
 */
export function StatCard({ label, value, hint, className }: StatCardProps) {
  return (
    <SectionCard className={cn('p-4', className)}>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="font-display mt-1 text-2xl">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </SectionCard>
  )
}
