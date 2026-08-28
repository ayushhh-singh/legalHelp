import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_VOICE_SETTINGS,
  hasVoiceConsent,
  isVoiceEnabled,
  isVoiceSupported,
  parseVoiceSettings,
  VOICE_CONSENT_VERSION,
  VOICE_LOCALES,
} from './voiceConsent'

/**
 * Voice search is the one feature in this app that sends something a reader
 * produced off the device, so the tests that matter are not "does it
 * transcribe" — they are "can it possibly run without consent" and "does it
 * ever start on its own".
 */

/* ------------------------------------------------------------------ *
 * The flags
 * ------------------------------------------------------------------ */

describe('voice settings', () => {
  it('is off, unconsented, by default', () => {
    expect(DEFAULT_VOICE_SETTINGS.enabled).toBe(false)
    expect(DEFAULT_VOICE_SETTINGS.consentVersion).toBe(0)
    expect(isVoiceEnabled(DEFAULT_VOICE_SETTINGS)).toBe(false)
  })

  it('needs BOTH the switch and consent for this version', () => {
    expect(isVoiceEnabled({ enabled: true, consentVersion: 0, consentAt: null })).toBe(false)
    expect(isVoiceEnabled({ enabled: false, consentVersion: VOICE_CONSENT_VERSION, consentAt: 'x' })).toBe(
      false,
    )
    expect(isVoiceEnabled({ enabled: true, consentVersion: VOICE_CONSENT_VERSION, consentAt: 'x' })).toBe(
      true,
    )
  })

  it('re-gates every device when the notice changes', () => {
    // Bumping the version is what makes readers read a changed notice again.
    const consented = { enabled: true, consentVersion: VOICE_CONSENT_VERSION - 1, consentAt: 'x' }
    expect(isVoiceEnabled(consented)).toBe(false)
    expect(hasVoiceConsent(consented)).toBe(false)
  })

  it('cannot be turned on by a hand-edited settings row', () => {
    // The same posture as parseAiSettings: anything unrecognised is discarded
    // rather than trusted, and only an exact `true` counts.
    for (const forged of [
      { enabled: 'true', consentVersion: VOICE_CONSENT_VERSION },
      { enabled: 1, consentVersion: VOICE_CONSENT_VERSION },
      { enabled: true, consentVersion: '1' },
      { enabled: true, consentVersion: 1.5 },
      'enabled',
      null,
      [],
    ]) {
      expect(isVoiceEnabled(parseVoiceSettings(forged)), JSON.stringify(forged)).toBe(false)
    }
  })

  it('round-trips a real consent', () => {
    const settings = {
      enabled: true,
      consentVersion: VOICE_CONSENT_VERSION,
      consentAt: '2026-08-28T00:00:00Z',
    }
    expect(parseVoiceSettings(settings)).toEqual(settings)
    expect(isVoiceEnabled(parseVoiceSettings(settings))).toBe(true)
  })

  it('speaks Indian English and Indian Hindi', () => {
    expect(VOICE_LOCALES).toEqual({ en: 'en-IN', hi: 'hi-IN' })
  })
})

/* ------------------------------------------------------------------ *
 * Feature detection
 * ------------------------------------------------------------------ */

describe('isVoiceSupported', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'SpeechRecognition')
    Reflect.deleteProperty(window, 'webkitSpeechRecognition')
  })

  it('is false where the browser has no implementation', () => {
    // jsdom has none, and neither does Firefox. The button must not appear.
    expect(isVoiceSupported()).toBe(false)
  })

  it('accepts either spelling of the global', () => {
    Object.defineProperty(window, 'webkitSpeechRecognition', { value: class {}, configurable: true })
    expect(isVoiceSupported()).toBe(true)
    Reflect.deleteProperty(window, 'webkitSpeechRecognition')

    Object.defineProperty(window, 'SpeechRecognition', { value: class {}, configurable: true })
    expect(isVoiceSupported()).toBe(true)
  })

  it('detects by presence, never by constructing one', () => {
    // Constructing a recogniser to find out whether recognition exists would
    // be the feature switching itself on to answer a question about itself.
    const construct = vi.fn()
    class Probe {
      constructor() {
        construct()
      }
    }
    Object.defineProperty(window, 'SpeechRecognition', { value: Probe, configurable: true })

    expect(isVoiceSupported()).toBe(true)
    expect(construct).not.toHaveBeenCalled()
  })
})

/* ------------------------------------------------------------------ *
 * The recogniser
 * ------------------------------------------------------------------ */

interface FakeInstance {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
  abort: ReturnType<typeof vi.fn>
  onresult: ((event: unknown) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
}

let instances: FakeInstance[] = []

function installFake({ throwOnStart = false } = {}) {
  instances = []
  class Fake {
    lang = ''
    continuous = false
    interimResults = false
    maxAlternatives = 0
    start = vi.fn(() => {
      if (throwOnStart) throw new Error('InvalidStateError')
    })
    stop = vi.fn()
    abort = vi.fn()
    onresult: ((event: unknown) => void) | null = null
    onerror: ((event: { error: string }) => void) | null = null
    onend: (() => void) | null = null
    constructor() {
      instances.push(this)
    }
  }
  Object.defineProperty(window, 'SpeechRecognition', { value: Fake, configurable: true })
}

const result = (transcript: string, isFinal: boolean) => ({
  resultIndex: 0,
  results: { length: 1, 0: { length: 1, isFinal, 0: { transcript } } },
})

describe('listen', () => {
  beforeEach(() => installFake())
  afterEach(() => {
    Reflect.deleteProperty(window, 'SpeechRecognition')
    vi.resetModules()
  })

  it('transcribes one utterance and stops, rather than holding the microphone open', async () => {
    const { listen } = await import('./voice')
    const onTranscript = vi.fn()
    listen('en', { onTranscript, onError: vi.fn(), onEnd: vi.fn() })

    const recognition = instances[0]
    expect(recognition?.continuous).toBe(false)
    expect(recognition?.interimResults).toBe(true)
    expect(recognition?.start).toHaveBeenCalledTimes(1)
  })

  it('recognises in the reader’s own language', async () => {
    const { listen } = await import('./voice')
    listen('hi', { onTranscript: vi.fn(), onError: vi.fn(), onEnd: vi.fn() })
    expect(instances[0]?.lang).toBe('hi-IN')

    listen('en', { onTranscript: vi.fn(), onError: vi.fn(), onEnd: vi.fn() })
    expect(instances[1]?.lang).toBe('en-IN')
  })

  it('reports interim text and then the final text', async () => {
    const { listen } = await import('./voice')
    const onTranscript = vi.fn()
    listen('en', { onTranscript, onError: vi.fn(), onEnd: vi.fn() })

    instances[0]?.onresult?.(result('dhara three', false))
    instances[0]?.onresult?.(result('dhara three zero two', true))

    expect(onTranscript).toHaveBeenNthCalledWith(1, 'dhara three', false)
    expect(onTranscript).toHaveBeenNthCalledWith(2, 'dhara three zero two', true)
  })

  it.each([
    ['not-allowed', 'denied'],
    ['service-not-allowed', 'denied'],
    ['audio-capture', 'no-microphone'],
    ['no-speech', 'no-speech'],
    ['network', 'network'],
    ['something-else', 'unknown'],
  ])('turns the %s error into "%s", which a sentence can be written for', async (raw, code) => {
    const { listen } = await import('./voice')
    const onError = vi.fn()
    listen('en', { onTranscript: vi.fn(), onError, onEnd: vi.fn() })

    instances[0]?.onerror?.({ error: raw })
    expect(onError).toHaveBeenCalledWith(code)
  })

  it('ends exactly once, however the session finished', async () => {
    // The button reads "listening" until onEnd fires. Firing twice would be
    // harmless; firing zero times leaves an open microphone on screen forever.
    const { listen } = await import('./voice')
    const onEnd = vi.fn()
    listen('en', { onTranscript: vi.fn(), onError: vi.fn(), onEnd })

    instances[0]?.onerror?.({ error: 'network' })
    instances[0]?.onend?.()
    instances[0]?.onend?.()

    expect(onEnd).toHaveBeenCalledTimes(1)
  })

  it('cancel() discards the utterance; stop() delivers it', async () => {
    const { listen } = await import('./voice')
    const session = listen('en', { onTranscript: vi.fn(), onError: vi.fn(), onEnd: vi.fn() })

    session?.stop()
    expect(instances[0]?.stop).toHaveBeenCalled()
    expect(instances[0]?.abort).not.toHaveBeenCalled()

    session?.cancel()
    expect(instances[0]?.abort).toHaveBeenCalled()
  })

  it('reports a failure to start rather than claiming to be listening', async () => {
    installFake({ throwOnStart: true })
    vi.resetModules()
    const { listen } = await import('./voice')
    const onError = vi.fn()
    const onEnd = vi.fn()

    expect(listen('en', { onTranscript: vi.fn(), onError, onEnd })).toBeNull()
    expect(onError).toHaveBeenCalledWith('unknown')
    expect(onEnd).toHaveBeenCalledTimes(1)
  })

  it('returns null where the browser has no implementation', async () => {
    Reflect.deleteProperty(window, 'SpeechRecognition')
    vi.resetModules()
    const { listen } = await import('./voice')
    expect(listen('en', { onTranscript: vi.fn(), onError: vi.fn(), onEnd: vi.fn() })).toBeNull()
  })
})
