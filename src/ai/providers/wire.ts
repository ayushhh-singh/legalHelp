import { asArray, asNumber, asRecord, asString, errorMessage, numberOr, parseJson } from '../json'
import { resolveEffort, resolveModel, type Effort } from '../models'
import {
  AiError,
  EMPTY_USAGE,
  type AiEventHandler,
  type ChatParams,
  type ChatResult,
  type ContentPart,
  type Message,
  type StopReason,
  type SystemBlock,
  type TokenUsage,
  type ToolSpec,
} from '../types'

/**
 * THE ONLY MODULE IN THIS APP THAT MAKES A NETWORK REQUEST.
 *
 * `eslint.config.ts` bans the `fetch` global everywhere in `src/` and grants an
 * exception to this one file, so the audit question "what can talk to the
 * network?" has a one-file answer. Tiers 1 and 2 share it because they speak
 * the same wire format; only the URL and the headers differ, and neither is
 * decided here.
 *
 * Nothing in here reads settings, IndexedDB or the DOM. It is handed a URL,
 * headers and a request, and it returns content blocks.
 */

export const ANTHROPIC_VERSION = '2023-06-01'
export const DEFAULT_MAX_TOKENS = 4096

export interface WireRequest {
  url: string
  headers: Record<string, string>
  body: Record<string, unknown>
  signal?: AbortSignal
  onEvent?: AiEventHandler
  fetchImpl?: typeof globalThis.fetch
}

/* ------------------------------------------------------------------ *
 * Request building
 * ------------------------------------------------------------------ */

const CACHE_CONTROL = { type: 'ephemeral' } as const

function systemToWire(blocks: readonly SystemBlock[]): unknown[] {
  return blocks.map((block) => ({
    type: 'text',
    text: block.text,
    ...(block.cache ? { cache_control: CACHE_CONTROL } : {}),
  }))
}

function partToWire(part: ContentPart): unknown {
  switch (part.type) {
    case 'text':
      return { type: 'text', text: part.text }
    case 'tool_use':
      return { type: 'tool_use', id: part.id, name: part.name, input: part.input }
    case 'tool_result':
      return {
        type: 'tool_result',
        tool_use_id: part.toolUseId,
        content: part.content,
        ...(part.isError ? { is_error: true } : {}),
      }
  }
}

function messagesToWire(messages: readonly Message[]): unknown[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.content.map(partToWire),
  }))
}

function toolsToWire(tools: readonly ToolSpec[]): unknown[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
    ...(tool.cache ? { cache_control: CACHE_CONTROL } : {}),
  }))
}

export interface BuildBodyOptions {
  effort: Effort
  stream: boolean
}

/**
 * The Messages API request body.
 *
 * Cache breakpoints land where `SystemBlock.cache` and `ToolSpec.cache` say —
 * the caller decides, because the caller is the one that knows which prefix is
 * stable. `thinking` and `output_config.effort` are emitted only for models
 * that accept them (src/ai/models.ts), so a request never 400s on a parameter
 * the chosen model removed.
 */
export function buildMessagesBody(params: ChatParams, options: BuildBodyOptions): Record<string, unknown> {
  const model = resolveModel(params.model)
  const effort = resolveEffort(model, options.effort)

  const outputConfig: Record<string, unknown> = {}
  if (effort) outputConfig.effort = effort
  if (params.jsonSchema) {
    outputConfig.format = {
      type: 'json_schema',
      name: params.jsonSchema.name,
      schema: params.jsonSchema.schema,
    }
  }

  return {
    model: model.id,
    max_tokens: Math.min(params.maxTokens ?? DEFAULT_MAX_TOKENS, model.maxOutput),
    ...(options.stream ? { stream: true } : {}),
    system: systemToWire(params.system),
    messages: messagesToWire(params.messages),
    ...(params.tools && params.tools.length > 0 ? { tools: toolsToWire(params.tools) } : {}),
    ...(model.adaptiveThinking ? { thinking: { type: 'adaptive' } } : {}),
    ...(Object.keys(outputConfig).length > 0 ? { output_config: outputConfig } : {}),
  }
}

/* ------------------------------------------------------------------ *
 * Transport
 * ------------------------------------------------------------------ */

function statusToCode(status: number) {
  if (status === 401 || status === 403) return 'auth' as const
  if (status === 429) return 'rate_limited' as const
  return 'provider' as const
}

async function throwForStatus(response: Response): Promise<never> {
  const text = await response.text().catch(() => '')
  const parsed = text ? asRecord(safeParse(text)) : undefined
  const detail = asString(asRecord(parsed?.error)?.message) ?? text.slice(0, 300)
  throw new AiError(
    statusToCode(response.status),
    detail || `Request failed with status ${response.status}.`,
    response.status,
  )
}

function safeParse(text: string): unknown {
  try {
    return parseJson(text)
  } catch {
    return undefined
  }
}

function resolveFetch(fetchImpl: typeof globalThis.fetch | undefined): typeof globalThis.fetch {
  const impl = fetchImpl ?? globalThis.fetch
  if (!impl) throw new AiError('provider', 'This environment has no fetch.')
  return impl.bind(globalThis)
}

/** Non-streaming POST. Used by the one-token connection test, nothing else. */
export async function postJson(request: WireRequest): Promise<unknown> {
  const doFetch = resolveFetch(request.fetchImpl)
  const response = await doFetch(request.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...request.headers },
    body: JSON.stringify(request.body),
    ...(request.signal ? { signal: request.signal } : {}),
  })
  if (!response.ok) await throwForStatus(response)
  return safeParse(await response.text())
}

/* ------------------------------------------------------------------ *
 * Server-sent events
 * ------------------------------------------------------------------ */

interface BlockAccumulator {
  type: 'text' | 'tool_use' | 'other'
  text: string
  id?: string
  name?: string
  json: string
}

/**
 * Streams a Messages API response and reassembles content blocks.
 *
 * Tool arguments arrive as `input_json_delta` fragments that are only valid
 * JSON once the block closes, so they are concatenated and parsed at
 * `content_block_stop`. Thinking blocks are consumed and dropped: this app
 * never displays or replays them.
 */
export async function streamMessages(request: WireRequest): Promise<ChatResult> {
  const doFetch = resolveFetch(request.fetchImpl)
  const response = await doFetch(request.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream', ...request.headers },
    body: JSON.stringify(request.body),
    ...(request.signal ? { signal: request.signal } : {}),
  })

  if (!response.ok) await throwForStatus(response)
  if (!response.body) throw new AiError('provider', 'The response carried no body to stream.')

  const blocks = new Map<number, BlockAccumulator>()
  let usage: TokenUsage = { ...EMPTY_USAGE }
  let stopReason: StopReason = 'end_turn'
  let model = asString(request.body.model) ?? 'unknown'

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      // SSE frames are separated by a blank line. A frame may still be
      // arriving, so only complete ones are consumed.
      let boundary = buffer.indexOf('\n\n')
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        handleFrame(frame)
        boundary = buffer.indexOf('\n\n')
      }
    }
  } catch (error) {
    if (request.signal?.aborted) throw new AiError('aborted', 'Cancelled.')
    throw new AiError('provider', errorMessage(error))
  } finally {
    reader.releaseLock()
  }

  const content: ContentPart[] = [...blocks.entries()]
    .sort(([a], [b]) => a - b)
    .flatMap(([, block]): ContentPart[] => {
      if (block.type === 'text') return block.text ? [{ type: 'text' as const, text: block.text }] : []
      if (block.type === 'tool_use' && block.id && block.name) {
        return [
          {
            type: 'tool_use' as const,
            id: block.id,
            name: block.name,
            input: block.json ? (safeParse(block.json) ?? {}) : {},
          },
        ]
      }
      return []
    })

  request.onEvent?.({ type: 'usage', usage, model })
  return { content, stopReason, usage, model }

  function handleFrame(frame: string): void {
    const dataLines = frame
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
    if (dataLines.length === 0) return

    const payload = asRecord(safeParse(dataLines.join('\n')))
    if (!payload) return

    switch (payload.type) {
      case 'message_start': {
        const message = asRecord(payload.message)
        model = asString(message?.model) ?? model
        usage = mergeUsage(usage, asRecord(message?.usage))
        break
      }
      case 'content_block_start': {
        const index = asNumber(payload.index) ?? 0
        const block = asRecord(payload.content_block)
        const type = asString(block?.type)
        blocks.set(index, {
          type: type === 'text' ? 'text' : type === 'tool_use' ? 'tool_use' : 'other',
          text: asString(block?.text) ?? '',
          ...(asString(block?.id) ? { id: asString(block?.id) } : {}),
          ...(asString(block?.name) ? { name: asString(block?.name) } : {}),
          json: '',
        })
        break
      }
      case 'content_block_delta': {
        const index = asNumber(payload.index) ?? 0
        const block = blocks.get(index)
        const delta = asRecord(payload.delta)
        if (!block || !delta) break
        const text = asString(delta.text)
        if (delta.type === 'text_delta' && text !== undefined) {
          block.text += text
          request.onEvent?.({ type: 'token', text })
        }
        const partial = asString(delta.partial_json)
        if (delta.type === 'input_json_delta' && partial !== undefined) block.json += partial
        break
      }
      case 'message_delta': {
        const delta = asRecord(payload.delta)
        stopReason = toStopReason(asString(delta?.stop_reason)) ?? stopReason
        usage = mergeUsage(usage, asRecord(payload.usage))
        break
      }
      case 'error': {
        const error = asRecord(payload.error)
        throw new AiError('provider', asString(error?.message) ?? 'The provider reported an error.')
      }
      default:
        break
    }
  }
}

function mergeUsage(current: TokenUsage, wire: Record<string, unknown> | undefined): TokenUsage {
  if (!wire) return current
  return {
    // `message_delta` reports a running output count and omits the input
    // fields; keeping the larger of the two is what makes both frames additive
    // without double-counting.
    inputTokens: Math.max(current.inputTokens, numberOr(wire.input_tokens, 0)),
    outputTokens: Math.max(current.outputTokens, numberOr(wire.output_tokens, 0)),
    cacheCreationInputTokens: Math.max(
      current.cacheCreationInputTokens,
      numberOr(wire.cache_creation_input_tokens, 0),
    ),
    cacheReadInputTokens: Math.max(current.cacheReadInputTokens, numberOr(wire.cache_read_input_tokens, 0)),
  }
}

const STOP_REASONS: Record<string, StopReason> = {
  end_turn: 'end_turn',
  tool_use: 'tool_use',
  max_tokens: 'max_tokens',
  stop_sequence: 'stop_sequence',
  refusal: 'refusal',
}

function toStopReason(value: string | undefined): StopReason | undefined {
  return value ? STOP_REASONS[value] : undefined
}

/** Reads a non-streamed Messages response into the same shape. */
export function parseMessageResponse(payload: unknown, fallbackModel: string): ChatResult {
  const message = asRecord(payload)
  const content: ContentPart[] = []
  for (const raw of asArray(message?.content) ?? []) {
    const block = asRecord(raw)
    const type = asString(block?.type)
    if (type === 'text') content.push({ type: 'text', text: asString(block?.text) ?? '' })
    if (type === 'tool_use') {
      content.push({
        type: 'tool_use',
        id: asString(block?.id) ?? '',
        name: asString(block?.name) ?? '',
        input: block?.input ?? {},
      })
    }
  }
  return {
    content,
    stopReason: toStopReason(asString(message?.stop_reason)) ?? 'end_turn',
    usage: mergeUsage({ ...EMPTY_USAGE }, asRecord(message?.usage)),
    model: asString(message?.model) ?? fallbackModel,
  }
}
