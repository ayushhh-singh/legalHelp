import type { AiProvider } from '../provider'
import {
  AiError,
  type AiProviderId,
  type ChatParams,
  type ChatResult,
  type ProviderCapabilities,
} from '../types'

/**
 * Tier 0 — an on-device model, so that nothing leaves the device at all.
 *
 * Interface only. Session 24 implements it over @mlc-ai/web-llm, which needs a
 * multi-hundred-megabyte weights download and a WebGPU adapter; both are the
 * reader's explicit choice, not something this build should smuggle in.
 *
 * It exists now because the provider seam has to be proven with more than one
 * shape behind it: `capabilities.localOnly` is true here and false for Tiers 1
 * and 2, and the consent copy and the banner already branch on it.
 */
export class LocalProvider implements AiProvider {
  readonly id: AiProviderId = 'local'

  readonly capabilities: ProviderCapabilities = {
    streaming: true,
    // A small on-device model does not do reliable tool calling, and an agent
    // whose tool calls fail silently is worse than no agent. Session 24 decides
    // whether this ever becomes true.
    tools: false,
    jsonMode: false,
    maxContext: 4_096,
    localOnly: true,
  }

  chat(_params: ChatParams): Promise<ChatResult> {
    return Promise.reject(new AiError('not_installed', 'The on-device model is not installed in this build.'))
  }
}
