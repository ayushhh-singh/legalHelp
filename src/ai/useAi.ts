import { useCallback, useEffect, useState } from 'react'

import { isAiEnabled, proxyUrlFromEnv, tierReady, type AiSettings } from './flags'
import type { AiProvider } from './provider'
import type { AiTier } from './types'
import type { BudgetState } from './usage'

import { useAppStore } from '@/app/store'

/**
 * The hook every AI surface starts from.
 *
 * `enabled` is synchronous and comes from the settings the app store already
 * hydrated, so a module can decide not to render an AI affordance without
 * awaiting anything and without importing a provider.
 *
 * `provider` and `budget` resolve asynchronously and are `null` whenever AI is
 * off — the dynamic imports behind them are the reason the AI layer never
 * reaches the initial route. The kill switch therefore takes effect without a
 * reload: the settings change alters `resolutionKey`, and everything resolved
 * under the old key stops being returned on the very next render.
 */
export interface UseAi {
  enabled: boolean
  tier: AiTier
  /** Enabled AND the tier's prerequisite (key, proxy URL, model) is met. */
  ready: boolean
  settings: AiSettings
  provider: AiProvider | null
  budget: BudgetState | null
  /** Set when the provider or the budget read failed; the surfaces show it. */
  error: string | null
  refreshBudget: () => Promise<void>
}

interface Resolved {
  /** The settings this was resolved for. A mismatch means it is stale. */
  key: string
  provider: AiProvider | null
  budget: BudgetState | null
  error: string | null
}

export function useAi(): UseAi {
  const settings = useAppStore((state) => state.ai)
  const [resolved, setResolved] = useState<Resolved | null>(null)

  const proxyUrl = proxyUrlFromEnv()
  const enabled = isAiEnabled(settings)
  const ready = enabled && tierReady(settings, proxyUrl)

  // Everything the resolution depends on. Comparing against it on read is what
  // lets the effect below never have to null state out synchronously.
  const key = `${settings.tier}|${settings.model}|${settings.monthlyTokenBudget}|${ready ? 1 : 0}`
  const current = resolved?.key === key ? resolved : null

  useEffect(() => {
    if (!ready) return

    let cancelled = false
    void (async () => {
      try {
        const [{ createProvider }, { budgetState }] = await Promise.all([
          import('./provider'),
          import('./usage'),
        ])
        const provider = await createProvider(settings)
        const budget = await budgetState(settings.monthlyTokenBudget)
        if (!cancelled) setResolved({ key, provider, budget, error: null })
      } catch (cause) {
        if (cancelled) return
        setResolved({
          key,
          provider: null,
          budget: null,
          error: cause instanceof Error ? cause.message : 'The AI provider could not be created.',
        })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [ready, key, settings])

  const refreshBudget = useCallback(async () => {
    if (!ready) return
    const { budgetState } = await import('./usage')
    const budget = await budgetState(settings.monthlyTokenBudget)
    setResolved((previous) => (previous && previous.key === key ? { ...previous, budget } : previous))
  }, [ready, key, settings.monthlyTokenBudget])

  return {
    enabled,
    tier: settings.tier,
    ready,
    settings,
    provider: current?.provider ?? null,
    budget: current?.budget ?? null,
    error: current?.error ?? null,
    refreshBudget,
  }
}
