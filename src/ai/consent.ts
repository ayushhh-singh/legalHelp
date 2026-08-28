import { clearAnswerCache } from './answer-cache'
import { CONSENT_VERSION, type AiSettings } from './flags'
import { clearVault } from './secrets'
import { clearUsage } from './usage'
import type { AiTier } from './types'

/**
 * Consent, and the kill switch.
 *
 * Nothing in the AI layer runs until `consentVersion` on the stored settings
 * equals CONSENT_VERSION. That check lives in `isAiEnabled()` (src/ai/flags.ts),
 * which the modules read — so consent is not a modal that can be dismissed
 * past, it is the gate the feature flag itself is built on.
 *
 * Bumping CONSENT_VERSION re-gates every device: the notice has to be read
 * again before anything can leave. Bump it whenever the substance of what
 * leaves the device changes.
 */

export type ActiveTier = Exclude<AiTier, 'off'>

export interface TierDisclosure {
  tier: ActiveTier
  /** Nothing this tier does can reach the network. */
  localOnly: boolean
  /** The reader pays a third party per token. */
  costsMoney: boolean
  /** Needs an API key stored on the device. */
  requiresKey: boolean
  /** Who, other than the reader, can see the prompt. */
  recipient: 'nobody' | 'anthropic' | 'operator-and-anthropic'
  /** i18n key under `ai.consent.tiers`, resolved by the modal. */
  i18nKey: string
}

/**
 * The honest, one-line answer to "what leaves this device?" for each tier.
 * The modal renders these; nothing else decides that wording.
 */
export const TIER_DISCLOSURES: Record<ActiveTier, TierDisclosure> = {
  local: {
    tier: 'local',
    localOnly: true,
    costsMoney: false,
    requiresKey: false,
    recipient: 'nobody',
    i18nKey: 'local',
  },
  byok: {
    tier: 'byok',
    localOnly: false,
    costsMoney: true,
    requiresKey: true,
    recipient: 'anthropic',
    i18nKey: 'byok',
  },
  proxy: {
    tier: 'proxy',
    localOnly: false,
    costsMoney: false,
    requiresKey: false,
    recipient: 'operator-and-anthropic',
    i18nKey: 'proxy',
  },
}

export const ACTIVE_TIERS: readonly ActiveTier[] = ['local', 'byok', 'proxy']

/** The settings patch that records consent. Does not turn anything on. */
export function acceptConsentPatch(now: Date = new Date()): Partial<AiSettings> {
  return { consentVersion: CONSENT_VERSION, consentAt: now.toISOString() }
}

/** The settings patch the kill switch writes. Consent is withdrawn too. */
export function killSwitchPatch(): Partial<AiSettings> {
  return { tier: 'off', consentVersion: 0, consentAt: null, hasKey: false }
}

/**
 * The destructive half of the kill switch: the stored key, the key material
 * that could decrypt it, every cached answer and the token ledger all go.
 *
 * Deliberately not reversible and deliberately not partial. A reader who turns
 * this off is saying "leave nothing behind", and a leftover ciphertext they
 * cannot see is exactly the thing that would make that untrue.
 */
export async function purgeAiData(): Promise<void> {
  await Promise.all([clearVault(), clearAnswerCache(), clearUsage()])
}

/**
 * True when this tier can be offered at all in this build. `local` needs the
 * on-device model (Session 24) and `proxy` needs a proxy URL, so both are shown
 * disabled with a reason rather than hidden — a hidden option looks like a
 * missing feature, a disabled one explains itself.
 */
export function tierAvailable(tier: ActiveTier, proxyUrl: string | undefined): boolean {
  switch (tier) {
    case 'local':
      return false
    case 'byok':
      return true
    case 'proxy':
      return Boolean(proxyUrl)
  }
}
