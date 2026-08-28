import { VOICE_LOCALES, type VoiceAvailability } from './voiceSettings'

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
 * ## The one rule
 *
 * `processLocally` is set on every recogniser this module creates, and
 * `availability()` is consulted before one is started. Per the specification a
 * user agent must then transcribe ON THE DEVICE or raise an error; it may not
 * fall back to a server. THERE IS NO CLOUD PATH IN THIS APP — where on-device
 * recognition is unavailable the reader is told to type instead.
 *
 * It also never starts on its own. `listen()` is called from a click handler
 * and from nowhere else, so the microphone cannot open without a press.
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
  /** Chrome 138+. True forbids the network fallback. */
  processLocally?: boolean
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((event: RecognitionEvent) => void) | null
  onerror: ((event: RecognitionErrorEvent) => void) | null
  onend: (() => void) | null
}

interface RecognitionStatics {
  available?: (options: { langs: string[]; processLocally: boolean }) => Promise<string>
  install?: (options: { langs: string[]; processLocally: boolean }) => Promise<boolean>
}

type RecognitionConstructor = (new () => SpeechRecognitionLike) & RecognitionStatics

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
  /** No on-device model for this language on this device. */
  | 'no-model'
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

const STATUSES = new Set<string>(['available', 'downloadable', 'downloading', 'unavailable'])

/**
 * Whether the on-device model for a language is present, fetchable or absent.
 *
 * Anything unexpected — a browser with no `available()`, a rejection, a status
 * this build does not know — is reported as `unavailable`. Failing closed is
 * the point: the alternative to on-device recognition here is not cloud
 * recognition, it is typing.
 */
export async function availability(language: Language): Promise<VoiceAvailability> {
  const Recognition = constructorFor()
  if (!Recognition?.available) return 'unavailable'

  try {
    const status = await Recognition.available({ langs: [VOICE_LOCALES[language]], processLocally: true })
    return STATUSES.has(status) ? (status as VoiceAvailability) : 'unavailable'
  } catch {
    return 'unavailable'
  }
}

/**
 * Ask the browser to fetch the on-device model for a language.
 *
 * A download the BROWSER performs, of a speech model. It carries nothing the
 * reader typed or said — but it is large, so it is a button rather than
 * something that happens on their behalf.
 */
export async function installModel(language: Language): Promise<boolean> {
  const Recognition = constructorFor()
  if (!Recognition?.install) return false

  try {
    return await Recognition.install({ langs: [VOICE_LOCALES[language]], processLocally: true })
  } catch {
    return false
  }
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
    case 'language-not-supported':
      // With `processLocally` set there is no server to reach, so either of
      // these means the on-device model is not usable.
      return 'no-model'
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
  // THE line. The user agent must now transcribe on the device or raise an
  // error; it may not fall back to a server.
  recognition.processLocally = true

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
