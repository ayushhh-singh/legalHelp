import { Pause, Play, Square, Volume2 } from 'lucide-react'

import type { ReadAloud } from '../useReadAloud'
import type { ReaderPrefs } from '../useLibrary'

import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'
import { platformHint, RATE_MAX, RATE_MIN, RATE_STEP } from '@/lib/library'
import { cn } from '@/lib/utils'

/**
 * Play, pause, stop, speed, voice — and a refusal that explains itself.
 *
 * The refusal is the part worth reading. A browser that offers only
 * server-synthesised voices for a language CAN speak, and this app will not use
 * it: the text of a provision an officer is reading would be posted to a third
 * party. So the bar says which of the three things is wrong — no voices at all,
 * only remote ones, or none for this language — and gives the one line that
 * fixes it on this reader's own operating system. "Read aloud is unavailable"
 * with no reason teaches nobody anything.
 */

interface ReadAloudBarProps {
  aloud: ReadAloud
  prefs: ReaderPrefs
  onPrefs: (patch: Partial<ReaderPrefs>) => void
  className?: string
}

export function ReadAloudBar({ aloud, prefs, onPrefs, className }: ReadAloudBarProps) {
  const { t } = useT()
  const { snapshot, voices, reason, supported } = aloud

  if (!supported || reason) {
    return (
      <section
        aria-label={t('library.tts.title')}
        data-print-hide
        className={cn(
          'rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground',
          className,
        )}
      >
        <p className="font-semibold text-foreground">{t('library.tts.title')}</p>
        <p className="mt-1">{t(`library.tts.noVoice.${reason ?? 'none-at-all'}`)}</p>
        <p className="mt-1">{t(`library.tts.hint.${platformHint(globalThis.navigator?.userAgent ?? '')}`)}</p>
      </section>
    )
  }

  const playing = snapshot.state === 'speaking'
  const paused = snapshot.state === 'paused'

  return (
    <section
      aria-label={t('library.tts.title')}
      data-print-hide
      className={cn(
        'flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-3',
        className,
      )}
    >
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon"
          className="h-9 w-9"
          aria-label={
            playing ? t('library.tts.pause') : paused ? t('library.tts.resume') : t('library.tts.play')
          }
          onClick={() => (playing ? aloud.pause() : paused ? aloud.resume() : aloud.play())}
        >
          {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="h-9 w-9"
          aria-label={t('library.tts.stop')}
          disabled={snapshot.state === 'idle'}
          onClick={aloud.stop}
        >
          <Square aria-hidden="true" />
        </Button>
      </div>

      {/*
        The position is a live region rather than decoration: a reader who
        cannot see the moving highlight still needs to know the voice is
        somewhere in the unit and how far.
      */}
      <p aria-live="polite" className="min-w-24 text-xs text-muted-foreground tabular-nums">
        {snapshot.index >= 0
          ? t('library.tts.position', { position: snapshot.index + 1, total: snapshot.total })
          : t('library.tts.onDevice')}
      </p>

      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        {t('library.tts.speed')}
        <input
          type="range"
          min={RATE_MIN}
          max={RATE_MAX}
          step={RATE_STEP}
          value={prefs.rate}
          onChange={(event) => {
            const rate = Number(event.target.value)
            onPrefs({ rate })
            aloud.setRate(rate)
          }}
          className="w-24 accent-[var(--action)]"
        />
        <span className="tabular-nums">{prefs.rate.toFixed(1)}×</span>
      </label>

      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <Volume2 aria-hidden="true" className="h-4 w-4" />
        <span className="sr-only sm:not-sr-only">{t('library.tts.voice')}</span>
        <select
          value={snapshot.voiceURI ?? ''}
          onChange={(event) => {
            const uri = event.target.value || null
            onPrefs({ voiceURI: uri })
            aloud.setVoice(uri)
          }}
          aria-label={t('library.tts.voice')}
          className="h-9 max-w-40 rounded-md border border-input bg-background px-2 text-xs"
        >
          {voices.map((voice) => (
            <option key={voice.voiceURI} value={voice.voiceURI}>
              {voice.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={prefs.autoContinue}
          onChange={(event) => onPrefs({ autoContinue: event.target.checked })}
          className="h-4 w-4 accent-[var(--action)]"
        />
        {t('library.tts.autoContinue')}
      </label>
    </section>
  )
}
