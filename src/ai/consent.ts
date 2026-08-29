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
 * True when this tier can be offered at all in this build.
 *
 * `local` and `byok` are unconditional: both ship in every build, and whether
 * this particular DEVICE can run Tier 0 is a WebGPU question that
 * `src/ai/local/webgpu.ts` answers inside the section, with the reason, rather
 * than by making the option vanish.
 *
 * `proxy` needs `VITE_AI_PROXY_URL`, and a build without one genuinely has
 * nowhere to send a request — so it is shown DISABLED with a reason rather
 * than hidden. A hidden option looks like a missing feature; a disabled one
 * explains itself. `tierPickable()` is the same question for the settings UI,
 * which additionally hides the proxy row entirely when no build ever
 * configured it (ADR-037).
 */
export function tierAvailable(tier: ActiveTier, proxyUrl: string | undefined): boolean {
  switch (tier) {
    case 'local':
      return true
    case 'byok':
      return true
    case 'proxy':
      return Boolean(proxyUrl)
  }
}

/**
 * Whether the settings screen draws the row AT ALL, as opposed to drawing it
 * disabled.
 *
 * The two questions used to have one answer, and Session 3A's rule — "show a
 * disabled option with a reason, never a hidden one" — was right when it was
 * written, because both Tier 0 and Tier 2 were then unbuilt and the reader
 * deserved to know they were coming.
 *
 * Tier 0 now ships, so a build with no proxy URL has two tiers that work. The
 * "Shared service" row in such a build is not an option waiting on the reader;
 * it is an option waiting on somebody the reader has never met, and a
 * permanently disabled control they can do nothing about is noise. The
 * distinction that survives is who can act: Tier 0's own refusals name THIS
 * DEVICE ("your graphics card cannot run the 16-bit version"), and the reader
 * can act on those, so those stay visible and disabled (ADR-037).
 */
export function tierPickable(tier: AiTier, proxyUrl: string | undefined): boolean {
  return tier === 'proxy' ? Boolean(proxyUrl) : true
}
