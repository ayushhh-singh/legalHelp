import { useCallback, useEffect, useRef, useState } from 'react'

import type { LawAnswerResult, LawRefusal, LawStep } from '@/ai/agents/law'
import type { AiProvider } from '@/ai/provider'
import type { AiErrorCode, AiTier } from '@/ai/types'
import type { Language } from '@/i18n'

/**
 * The Law Converter's half of the AI layer: state, cancellation, and the
 * dynamic imports that keep the agent out of the converter's chunk.
 *
 * ### Why everything is imported at RUN time and not at module load
 *
 * `src/ai` is lazy for a privacy reason rather than a performance one
 * (`docs/AI.md`): a reader who never turns AI on never downloads the code that
 * could reach the network. `ConverterPage` already mounts the panel behind
 * `React.lazy` and `lawAiAvailable(useAi().enabled)`, and this hook goes one
 * step further — the agent, the tool registry and the built-in tools are
 * imported when the reader presses Ask, not when the panel appears. Reading
 * what the panel says therefore costs nothing.
 *
 * It is also what keeps `data/law/*.json` off the critical path twice over: the
 * law tools call `loadCorpus()` themselves, so the 3.9 MB of statute is fetched
 * by the same lazily-imported chunk the converter's own search uses, and only
 * once something has actually been asked.
 *
 * ### One run at a time, and it is always cancellable
 *
 * A second run started over a first would leave two `AbortController`s and an
 * older answer racing to land. Starting a run aborts whatever was in flight,
 * and unmounting aborts too — a reader who has navigated away from `/law` must
 * not still be spending their tokens.
 */

export type LawAskState =
  | { kind: 'idle' }
  | {
      kind: 'running'
      steps: LawStep[]
      /** The answer as it streams, in the reader's language. Best-effort. */
      partial: string
    }
  | { kind: 'answer'; result: LawAnswerResult }
  | { kind: 'refused'; refusal: LawRefusal }
  | { kind: 'error'; code: AiErrorCode; message: string; toolsCalled: string[] }

export interface UseLawAsk {
  state: LawAskState
  /** True while a run is in flight, so the panel can disable its controls. */
  busy: boolean
  ask: (question: string) => void
  cancel: () => void
  reset: () => void
}

export interface UseLawAskParams {
  language: Language
  /** The converter's own offence-date field, read at the moment Ask is pressed. */
  offenceDate: string | null
  provider: AiProvider | null
  tier: AiTier
  budgetLimit: number
  /** Called after every run so the panel's budget line is not stale. */
  onSpent?: () => void
}

/**
 * The error codes that mean "the assistant would not stand behind an answer",
 * as opposed to "something broke".
 *
 * The panel shows a different note for these — the "why can't it answer" one —
 * because they are the grounding rule working, and a reader who is told only
 * "that run did not finish" learns nothing about why a perfectly sensible
 * question produced nothing.
 */
export const UNGROUNDED_CODES: readonly AiErrorCode[] = ['ungrounded', 'invalid_citation']

export function useLawAsk(params: UseLawAskParams): UseLawAsk {
  const [state, setState] = useState<LawAskState>({ kind: 'idle' })
  const [busy, setBusy] = useState(false)
  const abort = useRef<AbortController | null>(null)

  /*
    The latest parameters, read through a ref by the callback below.

    Without it `ask` would be re-created on every keystroke in the converter's
    own search field (`offenceDate` and `language` are stable, but `provider`
    and `onSpent` are not), which would re-render the panel — including an
    answer the reader is halfway through — for a value the run has not started
    using yet. The run reads the ref when it starts, which is exactly the moment
    "what is on screen now" is the right answer.
  */
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

  const ask = useCallback((question: string) => {
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller

    const steps: LawStep[] = []
    let partial = ''
    setBusy(true)
    setState({ kind: 'running', steps, partial })

    // A new array and a new object each time: pushing into the one already in
    // state gives React the same reference and the progress list never repaints.
    const paint = () => {
      if (!controller.signal.aborted) setState({ kind: 'running', steps: [...steps], partial })
    }

    void (async () => {
      const [agent, registry, builtins] = await Promise.all([
        import('@/ai/agents/law'),
        import('@/ai/tools/registry'),
        import('@/ai/tools/index'),
      ])
      builtins.registerBuiltinTools()

      const p = latest.current
      if (!p.provider) throw new Error('The AI provider is not ready.')

      const result = await agent.runLawAgent({
        provider: p.provider,
        question,
        language: p.language,
        offenceDate: p.offenceDate,
        tools: registry.listTools('law'),
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
