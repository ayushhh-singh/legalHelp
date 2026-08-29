import { useCallback, useEffect, useRef, useState } from 'react'

import type { TutorStep } from '@/ai/agents/tutor'
import type { AiProvider } from '@/ai/provider'
import type { AiTier, TokenUsage } from '@/ai/types'
import type { Language } from '@/i18n'

/**
 * The Rules Trainer's half of the AI layer: state, cancellation, and the
 * dynamic imports that keep the agent out of `/learn`'s own chunk — the same
 * shape as `src/modules/drafting/useDraftingAi.ts`, for the same reason
 * (`docs/AI.md`: laziness here is a privacy property, not a performance one).
 * One run at a time; starting a new one aborts whatever was in flight, and
 * unmounting aborts too.
 */

export type TutorAiState =
  | { kind: 'idle' }
  | { kind: 'running'; steps: TutorStep[] }
  | { kind: 'explain'; text: string; usage: TokenUsage; cost: number }
  | { kind: 'scenario'; text: string; cardId: string; reviewQueueUrl: string; usage: TokenUsage; cost: number }
  | { kind: 'focusPlan'; text: string; usage: TokenUsage; cost: number }
  | { kind: 'error'; message: string }

export interface UseTutorAi {
  state: TutorAiState
  busy: boolean
  explain: (params: { act: string; rule: string; qId: string; pickedAnswer: string; correctAnswer: string }) => void
  scenario: (params: { act: string; rule: string }) => void
  focusPlan: (params?: { act?: string }) => void
  cancel: () => void
  reset: () => void
}

export interface UseTutorAiParams {
  language: Language
  provider: AiProvider | null
  tier: AiTier
  budgetLimit: number
  /** Called after every run so the panel's budget line is not stale. */
  onSpent?: () => void
}

export function useTutorAi(params: UseTutorAiParams): UseTutorAi {
  const [state, setState] = useState<TutorAiState>({ kind: 'idle' })
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

  const start = useCallback((run: (signal: AbortSignal, onProgress: (step: TutorStep) => void) => Promise<void>) => {
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    const steps: TutorStep[] = []
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
  }, [])

  const load = async () => {
    const [agent, registry, builtins] = await Promise.all([
      import('@/ai/agents/tutor'),
      import('@/ai/tools/registry'),
      import('@/ai/tools/index'),
    ])
    builtins.registerBuiltinTools()
    return { agent, tools: registry.listTools('learn') }
  }

  const common = () => {
    const p = latest.current
    if (!p.provider) throw new Error('The AI provider is not ready.')
    return { provider: p.provider, language: p.language, tier: p.tier, budgetLimit: p.budgetLimit }
  }

  const explain = useCallback(
    (input: { act: string; rule: string; qId: string; pickedAnswer: string; correctAnswer: string }) => {
      start(async (signal, onProgress) => {
        const { agent, tools } = await load()
        const base = common()
        const result = await agent.explainAnswer({ ...input, ...base, tools, signal, onProgress })
        if (signal.aborted) return
        if (result.status === 'error') setState({ kind: 'error', message: result.message })
        else setState({ kind: 'explain', text: result.text, usage: result.usage, cost: result.cost })
      })
    },
    [start],
  )

  const scenario = useCallback(
    (input: { act: string; rule: string }) => {
      start(async (signal, onProgress) => {
        const { agent, tools } = await load()
        const base = common()
        const result = await agent.proposeScenario({ ...input, ...base, tools, signal, onProgress })
        if (signal.aborted) return
        if (result.status === 'error') setState({ kind: 'error', message: result.message })
        else {
          setState({
            kind: 'scenario',
            text: result.text,
            cardId: result.cardId,
            reviewQueueUrl: result.reviewQueueUrl,
            usage: result.usage,
            cost: result.cost,
          })
        }
      })
    },
    [start],
  )

  const focusPlan = useCallback(
    (input?: { act?: string }) => {
      start(async (signal, onProgress) => {
        const { agent, tools } = await load()
        const base = common()
        const result = await agent.weeklyFocusPlan({ ...(input ?? {}), ...base, tools, signal, onProgress })
        if (signal.aborted) return
        if (result.status === 'error') setState({ kind: 'error', message: result.message })
        else setState({ kind: 'focusPlan', text: result.text, usage: result.usage, cost: result.cost })
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

  return { state, busy, explain, scenario, focusPlan, cancel, reset }
}
