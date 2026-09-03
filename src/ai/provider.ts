import { proxyUrlFromEnv, type AiSettings } from './flags'
import {
  AiError,
  type AiProviderId,
  type ChatParams,
  type ChatResult,
  type ProviderCapabilities,
} from './types'

/**
 * The provider seam. Four implementations, one interface, and application code
 * that cannot tell them apart — which is the whole point: an agent written
 * against MockProvider in a test is the same agent that runs against the
 * reader's own key.
 *
 * Every implementation is loaded by dynamic import below, so turning AI off
 * means none of them is ever fetched.
 */
export interface AiProvider {
  readonly id: AiProviderId
  readonly capabilities: ProviderCapabilities
  chat(params: ChatParams): Promise<ChatResult>
}

export interface CreateProviderOptions {
  /** Overrides `VITE_AI_PROXY_URL`; tests use it, production does not. */
  proxyUrl?: string
  /** Injected for the Playwright test that mocks api.anthropic.com. */
  fetchImpl?: typeof globalThis.fetch
}

/**
 * Builds the provider the settings ask for. Throws rather than silently
 * degrading: a reader who chose BYOK and has no key must be told so, not
 * quietly served by something else.
 */
export async function createProvider(
  settings: AiSettings,
  options: CreateProviderOptions = {},
): Promise<AiProvider> {
  switch (settings.tier) {
    case 'off':
      throw new AiError('not_configured', 'AI is off.')

    case 'local': {
      const { LocalProvider } = await import('./providers/local')
      return new LocalProvider({ modelId: settings.localModel })
    }

    case 'byok': {
      const { AnthropicDirectProvider } = await import('./providers/anthropic-direct')
      return new AnthropicDirectProvider({
        model: settings.model,
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      })
    }

    case 'openai': {
      const { OpenAiCompatibleProvider } = await import('./providers/openaiCompatible')
      const supports: ('tools' | 'json')[] = []
      if (settings.openAiSupportsTools) supports.push('tools')
      if (settings.openAiSupportsJson) supports.push('json')
      return new OpenAiCompatibleProvider({
        baseUrl: settings.openAiBaseUrl,
        model: settings.openAiModel,
        supports,
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      })
    }

    case 'proxy': {
      const baseUrl = options.proxyUrl ?? proxyUrlFromEnv()
      if (!baseUrl) {
        throw new AiError('not_configured', 'This build has no AI proxy configured.')
      }
      const { ProxyProvider } = await import('./providers/proxy')
      return new ProxyProvider({
        baseUrl,
        model: settings.model,
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      })
    }
  }
}
