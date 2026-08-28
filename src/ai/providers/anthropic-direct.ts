import { TASK_DEFAULTS, resolveModel, type Effort } from '../models'
import type { AiProvider } from '../provider'
import { ANTHROPIC_KEY_ID, readSecret } from '../secrets'
import {
  AiError,
  type AiProviderId,
  type ChatParams,
  type ChatResult,
  type ProviderCapabilities,
} from '../types'
import { buildMessagesBody, parseMessageResponse, postJson, streamMessages, ANTHROPIC_VERSION } from './wire'

/**
 * Tier 1 — bring your own key.
 *
 * The browser talks to api.anthropic.com directly. There is no server of ours
 * in the path, which is the point: the reader's prompts go to Anthropic under
 * the reader's own account, and this project never holds a key, a log or a
 * bill. `anthropic-dangerous-direct-browser-access` is Anthropic's opt-in for
 * exactly this arrangement — it relaxes their CORS policy; it does not relax
 * anything about who can see the traffic.
 *
 * WHAT THE READER IS AGREEING TO, and what the consent modal says plainly:
 * every prompt, every tool result the agent feeds back, and the reader's own
 * question leave the device and reach Anthropic. The classified-content rule
 * on the AI banner is the only control that matters here.
 *
 * The key is read from the encrypted vault on each request rather than held in
 * a field, so the kill switch takes effect on the very next call.
 */

export const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages'

export interface AnthropicDirectOptions {
  model: string
  effort?: Effort
  /** Injected by tests; production uses the global. */
  fetchImpl?: typeof globalThis.fetch
  /** Injected by tests so no vault is needed to assert on headers. */
  readKey?: () => Promise<string | null>
}

export class AnthropicDirectProvider implements AiProvider {
  readonly id: AiProviderId = 'anthropic-direct'

  private readonly options: AnthropicDirectOptions

  constructor(options: AnthropicDirectOptions) {
    this.options = options
  }

  get capabilities(): ProviderCapabilities {
    const model = resolveModel(this.options.model)
    return {
      streaming: true,
      tools: true,
      jsonMode: model.structuredOutput,
      maxContext: model.maxContext,
      localOnly: false,
    }
  }

  async chat(params: ChatParams): Promise<ChatResult> {
    const key = await this.key()
    const body = buildMessagesBody(
      { ...params, model: params.model ?? this.options.model },
      { effort: this.options.effort ?? TASK_DEFAULTS['law-explain'].effort, stream: true },
    )

    return streamMessages({
      url: ANTHROPIC_MESSAGES_URL,
      headers: headersFor(key),
      body,
      ...(params.signal ? { signal: params.signal } : {}),
      ...(params.onEvent ? { onEvent: params.onEvent } : {}),
      ...(this.options.fetchImpl ? { fetchImpl: this.options.fetchImpl } : {}),
    })
  }

  /**
   * The settings screen's "test connection". Exactly ONE request, sent only on
   * an explicit click, with `max_tokens: 1` — enough to prove the key and the
   * headers work and nothing more. Thinking is switched off for the ping
   * because an adaptive-thinking model cannot answer inside one token.
   */
  async testConnection(signal?: AbortSignal): Promise<ChatResult> {
    const key = await this.key()
    const model = resolveModel(this.options.model)

    const payload = await postJson({
      url: ANTHROPIC_MESSAGES_URL,
      headers: headersFor(key),
      body: {
        model: model.id,
        max_tokens: 1,
        messages: [{ role: 'user', content: [{ type: 'text', text: 'ping' }] }],
        ...(model.adaptiveThinking ? { thinking: { type: 'disabled' } } : {}),
      },
      ...(signal ? { signal } : {}),
      ...(this.options.fetchImpl ? { fetchImpl: this.options.fetchImpl } : {}),
    })

    return parseMessageResponse(payload, model.id)
  }

  private async key(): Promise<string> {
    const read = this.options.readKey ?? (() => readSecret(ANTHROPIC_KEY_ID))
    const key = await read()
    if (!key) {
      throw new AiError('no_key', 'No API key is stored on this device.')
    }
    return key
  }
}

/**
 * Exported so the Playwright privacy test can assert on the exact header set:
 * a key, a pinned API version, and the direct-browser-access opt-in. Nothing
 * identifying the reader or this app is added.
 */
export function headersFor(key: string): Record<string, string> {
  return {
    'x-api-key': key,
    'anthropic-version': ANTHROPIC_VERSION,
    'anthropic-dangerous-direct-browser-access': 'true',
  }
}
