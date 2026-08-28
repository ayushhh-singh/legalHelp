import type { z } from 'zod'

import type { Language } from '@/i18n'

/**
 * The vocabulary the whole AI layer speaks. Nothing here imports a provider,
 * a React component or Dexie, so `import type` from this module is free — the
 * kill switch and the feature flags can name these types without pulling the
 * AI chunk into the initial route.
 */

/** Master-context rule: user-visible strings are always `{ en, hi }` pairs. */
export type Bilingual = Record<Language, string>

/**
 * Activation tiers. The app code is identical in all four; only where the
 * tokens are produced changes.
 *
 * - `off`   — the default. Zero outbound requests, no AI surface renders.
 * - `local` — Tier 0, WebLLM in the browser. Nothing leaves the device.
 * - `byok`  — Tier 1, the reader's own key, browser → api.anthropic.com.
 * - `proxy` — Tier 2, the owner's key behind a Cloudflare Worker.
 */
export const AI_TIERS = ['off', 'local', 'byok', 'proxy'] as const
export type AiTier = (typeof AI_TIERS)[number]

export const isAiTier = (value: unknown): value is AiTier =>
  typeof value === 'string' && (AI_TIERS as readonly string[]).includes(value)

/* ------------------------------------------------------------------ *
 * Conversation
 * ------------------------------------------------------------------ */

export type MessageRole = 'user' | 'assistant'

export interface TextPart {
  type: 'text'
  text: string
}

export interface ToolUsePart {
  type: 'tool_use'
  /** Provider-assigned id, echoed back on the matching tool_result. */
  id: string
  name: string
  input: unknown
}

export interface ToolResultPart {
  type: 'tool_result'
  toolUseId: string
  content: string
  isError?: boolean
}

export type ContentPart = TextPart | ToolUsePart | ToolResultPart

export interface Message {
  role: MessageRole
  content: ContentPart[]
}

/**
 * A system prompt in ordered blocks so the caller controls where the prompt
 * cache breakpoint falls. See src/ai/prompts.ts for the required order:
 * stable persona (cached) → profile (cached) → per-request context.
 */
export interface SystemBlock {
  text: string
  /** Marks the end of a cacheable prefix (`cache_control` on the wire). */
  cache?: boolean
}

/* ------------------------------------------------------------------ *
 * Tools
 * ------------------------------------------------------------------ */

/**
 * Which module's data a tool reads. `listTools(scope)` uses this so an agent is
 * handed only the tools its surface can justify — a smaller tool list is both
 * a cheaper prompt and a smaller blast radius.
 */
export const TOOL_SCOPES = ['law', 'pay', 'draft', 'learn', 'utils', 'common'] as const
export type ToolScope = (typeof TOOL_SCOPES)[number]

/** What a handler is allowed to know about the run it is serving. */
export interface ToolContext {
  language: Language
  signal: AbortSignal
}

/**
 * A tool is a PURE FUNCTION OVER LOCAL DATA. Handlers never fetch the network —
 * `src/ai/tools/registry.test.ts` asserts the registry rejects a definition
 * whose source mentions one, and the Playwright privacy suite is the backstop.
 */
export interface ToolDef<I = never> {
  name: string
  description: Bilingual
  scope: ToolScope
  /** Zod is the single source of truth; the JSON Schema is derived from it. */
  inputSchema: z.ZodType<I>
  handler: (input: I, ctx: ToolContext) => Promise<unknown>
  /** Per-tool override of the agent's default timeout. */
  timeoutMs?: number
}

/** A registered tool, erased to `unknown` so the registry can hold a mixed map. */
export type AnyToolDef = ToolDef<never>

/** JSON Schema as it goes on the wire. Deliberately loose — zod produces it. */
export type JsonSchema = Record<string, unknown>

/** The wire form of a tool definition, shared by every provider and by MCP. */
export interface ToolSpec {
  name: string
  description: string
  inputSchema: JsonSchema
  /** Marks the cache breakpoint at the end of the tool list. */
  cache?: boolean
}

export interface ToolCall {
  id: string
  name: string
  input: unknown
}

/**
 * The unit of grounding. `id` is the short, quotable handle (`T1`, `T2`, …)
 * that a grounded answer must cite; the agent rejects a final answer that
 * cites none of them when its policy says `groundedRequired`.
 */
export interface ToolResult {
  id: string
  toolCallId: string
  name: string
  ok: boolean
  output: unknown
  error?: string
  ms: number
}

/* ------------------------------------------------------------------ *
 * Providers
 * ------------------------------------------------------------------ */

export interface ProviderCapabilities {
  streaming: boolean
  tools: boolean
  jsonMode: boolean
  maxContext: number
  /** True when nothing this provider does can leave the device. */
  localOnly: boolean
}

export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | 'refusal' | 'aborted'

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  cacheCreationInputTokens: number
  cacheReadInputTokens: number
}

export const EMPTY_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
}

/**
 * Everything an agent, a UI or a test may observe while a run is in flight.
 * `onEvent` is the only channel — there is no other logging surface, so a
 * consumer that ignores it sees nothing and a test that records it sees all.
 */
export type AiEvent =
  | { type: 'token'; text: string }
  | { type: 'toolCall'; call: ToolCall }
  | { type: 'toolResult'; result: ToolResult }
  | { type: 'final'; text: string; json?: unknown; stopReason: StopReason }
  | { type: 'error'; code: AiErrorCode; message: string }
  | { type: 'usage'; usage: TokenUsage; model: string }

export type AiEventHandler = (event: AiEvent) => void

export interface JsonSchemaRequest {
  name: string
  schema: JsonSchema
}

export interface ChatParams {
  system: SystemBlock[]
  messages: Message[]
  tools?: ToolSpec[]
  jsonSchema?: JsonSchemaRequest
  model?: string
  maxTokens?: number
  signal?: AbortSignal
  onEvent?: AiEventHandler
}

export interface ChatResult {
  content: ContentPart[]
  stopReason: StopReason
  usage: TokenUsage
  model: string
}

export const AI_PROVIDER_IDS = ['mock', 'local', 'anthropic-direct', 'proxy'] as const
export type AiProviderId = (typeof AI_PROVIDER_IDS)[number]

/* ------------------------------------------------------------------ *
 * Errors
 * ------------------------------------------------------------------ */

/**
 * Declared as an array so it can be iterated at runtime: every code must have a
 * bilingual message under `ai.errors` in both catalogues, and
 * `src/ai/errors.test.ts` walks this list to prove it. A union type alone would
 * let a new code ship with no way to tell the reader what happened.
 */
export const AI_ERROR_CODES = [
  /** The final answer cited no tool result and the agent policy required one. */
  'ungrounded',
  /** The answer cited a snippet that does not exist, or invented a section number. */
  'invalid_citation',
  'max_steps',
  /** The model hit max_tokens: the answer on screen would be half a sentence. */
  'truncated',
  /** No question to answer, or the model produced no text at all. */
  'empty',
  'budget_exhausted',
  'aborted',
  'tool_timeout',
  'invalid_args',
  'unknown_tool',
  'no_key',
  'not_configured',
  'not_installed',
  'auth',
  'rate_limited',
  'provider',
] as const

export type AiErrorCode = (typeof AI_ERROR_CODES)[number]

export class AiError extends Error {
  readonly code: AiErrorCode
  readonly status?: number

  constructor(code: AiErrorCode, message: string, status?: number) {
    super(message)
    this.name = 'AiError'
    this.code = code
    if (status !== undefined) this.status = status
  }
}

export const isAiError = (value: unknown): value is AiError => value instanceof AiError

/* ------------------------------------------------------------------ *
 * Provenance
 * ------------------------------------------------------------------ */

/**
 * Stored beside every AI output. `promptVersion` is what makes an old answer
 * identifiable after a prompt edit — bump the agent's PROMPT_VERSION and the
 * answer cache stops serving anything written by the previous wording.
 */
export interface AiOutputMeta {
  agentId: string
  model: string
  promptVersion: number
  tier: AiTier
  /** Which numbered context snippets the run was given. */
  contextIds: string[]
  tokens: TokenUsage
  /** USD, estimated from the model's published rate. Zero for local and mock. */
  cost: number
  cached: boolean
  /** ISO-8601. */
  at: string
}
