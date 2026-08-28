import { TASK_DEFAULTS, resolveModel, type Effort } from '../models'
import type { AiProvider } from '../provider'
import type { AiProviderId, ChatParams, ChatResult, ProviderCapabilities } from '../types'
import { buildMessagesBody, streamMessages } from './wire'

/**
 * Tier 2 — the owner's key, behind a Cloudflare Worker at `VITE_AI_PROXY_URL`.
 *
 * Identical wire format to Tier 1, minus the key: the browser sends no
 * credential at all, and the Worker attaches one on the far side. That is the
 * whole difference, and it is why the two providers can share `wire.ts`.
 *
 * The Worker itself is Session 24. This build ships with no proxy URL, so the
 * tier cannot be selected — `tierReady()` returns false and the settings UI
 * disables the option rather than offering a request that would 404.
 *
 * Note for whoever writes the Worker: it sees every prompt. Its privacy notice
 * is not this file's to make, and the consent modal says Tier 2 means "the
 * app's operator can see what you send".
 */
export interface ProxyOptions {
  /** e.g. https://ai.example.workers.dev — `/v1/messages` is appended. */
  baseUrl: string
  model: string
  effort?: Effort
  fetchImpl?: typeof globalThis.fetch
}

export class ProxyProvider implements AiProvider {
  readonly id: AiProviderId = 'proxy'

  private readonly options: ProxyOptions

  constructor(options: ProxyOptions) {
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

  chat(params: ChatParams): Promise<ChatResult> {
    const body = buildMessagesBody(
      { ...params, model: params.model ?? this.options.model },
      { effort: this.options.effort ?? TASK_DEFAULTS['law-explain'].effort, stream: true },
    )

    return streamMessages({
      url: messagesUrl(this.options.baseUrl),
      // No key, and no header that identifies the reader.
      headers: {},
      body,
      ...(params.signal ? { signal: params.signal } : {}),
      ...(params.onEvent ? { onEvent: params.onEvent } : {}),
      ...(this.options.fetchImpl ? { fetchImpl: this.options.fetchImpl } : {}),
    })
  }
}

/**
 * `VITE_AI_PROXY_URL` is set by whoever deploys the Worker, and "the URL" is as
 * likely to be pasted with `/v1/messages` already on it as without. Appending
 * blindly would produce `/v1/messages/v1/messages` and a 404 nobody would
 * connect to the trailing slash they typed.
 */
export function messagesUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '').replace(/\/v1\/messages$/, '')}/v1/messages`
}
