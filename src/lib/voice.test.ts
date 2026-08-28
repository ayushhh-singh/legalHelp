import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_VOICE_SETTINGS, isVoiceSupported, parseVoiceSettings, VOICE_LOCALES } from './voiceSettings'

/**
 * Voice search recognises speech ON THE DEVICE or refuses (ADR-017), so the
 * tests that matter are not "does it transcribe" — they are "can it ever run
 * without `processLocally`", "does the button appear where the browser has only
 * the cloud path", and "does it ever start on its own".
 */

/* ------------------------------------------------------------------ *
 * The flags
 * ------------------------------------------------------------------ */

describe('voice settings', () => {
  it('is on by default, because there is nothing to consent to', () => {
    // Recognition happens on the device (ADR-017). The button still does
    // nothing until pressed, and pressing it still needs the browser's own
    // microphone permission.
    expect(DEFAULT_VOICE_SETTINGS.enabled).toBe(true)
  })

  it('can be switched off, and only an explicit false does it', () => {
    expect(parseVoiceSettings({ enabled: false }).enabled).toBe(false)
    expect(parseVoiceSettings({ enabled: true }).enabled).toBe(true)
    for (const junk of [{}, { enabled: 'no' }, { enabled: 0 }, 'off', null, []]) {
      expect(parseVoiceSettings(junk).enabled, JSON.stringify(junk)).toBe(true)
    }
  })

  it('speaks Indian English and Indian Hindi', () => {
    expect(VOICE_LOCALES).toEqual({ en: 'en-IN', hi: 'hi-IN' })
  })
})

/**
 * `processLocally` lives on the PROTOTYPE in a real browser, which is where
 * `isVoiceSupported` looks — a class field would be an instance property and
 * would not be found by a check that must not construct anything.
 */
function withOnDevice<T extends abstract new (...args: never[]) => object>(Ctor: T): T {
  Object.defineProperty(Ctor.prototype, 'processLocally', { value: false, writable: true })
  return Ctor
}

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
    const Local = withOnDevice(class {})
    Object.defineProperty(window, 'webkitSpeechRecognition', { value: Local, configurable: true })
    expect(isVoiceSupported()).toBe(true)
    Reflect.deleteProperty(window, 'webkitSpeechRecognition')

    Object.defineProperty(window, 'SpeechRecognition', { value: Local, configurable: true })
    expect(isVoiceSupported()).toBe(true)
  })

  it('is FALSE where the browser has the API but no on-device switch', () => {
    // A Chrome without `processLocally` has only the cloud path, and this app
    // does not offer that path. No button at all is the right answer — one that
    // quietly uploads what you say is worse than none.
    Object.defineProperty(window, 'SpeechRecognition', { value: class {}, configurable: true })
    expect(isVoiceSupported()).toBe(false)
  })

  it('detects by presence, never by constructing one', () => {
    // Constructing a recogniser to find out whether recognition exists would
    // be the feature switching itself on to answer a question about itself.
    const construct = vi.fn()
    const Probe = withOnDevice(
      class {
        constructor() {
          construct()
        }
      },
    )
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
  processLocally: boolean
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
    processLocally = false
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

  it('REQUIRES on-device processing on every recogniser it creates', async () => {
    // The one line that makes the rest of this feature honest: with it set, the
    // user agent must transcribe locally or raise an error, and may not fall
    // back to a server (ADR-017).
    const { listen } = await import('./voice')
    listen('en', { onTranscript: vi.fn(), onError: vi.fn(), onEnd: vi.fn() })
    expect(instances[0]?.processLocally).toBe(true)
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
    ['network', 'no-model'],
    ['language-not-supported', 'no-model'],
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

    instances[0]?.onerror?.({ error: 'audio-capture' })
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
