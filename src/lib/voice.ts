import { VOICE_LOCALES } from './voiceConsent'

import type { Language } from '@/i18n'

/**
 * THE ONLY MODULE IN THIS APP THAT MAY CONSTRUCT A SpeechRecognition.
 *
 * `eslint.config.js` restricts both spellings of the global everywhere else and
 * grants a file-scoped exception here, exactly as it does for `fetch` in
 * `src/ai/providers/wire.ts` (ADR-011). The point is the same: "what in this
 * app can send something off the device?" stays answerable by reading two
 * files. `tests/no-external-urls.test.ts` asserts the count.
 *
 * This module is reached by a DYNAMIC IMPORT from the microphone button, so a
 * reader who never presses it never downloads it.
 *
 * ## What this does not do
 *
 * It does not make recognition local. Chrome's implementation streams the
 * captured audio to Google's servers, and nothing here can change that; the
 * consent notice says so in those words. It also never starts on its own —
 * `listen()` is called from a click handler and from nowhere else, so the
 * microphone cannot open without a press.
 */

/** The subset of the Web Speech API this app uses. */
interface RecognitionAlternative {
  transcript: string
}
interface RecognitionResult {
  readonly length: number
  isFinal: boolean
  [index: number]: RecognitionAlternative
}
interface RecognitionResultList {
  readonly length: number
  [index: number]: RecognitionResult
}
interface RecognitionEvent {
  resultIndex: number
  results: RecognitionResultList
}
interface RecognitionErrorEvent {
  error: string
}
interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((event: RecognitionEvent) => void) | null
  onerror: ((event: RecognitionErrorEvent) => void) | null
  onend: (() => void) | null
}

type RecognitionConstructor = new () => SpeechRecognitionLike

/**
 * Why a spoken query stopped. Each maps to a sentence a reader can act on —
 * "it failed" is not an answer when the microphone is involved.
 */
export type VoiceErrorCode =
  /** The reader (or the OS) refused microphone access. */
  | 'denied'
  /** No microphone, or the browser could not open it. */
  | 'no-microphone'
  /** Heard nothing. */
  | 'no-speech'
  /** The recognition service could not be reached — it is a network service. */
  | 'network'
  | 'unknown'

export interface VoiceSession {
  /** Stop listening and keep whatever was already transcribed. */
  stop: () => void
  /** Stop listening and discard it. */
  cancel: () => void
}

export interface VoiceHandlers {
  /** Fires repeatedly with the best transcript so far, final or not. */
  onTranscript: (transcript: string, isFinal: boolean) => void
  onError: (code: VoiceErrorCode) => void
  /** Always fires once, however the session ended. */
  onEnd: () => void
}

function constructorFor(): RecognitionConstructor | null {
  const scope = window as unknown as {
    SpeechRecognition?: RecognitionConstructor
    webkitSpeechRecognition?: RecognitionConstructor
  }
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null
}

/** The spec's error strings, narrowed to something a sentence can be written for. */
function classify(error: string): VoiceErrorCode {
  switch (error) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'denied'
    case 'audio-capture':
      return 'no-microphone'
    case 'no-speech':
      return 'no-speech'
    case 'network':
      return 'network'
    default:
      return 'unknown'
  }
}

/**
 * Start listening. Returns null when the browser has no implementation, which
 * the caller has already checked with `isVoiceSupported` — the second check is
 * because feature detection and construction are different moments.
 *
 * `continuous` is false: this transcribes ONE utterance and stops. A search box
 * is not a dictation surface, and an open microphone that keeps streaming is
 * not something to leave running under a reader who pressed a button once.
 */
export function listen(language: Language, handlers: VoiceHandlers): VoiceSession | null {
  const Recognition = constructorFor()
  if (!Recognition) return null

  const recognition = new Recognition()
  recognition.lang = VOICE_LOCALES[language]
  recognition.continuous = false
  recognition.interimResults = true
  recognition.maxAlternatives = 1

  let ended = false
  const end = () => {
    if (ended) return
    ended = true
    handlers.onEnd()
  }

  recognition.onresult = (event) => {
    let transcript = ''
    let isFinal = false
    for (let i = 0; i < event.results.length; i += 1) {
      const result = event.results[i]
      if (!result) continue
      transcript += result[0]?.transcript ?? ''
      if (result.isFinal) isFinal = true
    }
    if (transcript) handlers.onTranscript(transcript.trim(), isFinal)
  }

  recognition.onerror = (event) => {
    handlers.onError(classify(event.error))
    // `onend` fires after `onerror` in every implementation, but not firing it
    // would leave the button stuck in "listening" — so `end` is idempotent.
    end()
  }

  recognition.onend = end

  try {
    recognition.start()
  } catch {
    // Calling start() twice throws InvalidStateError. Treat it as a finished
    // session rather than leaving the caller believing it is listening.
    handlers.onError('unknown')
    end()
    return null
  }

  return {
    stop: () => recognition.stop(),
    cancel: () => {
      // abort() discards the utterance; stop() would deliver it.
      recognition.abort()
      end()
    },
  }
}
