import { useCallback, useEffect, useRef, useState } from 'react'

import type {
  BriefRefusal,
  DraftingDraft,
  DraftingQuestions,
  DraftingStep,
  InterviewAnswer,
  SuggestionKind,
} from '@/ai/agents/drafting'
import type { AiProvider } from '@/ai/provider'
import type { AiTier, Bilingual, TokenUsage } from '@/ai/types'
import type { Language } from '@/i18n'
import type { DraftValues, Lang } from '@/lib/drafting/types'
import type { DocTemplate, TemplateField } from './schema'
import { asText, readValue } from './values'

/**
 * The Drafting Studio's half of the AI layer: state, cancellation, and the
 * dynamic imports that keep the agent out of the editor's chunk.
 *
 * ### Why everything is imported at RUN time and not at module load
 *
 * `src/ai` is lazy for a privacy reason rather than a performance one
 * (`docs/AI.md`): a reader who never turns AI on never downloads the code that
 * could reach the network. `EditorPage` already mounts the panel behind
 * `React.lazy` and `useAi().enabled`, and this hook goes one step further —
 * the agent, the tool registry and the built-in tools are imported when the
 * officer presses the button, not when the panel appears. Opening the panel to
 * read what it says therefore costs nothing.
 *
 * ### One run at a time, and it is always cancellable
 *
 * A second run started over a first would leave two `AbortController`s and an
 * older result racing to land. Starting a run aborts whatever was in flight,
 * and unmounting aborts too — an editor the officer has navigated away from
 * must not be spending their tokens.
 */

export type DraftingAiState =
  | { kind: 'idle' }
  | { kind: 'running'; steps: DraftingStep[] }
  | { kind: 'questions'; result: DraftingQuestions; brief: string }
  | {
      kind: 'draft'
      result: DraftingDraft
      /**
       * The officer's values as they stood when the run STARTED — the baseline
       * the model was completing, and the `before` side of every diff.
       *
       * Held here rather than read live from the form, because the list of
       * changed fields must not rewrite itself while the officer works down it:
       * applying one field would otherwise make that field equal to its own
       * suggestion and drop its row — and the confirmation with it.
       */
      baseValues: DraftValues
    }
  | {
      kind: 'suggestion'
      fieldId: string
      before: string
      after: string
      note: Bilingual
      csmopRef: string | null
      usage: TokenUsage
      cost: number
    }
  | { kind: 'explanation'; itemId: string; text: string; usage: TokenUsage; cost: number }
  | { kind: 'refused'; refusal: BriefRefusal }
  | { kind: 'error'; message: string }

export interface UseDraftingAi {
  state: DraftingAiState
  /** True while a run is in flight, so the panel can disable its controls. */
  busy: boolean
  draft: (brief: string) => void
  /** Answer the questions of the run in `state` and draft from them. */
  answer: (answers: readonly InterviewAnswer[]) => void
  improve: (field: TemplateField, kind: SuggestionKind) => void
  explain: (itemId: string) => void
  cancel: () => void
  reset: () => void
}

export interface UseDraftingAiParams {
  template: DocTemplate
  /** Read at call time, so a run always sees what is on screen now. */
  values: DraftValues
  /** The preview's language: which issue(s) of the document to produce. */
  lang: Lang | 'bilingual'
  /** The language the officer is typing in — what "improve wording" rewrites. */
  editing: Lang
  language: Language
  devanagariDigits: boolean
  provider: AiProvider | null
  tier: AiTier
  budgetLimit: number
  /** Called after every run so the panel's budget line is not stale. */
  onSpent?: () => void
}

export function useDraftingAi(params: UseDraftingAiParams): UseDraftingAi {
  const [state, setState] = useState<DraftingAiState>({ kind: 'idle' })
  const [busy, setBusy] = useState(false)
  const abort = useRef<AbortController | null>(null)
  /**
   * The brief behind the questions currently on screen, or `null` when there
   * are none.
   *
   * `answer()` needs the brief the questions came from, and reading it out of
   * a `setState` updater — which is where it used to come from — starts the
   * run inside a function React invokes TWICE in StrictMode. `src/main.tsx`
   * renders the whole app inside one, so answering three clarifying questions
   * started two runs against the reader's own key. Only `start()`'s
   * abort-the-previous behaviour kept the second from reaching the wire, and
   * that is a coincidence to rely on rather than a design. Playwright cannot
   * see it either: it runs a production build, where StrictMode is inert.
   */
  const pendingBrief = useRef<string | null>(null)

  /*
    The latest parameters, read through a ref by the callbacks below.

    Without it every callback would be re-created on each keystroke in the form
    (`values` changes), which would re-render the whole panel — including a
    diff the officer is halfway through reviewing — for a value the run has not
    started using yet. The run reads the ref when it starts, which is exactly
    the moment "what is on screen now" is the right answer.
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

  const start = useCallback(
    (run: (signal: AbortSignal, onProgress: (step: DraftingStep) => void) => Promise<void>) => {
      abort.current?.abort()
      const controller = new AbortController()
      abort.current = controller
      const steps: DraftingStep[] = []
      setBusy(true)
      setState({ kind: 'running', steps })

      void run(controller.signal, (step) => {
        if (controller.signal.aborted) return
        steps.push(step)
        // A new array each time: pushing into the one already in state gives
        // React the same reference and the progress list never repaints.
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
      import('@/ai/agents/drafting'),
      import('@/ai/tools/registry'),
      import('@/ai/tools/index'),
    ])
    builtins.registerBuiltinTools()
    return { agent, tools: registry.listTools(['draft', 'utils']) }
  }

  const common = () => {
    const p = latest.current
    if (!p.provider) throw new Error('The AI provider is not ready.')
    return {
      provider: p.provider,
      language: p.language,
      tier: p.tier,
      budgetLimit: p.budgetLimit,
      template: p.template,
    }
  }

  const runDraft = useCallback(
    (brief: string, answers: readonly InterviewAnswer[]) => {
      start(async (signal, onProgress) => {
        const { agent, tools } = await load()
        const p = latest.current
        const base = common()
        // Captured before the run, not after: this is the baseline the model
        // was given and the `before` side of every diff the officer reviews.
        const baseValues = p.values
        const result = await agent.runDraftingAgent({
          provider: base.provider,
          brief,
          templateId: p.template.id,
          lang: p.lang,
          language: p.language,
          answers,
          currentValues: p.values,
          devanagariDigits: p.devanagariDigits,
          tools,
          tier: base.tier,
          budgetLimit: base.budgetLimit,
          signal,
          onProgress,
        })
        if (signal.aborted) return

        if (result.status === 'refused') {
          pendingBrief.current = null
          setState({ kind: 'refused', refusal: result.refusal })
        } else if (result.status === 'error') {
          pendingBrief.current = null
          setState({ kind: 'error', message: result.message })
        } else if (result.status === 'questions') {
          pendingBrief.current = brief
          setState({ kind: 'questions', result, brief })
        } else {
          pendingBrief.current = null
          setState({ kind: 'draft', result, baseValues })
        }
      })
    },
    [start],
  )

  const draft = useCallback((brief: string) => runDraft(brief, []), [runDraft])

  const answer = useCallback(
    (answers: readonly InterviewAnswer[]) => {
      const brief = pendingBrief.current
      // Only ever from the questions state. A second press while the first run
      // is in flight would otherwise re-ask the same brief.
      if (brief === null) return
      pendingBrief.current = null
      runDraft(brief, answers)
    },
    [runDraft],
  )

  const improve = useCallback(
    (field: TemplateField, kind: SuggestionKind) => {
      start(async (signal, onProgress) => {
        const { agent, tools } = await load()
        const p = latest.current
        const base = common()
        // Exactly the text the diff will show, and nothing else from the draft.
        const before = asText(readValue(p.values, field, p.editing))
        const result = await agent.improveWording({
          provider: base.provider,
          template: base.template,
          field,
          text: before,
          lang: p.editing,
          language: p.language,
          kind,
          tools,
          tier: base.tier,
          budgetLimit: base.budgetLimit,
          signal,
          onProgress,
        })
        if (signal.aborted) return

        if (result.status === 'refused') setState({ kind: 'refused', refusal: result.refusal })
        else if (result.status === 'error') setState({ kind: 'error', message: result.message })
        else {
          setState({
            kind: 'suggestion',
            fieldId: field.id,
            before,
            after: result.text,
            note: result.note,
            csmopRef: result.csmopRef,
            usage: result.usage,
            cost: result.cost,
          })
        }
      })
    },
    [start],
  )

  const explain = useCallback(
    (itemId: string) => {
      start(async (signal, onProgress) => {
        const { agent, tools } = await load()
        const p = latest.current
        const base = common()
        const result = await agent.explainChecklistFailure({
          provider: base.provider,
          template: base.template,
          itemId,
          values: p.values,
          lang: p.lang === 'bilingual' ? p.editing : p.lang,
          language: p.language,
          tools,
          tier: base.tier,
          budgetLimit: base.budgetLimit,
          signal,
          onProgress,
        })
        if (signal.aborted) return

        if (result.status === 'error') setState({ kind: 'error', message: result.message })
        else {
          setState({
            kind: 'explanation',
            itemId,
            text: result.text,
            usage: result.usage,
            cost: result.cost,
          })
        }
      })
    },
    [start],
  )

  const cancel = useCallback(() => {
    abort.current?.abort()
    abort.current = null
    pendingBrief.current = null
    setBusy(false)
    setState({ kind: 'idle' })
  }, [])

  const reset = useCallback(() => {
    pendingBrief.current = null
    setState({ kind: 'idle' })
  }, [])

  return { state, busy, draft, answer, improve, explain, cancel, reset }
}
