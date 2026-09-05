import { Minus, Plus } from 'lucide-react'

import type { LineHeight, ReaderPrefs, ReadingMode, ReadingSurface, TypeFamily } from '../useLibrary'

import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'
import { cn } from '@/lib/utils'

/**
 * The reader's own controls: reading language, text size, typeface, spacing and
 * surface — ONE tray behind the bar's "Aa", not five groups permanently between
 * the officer and the provision.
 *
 * Session 35 moved them there and changed nothing about what they do. The
 * argument is the one the whole focus level rests on: these are set once, and a
 * control that is set once does not earn a fifth of the screen on every unit
 * for ever. The sample line below the stepper is what a popover has to add in
 * exchange — with the controls on the page the text itself was the preview.
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

/** The same four steps `UnitBody` sets the provision in. */
const SAMPLE_SIZE: Readonly<Record<number, string>> = {
  1: 'text-sm',
  2: 'text-base',
  3: 'text-lg',
  4: 'text-xl',
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
    <div data-print-hide className={cn('flex flex-col gap-4', className)}>
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

      {/*
        The live preview.

        It is set from the SAME class table `UnitBody` uses, and it is a
        sentence rather than "Aa" because the thing being previewed is a
        typeface, a size, a leading and a surface all at once — none of which a
        two-letter specimen shows. It carries `lang` so a Hindi reader sees
        Devanagari at the leading Devanagari will actually get.

        The sentence is about ITSELF and quotes no provision, deliberately. The
        first version was CCS (Conduct) Rule 3's own words, which read well and
        collided with every test in this repository that probes for "absolute
        integrity" to check the rule is on screen — a hidden, `aria-hidden`
        copy of the phrase the assertion was looking for.
      */}
      <p
        aria-hidden="true"
        lang={prefs.mode === 'hi' ? 'hi' : 'en'}
        className={cn(
          'rounded-lg border border-border px-3 py-2',
          prefs.surface === 'sepia' ? 'library-sepia-swatch' : 'bg-card',
          SAMPLE_SIZE[prefs.size] ?? SAMPLE_SIZE[2],
          prefs.family === 'serif' ? 'font-reading' : 'font-sans',
          (devanagariShown || prefs.lineHeight === 'relaxed') && 'leading-[1.9]',
        )}
      >
        {t('library.type.sample')}
      </p>

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
