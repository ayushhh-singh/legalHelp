import { useCallback, useEffect, useRef, useState } from 'react'

import type { PayAgentStep, PayRefusal } from '@/ai/agents/pay'
import type { AiProvider } from '@/ai/provider'
import type { AiTier, TokenUsage } from '@/ai/types'
import type { Language } from '@/i18n'

/**
 * The Pay calculator's half of the AI layer — the same shape as
 * `src/modules/drafting/useDraftingAi.ts` and
 * `src/modules/trainer/useTutorAi.ts`: state, cancellation, and dynamic
 * imports so a reader with AI off never downloads the agent.
 */

export type PayAiState =
  | { kind: 'idle' }
  | { kind: 'running'; steps: PayAgentStep[] }
  | { kind: 'ok'; text: string; usage: TokenUsage; cost: number }
  | { kind: 'refused'; refusal: PayRefusal }
  | { kind: 'error'; message: string }

export interface UsePayAi {
  state: PayAiState
  busy: boolean
  explainPayslip: (params: { jobId: string; overrides?: Record<string, unknown> }) => void
  compareJobs: (params: { jobA: string; jobB: string; overrides?: Record<string, unknown> }) => void
  cancel: () => void
  reset: () => void
}

export interface UsePayAiParams {
  language: Language
  provider: AiProvider | null
  tier: AiTier
  budgetLimit: number
  onSpent?: () => void
}

export function usePayAi(params: UsePayAiParams): UsePayAi {
  const [state, setState] = useState<PayAiState>({ kind: 'idle' })
  const [busy, setBusy] = useState(false)
  const abort = useRef<AbortController | null>(null)
  const latest = useRef(params)
  useEffect(() => {
    latest.current = params
  })

  useEffect(
    () => () => {
      abort.current?.abort()
    },
    [],
  )

  const start = useCallback(
    (run: (signal: AbortSignal, onProgress: (step: PayAgentStep) => void) => Promise<void>) => {
      abort.current?.abort()
      const controller = new AbortController()
      abort.current = controller
      const steps: PayAgentStep[] = []
      setBusy(true)
      setState({ kind: 'running', steps })

      void run(controller.signal, (step) => {
        if (controller.signal.aborted) return
        steps.push(step)
        setState({ kind: 'running', steps: [...steps] })
      })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return
          setState({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
        })
        .finally(() => {
          if (abort.current === controller) {
            abort.current = null
            setBusy(false)
          }
          latest.current.onSpent?.()
        })
    },
    [],
  )

  const load = async () => {
    const [agent, registry, builtins] = await Promise.all([
      import('@/ai/agents/pay'),
      import('@/ai/tools/registry'),
      import('@/ai/tools/index'),
    ])
    builtins.registerBuiltinTools()
    return { agent, tools: registry.listTools('pay') }
  }

  const common = () => {
    const p = latest.current
    if (!p.provider) throw new Error('The AI provider is not ready.')
    return { provider: p.provider, language: p.language, tier: p.tier, budgetLimit: p.budgetLimit }
  }

  const explainPayslip = useCallback(
    (input: { jobId: string; overrides?: Record<string, unknown> }) => {
      start(async (signal, onProgress) => {
        const { agent, tools } = await load()
        const base = common()
        const result = await agent.explainPayslip({ ...input, ...base, tools, signal, onProgress })
        if (signal.aborted) return
        if (result.status === 'error') setState({ kind: 'error', message: result.message })
        else if (result.status === 'refused') setState({ kind: 'refused', refusal: result.refusal })
        else setState({ kind: 'ok', text: result.text, usage: result.usage, cost: result.cost })
      })
    },
    [start],
  )

  const compareJobs = useCallback(
    (input: { jobA: string; jobB: string; overrides?: Record<string, unknown> }) => {
      start(async (signal, onProgress) => {
        const { agent, tools } = await load()
        const base = common()
        const result = await agent.compareJobsForReader({ ...input, ...base, tools, signal, onProgress })
        if (signal.aborted) return
        if (result.status === 'error') setState({ kind: 'error', message: result.message })
        else if (result.status === 'refused') setState({ kind: 'refused', refusal: result.refusal })
        else setState({ kind: 'ok', text: result.text, usage: result.usage, cost: result.cost })
      })
    },
    [start],
  )

  const cancel = useCallback(() => {
    abort.current?.abort()
    abort.current = null
    setBusy(false)
    setState({ kind: 'idle' })
  }, [])

  const reset = useCallback(() => setState({ kind: 'idle' }), [])

  return { state, busy, explainPayslip, compareJobs, cancel, reset }
}
