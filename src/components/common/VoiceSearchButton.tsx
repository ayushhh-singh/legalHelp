import { Loader2, Mic, MicOff } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { useAppStore } from '@/app/store'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'
import { cn } from '@/lib/utils'
import type { VoiceErrorCode, VoiceSession } from '@/lib/voice'
import { hasVoiceConsent, isVoiceEnabled, isVoiceSupported, VOICE_CONSENT_VERSION } from '@/lib/voiceConsent'

/**
 * Dictate a search query — off by default, behind a notice.
 *
 * Speech recognition is not an on-device feature. Chrome streams the captured
 * audio to Google's servers, so a spoken query is user-entered data leaving the
 * device: precisely what this app's hard rule forbids by default, and what
 * `tests/e2e/zero-third-party-requests.spec.ts` enforces. The resolution is the
 * one the AI layer already uses (ADR-011): consent IS the feature flag, the
 * notice says where the audio goes before anything is recorded, and the code
 * that can send it sits behind a dynamic import.
 *
 * Three things follow, and each is load-bearing rather than decorative:
 *
 *  - **The button does not appear where the API does not exist.** Firefox
 *    implements none of it; a button that appears and then fails is worse than
 *    no button.
 *  - **`src/lib/voice.ts` is imported on the FIRST PRESS**, never at render, so
 *    a reader who ignores the microphone never downloads the recogniser.
 *  - **Listening is always visible** — the icon changes, the button says
 *    "Listening", and it is announced. An open microphone with no indicator is
 *    not something to ship.
 */
export function VoiceSearchButton({
  onTranscript,
  className,
}: {
  /** Fires with the transcript so far; `isFinal` marks the last one. */
  onTranscript: (transcript: string, isFinal: boolean) => void
  className?: string
}) {
  const { t, language } = useT()
  const voice = useAppStore((s) => s.voice)
  const setVoice = useAppStore((s) => s.setVoice)

  const [supported] = useState(isVoiceSupported)
  const [noticeOpen, setNoticeOpen] = useState(false)
  const [listening, setListening] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<VoiceErrorCode | null>(null)

  const sessionRef = useRef<VoiceSession | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  // A microphone must not outlive the screen it was opened from.
  useEffect(() => {
    return () => {
      sessionRef.current?.cancel()
      sessionRef.current = null
    }
  }, [])

  if (!supported) return null

  const start = async () => {
    setError(null)
    setStarting(true)
    // The dynamic import is the privacy property, not a performance one.
    const { listen } = await import('@/lib/voice')
    const session = listen(language, {
      onTranscript,
      onError: (code) => setError(code),
      onEnd: () => {
        sessionRef.current = null
        setListening(false)
        setStarting(false)
      },
    })
    sessionRef.current = session
    setStarting(false)
    setListening(session !== null)
  }

  const press = () => {
    if (listening) {
      sessionRef.current?.stop()
      return
    }
    if (!isVoiceEnabled(voice)) {
      setNoticeOpen(true)
      return
    }
    void start()
  }

  const accept = async () => {
    await setVoice({
      enabled: true,
      consentVersion: VOICE_CONSENT_VERSION,
      consentAt: new Date().toISOString(),
    })
    setNoticeOpen(false)
    await start()
  }

  return (
    <>
      <Button
        ref={triggerRef}
        type="button"
        variant={listening ? 'secondary' : 'outline'}
        size="icon"
        onClick={press}
        aria-pressed={listening}
        aria-label={listening ? t('voice.stop') : t('voice.start')}
        className={cn('shrink-0', className)}
      >
        {starting ? (
          <Loader2 aria-hidden="true" className="animate-spin" />
        ) : listening ? (
          <Mic aria-hidden="true" />
        ) : (
          <MicOff aria-hidden="true" />
        )}
      </Button>

      {/* The microphone is open. Say so in text, not only with an icon. */}
      <p role="status" aria-live="assertive" className="sr-only">
        {listening ? t('voice.listening') : ''}
      </p>
      {error ? (
        <p role="alert" className="mt-1.5 text-xs text-coral-foreground">
          {t(`voice.errors.${error}`)}
        </p>
      ) : null}

      {noticeOpen ? (
        <VoiceNotice
          onAccept={() => void accept()}
          onCancel={() => {
            setNoticeOpen(false)
            triggerRef.current?.focus()
          }}
          alreadyConsented={hasVoiceConsent(voice)}
        />
      ) : null}
    </>
  )
}

/**
 * The notice. Deliberately short and specific: it says which company receives
 * the audio, that it is not on-device, and that a reader can turn it off again.
 * A long notice is a notice nobody reads.
 */
function VoiceNotice({
  onAccept,
  onCancel,
  alreadyConsented,
}: {
  onAccept: () => void
  onCancel: () => void
  alreadyConsented: boolean
}) {
  const { t } = useT()
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    panelRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onCancel])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4">
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="voice-notice-title"
        className="max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-lg border border-border bg-card p-5 focus-visible:outline-none"
      >
        <h2 id="voice-notice-title" className="text-lg font-semibold">
          {t('voice.notice.title')}
        </h2>

        <div className="mt-3 space-y-3 text-sm">
          <p className="rounded-md border-l-[3px] border-coral bg-coral/15 px-3 py-2 text-coral-foreground">
            {t('voice.notice.leaves')}
          </p>
          <p>{t('voice.notice.rest')}</p>
          <p className="text-muted-foreground">{t('voice.notice.off')}</p>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <Button type="button" onClick={onAccept}>
            {alreadyConsented ? t('voice.notice.turnOn') : t('voice.notice.accept')}
          </Button>
          <Button type="button" variant="outline" onClick={onCancel}>
            {t('voice.notice.cancel')}
          </Button>
        </div>
      </div>
    </div>
  )
}
