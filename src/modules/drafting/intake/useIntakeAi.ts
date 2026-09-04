import { useCallback, useEffect, useRef, useState } from 'react'

import type { IntakeAiAnalysis, IntakeStep } from '@/ai/agents/intake'
import type { BriefRefusal } from '@/ai/agents/drafting'
import type { AiProvider } from '@/ai/provider'
import type { AiTier } from '@/ai/types'
import type { Language } from '@/i18n'
import type { IntakeAnalysis, ResolvedProvision } from '@/lib/drafting/intake'
import type { RetrievedSnippet } from '@/lib/retrieval'

/**
 * The reply screen's half of the AI layer.
 *
 * Same shape as `useDraftingAi` and for the same reasons: one run at a time,
 * always cancellable, and the agent is dynamic-imported when the BUTTON is
 * pressed rather than when the panel renders. `src/ai` is lazy for a privacy
 * reason (`docs/AI.md`), and a reader who opens the reply screen to read the
 * chips — which is the whole feature with AI off — must not download the code
 * that could reach the network.
 */

export type IntakeAiState =
  | { kind: 'idle' }
  | { kind: 'running'; steps: IntakeStep[] }
  | { kind: 'analysis'; result: IntakeAiAnalysis }
  | { kind: 'refused'; refusal: BriefRefusal }
  | { kind: 'error'; message: string }

export interface UseIntakeAiParams {
  provider: AiProvider | null
  tier: AiTier
  budgetLimit: number
  language: Language
  templateIds: readonly string[]
  onSpent?: () => void
}

export interface UseIntakeAi {
  state: IntakeAiState
  busy: boolean
  analyse: (args: {
    text: string
    extracted: IntakeAnalysis
    provisions: readonly ResolvedProvision[]
    snippets: readonly RetrievedSnippet[]
  }) => void
  cancel: () => void
  reset: () => void
}

export function useIntakeAi(params: UseIntakeAiParams): UseIntakeAi {
  const [state, setState] = useState<IntakeAiState>({ kind: 'idle' })
  const [busy, setBusy] = useState(false)
  const abort = useRef<AbortController | null>(null)

  // The latest parameters, read through a ref at RUN time. Without it every
  // callback is rebuilt on each keystroke in the paste box, which re-renders a
  // result the officer may be halfway through reading.
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

  const analyse = useCallback<UseIntakeAi['analyse']>((args) => {
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    const steps: IntakeStep[] = []
    setBusy(true)
    setState({ kind: 'running', steps })

    void (async () => {
      const current = latest.current
      if (!current.provider) throw new Error('The AI provider is not ready.')
      const { runIntakeAgent } = await import('@/ai/agents/intake')
      const result = await runIntakeAgent({
        provider: current.provider,
        text: args.text,
        extracted: args.extracted,
        provisions: args.provisions,
        snippets: args.snippets,
        templateIds: current.templateIds,
        language: current.language,
        tier: current.tier,
        budgetLimit: current.budgetLimit,
        signal: controller.signal,
        onProgress: (step) => {
          if (controller.signal.aborted) return
          steps.push(step)
          // A new array each time: pushing into the one already in state hands
          // React the same reference and the list never repaints.
          setState({ kind: 'running', steps: [...steps] })
        },
      })
      if (controller.signal.aborted) return
      if (result.status === 'refused') setState({ kind: 'refused', refusal: result.refusal })
      else if (result.status === 'error') setState({ kind: 'error', message: result.message })
      else setState({ kind: 'analysis', result })
    })()
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

  const cancel = useCallback(() => {
    abort.current?.abort()
    abort.current = null
    setBusy(false)
    setState({ kind: 'idle' })
  }, [])

  const reset = useCallback(() => setState({ kind: 'idle' }), [])

  return { state, busy, analyse, cancel, reset }
}
