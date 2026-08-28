import { Check } from 'lucide-react'

import { cn } from '@/lib/utils'

interface OptionRowProps {
  selected: boolean
  label: string
  /** One line under the label explaining what the option does or why it is off. */
  hint?: string
  disabled?: boolean
  onSelect: () => void
  className?: string
}

/**
 * A radio option drawn as a full-width row.
 *
 * Selection is carried by three things at once — the border colour, a bolder
 * label and the check mark — because "state is never colour alone" is a rule
 * this app keeps everywhere, not only in the nav.
 */
export function OptionRow({ selected, label, hint, disabled, onSelect, className }: OptionRowProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        'flex min-h-11 w-full items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5 text-left text-sm transition-colors',
        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none',
        'disabled:cursor-not-allowed disabled:opacity-50',
        selected
          ? 'border-action bg-accent font-semibold text-accent-foreground'
          : 'text-muted-foreground hover:bg-muted disabled:hover:bg-transparent',
        className,
      )}
    >
      <span className="min-w-0">
        <span className="block">{label}</span>
        {/* Size and weight carry the hierarchy, not opacity: dimming
            --muted-foreground with `opacity-80` drops it below 4.5:1, which
            tests/e2e/a11y.spec.ts caught on this very row. */}
        {hint ? <span className="mt-0.5 block text-xs font-normal">{hint}</span> : null}
      </span>
      {selected ? <Check aria-hidden="true" className="h-4 w-4 shrink-0" /> : null}
    </button>
  )
}
