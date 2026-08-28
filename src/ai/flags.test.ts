import { describe, expect, it } from 'vitest'

import {
  CONSENT_VERSION,
  DEFAULT_AI_SETTINGS,
  hasConsent,
  isAiEnabled,
  parseAiSettings,
  tierReady,
} from './flags'
import { AI_MODELS, DEFAULT_MODEL, raiseEffort, resolveEffort, resolveModel, TASK_DEFAULTS } from './models'

const consented = { ...DEFAULT_AI_SETTINGS, consentVersion: CONSENT_VERSION, consentAt: '2026-08-28' }

describe('parseAiSettings', () => {
  it('falls back to off for anything it does not recognise', () => {
    expect(parseAiSettings(undefined)).toEqual(DEFAULT_AI_SETTINGS)
    expect(parseAiSettings('byok')).toEqual(DEFAULT_AI_SETTINGS)
    expect(parseAiSettings({ tier: 'sneaky' }).tier).toBe('off')
  })

  it('cannot be talked into an enabled state by a hand-edited row', () => {
    // Both halves must be right: a tier alone is not consent.
    const forged = parseAiSettings({ tier: 'byok', consentVersion: 'yes', hasKey: 'yes' })

    expect(forged.tier).toBe('byok')
    expect(forged.consentVersion).toBe(0)
    expect(forged.hasKey).toBe(false)
    expect(isAiEnabled(forged)).toBe(false)
  })

  it('re-gates every device when the notice changes', () => {
    const stale = parseAiSettings({ tier: 'byok', consentVersion: CONSENT_VERSION - 1 })

    expect(hasConsent(stale)).toBe(false)
    expect(isAiEnabled(stale)).toBe(false)
  })

  it('clamps a negative or fractional budget to a whole number of tokens', () => {
    expect(parseAiSettings({ monthlyTokenBudget: -5 }).monthlyTokenBudget).toBe(0)
    expect(parseAiSettings({ monthlyTokenBudget: 1234.7 }).monthlyTokenBudget).toBe(1234)
  })
})

describe('isAiEnabled and tierReady', () => {
  it('stays off without both a tier and current consent', () => {
    expect(isAiEnabled(DEFAULT_AI_SETTINGS)).toBe(false)
    expect(isAiEnabled({ ...DEFAULT_AI_SETTINGS, tier: 'byok' })).toBe(false)
    expect(isAiEnabled({ ...consented, tier: 'off' })).toBe(false)
    expect(isAiEnabled({ ...consented, tier: 'byok' })).toBe(true)
  })

  it('holds each tier to its own prerequisite', () => {
    expect(tierReady({ ...consented, tier: 'byok', hasKey: false }, undefined)).toBe(false)
    expect(tierReady({ ...consented, tier: 'byok', hasKey: true }, undefined)).toBe(true)
    expect(tierReady({ ...consented, tier: 'proxy' }, undefined)).toBe(false)
    expect(tierReady({ ...consented, tier: 'proxy' }, 'https://ai.example.test')).toBe(true)
    // Tier 0 ships in Session 24; until then it can be chosen but never runs.
    expect(tierReady({ ...consented, tier: 'local' }, undefined)).toBe(false)
  })
})

describe('the model constants', () => {
  it('has a default that is actually in the list', () => {
    expect(AI_MODELS.map((model) => model.id)).toContain(DEFAULT_MODEL)
    expect(resolveModel(undefined).id).toBe(DEFAULT_MODEL)
    expect(resolveModel('claude-does-not-exist').id).toBe(DEFAULT_MODEL)
  })

  it('gives every agent a model and an effort rather than a fallback row', () => {
    for (const [agentId, defaults] of Object.entries(TASK_DEFAULTS)) {
      expect(
        AI_MODELS.map((model) => model.id),
        agentId,
      ).toContain(defaults.model)
      expect(defaults.maxSteps, agentId).toBeGreaterThan(0)
    }
  })

  it('clamps effort to what the chosen model accepts', () => {
    const sonnet = resolveModel('claude-sonnet-4-6')
    const haiku = resolveModel('claude-haiku-4-5')

    // Sonnet 4.6 has no `xhigh` rung; asking for one must not 400 the request.
    expect(resolveEffort(sonnet, 'xhigh')).toBe('max')
    expect(resolveEffort(sonnet, 'medium')).toBe('medium')
    // Pre-4.6 models reject `effort` outright, so it is omitted.
    expect(resolveEffort(haiku, 'high')).toBeUndefined()
  })

  it('raises effort by one rung for an analytical question', () => {
    const sonnet = resolveModel('claude-sonnet-4-6')
    expect(raiseEffort('low', sonnet)).toBe('medium')
    expect(raiseEffort('max', sonnet)).toBe('max')
  })
})
