/**
 * Voice search: the flags, and the ONLY part of it the initial route loads.
 *
 * The recogniser itself lives in `src/lib/voice.ts` behind a dynamic import,
 * for the same reason the AI providers do (ADR-011): a reader who never turns
 * voice on never downloads the code that could send anything off the device.
 *
 * **Why this needs consent at all.** `SpeechRecognition` in Chrome is not
 * on-device — it streams the captured audio to Google's servers. A spoken
 * query is therefore user-entered data leaving the device, which is exactly
 * what the master context's hard rule forbids by default and what
 * `tests/e2e/zero-third-party-requests.spec.ts` enforces. Off is the default,
 * and the notice says where the audio goes before anything can be recorded.
 *
 * This module has no runtime imports and touches no browser API. Keep it that
 * way: `src/app/store.ts` loads it eagerly.
 */

/**
 * Bumping this invalidates every stored consent, so readers must read the
 * notice again before the microphone can be used. Bump it when the "where the
 * audio goes" text changes in substance, not for a typo.
 */
export const VOICE_CONSENT_VERSION = 1

export interface VoiceSettings {
  /** The reader has turned voice search on. */
  enabled: boolean
  /** The VOICE_CONSENT_VERSION accepted; 0 when it never was. */
  consentVersion: number
  /** ISO-8601, or null when consent was never given. */
  consentAt: string | null
}

/** Off, unconsented. A fresh install and an unparseable row both land here. */
export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  enabled: false,
  consentVersion: 0,
  consentAt: null,
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Anything unrecognised is discarded rather than trusted — the same posture as
 * `parseAiSettings`. A hand-edited settings row cannot turn the microphone on,
 * because `enabled` must be exactly `true` AND `consentVersion` must equal the
 * current version before `isVoiceEnabled` agrees.
 */
export function parseVoiceSettings(value: unknown): VoiceSettings {
  if (!isRecord(value)) return DEFAULT_VOICE_SETTINGS

  return {
    enabled: value.enabled === true,
    consentVersion:
      typeof value.consentVersion === 'number' && Number.isInteger(value.consentVersion)
        ? value.consentVersion
        : 0,
    consentAt: typeof value.consentAt === 'string' ? value.consentAt : null,
  }
}

/** True only when consent for THIS version is on record and voice is on. */
export function isVoiceEnabled(settings: VoiceSettings): boolean {
  return settings.enabled && settings.consentVersion === VOICE_CONSENT_VERSION
}

/** The reader has read the current notice; voice may still be switched off. */
export function hasVoiceConsent(settings: VoiceSettings): boolean {
  return settings.consentVersion === VOICE_CONSENT_VERSION
}

/**
 * Whether this browser has the API at all, without touching it.
 *
 * A presence check on `window`, not a constructor call — Firefox implements
 * none of it, and the button must simply not appear there rather than appear
 * and fail. `src/lib/voice.ts` is the only module that may construct one.
 */
export function isVoiceSupported(): boolean {
  if (typeof window === 'undefined') return false
  return 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window
}

/** BCP-47 tags for Indian English and Indian Hindi, which is what readers speak. */
export const VOICE_LOCALES: Readonly<Record<'en' | 'hi', string>> = {
  en: 'en-IN',
  hi: 'hi-IN',
}
