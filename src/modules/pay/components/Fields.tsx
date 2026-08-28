import { Minus, Plus } from 'lucide-react'
import { useId } from 'react'

import { cn } from '@/lib/utils'

/**
 * The form primitives the Pay module uses.
 *
 * Kept here rather than in `src/components/ui-x` because none of them has a
 * second caller yet, and a shared component with one use is a guess about the
 * next one. They move up when the Drafting Studio or the Utilities module needs
 * the same control.
 *
 * Every one of them: a real `<label>` bound by id, a 44px target, a visible
 * focus ring from `--ring`, and `tabular-nums` on anything numeric.
 */

export function Field({
  label,
  hint,
  htmlFor,
  children,
  className,
}: {
  label: string
  hint?: string
  htmlFor?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <label className="mb-1 block text-sm font-medium" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

export function SelectField<T extends string>({
  label,
  hint,
  value,
  options,
  onChange,
  className,
}: {
  label: string
  hint?: string
  value: T
  options: ReadonlyArray<{ value: T; label: string }>
  onChange: (value: T) => void
  className?: string
}) {
  const id = useId()
  return (
    <Field label={label} hint={hint} htmlFor={id} className={className}>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        className="h-11 w-full rounded-lg border border-input bg-card px-3 text-sm tabular-nums focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  )
}

export function NumberField({
  label,
  hint,
  value,
  onChange,
  min = 0,
  max,
  step = 1,
  prefix,
  suffix,
  className,
}: {
  label: string
  hint?: string
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  prefix?: string
  suffix?: string
  className?: string
}) {
  const id = useId()
  return (
    <Field label={label} hint={hint} htmlFor={id} className={className}>
      <div className="relative">
        {prefix ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground"
          >
            {prefix}
          </span>
        ) : null}
        <input
          id={id}
          type="number"
          inputMode="numeric"
          value={Number.isFinite(value) ? value : 0}
          min={min}
          max={max}
          step={step}
          onChange={(event) => {
            const next = Number(event.target.value)
            onChange(Number.isFinite(next) ? next : 0)
          }}
          className={cn(
            'h-11 w-full rounded-lg border border-input bg-card px-3 text-sm tabular-nums focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
            prefix && 'pl-7',
            suffix && 'pr-8',
          )}
        />
        {suffix ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted-foreground"
          >
            {suffix}
          </span>
        ) : null}
      </div>
    </Field>
  )
}

/**
 * The cell stepper.
 *
 * A stepper rather than a select, because a Level has up to forty cells and the
 * reader is moving one step at a time from wherever they are — and because the
 * figure that matters is the basic pay, not the ordinal. Both are shown, and
 * the basic pay is the bigger of the two.
 */
export function Stepper({
  label,
  value,
  max,
  onChange,
  display,
  decreaseLabel,
  increaseLabel,
  hint,
}: {
  label: string
  /** Zero-based, as the engine counts. The caller renders it one-based. */
  value: number
  max: number
  onChange: (value: number) => void
  display: string
  decreaseLabel: string
  increaseLabel: string
  hint?: string
}) {
  const id = useId()
  const step = (delta: number) => onChange(Math.min(Math.max(value + delta, 0), max))

  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <div className="flex items-stretch gap-2">
        <button
          type="button"
          onClick={() => step(-1)}
          disabled={value <= 0}
          aria-label={decreaseLabel}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-input text-foreground transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50"
        >
          <Minus aria-hidden="true" className="h-4 w-4" />
        </button>
        <output
          id={id}
          className="flex h-11 min-w-0 flex-1 items-center justify-center rounded-lg border border-border bg-muted px-2 text-sm font-semibold tabular-nums"
        >
          {display}
        </output>
        <button
          type="button"
          onClick={() => step(1)}
          disabled={value >= max}
          aria-label={increaseLabel}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-input text-foreground transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50"
        >
          <Plus aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>
    </Field>
  )
}

/**
 * A switch drawn as a row.
 *
 * `role="switch"` with `aria-checked` rather than a styled checkbox: the state
 * is on/off rather than selected/unselected, and the two are announced
 * differently. State is carried by the knob's POSITION as well as the fill, so
 * it survives a monochrome print and colour-blindness alike.
 */
export function ToggleRow({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string
  hint?: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}) {
  const id = useId()
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 py-1">
      <span className="min-w-0">
        <label className="block text-sm font-medium" htmlFor={id}>
          {label}
        </label>
        {hint ? <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span> : null}
      </span>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-6 w-11 shrink-0 rounded-full border transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none disabled:opacity-50',
          checked ? 'border-action bg-action' : 'border-input bg-muted',
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'absolute top-0.5 h-4 w-4 rounded-full transition-transform',
            checked ? 'translate-x-[22px] bg-action-foreground' : 'translate-x-0.5 bg-muted-foreground',
          )}
        />
      </button>
    </div>
  )
}

/** A group of mutually exclusive chips — the regime toggle, the tab bar. */
export function ChipGroup<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string
  value: T
  options: ReadonlyArray<{ value: T; label: string; hint?: string }>
  onChange: (value: T) => void
  className?: string
}) {
  return (
    <div className={className}>
      <p className="mb-1 text-sm font-medium">{label}</p>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
        {options.map((option) => {
          const selected = option.value === value
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(option.value)}
              title={option.hint}
              className={cn(
                'inline-flex min-h-11 items-center rounded-full border px-4 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none',
                selected
                  ? 'border-action bg-action font-semibold text-action-foreground'
                  : 'border-border bg-card text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              )}
            >
              {option.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
