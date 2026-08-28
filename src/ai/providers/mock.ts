import type { AiProvider } from '../provider'
import {
  AiError,
  EMPTY_USAGE,
  type AiErrorCode,
  type AiProviderId,
  type ChatParams,
  type ChatResult,
  type ContentPart,
  type ProviderCapabilities,
  type StopReason,
  type TokenUsage,
} from '../types'

/**
 * The provider every test runs against.
 *
 * It is scripted rather than generative: a fixture lists the turns it will
 * return, in order, and the agent loop is exercised against them. That makes
 * the tool-call loop, the step cap, argument recovery, cancellation, the
 * grounding rule and the budget stop all deterministic — none of them depends
 * on a model deciding to behave a particular way.
 *
 * It records every request it was given (`calls`), which is how the tests
 * assert on prompt structure: cache breakpoints, tool order, whether the
 * validation error was fed back exactly once.
 */

export interface MockTurn {
  content: ContentPart[]
  stopReason: StopReason
  usage?: Partial<TokenUsage>
  /** Throw instead of answering — simulates a provider-side failure. */
  throwError?: { code: AiErrorCode; message: string }
  /** Milliseconds before the turn resolves; lets a test cancel mid-flight. */
  delayMs?: number
}

export interface MockScript {
  id: string
  turns: readonly MockTurn[]
  capabilities?: Partial<ProviderCapabilities>
  /** Repeat the last turn forever instead of running out — for step-cap tests. */
  repeatLast?: boolean
}

const DEFAULT_CAPABILITIES: ProviderCapabilities = {
  streaming: true,
  tools: true,
  jsonMode: true,
  maxContext: 200_000,
  localOnly: true,
}

/** Resolves after `ms`, or rejects the moment the signal aborts. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AiError('aborted', 'Cancelled.'))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    function onAbort() {
      clearTimeout(timer)
      reject(new AiError('aborted', 'Cancelled.'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export class MockProvider implements AiProvider {
  readonly id: AiProviderId = 'mock'
  readonly capabilities: ProviderCapabilities
  /** Every ChatParams this provider was handed, in order. */
  readonly calls: ChatParams[] = []

  private readonly script: MockScript
  private turnIndex = 0

  constructor(script: MockScript) {
    this.script = script
    this.capabilities = { ...DEFAULT_CAPABILITIES, ...script.capabilities }
  }

  /** How many turns have been consumed. Asserted by the step-cap tests. */
  get turnsTaken(): number {
    return this.turnIndex
  }

  async chat(params: ChatParams): Promise<ChatResult> {
    this.calls.push(params)

    const turn = this.nextTurn()
    if (!turn) {
      throw new AiError(
        'provider',
        `Mock script "${this.script.id}" ran out of turns after ${this.turnIndex}.`,
      )
    }

    if (turn.delayMs) await sleep(turn.delayMs, params.signal)
    if (params.signal?.aborted) throw new AiError('aborted', 'Cancelled.')
    if (turn.throwError) throw new AiError(turn.throwError.code, turn.throwError.message)

    const usage: TokenUsage = { ...EMPTY_USAGE, ...turn.usage }

    for (const part of turn.content) {
      if (part.type === 'text') params.onEvent?.({ type: 'token', text: part.text })
    }
    params.onEvent?.({ type: 'usage', usage, model: this.modelName(params) })

    return {
      content: turn.content,
      stopReason: turn.stopReason,
      usage,
      model: this.modelName(params),
    }
  }

  private modelName(params: ChatParams): string {
    return params.model ?? `mock/${this.script.id}`
  }

  private nextTurn(): MockTurn | undefined {
    const turns = this.script.turns
    if (this.turnIndex < turns.length) return turns[this.turnIndex++]
    if (this.script.repeatLast && turns.length > 0) {
      this.turnIndex++
      return turns[turns.length - 1]
    }
    return undefined
  }
}
