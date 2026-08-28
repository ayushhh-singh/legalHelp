import { describe, expect, it } from 'vitest'

import { ACTIVE_TIERS, TIER_DISCLOSURES, acceptConsentPatch, killSwitchPatch, tierAvailable } from './consent'
import { CONSENT_VERSION, DEFAULT_AI_SETTINGS, isAiEnabled, parseAiSettings } from './flags'
import { AI_TIERS } from './types'

import en from '@/i18n/en.json'
import hi from '@/i18n/hi.json'

describe('the tier disclosures', () => {
  it('covers every tier except off', () => {
    expect([...ACTIVE_TIERS].sort()).toEqual(AI_TIERS.filter((tier) => tier !== 'off').sort())
    for (const tier of ACTIVE_TIERS) {
      expect(TIER_DISCLOSURES[tier].tier, tier).toBe(tier)
    }
  })

  it('states, in both languages, what each tier sends and what it costs', () => {
    // A tier added without its consent copy would ship a modal that silently
    // omits one of the things leaving the device. This is that guard.
    for (const tier of ACTIVE_TIERS) {
      for (const catalogue of [en, hi]) {
        const copy = catalogue.ai.consent.tiers[TIER_DISCLOSURES[tier].i18nKey as 'byok']
        expect(copy?.name, `${tier} name`).toBeTruthy()
        expect(copy?.leaves, `${tier} leaves`).toBeTruthy()
        expect(copy?.cost, `${tier} cost`).toBeTruthy()
      }
    }
  })

  it('marks exactly one tier as local-only, and the paid one as costing money', () => {
    expect(ACTIVE_TIERS.filter((tier) => TIER_DISCLOSURES[tier].localOnly)).toEqual(['local'])
    expect(TIER_DISCLOSURES.byok).toMatchObject({
      costsMoney: true,
      requiresKey: true,
      recipient: 'anthropic',
    })
    expect(TIER_DISCLOSURES.proxy.recipient).toBe('operator-and-anthropic')
  })
})

describe('tierAvailable', () => {
  it('offers only what this build can actually run', () => {
    // Tier 0 needs the on-device model (Session 24); Tier 2 needs a proxy URL.
    expect(tierAvailable('local', undefined)).toBe(false)
    expect(tierAvailable('byok', undefined)).toBe(true)
    expect(tierAvailable('proxy', undefined)).toBe(false)
    expect(tierAvailable('proxy', 'https://ai.example.test')).toBe(true)
  })
})

describe('the consent and kill-switch patches', () => {
  it('records consent without turning anything on', () => {
    const next = parseAiSettings({ ...DEFAULT_AI_SETTINGS, ...acceptConsentPatch(new Date('2026-08-28')) })

    expect(next.consentVersion).toBe(CONSENT_VERSION)
    expect(next.consentAt).toBe('2026-08-28T00:00:00.000Z')
    expect(next.tier).toBe('off')
    expect(isAiEnabled(next)).toBe(false)
  })

  it('withdraws consent as well as switching off, so the notice must be read again', () => {
    const running = parseAiSettings({
      ...DEFAULT_AI_SETTINGS,
      tier: 'byok',
      hasKey: true,
      consentVersion: CONSENT_VERSION,
    })
    expect(isAiEnabled(running)).toBe(true)

    const killed = parseAiSettings({ ...running, ...killSwitchPatch() })
    expect(killed).toMatchObject({ tier: 'off', consentVersion: 0, consentAt: null, hasKey: false })
    expect(isAiEnabled(killed)).toBe(false)
  })
})
