import { useCallback, useEffect, useRef, useState } from 'react'

import type {
  StudyAgentResult,
  StudyAnswerResult,
  StudyIntent,
  StudyRefusal,
  StudyStep,
} from '@/ai/agents/study'
import type { AiProvider } from '@/ai/provider'
import type { AiErrorCode, AiTier } from '@/ai/types'
import type { Language } from '@/i18n'

/**
 * The Library's half of the AI layer, built to the shape `useLawAsk` settled.
 *
 * Everything is imported at RUN time, not at module load: `src/ai` is lazy for
 * a privacy reason rather than a performance one (`docs/AI.md`), and the panel
 * that mounts this hook is itself behind `React.lazy` and an availability gate.
 * A reader who never turns AI on never downloads the code that could reach the
 * network, and a reader who has turned it on but has not pressed Ask has not
 * downloaded the agent either.
 *
 * One run at a time and always cancellable, for the reason `useLawAsk` states:
 * two runs would leave two `AbortController`s and two answers racing to land,
 * and a reader who has navigated away must not still be spending their tokens.
 */

export type StudyAskState =
  | { kind: 'idle' }
  | { kind: 'running'; steps: StudyStep[]; partial: string }
  | { kind: 'answer'; result: StudyAnswerResult }
  | { kind: 'refused'; refusal: StudyRefusal }
  | { kind: 'error'; code: AiErrorCode; message: string; toolsCalled: string[] }

/** The codes that mean "it would not stand behind an answer", not "it broke". */
export const UNGROUNDED_CODES: readonly AiErrorCode[] = ['ungrounded', 'invalid_citation']

export interface UseStudyAskParams {
  language: Language
  workId: string
  unitId: string | null
  nodeId: string | null
  provider: AiProvider | null
  tier: AiTier
  budgetLimit: number
  onSpent?: () => void
}

export interface UseStudyAsk {
  state: StudyAskState
  busy: boolean
  ask: (question: string, intent: StudyIntent, includeNotes: boolean) => void
  cancel: () => void
  reset: () => void
}

export function useStudyAsk(params: UseStudyAskParams): UseStudyAsk {
  const [state, setState] = useState<StudyAskState>({ kind: 'idle' })
  const [busy, setBusy] = useState(false)
  const abort = useRef<AbortController | null>(null)

  // The latest parameters, read through a ref when a run STARTS — which is the
  // moment "what is on screen now" is the right answer. Without it `ask` would
  // be re-created whenever `provider` or `onSpent` changed and would repaint an
  // answer the reader is halfway through.
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

  const ask = useCallback((question: string, intent: StudyIntent, includeNotes: boolean) => {
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller

    const steps: StudyStep[] = []
    let partial = ''
    setBusy(true)
    setState({ kind: 'running', steps, partial })

    // A fresh array and object each paint: pushing into the one already in
    // state hands React the same reference and the list never repaints.
    const paint = () => {
      if (!controller.signal.aborted) setState({ kind: 'running', steps: [...steps], partial })
    }

    void (async () => {
      const [agent, registry, builtins] = await Promise.all([
        import('@/ai/agents/study'),
        import('@/ai/tools/registry'),
        import('@/ai/tools/index'),
      ])
      builtins.registerBuiltinTools()

      const p = latest.current
      if (!p.provider) throw new Error('The AI provider is not ready.')

      const result: StudyAgentResult = await agent.runStudyAgent({
        provider: p.provider,
        question,
        intent,
        language: p.language,
        workId: p.workId,
        unitId: p.unitId,
        nodeId: p.nodeId,
        includeNotes,
        tools: registry.listTools('library'),
        tier: p.tier,
        budgetLimit: p.budgetLimit,
        signal: controller.signal,
        onProgress: (step) => {
          steps.push(step)
          paint()
        },
        onPartialAnswer: (text) => {
          partial = text
          paint()
        },
      })
      if (controller.signal.aborted) return

      if (result.status === 'refused') setState({ kind: 'refused', refusal: result.refusal })
      else if (result.status === 'error') {
        setState({
          kind: 'error',
          code: result.code,
          message: result.message,
          toolsCalled: result.toolsCalled,
        })
      } else setState({ kind: 'answer', result })
    })()
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setState({
          kind: 'error',
          code: 'provider',
          message: error instanceof Error ? error.message : String(error),
          toolsCalled: [],
        })
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

  const reset = useCallback(() => {
    setState({ kind: 'idle' })
  }, [])

  return { state, busy, ask, cancel, reset }
}
