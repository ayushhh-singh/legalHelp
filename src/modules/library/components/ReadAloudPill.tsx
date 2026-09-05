import { Pause, Play, Square, X } from 'lucide-react'

import type { ReadAloud } from '../useReadAloud'
import type { ReaderPrefs } from '../useLibrary'

import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'
import { platformHint, RATE_MAX, RATE_MIN, RATE_STEP } from '@/lib/library'
import { cn } from '@/lib/utils'

/**
 * Read aloud, as a floating pill at the foot of the screen.
 *
 * It replaces the card that used to sit between the reader and the text
 * (`ReadAloudBar`, Session 27). Nothing about what it does changed: play,
 * pause, stop, speed, voice, and continue into the next unit. What changed is
 * that it is not there until the headphones button in the focus bar is pressed,
 * and that when it is there it is over the page rather than in the column — a
 * transport control belongs where a transport control belongs.
 *
 * ### The refusal is still the part worth reading
 *
 * A browser that offers only server-synthesised voices for a language CAN
 * speak, and this app will not use it: the text of a provision an officer is
 * reading would be posted to a third party. So it says which of the three
 * things is wrong — no voices at all, only remote ones, or none for this
 * language — and gives the one line that fixes it on this reader's own
 * operating system. "Read aloud is unavailable" with no reason teaches nobody.
 *
 * ### "Spoken by this device"
 *
 * That promise used to be the pill's resting text and is now its `title` and
 * its `sr-only` description, because the pill's resting state has to be small
 * enough to sit over a page. It is not lost: the first-run coach mark on the
 * headphones button states it in full, and this element carries it for anyone
 * who hovers or listens.
 *
 * ### It is above the tab bar's inset, not on it
 *
 * `bottom` clears `env(safe-area-inset-bottom)` and the PWA toast's own
 * measured space (`--pwa-toast-space`), which is the pair `docs/DATA-GAPS.md`
 * #59 and Session 33's toast fix are both about — a floating control that lands
 * on another floating control intercepts every press meant for it.
 */

interface ReadAloudPillProps {
  aloud: ReadAloud
  prefs: ReaderPrefs
  onPrefs: (patch: Partial<ReaderPrefs>) => void
  /** Shuts the pill. The headphones button in the bar is the other way. */
  onClose: () => void
  className?: string
}

const SHELL =
  'fixed inset-x-0 bottom-[calc(1rem+env(safe-area-inset-bottom,0px)+var(--pwa-toast-space,0px))] z-45 mx-auto w-[min(40rem,calc(100vw-2rem))] rounded-full border border-border bg-card px-3 py-2 shadow-lg'

export function ReadAloudPill({ aloud, prefs, onPrefs, onClose, className }: ReadAloudPillProps) {
  const { t } = useT()
  const { snapshot, voices, reason, supported } = aloud

  if (!supported || reason) {
    return (
      <section
        aria-label={t('library.tts.title')}
        data-print-hide
        className={cn(SHELL, 'rounded-xl', className)}
      >
        <div className="flex items-start gap-2 px-2 py-1">
          <div className="min-w-0 flex-1 text-xs text-muted-foreground">
            <p className="font-semibold text-foreground">
              {t(`library.tts.noVoice.${reason ?? 'none-at-all'}`)}
            </p>
            <p className="mt-1">
              {t(`library.tts.hint.${platformHint(globalThis.navigator?.userAgent ?? '')}`)}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0"
            aria-label={t('library.tts.close')}
            onClick={onClose}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
      </section>
    )
  }

  const playing = snapshot.state === 'speaking'
  const paused = snapshot.state === 'paused'

  return (
    <section
      aria-label={t('library.tts.title')}
      title={t('library.tts.onDevice')}
      data-print-hide
      className={cn(SHELL, 'flex flex-wrap items-center gap-2', className)}
    >
      <p className="sr-only">{t('library.tts.onDevice')}</p>

      <Button
        variant="outline"
        size="icon"
        className="h-9 w-9 shrink-0 rounded-full"
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
        className="h-9 w-9 shrink-0 rounded-full"
        aria-label={t('library.tts.stop')}
        disabled={snapshot.state === 'idle'}
        onClick={aloud.stop}
      >
        <Square aria-hidden="true" />
      </Button>

      {/*
        The position is a live region rather than decoration: a reader who
        cannot see the moving highlight still needs to know the voice is
        somewhere in the unit and how far.
      */}
      <p aria-live="polite" className="min-w-20 shrink-0 text-xs text-muted-foreground tabular-nums">
        {snapshot.index >= 0
          ? t('library.tts.position', { position: snapshot.index + 1, total: snapshot.total })
          : ''}
      </p>

      <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
        <span className="sr-only sm:not-sr-only">{t('library.tts.speed')}</span>
        <input
          type="range"
          min={RATE_MIN}
          max={RATE_MAX}
          step={RATE_STEP}
          value={prefs.rate}
          aria-label={t('library.tts.speed')}
          onChange={(event) => {
            const rate = Number(event.target.value)
            onPrefs({ rate })
            aloud.setRate(rate)
          }}
          className="w-20 accent-[var(--action)]"
        />
        <span className="tabular-nums">{prefs.rate.toFixed(1)}×</span>
      </label>

      <select
        value={snapshot.voiceURI ?? ''}
        onChange={(event) => {
          const uri = event.target.value || null
          onPrefs({ voiceURI: uri })
          aloud.setVoice(uri)
        }}
        aria-label={t('library.tts.voice')}
        className="h-9 min-w-0 flex-1 rounded-full border border-input bg-background px-3 text-xs"
      >
        {voices.map((voice) => (
          <option key={voice.voiceURI} value={voice.voiceURI}>
            {voice.name}
          </option>
        ))}
      </select>

      <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={prefs.autoContinue}
          onChange={(event) => onPrefs({ autoContinue: event.target.checked })}
          className="h-4 w-4 accent-[var(--action)]"
        />
        <span className="sr-only sm:not-sr-only">{t('library.tts.autoContinue')}</span>
      </label>

      <Button
        variant="ghost"
        size="icon"
        className="h-9 w-9 shrink-0 rounded-full"
        aria-label={t('library.tts.close')}
        onClick={onClose}
      >
        <X aria-hidden="true" />
      </Button>
    </section>
  )
}
