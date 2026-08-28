import { DEFAULT_MODEL } from './models'
import { isAiTier, type AiTier } from './types'

/**
 * The AI layer's feature flags, and the ONLY part of it that the initial route
 * is allowed to load. Everything else — providers, the agent loop, WebCrypto,
 * the tool registry — sits behind a dynamic import, so a reader who never turns
 * AI on never downloads it.
 *
 * This module therefore has no runtime imports beyond a single string constant
 * and a type guard. Keep it that way.
 */

/**
 * Bumping this invalidates every stored consent: readers must read the notice
 * again before anything can leave the device. Bump it whenever the "what leaves
 * the device" text changes in substance, not for a typo.
 */
export const CONSENT_VERSION = 1

/** Tokens per calendar month, across input and output. Zero means "no calls". */
export const DEFAULT_MONTHLY_TOKEN_BUDGET = 200_000

export interface AiSettings {
  tier: AiTier
  /** The CONSENT_VERSION the reader accepted; 0 when they never have. */
  consentVersion: number
  /** ISO-8601, or null when consent was never given. */
  consentAt: string | null
  model: string
  monthlyTokenBudget: number
  /**
   * Mirrors "a key exists in the secrets table". The key itself never enters
   * the settings row, the zustand store or any React prop.
   */
  hasKey: boolean
  /** Serve repeat non-personal questions from the local answer cache. */
  answerCache: boolean
}

/**
 * Off, with no consent and no key. A fresh install, a cleared browser and a
 * settings row this version cannot parse all land here.
 */
export const DEFAULT_AI_SETTINGS: AiSettings = {
  tier: 'off',
  consentVersion: 0,
  consentAt: null,
  model: DEFAULT_MODEL,
  monthlyTokenBudget: DEFAULT_MONTHLY_TOKEN_BUDGET,
  hasKey: false,
  answerCache: true,
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Anything unrecognised is discarded rather than trusted — same posture as the
 * theme and language rows in src/app/store.ts. A hand-edited row cannot turn AI
 * on, because `tier` must parse AND `consentVersion` must equal the current
 * CONSENT_VERSION before `isAiEnabled` returns true.
 */
export function parseAiSettings(value: unknown): AiSettings {
  if (!isRecord(value)) return DEFAULT_AI_SETTINGS

  const tier = isAiTier(value.tier) ? value.tier : DEFAULT_AI_SETTINGS.tier
  const consentVersion =
    typeof value.consentVersion === 'number' && Number.isInteger(value.consentVersion)
      ? value.consentVersion
      : 0
  const budget =
    typeof value.monthlyTokenBudget === 'number' && Number.isFinite(value.monthlyTokenBudget)
      ? Math.max(0, Math.floor(value.monthlyTokenBudget))
      : DEFAULT_AI_SETTINGS.monthlyTokenBudget

  return {
    tier,
    consentVersion,
    consentAt: typeof value.consentAt === 'string' ? value.consentAt : null,
    model: typeof value.model === 'string' && value.model ? value.model : DEFAULT_AI_SETTINGS.model,
    monthlyTokenBudget: budget,
    hasKey: value.hasKey === true,
    answerCache: value.answerCache !== false,
  }
}

/** True only when consent for THIS version is on record and a tier is chosen. */
export function isAiEnabled(settings: AiSettings): boolean {
  return settings.tier !== 'off' && settings.consentVersion === CONSENT_VERSION
}

/** The reader has read the current notice; the tier may still be `off`. */
export function hasConsent(settings: AiSettings): boolean {
  return settings.consentVersion === CONSENT_VERSION
}

/**
 * A tier is only usable once its prerequisite is met. `byok` needs a key;
 * `proxy` needs the build to have been given a proxy URL; `local` needs the
 * on-device model, which Session 24 installs.
 */
export function tierReady(settings: AiSettings, proxyUrl: string | undefined): boolean {
  switch (settings.tier) {
    case 'off':
      return false
    case 'byok':
      return settings.hasKey
    case 'proxy':
      return Boolean(proxyUrl)
    case 'local':
      return false
  }
}

/** `VITE_AI_PROXY_URL`, read in one place so tests can reason about it. */
export function proxyUrlFromEnv(): string | undefined {
  const raw: unknown = import.meta.env.VITE_AI_PROXY_URL
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined
}
