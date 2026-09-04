import { useCallback, useEffect, useRef, useState } from 'react'

import type { BriefRefusal } from '@/ai/agents/drafting'
import type { ModifyProposal } from '@/ai/agents/modify'
import type { ModifyStep } from '@/ai/agents/modify-actions'
import type { AiProvider } from '@/ai/provider'
import type { AiTier } from '@/ai/types'
import type { Language } from '@/i18n'
import type { OfficialDoc } from '@/lib/drafting/model'
import type { Lang } from '@/lib/drafting/types'
import type { RetrievedSnippet } from '@/lib/retrieval'
import type { DocTemplate } from '../schema'

/**
 * The editor's half of modify-by-instruction.
 *
 * The same shape as `useDraftingAi` and `useIntakeAi`: one run at a time,
 * always cancellable, unmount aborts, and `@/ai/agents/modify` is
 * dynamic-imported when the button is pressed. The agent module pulls the
 * renderer, the checklist evaluator and the proposal diff, so importing it at
 * module load would put all three into the editor's chunk for a reader who
 * never turns AI on.
 *
 * ### The proposal is held here, and the document is not
 *
 * `state.proposal` is a list of decisions. Applying it is the caller's — the
 * panel calls `applyProposal`, snapshots a version and writes the document —
 * because that sequence must be one act, and a hook that did it would own a
 * write the panel has to be able to sequence against its own autosave.
 */

export type ModifyAiState =
  | { kind: 'idle' }
  | { kind: 'running'; steps: ModifyStep[] }
  | { kind: 'proposal'; result: ModifyProposal }
  | { kind: 'refused'; refusal: BriefRefusal }
  | { kind: 'error'; message: string }

export interface UseModifyAiParams {
  doc: OfficialDoc
  template: DocTemplate
  lang: Lang
  language: Language
  devanagariDigits: boolean
  provider: AiProvider | null
  tier: AiTier
  budgetLimit: number
  onSpent?: () => void
}

export interface UseModifyAi {
  state: ModifyAiState
  busy: boolean
  run: (args: {
    instruction: string
    scope?: ReadonlySet<number>
    snippets?: readonly RetrievedSnippet[]
  }) => void
  cancel: () => void
  reset: () => void
}

export function useModifyAi(params: UseModifyAiParams): UseModifyAi {
  const [state, setState] = useState<ModifyAiState>({ kind: 'idle' })
  const [busy, setBusy] = useState(false)
  const abort = useRef<AbortController | null>(null)

  /*
    The latest parameters, read at RUN time.

    `doc` changes on every keystroke in the editor, so without this every
    callback would be rebuilt on each one — re-rendering a proposal the officer
    is halfway through deciding. Reading the ref when the run STARTS is exactly
    the moment "the document as it stands" is the right answer.
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

  const run = useCallback<UseModifyAi['run']>((args) => {
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    const steps: ModifyStep[] = []
    setBusy(true)
    setState({ kind: 'running', steps })

    void (async () => {
      const current = latest.current
      if (!current.provider) throw new Error('The AI provider is not ready.')
      const { runModifyAgent } = await import('@/ai/agents/modify')
      const result = await runModifyAgent({
        provider: current.provider,
        doc: current.doc,
        template: current.template,
        instruction: args.instruction,
        lang: current.lang,
        language: current.language,
        devanagariDigits: current.devanagariDigits,
        ...(args.scope ? { scope: args.scope } : {}),
        ...(args.snippets ? { snippets: args.snippets } : {}),
        tier: current.tier,
        budgetLimit: current.budgetLimit,
        signal: controller.signal,
        onProgress: (step) => {
          if (controller.signal.aborted) return
          steps.push(step)
          setState({ kind: 'running', steps: [...steps] })
        },
      })
      if (controller.signal.aborted) return
      if (result.status === 'refused') setState({ kind: 'refused', refusal: result.refusal })
      else if (result.status === 'error') setState({ kind: 'error', message: result.message })
      else setState({ kind: 'proposal', result })
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

  return { state, busy, run, cancel, reset }
}
