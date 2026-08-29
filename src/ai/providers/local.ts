import { DEFAULT_LOCAL_MODEL, findLocalModel } from '../local/catalogue'
import { engineGenerate, type LocalGenerate } from '../local/engine'
import {
  LOCAL_MAX_TOOL_STEPS,
  flattenSystem,
  parseLocalTurn,
  toContent,
  toPromptMessages,
  toolProtocolInstruction,
  toolStepsUsed,
  type LocalMessage,
  type ParseMode,
} from '../local/protocol'
import type { AiProvider } from '../provider'
import {
  EMPTY_USAGE,
  type AiProviderId,
  type ChatParams,
  type ChatResult,
  type ProviderCapabilities,
} from '../types'

/**
 * Tier 0 — the model runs inside the browser, and nothing leaves the device.
 *
 * This is the only provider in the app whose `capabilities.localOnly` is true,
 * and that flag is load-bearing rather than informational: the consent modal
 * and the permanent AI banner both branch on it, so choosing this tier changes
 * what the reader is told is happening to their words. It is true here because
 * it is true — there is no `fetch` in this file, in `local/engine.ts`, or in
 * `local/protocol.ts`, and the only network traffic the tier ever produces is
 * the one-time model download the reader starts by hand in Settings.
 *
 * TOOLS ARE EMULATED. A 1.5B model has no tool-calling wire format, so the
 * protocol is taught in the prompt and read back by `local/protocol.ts` —
 * strictly, and with the two-step cap this tier needs. Everything above the
 * provider seam is unchanged: `runAgent` receives the same `tool_use` content
 * parts it receives from Anthropic, and cannot tell which tier produced them.
 *
 * WHAT THIS TIER IS NOT. `LOCAL_MODELS` tops out around 2.5 GB, and a model
 * that size does not write administrative Hindi, does not reliably plan four
 * lookups deep, and will occasionally answer a question it should have looked
 * up. Every one of those is caught downstream — by the grounding rule, by
 * `validateCitations`, and by each agent's own code-side re-derivation — which
 * is exactly why those checks were written as code rather than as instructions.
 * On this tier they fail closed more often, and that is the tier working.
 */

export interface LocalOptions {
  /** A model id from `src/ai/local/catalogue.ts`. */
  modelId?: string
  /**
   * Injected by the tests. Production uses the WebGPU engine; a scripted stub
   * exercises the whole provider with no GPU and no download, which is what
   * makes the protocol testable at all.
   */
  generate?: LocalGenerate
}

/**
 * The ceiling on one turn.
 *
 * Not the model's context window — this is OUTPUT, and on a device generating
 * perhaps twenty tokens a second a 4,096-token answer is three minutes of
 * watching. A tool call is under a hundred tokens and a two-sentence grounded
 * answer is a few hundred; 1,024 leaves room for a Devanagari answer, which
 * costs markedly more tokens than its English twin.
 */
export const LOCAL_MAX_OUTPUT_TOKENS = 1_024

export class LocalProvider implements AiProvider {
  readonly id: AiProviderId = 'local'

  private readonly modelId: string
  private readonly generate: LocalGenerate

  constructor(options: LocalOptions = {}) {
    this.modelId = options.modelId ?? DEFAULT_LOCAL_MODEL
    this.generate = options.generate ?? engineGenerate(this.modelId)
  }

  get capabilities(): ProviderCapabilities {
    const model = findLocalModel(this.modelId)
    return {
      streaming: true,
      // True by emulation, and the distinction matters to nobody above this
      // line: what a caller asks of `tools` is that a `tool_use` part can come
      // back, and one can.
      tools: true,
      jsonMode: true,
      maxContext: model?.contextWindow ?? 4_096,
      localOnly: true,
    }
  }

  async chat(params: ChatParams): Promise<ChatResult> {
    const tools = params.tools ?? []
    const used = toolStepsUsed(params.messages)
    const stepsLeft = tools.length > 0 ? Math.max(0, LOCAL_MAX_TOOL_STEPS - used) : 0

    // A schema-constrained turn is never a tool turn: the caller has asked for
    // one specific object back, and offering the tool envelope alongside it
    // would be asking for two different objects at once. `src/ai/agents/law.ts`
    // relies on exactly this — its answering pass passes `tools: []` and a
    // schema, and must get the schema's own shape back unwrapped.
    const schemaTurn = Boolean(params.jsonSchema)
    const mode: ParseMode = schemaTurn ? 'raw' : stepsLeft > 0 ? 'tools' : 'answer'

    const system = schemaTurn
      ? flattenSystem(params.system)
      : [flattenSystem(params.system), toolProtocolInstruction(tools, { stepsLeft })]
          .filter((part) => part.length > 0)
          .join('\n\n')

    const messages: LocalMessage[] = [
      ...(system ? ([{ role: 'system', content: system }] as LocalMessage[]) : []),
      ...toPromptMessages(params.messages),
    ]

    const result = await this.generate({
      messages,
      maxTokens: Math.min(params.maxTokens ?? LOCAL_MAX_OUTPUT_TOKENS, LOCAL_MAX_OUTPUT_TOKENS),
      // Constrained decoding is what makes the envelope arrive as JSON at all
      // on a small model. It is switched off for a prose turn, where forcing
      // JSON would be forcing the wrong shape.
      jsonMode: !schemaTurn,
      ...(params.jsonSchema ? { jsonSchema: JSON.stringify(params.jsonSchema.schema) } : {}),
      /*
        Every text delta becomes a `token` event, on a structured turn as much
        as on a prose one, because that is what `wire.ts` does for Tiers 1 and 2
        and a provider that streams differently is a provider a caller has to
        know about.

        This once suppressed tokens whenever a `jsonSchema` was asked for, on
        the reasoning that a half-arrived envelope would paint `{"answer": "Sec`
        on screen. The reasoning was wrong in both directions: no surface in
        this app renders raw token text, and the ONE consumer of these events —
        `src/ai/agents/law.ts`'s answering pass — passes a jsonSchema and reads
        the partial JSON with `partialAnswerText()`, a function that exists for
        exactly this. So the suppression silenced the only surface that streams,
        on the slowest tier, where a run is half a minute rather than three
        seconds and progressive text is worth most.
      */
      ...(params.onEvent ? { onToken: (text: string) => params.onEvent?.({ type: 'token', text }) } : {}),
      ...(params.signal ? { signal: params.signal } : {}),
    })

    const turn = parseLocalTurn(result.text, mode)
    const content = toContent(turn, `local_tool_${used + 1}`)

    const usage = { ...EMPTY_USAGE, ...result.usage }
    params.onEvent?.({ type: 'usage', usage, model: this.modelId })

    return {
      content,
      // A parsed tool call is a `tool_use` stop, whatever the decoder said —
      // `runAgent` reads `stopReason` only to detect truncation and refusal,
      // and a complete envelope that happened to end on the token ceiling is
      // neither.
      stopReason: turn.kind === 'tool' ? 'tool_use' : result.stopReason,
      usage,
      model: this.modelId,
    }
  }
}
