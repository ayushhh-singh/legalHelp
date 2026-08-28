import { EMPTY_CONTEXT, validateCitations, type BuiltContext } from './context'
import { errorMessage, parseJson, stringifyToolOutput } from './json'
import { PROMPT_VERSIONS } from './prompts'
import { TASK_DEFAULTS, type AgentId } from './models'
import type { AiProvider } from './provider'
import { toolSpecs, validateToolInput, type RegisteredTool } from './tools/registry'
import {
  AiError,
  EMPTY_USAGE,
  type AiErrorCode,
  type AiEventHandler,
  type AiOutputMeta,
  type AiTier,
  type ContentPart,
  type JsonSchemaRequest,
  type Message,
  type SystemBlock,
  type TokenUsage,
  type ToolResult,
  type ToolSpec,
} from './types'
import { addUsage, budgetState, estimateCost, recordUsage, type BudgetState } from './usage'

import type { Language } from '@/i18n'

/**
 * The agent loop. No framework — a `for` loop with a step cap, argument
 * validation, per-tool timeouts, a token budget checked before every call, and
 * a grounding rule that fails the run closed.
 *
 * The reason it is written by hand rather than pulled from a library: every one
 * of those five is a correctness property this app cannot delegate. An officer
 * acting on a section number needs the number to have come from a table, and
 * "the framework probably handles it" is not an answer anyone can audit.
 *
 * GROUNDING. Each tool result gets a short handle — `T1`, `T2`, … in execution
 * order. When the agent's policy says `groundedRequired`, the final answer must
 * cite at least one of them, and every numbered provision it states must appear
 * in a context snippet it cited. An answer that does neither ends the run with
 * `error: ungrounded` and is never shown.
 */

export const DEFAULT_MAX_STEPS = 8
export const DEFAULT_TOOL_TIMEOUT_MS = 5_000

/** Injected so a test can exercise the budget stop without touching Dexie. */
export interface UsageLedger {
  state: (limit: number) => Promise<BudgetState>
  record: (model: string, usage: TokenUsage) => Promise<void>
}

const dexieLedger: UsageLedger = {
  state: (limit) => budgetState(limit),
  record: async (model, usage) => {
    await recordUsage(model, usage)
  },
}

export interface RunAgentParams {
  agentId: AgentId
  provider: AiProvider
  /** Usually `listTools(scope)`. Passed in so a test can register its own. */
  tools: readonly RegisteredTool[]
  system: SystemBlock[]
  userMessage: string
  maxSteps?: number
  toolTimeoutMs?: number
  onEvent?: AiEventHandler
  signal?: AbortSignal
  jsonSchema?: JsonSchemaRequest
  /** Defaults to the agent's row in TASK_DEFAULTS. */
  groundedRequired?: boolean
  language?: Language
  context?: BuiltContext
  model?: string
  tier?: AiTier
  /** Monthly token ceiling. `null` disables the check (tests, Tier 0). */
  budgetLimit?: number | null
  ledger?: UsageLedger
  now?: () => Date
}

export interface Grounding {
  required: boolean
  /** Every tool result the run produced. */
  toolResultIds: string[]
  /** The subset the final answer actually cited. */
  citedToolResultIds: string[]
  citedContextIndices: number[]
}

export interface AgentRun {
  ok: boolean
  text: string
  json?: unknown
  error?: { code: AiErrorCode; message: string }
  steps: number
  usage: TokenUsage
  toolResults: ToolResult[]
  grounding: Grounding
  meta: AiOutputMeta
}

const TOOL_CITATION_PATTERN = /\[T(\d{1,3})\]/g

export async function runAgent(params: RunAgentParams): Promise<AgentRun> {
  const {
    agentId,
    provider,
    tools,
    system,
    userMessage,
    onEvent,
    signal,
    jsonSchema,
    context = EMPTY_CONTEXT,
    tier = 'byok',
    ledger = dexieLedger,
    now = () => new Date(),
  } = params

  const defaults = TASK_DEFAULTS[agentId]
  const maxSteps = params.maxSteps ?? defaults.maxSteps ?? DEFAULT_MAX_STEPS
  const groundedRequired = params.groundedRequired ?? defaults.groundedRequired
  const toolTimeoutMs = params.toolTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS
  const model = params.model ?? defaults.model
  const budgetLimit = params.budgetLimit === undefined ? null : params.budgetLimit

  const specs: ToolSpec[] = tools.length > 0 ? specsFor(tools) : []
  const messages: Message[] = [{ role: 'user', content: [{ type: 'text', text: userMessage }] }]
  const toolResults: ToolResult[] = []
  /** One recovery per tool. A second bad call from the same tool ends the run. */
  const invalidAttempts = new Map<string, number>()

  let usage: TokenUsage = { ...EMPTY_USAGE }
  let steps = 0
  let usedModel = model

  const finish = (over: Partial<AgentRun> & { ok: boolean }): AgentRun => {
    const run: AgentRun = {
      text: '',
      steps,
      usage,
      toolResults,
      grounding: {
        required: groundedRequired,
        toolResultIds: toolResults.map((result) => result.id),
        citedToolResultIds: [],
        citedContextIndices: [],
      },
      meta: {
        agentId,
        model: usedModel,
        promptVersion: PROMPT_VERSIONS[agentId],
        tier,
        contextIds: context.ids,
        tokens: usage,
        cost: estimateCost(usedModel, usage),
        cached: false,
        at: now().toISOString(),
      },
      ...over,
    }
    if (run.error) onEvent?.({ type: 'error', code: run.error.code, message: run.error.message })
    return run
  }

  const fail = (code: AiErrorCode, message: string): AgentRun =>
    finish({ ok: false, error: { code, message } })

  for (steps = 1; steps <= maxSteps; steps += 1) {
    if (signal?.aborted) return fail('aborted', 'The run was cancelled.')

    if (budgetLimit !== null) {
      const budget = await ledger.state(budgetLimit)
      if (budget.exhausted) {
        return fail(
          'budget_exhausted',
          `The monthly budget of ${budget.limit.toLocaleString()} tokens is used up.`,
        )
      }
    }

    let turn
    try {
      turn = await provider.chat({
        system,
        // A snapshot, not the live array: a provider must not be able to see
        // (or be confused by) turns appended after its request was built.
        messages: messages.map((message) => ({ ...message })),
        model,
        ...(specs.length > 0 ? { tools: specs } : {}),
        ...(jsonSchema ? { jsonSchema } : {}),
        ...(signal ? { signal } : {}),
        ...(onEvent ? { onEvent } : {}),
      })
    } catch (error) {
      if (error instanceof AiError) return fail(error.code, error.message)
      return fail('provider', errorMessage(error))
    }

    usedModel = turn.model
    usage = addUsage(usage, turn.usage)
    await ledger.record(turn.model, turn.usage)

    messages.push({ role: 'assistant', content: turn.content })

    const calls = turn.content.filter(
      (part): part is Extract<ContentPart, { type: 'tool_use' }> => part.type === 'tool_use',
    )

    if (calls.length === 0) {
      return finalise({
        turnContent: turn.content,
        stopReason: turn.stopReason,
      })
    }

    // Anthropic may return several tool_use blocks in one turn. All of their
    // results go back in ONE user message: splitting them teaches the model to
    // stop calling tools in parallel.
    const resultParts: ContentPart[] = []

    for (const call of calls) {
      if (signal?.aborted) return fail('aborted', 'The run was cancelled.')
      onEvent?.({ type: 'toolCall', call: { id: call.id, name: call.name, input: call.input } })

      const tool = findTool(tools, call.name)
      if (!tool) {
        const message = `Unknown tool "${call.name}". Available: ${tools.map((t) => t.def.name).join(', ')}.`
        const attempts = (invalidAttempts.get(call.name) ?? 0) + 1
        invalidAttempts.set(call.name, attempts)
        if (attempts > 1) return fail('unknown_tool', message)
        resultParts.push({ type: 'tool_result', toolUseId: call.id, content: message, isError: true })
        continue
      }

      const validation = validateToolInput(tool, call.input)
      if (!validation.ok) {
        const attempts = (invalidAttempts.get(call.name) ?? 0) + 1
        invalidAttempts.set(call.name, attempts)
        if (attempts > 1) {
          // The model has already been shown the error once. A second failure
          // is a loop, not a slip.
          return fail('invalid_args', validation.message)
        }
        resultParts.push({
          type: 'tool_result',
          toolUseId: call.id,
          content: validation.message,
          isError: true,
        })
        continue
      }

      const result = await executeTool({
        tool,
        call,
        input: validation.value,
        id: `T${toolResults.length + 1}`,
        language: params.language ?? 'en',
        timeoutMs: tool.def.timeoutMs ?? toolTimeoutMs,
        ...(signal ? { signal } : {}),
      })

      toolResults.push(result)
      onEvent?.({ type: 'toolResult', result })
      resultParts.push({
        type: 'tool_result',
        toolUseId: call.id,
        // The handle is prefixed so the model can cite it without being told
        // the id out of band.
        content: `[${result.id}] ${result.ok ? stringifyToolOutput(result.output) : (result.error ?? 'failed')}`,
        ...(result.ok ? {} : { isError: true }),
      })
    }

    messages.push({ role: 'user', content: resultParts })
  }

  steps = maxSteps
  return fail('max_steps', `The agent did not finish within ${maxSteps} steps.`)

  /* ---------------------------------------------------------------- */

  function finalise({
    turnContent,
    stopReason,
  }: {
    turnContent: ContentPart[]
    stopReason: string
  }): AgentRun {
    const text = turnContent
      .filter((part): part is Extract<ContentPart, { type: 'text' }> => part.type === 'text')
      .map((part) => part.text)
      .join('')
      .trim()

    if (stopReason === 'refusal') {
      return fail('provider', 'The model declined to answer this request.')
    }

    const citedToolResultIds = [...text.matchAll(TOOL_CITATION_PATTERN)]
      .map((match) => `T${match[1] ?? ''}`)
      .filter((id) => toolResults.some((result) => result.id === id))

    if (groundedRequired) {
      if (toolResults.length === 0) {
        return fail(
          'ungrounded',
          'The answer cites no tool result because no tool was called. Nothing supports it.',
        )
      }
      if (citedToolResultIds.length === 0) {
        return fail('ungrounded', 'The answer cites none of the tool results the run produced.')
      }
    }

    const citations = validateCitations(text, context, { requireCitation: groundedRequired })
    if (!citations.ok) {
      return fail('invalid_citation', citations.problems.map((problem) => problem.detail).join(' '))
    }

    let json: unknown
    if (jsonSchema) {
      try {
        json = parseJson(text)
      } catch {
        return fail('provider', 'A structured answer was requested but the response was not JSON.')
      }
    }

    onEvent?.({ type: 'final', text, ...(json !== undefined ? { json } : {}), stopReason: 'end_turn' })

    return finish({
      ok: true,
      text,
      ...(json !== undefined ? { json } : {}),
      grounding: {
        required: groundedRequired,
        toolResultIds: toolResults.map((result) => result.id),
        citedToolResultIds: [...new Set(citedToolResultIds)],
        citedContextIndices: citations.cited,
      },
    })
  }
}

function specsFor(tools: readonly RegisteredTool[]): ToolSpec[] {
  const names = new Set(tools.map((tool) => tool.def.name))
  // Reuse the registry's wire mapping so the cache breakpoint and the sort
  // order are decided in exactly one place.
  return toolSpecs().filter((spec) => names.has(spec.name))
}

function findTool(tools: readonly RegisteredTool[], name: string): RegisteredTool | undefined {
  return tools.find((tool) => tool.def.name === name) ?? undefined
}

interface ExecuteToolParams {
  tool: RegisteredTool
  call: { id: string; name: string }
  input: unknown
  id: string
  language: Language
  timeoutMs: number
  signal?: AbortSignal
}

/**
 * A handler that hangs must not hang the run. The timeout aborts the context
 * signal the handler was given and reports a failed tool result, which the
 * model can then work around — a failure it can see beats a spinner it cannot.
 */
async function executeTool(params: ExecuteToolParams): Promise<ToolResult> {
  const { tool, call, input, id, language, timeoutMs, signal } = params
  const started = Date.now()
  const controller = new AbortController()
  const onOuterAbort = () => controller.abort()
  signal?.addEventListener('abort', onOuterAbort, { once: true })

  // A flag rather than a racing rejection: a handler that rejects on its own
  // abort would otherwise win the race and the run would report the handler's
  // wording instead of "timed out", which is the fact the model needs.
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  try {
    const output = await Promise.race([
      (tool.def.handler as (i: unknown, c: { language: Language; signal: AbortSignal }) => Promise<unknown>)(
        input,
        { language, signal: controller.signal },
      ),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () => reject(abortReason()), { once: true })
      }),
    ])
    return { id, toolCallId: call.id, name: call.name, ok: true, output, ms: Date.now() - started }
  } catch (error) {
    return {
      id,
      toolCallId: call.id,
      name: call.name,
      ok: false,
      output: null,
      error: timedOut ? abortReason().message : errorMessage(error),
      ms: Date.now() - started,
    }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onOuterAbort)
  }

  function abortReason(): AiError {
    return timedOut
      ? new AiError('tool_timeout', `${tool.def.name} did not answer in ${timeoutMs} ms.`)
      : new AiError('aborted', `${tool.def.name} was cancelled.`)
  }
}
