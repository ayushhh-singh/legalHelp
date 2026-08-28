import { ArrowLeftRight } from 'lucide-react'

import { LAW_CODES } from '../data'
import type { LawCode } from '../types'

import { useT } from '@/i18n/useT'
import type { Direction } from '@/lib/search'
import { cn } from '@/lib/utils'

/**
 * The two controls that decide what a bare number means.
 *
 * Both are radio groups rather than buttons that look like chips: they are
 * single-choice filters, one of which is always active, and that is exactly
 * what a radio group is. Getting this wrong is the usual way a chip row becomes
 * unusable with a keyboard — arrow keys have to move between the options, and
 * only the checked one may be in the tab order, which the native inputs give
 * for free.
 */

const CHIP_BASE =
  'inline-flex min-h-11 cursor-pointer items-center justify-center rounded-full border px-3.5 text-sm font-medium transition-colors'
const CHIP_OFF = 'border-border bg-card text-muted-foreground hover:border-input hover:text-foreground'
const CHIP_ON = 'border-action bg-action text-action-foreground font-semibold'

interface ChipRadioProps {
  name: string
  value: string
  checked: boolean
  onChange: () => void
  disabled?: boolean
  children: React.ReactNode
}

function ChipRadio({ name, value, checked, onChange, disabled, children }: ChipRadioProps) {
  return (
    <label
      className={cn(
        CHIP_BASE,
        checked ? CHIP_ON : CHIP_OFF,
        disabled && 'cursor-not-allowed opacity-50',
        'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background',
      )}
    >
      {/*
        `onClick` as well as `onChange`, deliberately.

        A radio that is ALREADY checked fires no change event, so clicking the
        pre-selected "All" chip did nothing at all — and "All" is the default,
        which made the most obvious chip on the page the one that appeared
        broken. `onChange` is still needed for the keyboard: arrow keys move
        between radios and fire change without a click. The handler is
        idempotent, so an unchecked radio calling it twice is harmless.
      */}
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        onClick={onChange}
        disabled={disabled}
        className="sr-only"
      />
      {children}
    </label>
  )
}

export function CodeChips({
  value,
  onChange,
}: {
  value: LawCode | null
  onChange: (code: LawCode | null) => void
}) {
  const { t } = useT()

  return (
    <fieldset className="min-w-0">
      <legend className="mb-1.5 text-sm font-medium">{t('law.code.label')}</legend>
      <div role="radiogroup" aria-label={t('law.code.label')} className="flex flex-wrap gap-2">
        <ChipRadio name="law-code" value="all" checked={value === null} onChange={() => onChange(null)}>
          {t('law.code.all')}
        </ChipRadio>
        {LAW_CODES.map((code) => (
          <ChipRadio
            key={code}
            name="law-code"
            value={code}
            checked={value === code}
            onChange={() => onChange(code)}
          >
            {t(`law.code.${code}`)}
          </ChipRadio>
        ))}
      </div>
    </fieldset>
  )
}

export function DirectionToggle({
  value,
  onChange,
  /** Set when an Act named in the query has overridden the toggle. */
  overriddenBy,
  /**
   * True while the reader is reading an Act in order rather than searching.
   *
   * Direction decides what a bare NUMBER means, so with nothing typed it has
   * nothing to decide. Leaving it live was worse than useless: pressing it
   * changed the URL and reordered nothing, which reads as a broken control.
   */
  disabled = false,
}: {
  value: Direction
  onChange: (direction: Direction) => void
  overriddenBy?: string | null
  disabled?: boolean
}) {
  const { t } = useT()

  return (
    <fieldset className="min-w-0">
      <legend className="mb-1.5 flex items-center gap-1.5 text-sm font-medium">
        <ArrowLeftRight aria-hidden="true" className="h-3.5 w-3.5 text-muted-foreground" />
        {t('law.direction.label')}
      </legend>
      <div role="radiogroup" aria-label={t('law.direction.label')} className="flex flex-wrap gap-2">
        <ChipRadio
          name="law-direction"
          value="old-new"
          checked={value === 'old-new'}
          disabled={disabled}
          onChange={() => onChange('old-new')}
        >
          {t('law.direction.oldNew')}
        </ChipRadio>
        <ChipRadio
          name="law-direction"
          value="new-old"
          checked={value === 'new-old'}
          disabled={disabled}
          onChange={() => onChange('new-old')}
        >
          {t('law.direction.newOld')}
        </ChipRadio>
      </div>
      {disabled ? (
        <p className="mt-1.5 text-xs text-muted-foreground">{t('law.direction.disabledWhileBrowsing')}</p>
      ) : null}
      {/*
        Naming an Act in the query beats the toggle — "crpc 438" is not a
        mistake to be honoured literally. Saying so out loud is the difference
        between a helpful override and a control that appears to be ignored.
      */}
      {overriddenBy ? (
        <p className="mt-1.5 text-xs text-muted-foreground">
          {t('law.direction.followed', { act: overriddenBy })}
        </p>
      ) : null}
    </fieldset>
  )
}
