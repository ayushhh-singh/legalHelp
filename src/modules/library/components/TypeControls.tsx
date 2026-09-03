import { Minus, Plus } from 'lucide-react'

import type { LineHeight, ReaderPrefs, ReadingMode, ReadingSurface, TypeFamily } from '../useLibrary'

import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'
import { cn } from '@/lib/utils'

/**
 * The reader's own controls: reading language, text size, typeface, spacing.
 *
 * Two of the four are constrained by facts rather than taste:
 *
 * - **Relaxed spacing is FORCED whenever Devanagari is on screen**, per the
 *   master context's `line-height ≥ 1.75` rule. The control is disabled rather
 *   than hidden, with the reason stated — ADR-030's line, and the same one the
 *   AI tier picker takes: a control that vanishes teaches nothing.
 * - **The warm surface is an 8% `--marigold` wash, not cream paper.** The
 *   design system's NEVER list rules out reintroducing "cream paper + serif +
 *   terracotta" piecemeal, and this control sits next to a serif toggle. See
 *   `.library-sepia` in `src/styles/index.css`.
 * - **The serif face is the SYSTEM serif stack, not a fourth webfont.** ADR-018
 *   refused ~25 KB of woff2 for the pay slip's numerals; a reading preference
 *   does not get to spend more than a pay slip did. Devanagari falls through to
 *   Noto Sans Devanagari either way, which is already loaded on every route.
 */

const MODES: readonly ReadingMode[] = ['en', 'hi', 'both']
const FAMILIES: readonly TypeFamily[] = ['sans', 'serif']
const HEIGHTS: readonly LineHeight[] = ['normal', 'relaxed']
const SURFACES: readonly ReadingSurface[] = ['default', 'sepia']

interface TypeControlsProps {
  prefs: ReaderPrefs
  onChange: (patch: Partial<ReaderPrefs>) => void
  /** True when Devanagari is on screen, which pins the spacing. */
  devanagariShown: boolean
  className?: string
}

function SegmentedGroup<T extends string>({
  legend,
  options,
  value,
  labelFor,
  onSelect,
  disabled,
}: {
  legend: string
  options: readonly T[]
  value: T
  labelFor: (option: T) => string
  onSelect: (option: T) => void
  disabled?: boolean
}) {
  return (
    <div role="group" aria-label={legend} className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{legend}</span>
      <div className="flex rounded-md border border-input p-0.5">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            disabled={disabled}
            aria-pressed={value === option}
            onClick={() => onSelect(option)}
            className={cn(
              'min-h-9 flex-1 rounded-sm px-3 text-xs transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
              value === option
                ? 'bg-action font-semibold text-action-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              disabled && 'cursor-not-allowed opacity-50',
            )}
          >
            {labelFor(option)}
          </button>
        ))}
      </div>
    </div>
  )
}

export function TypeControls({ prefs, onChange, devanagariShown, className }: TypeControlsProps) {
  const { t } = useT()

  return (
    <div data-print-hide className={cn('grid gap-4 sm:grid-cols-2 lg:grid-cols-5', className)}>
      <SegmentedGroup
        legend={t('library.lang.label')}
        options={MODES}
        value={prefs.mode}
        labelFor={(mode) => t(`library.lang.${mode}`)}
        onSelect={(mode) => onChange({ mode })}
      />

      <div role="group" aria-label={t('library.type.size')} className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">{t('library.type.size')}</span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9"
            aria-label={t('library.type.smaller')}
            disabled={prefs.size <= 1}
            onClick={() => onChange({ size: prefs.size - 1 })}
          >
            <Minus aria-hidden="true" />
          </Button>
          {/*
            The step is announced, not just drawn: an icon pair with a row of
            dots between them tells a screen-reader user nothing about where
            they are in the range.
          */}
          <span aria-live="polite" className="flex-1 text-center text-xs tabular-nums">
            {t('library.type.sizeNow', { step: prefs.size })}
          </span>
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9"
            aria-label={t('library.type.larger')}
            disabled={prefs.size >= 4}
            onClick={() => onChange({ size: prefs.size + 1 })}
          >
            <Plus aria-hidden="true" />
          </Button>
        </div>
      </div>

      <SegmentedGroup
        legend={t('library.type.family')}
        options={FAMILIES}
        value={prefs.family}
        labelFor={(family) => t(`library.type.${family}`)}
        onSelect={(family) => onChange({ family })}
      />

      <SegmentedGroup
        legend={t('library.polish.surface')}
        options={SURFACES}
        value={prefs.surface}
        labelFor={(surface) =>
          t(surface === 'sepia' ? 'library.polish.surfaceSepia' : 'library.polish.surfaceDefault')
        }
        onSelect={(surface) => onChange({ surface })}
      />

      <div className="flex flex-col gap-1">
        <SegmentedGroup
          legend={t('library.type.lineHeight')}
          options={HEIGHTS}
          value={devanagariShown ? 'relaxed' : prefs.lineHeight}
          labelFor={(height) => t(`library.type.${height}`)}
          onSelect={(lineHeight) => onChange({ lineHeight })}
          disabled={devanagariShown}
        />
        {devanagariShown ? (
          <p className="text-xs text-muted-foreground">{t('library.type.relaxedLocked')}</p>
        ) : null}
      </div>
    </div>
  )
}
