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
  children: React.ReactNode
}

function ChipRadio({ name, value, checked, onChange, children }: ChipRadioProps) {
  return (
    <label
      className={cn(
        CHIP_BASE,
        checked ? CHIP_ON : CHIP_OFF,
        'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background',
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
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
}: {
  value: Direction
  onChange: (direction: Direction) => void
  overriddenBy?: string | null
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
          onChange={() => onChange('old-new')}
        >
          {t('law.direction.oldNew')}
        </ChipRadio>
        <ChipRadio
          name="law-direction"
          value="new-old"
          checked={value === 'new-old'}
          onChange={() => onChange('new-old')}
        >
          {t('law.direction.newOld')}
        </ChipRadio>
      </div>
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
