import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { CONSENT_VERSION, DEFAULT_AI_SETTINGS } from './flags'
import { ANTHROPIC_KEY_ID, storeSecret } from './secrets'
import { useAi } from './useAi'

import { useAppStore } from '@/app/store'

const consented = { ...DEFAULT_AI_SETTINGS, consentVersion: CONSENT_VERSION, consentAt: '2026-08-28' }

beforeEach(() => {
  useAppStore.setState({ ai: DEFAULT_AI_SETTINGS })
})

describe('useAi', () => {
  it('reports off, with no provider, on a fresh device', () => {
    const { result } = renderHook(() => useAi())

    expect(result.current.enabled).toBe(false)
    expect(result.current.ready).toBe(false)
    expect(result.current.provider).toBeNull()
    expect(result.current.budget).toBeNull()
  })

  it('stays off with a tier chosen but no consent recorded', () => {
    act(() => {
      useAppStore.setState({ ai: { ...DEFAULT_AI_SETTINGS, tier: 'byok', hasKey: true } })
    })
    const { result } = renderHook(() => useAi())

    expect(result.current.enabled).toBe(false)
    expect(result.current.provider).toBeNull()
  })

  it('is enabled but not ready when the chosen tier has no key', () => {
    act(() => {
      useAppStore.setState({ ai: { ...consented, tier: 'byok', hasKey: false } })
    })
    const { result } = renderHook(() => useAi())

    expect(result.current.enabled).toBe(true)
    expect(result.current.ready).toBe(false)
    expect(result.current.provider).toBeNull()
  })

  it('resolves a provider and a budget once the tier is ready', async () => {
    await storeSecret(ANTHROPIC_KEY_ID, 'sk-ant-api03-test')
    act(() => {
      useAppStore.setState({ ai: { ...consented, tier: 'byok', hasKey: true } })
    })
    const { result } = renderHook(() => useAi())

    await waitFor(() => expect(result.current.provider).not.toBeNull())
    expect(result.current.provider?.id).toBe('anthropic-direct')
    expect(result.current.provider?.capabilities.localOnly).toBe(false)
    expect(result.current.budget?.limit).toBe(DEFAULT_AI_SETTINGS.monthlyTokenBudget)
  })

  it('drops the provider the moment the kill switch fires, with no reload', async () => {
    await storeSecret(ANTHROPIC_KEY_ID, 'sk-ant-api03-test')
    act(() => {
      useAppStore.setState({ ai: { ...consented, tier: 'byok', hasKey: true } })
    })
    const { result } = renderHook(() => useAi())
    await waitFor(() => expect(result.current.provider).not.toBeNull())

    act(() => {
      useAppStore.setState({ ai: { ...DEFAULT_AI_SETTINGS } })
    })

    expect(result.current.enabled).toBe(false)
    expect(result.current.provider).toBeNull()
  })

  it('surfaces a misconfigured tier instead of silently degrading to another', async () => {
    // Tier 2 with no VITE_AI_PROXY_URL: `ready` is false, so nothing is built
    // and nothing is sent anywhere else instead.
    act(() => {
      useAppStore.setState({ ai: { ...consented, tier: 'proxy' } })
    })
    const { result } = renderHook(() => useAi())

    await waitFor(() => expect(result.current.enabled).toBe(true))
    expect(result.current.ready).toBe(false)
    expect(result.current.provider).toBeNull()
  })
})
