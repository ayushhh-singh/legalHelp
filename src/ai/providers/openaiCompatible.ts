import type { AiProvider } from '../provider'
import { OPENAI_KEY_ID, readSecret } from '../secrets'
import {
  AiError,
  type AiProviderId,
  type ChatParams,
  type ChatResult,
  type ProviderCapabilities,
} from '../types'
import {
  buildChatCompletionsBody,
  DEFAULT_MAX_TOKENS,
  parseChatCompletion,
  postJson,
  streamChatCompletions,
} from './wire'

/**
 * The OpenAI-compatible tier.
 *
 * One provider for every endpoint that speaks `POST /chat/completions` — Google
 * AI Studio's compatibility layer, Groq, OpenRouter, a local Ollama, a
 * self-hosted vLLM. The reader supplies a base URL, a model name and (usually)
 * a key; nothing about which service it is reaches this file, and nothing needs
 * to.
 *
 * ### Why it exists at all in an app with three tiers already
 *
 * Because the other three each ask the reader for something they may not have.
 * Tier 0 needs a machine with WebGPU and a gigabyte of disk. Tier 1 needs a
 * paid Anthropic account. Tier 2 needs an operator with credits. An officer with
 * an ordinary laptop and a free Google AI Studio key has none of those, and the
 * AI layer would be unreachable for them — which for a free, no-accounts app is
 * the wrong failure. The consent notice names the free options rather than
 * leaving the reader to find them.
 *
 * ### Capability flags are HONEST, and that is a design constraint
 *
 * `capabilities` is not a wish. `tools` is false unless the reader has said the
 * endpoint supports tool calling, and when it is false the agent is told so and
 * downgrades to JSON mode with the tool list folded into the prompt — visibly,
 * in `capabilityNote()`, rather than by quietly dropping the tools and letting
 * the model hallucinate a call it was never offered. An endpoint that claims
 * more than it does is the failure mode this whole tier is exposed to, so the
 * app claims less and says why.
 */

export const OPENAI_CHAT_PATH = '/chat/completions'

export type OpenAiCapability = 'tools' | 'json'

export interface OpenAiCompatibleOptions {
  /** The endpoint's base URL, without `/chat/completions`. */
  baseUrl: string
  /** The model name exactly as that endpoint spells it. Never resolved here. */
  model: string
  /** What the reader says the endpoint supports. Defaults to neither. */
  supports?: readonly OpenAiCapability[]
  maxTokens?: number
  /** Injected by tests; production uses the global. */
  fetchImpl?: typeof globalThis.fetch
  /** Injected by tests so no vault is needed to assert on headers. */
  readKey?: () => Promise<string | null>
}

/**
 * `https://host/v1` + `/chat/completions`, with exactly one slash between.
 *
 * A reader pasting a base URL gets it wrong in both directions — a trailing
 * slash, or the full path including `/chat/completions` because that is what
 * the service's documentation shows. Both are accepted here rather than
 * refused, because the alternative is a 404 whose cause is a slash.
 */
export function chatUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  return trimmed.endsWith(OPENAI_CHAT_PATH) ? trimmed : `${trimmed}${OPENAI_CHAT_PATH}`
}

/**
 * Whether a base URL is usable at all.
 *
 * `http:` is allowed and `https:` is preferred, and that is deliberate: a local
 * Ollama is `http://localhost:11434/v1` and refusing it would rule out the one
 * option on this tier that sends nothing over a network at all. The settings
 * screen warns about a non-local `http:` URL; this function only decides
 * whether the string is a URL.
 */
export function isUsableBaseUrl(value: string): boolean {
  try {
    const url = new URL(value.trim())
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0'])

/** True for a base URL that never leaves this machine. */
export function isLocalBaseUrl(value: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(value.trim()).hostname)
  } catch {
    return false
  }
}

export interface CapabilityNote {
  /** What the run will actually do, given what the endpoint supports. */
  mode: 'tools' | 'json' | 'text'
  /** i18n key under `ai.openai.note`. The wording is the catalogue's. */
  i18nKey: 'tools' | 'jsonFallback' | 'textOnly'
}

/**
 * What an agent that wanted tools will actually get.
 *
 * Returned rather than logged, so the surface can SAY it. A reader whose
 * endpoint has no tool support is not getting the same answer as one whose
 * endpoint does, and pretending otherwise is how a grounded app stops being
 * one.
 */
export function capabilityNote(supports: readonly OpenAiCapability[] | undefined): CapabilityNote {
  const has = new Set(supports ?? [])
  if (has.has('tools')) return { mode: 'tools', i18nKey: 'tools' }
  if (has.has('json')) return { mode: 'json', i18nKey: 'jsonFallback' }
  return { mode: 'text', i18nKey: 'textOnly' }
}

export class OpenAiCompatibleProvider implements AiProvider {
  readonly id: AiProviderId = 'openai-compatible'

  private readonly options: OpenAiCompatibleOptions

  constructor(options: OpenAiCompatibleOptions) {
    if (!isUsableBaseUrl(options.baseUrl)) {
      throw new AiError('not_configured', `"${options.baseUrl}" is not a usable base URL.`)
    }
    if (!options.model.trim()) {
      throw new AiError('not_configured', 'No model name is set for this endpoint.')
    }
    this.options = options
  }

  get capabilities(): ProviderCapabilities {
    const has = new Set(this.options.supports ?? [])
    return {
      streaming: true,
      tools: has.has('tools'),
      jsonMode: has.has('json'),
      // Unknown, and this app does not guess: the endpoint is the reader's and
      // the model is whatever they typed. A figure invented here would be shown
      // to them as a fact about their own service.
      maxContext: 0,
      localOnly: isLocalBaseUrl(this.options.baseUrl),
    }
  }

  async chat(params: ChatParams): Promise<ChatResult> {
    const headers = await this.headers()
    const capability = capabilityNote(this.options.supports)

    const body = buildChatCompletionsBody(params, {
      model: params.model ?? this.options.model,
      maxTokens: params.maxTokens ?? this.options.maxTokens ?? DEFAULT_MAX_TOKENS,
      stream: true,
      tools: capability.mode === 'tools',
      jsonMode: capability.mode !== 'text',
    })

    return streamChatCompletions({
      url: chatUrl(this.options.baseUrl),
      headers,
      body,
      ...(params.signal ? { signal: params.signal } : {}),
      ...(params.onEvent ? { onEvent: params.onEvent } : {}),
      ...(this.options.fetchImpl ? { fetchImpl: this.options.fetchImpl } : {}),
    })
  }

  /**
   * The settings screen's "test connection". Exactly ONE request, on an
   * explicit click, with `max_tokens: 1` — enough to prove the URL, the key and
   * the model name, and nothing more. The same shape
   * `AnthropicDirectProvider.testConnection` has.
   */
  async testConnection(signal?: AbortSignal): Promise<ChatResult> {
    const headers = await this.headers()
    const payload = await postJson({
      url: chatUrl(this.options.baseUrl),
      headers,
      body: {
        model: this.options.model,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      },
      ...(signal ? { signal } : {}),
      ...(this.options.fetchImpl ? { fetchImpl: this.options.fetchImpl } : {}),
    })
    return parseChatCompletion(payload, this.options.model)
  }

  /**
   * The key is read from the encrypted vault on EACH request rather than held
   * in a field, so the kill switch takes effect on the very next call — the
   * same rule `AnthropicDirectProvider` follows.
   *
   * A missing key is not an error here, and that is the one place this provider
   * differs from Tier 1: a local Ollama needs none, and refusing to run without
   * one would rule out the only option on this tier that sends nothing over a
   * network. An endpoint that DOES need a key answers 401, which
   * `throwForStatus` maps to `auth` and the surface names.
   */
  private async headers(): Promise<Record<string, string>> {
    const read = this.options.readKey ?? (() => readSecret(OPENAI_KEY_ID))
    const key = await read()
    return key ? { authorization: `Bearer ${key}` } : {}
  }
}
