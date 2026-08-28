/**
 * Voice search: the flags, and the ONLY part of it the initial route loads.
 *
 * **Recognition happens on this device or it does not happen.**
 *
 * The Web Speech API is a network service by default — Chrome streams the
 * captured audio to Google and transcribes it there — which is why this feature
 * first shipped behind a consent notice (ADR-014). Chrome now exposes on-device
 * recognition through `processLocally` and `SpeechRecognition.available()`, so
 * the honest design is to REQUIRE it and refuse when it is absent, rather than
 * to explain a compromise (ADR-017).
 *
 * That is what removes the consent gate. With `processLocally` set, nothing a
 * reader says leaves the device, so there is nothing to warn about and the hard
 * rule holds with no exception at all. `src/lib/voice.ts` enforces it; this
 * module only decides whether to draw the button.
 *
 * No runtime imports, and nothing here constructs a recogniser. Keep it that
 * way: `src/app/store.ts` loads it eagerly.
 */

export interface VoiceSettings {
  /**
   * Whether the microphone button is offered. Default true — it does nothing
   * until pressed, pressing it still needs the browser's own microphone
   * permission, and the audio never leaves the device. The switch is for a
   * reader who would rather not see a microphone at all.
   */
  enabled: boolean
}

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = { enabled: true }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Anything unrecognised falls back to the default rather than being trusted. */
export function parseVoiceSettings(value: unknown): VoiceSettings {
  if (!isRecord(value)) return DEFAULT_VOICE_SETTINGS
  return { enabled: value.enabled !== false }
}

/**
 * Whether this browser can recognise speech WITHOUT sending it anywhere.
 *
 * Two conditions, both required, and neither constructs a recogniser:
 *
 *  1. the API exists at all — Firefox implements none of it;
 *  2. `processLocally` exists on the prototype — without it the browser has
 *     only the cloud path, and this app does not offer that path.
 *
 * A browser with the API but not the on-device switch shows NO microphone
 * button. That is the point: a button that quietly uploads what you say is
 * worse than no button.
 */
export function isVoiceSupported(): boolean {
  if (typeof window === 'undefined') return false

  const scope = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }
  const Ctor = scope.SpeechRecognition ?? scope.webkitSpeechRecognition
  if (typeof Ctor !== 'function') return false

  const proto: unknown = (Ctor as { prototype?: unknown }).prototype
  return typeof proto === 'object' && proto !== null && 'processLocally' in proto
}

/** BCP-47 tags for Indian English and Indian Hindi, which is what readers speak. */
export const VOICE_LOCALES: Readonly<Record<'en' | 'hi', string>> = {
  en: 'en-IN',
  hi: 'hi-IN',
}

/**
 * Whether the on-device model for a language is here, fetchable, or absent.
 *
 * Mirrors the spec's `AvailabilityStatus`. `downloadable` is a real state and
 * not an error: the language pack is a one-time download the BROWSER performs,
 * of a speech model, and it is offered as a button rather than started behind
 * the reader's back.
 */
export type VoiceAvailability = 'available' | 'downloadable' | 'downloading' | 'unavailable'
