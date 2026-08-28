import { useEffect, useRef, useState } from 'react'

import { useAppStore } from '@/app/store'
import { useT } from '@/i18n/useT'
import type { VoiceErrorCode, VoiceSession } from '@/lib/voice'
import { isVoiceSupported, type VoiceAvailability } from '@/lib/voiceSettings'

/**
 * Dictate into a text field — recognised ON THIS DEVICE, or not at all.
 *
 * There is no consent notice, and its absence is the feature. The first version
 * had one, because Chrome's default speech path streams the audio to Google
 * (ADR-014). Requiring `processLocally` removes the thing the notice was about:
 * nothing a reader says leaves the device, so the hard rule holds with no
 * exception and there is nothing to read (ADR-017).
 *
 * A hook rather than a component because the microphone has two pieces of UI in
 * two places — a button in the field's row, and a sentence under it — and the
 * state belongs to neither.
 */
export interface VoiceSearch {
  /** False where on-device recognition does not exist; render nothing. */
  supported: boolean
  listening: boolean
  busy: boolean
  /** Set once a press has asked the browser about the model. */
  status: VoiceAvailability | null
  error: VoiceErrorCode | null
  /** Start, or stop if already listening. */
  press: () => void
  /** Fetch the on-device model, then start. */
  download: () => void
  label: string
}

export function useVoiceSearch(onTranscript: (transcript: string, isFinal: boolean) => void): VoiceSearch {
  const { t, language } = useT()
  const enabled = useAppStore((s) => s.voice.enabled)

  const [supported] = useState(isVoiceSupported)
  const [listening, setListening] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<VoiceAvailability | null>(null)
  const [error, setError] = useState<VoiceErrorCode | null>(null)

  const sessionRef = useRef<VoiceSession | null>(null)

  // A microphone must not outlive the screen it was opened from.
  useEffect(() => {
    return () => {
      sessionRef.current?.cancel()
      sessionRef.current = null
    }
  }, [])

  const start = async () => {
    setError(null)
    setBusy(true)
    // The dynamic import keeps the recogniser out of the initial route.
    const voice = await import('@/lib/voice')

    // Ask before starting. A recogniser whose model is absent fails with a
    // generic error; asking first lets the reader be offered the download.
    const state = await voice.availability(language)
    setStatus(state)
    if (state !== 'available') {
      setBusy(false)
      return
    }

    const session = voice.listen(language, {
      onTranscript,
      onError: setError,
      onEnd: () => {
        sessionRef.current = null
        setListening(false)
        setBusy(false)
      },
    })
    sessionRef.current = session
    setBusy(false)
    setListening(session !== null)
  }

  return {
    supported: supported && enabled,
    listening,
    busy,
    status,
    error,
    label: listening ? t('voice.stop') : t('voice.start'),
    press: () => {
      if (listening) sessionRef.current?.stop()
      else void start()
    },
    download: () => {
      void (async () => {
        setBusy(true)
        const voice = await import('@/lib/voice')
        const ok = await voice.installModel(language)
        setStatus(ok ? 'available' : 'unavailable')
        setBusy(false)
        if (ok) await start()
      })()
    },
  }
}
