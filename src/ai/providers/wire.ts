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

/**
 * Empty blocks are dropped: the Messages API rejects a text block whose text is
 * empty, and an absent profile segment or an empty context block would
 * otherwise turn a well-formed prompt into a 400 nobody can read.
 */
function systemToWire(blocks: readonly SystemBlock[]): unknown[] {
  return blocks
    .filter((block) => block.text.trim().length > 0)
    .map((block) => ({
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

/**
 * Sends the request and classifies a transport failure.
 *
 * An aborted fetch rejects with a DOMException named `AbortError`, not with an
 * AiError — without this, cancelling a run surfaced to the reader as "the AI
 * service could not be reached", which is both wrong and alarming. Offline is
 * the other case that lands here, and it is a `provider` failure.
 */
async function send(
  request: WireRequest,
  doFetch: typeof globalThis.fetch,
  headers: Record<string, string>,
): Promise<Response> {
  try {
    return await doFetch(request.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(request.body),
      ...(request.signal ? { signal: request.signal } : {}),
    })
  } catch (error) {
    if (request.signal?.aborted) throw new AiError('aborted', 'Cancelled.')
    throw new AiError('provider', errorMessage(error))
  }
}

/** Non-streaming POST. Used by the one-token connection test, nothing else. */
export async function postJson(request: WireRequest): Promise<unknown> {
  const doFetch = resolveFetch(request.fetchImpl)
  const response = await send(request, doFetch, {
    'content-type': 'application/json',
    ...request.headers,
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
  const response = await send(request, doFetch, {
    'content-type': 'application/json',
    accept: 'text/event-stream',
    ...request.headers,
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
      // Normalising the WHOLE buffer, not just the new chunk, is what makes a
      // CRLF stream safe: a \r can arrive at the end of one chunk and its \n at
      // the start of the next, and per-chunk normalisation would leave that
      // pair intact and mis-frame everything after it.
      buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n')
      buffer = drainFrames(buffer)
    }
    // A stream that ends without its final blank line still carries a complete
    // frame — usually the `message_delta` that holds stop_reason and the output
    // token count. Dropping it silently would report end_turn for a turn that
    // actually stopped on max_tokens.
    buffer = drainFrames(`${buffer + decoder.decode()}\n\n`)
  } catch (error) {
    // Abandon the body rather than leaving it half-read: an un-cancelled
    // response body holds the connection open until GC.
    void reader.cancel().catch(() => undefined)
    if (request.signal?.aborted) throw new AiError('aborted', 'Cancelled.')
    if (error instanceof AiError) throw error
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

  /** Consumes every complete frame in `text` and returns what is left over. */
  function drainFrames(text: string): string {
    let rest = text
    let boundary = rest.indexOf('\n\n')
    while (boundary !== -1) {
      handleFrame(rest.slice(0, boundary))
      rest = rest.slice(boundary + 2)
      boundary = rest.indexOf('\n\n')
    }
    return rest
  }

  function handleFrame(frame: string): void {
    // Per the SSE grammar the space after the colon is optional, and a field
    // may be repeated — the values are joined with a newline, not concatenated.
    const dataLines = frame
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).replace(/^ /, ''))
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

/* ------------------------------------------------------------------ *
 * The OpenAI-compatible wire format
 * ------------------------------------------------------------------ */

/**
 * `POST /chat/completions`, the shape almost every non-Anthropic endpoint
 * speaks — Google AI Studio's compatibility layer, Groq, OpenRouter, a local
 * Ollama, and a dozen others.
 *
 * IT IS IN THIS FILE, and that is the point. `eslint.config.js` grants exactly
 * one file-scoped `fetch` exception and this is it, so "what in this app can
 * talk to the network?" stays answerable from one file (docs/AI.md §4). A
 * second provider with its own transport would be a second answer.
 *
 * Nothing here reads settings, IndexedDB or the DOM. It is handed a URL,
 * headers and a request, and it returns content blocks in the SAME
 * `ContentPart[]` shape `streamMessages` returns — which is what lets `runAgent`
 * be unable to tell the two apart.
 */

/** A `messages` array in the OpenAI shape. */
type OpenAiMessage = Record<string, unknown>

/**
 * The system blocks, flattened.
 *
 * There is no `cache_control` here and there cannot be: prompt caching is an
 * Anthropic feature with an Anthropic wire representation, and no
 * OpenAI-compatible endpoint has an equivalent this app could set. The blocks
 * are joined in order into one system message, which is the correct
 * degradation — the ORDER is what `src/ai/prompts.ts` guarantees, and the cache
 * breakpoints are an optimisation on top of it that simply does not apply here.
 * `docs/AI.md` §10's cost table is Anthropic's and does not describe this tier.
 */
function systemToOpenAi(blocks: readonly SystemBlock[]): string {
  return blocks
    .map((block) => block.text.trim())
    .filter(Boolean)
    .join('\n\n')
}

/**
 * One `Message` becomes one or more OpenAI messages.
 *
 * The shapes genuinely differ. Anthropic puts a tool RESULT in a user turn as a
 * `tool_result` block; OpenAI has a `role: "tool"` message per result. A turn
 * carrying three tool results therefore becomes three messages, and a turn
 * carrying text and a tool call becomes one message with both — which is why
 * this returns an array rather than an object.
 */
function messageToOpenAi(message: Message): OpenAiMessage[] {
  const out: OpenAiMessage[] = []
  const text = message.content
    .filter((part): part is Extract<ContentPart, { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .join('')
  const calls = message.content.filter(
    (part): part is Extract<ContentPart, { type: 'tool_use' }> => part.type === 'tool_use',
  )
  const results = message.content.filter(
    (part): part is Extract<ContentPart, { type: 'tool_result' }> => part.type === 'tool_result',
  )

  if (message.role === 'assistant') {
    if (text || calls.length > 0) {
      out.push({
        role: 'assistant',
        content: text || null,
        ...(calls.length > 0
          ? {
              tool_calls: calls.map((call) => ({
                id: call.id,
                type: 'function',
                function: { name: call.name, arguments: JSON.stringify(call.input ?? {}) },
              })),
            }
          : {}),
      })
    }
    return out
  }

  // A user turn. Tool results become their own `role: "tool"` messages, and
  // they go FIRST: an endpoint that validates the conversation expects every
  // tool call to be answered before the next user message.
  for (const result of results) {
    out.push({ role: 'tool', tool_call_id: result.toolUseId, content: result.content })
  }
  if (text) out.push({ role: 'user', content: text })
  return out
}

export interface OpenAiBodyOptions {
  model: string
  maxTokens: number
  stream: boolean
  /**
   * Whether the endpoint accepts a `tools` array. When it does not, the caller
   * has already folded the tool list into the prompt and asks for JSON instead
   * — see `src/ai/providers/openaiCompatible.ts`, which is honest about the
   * downgrade rather than silently dropping the tools.
   */
  tools: boolean
  /** Whether the endpoint accepts `response_format: { type: "json_object" }`. */
  jsonMode: boolean
}

export function buildChatCompletionsBody(
  params: ChatParams,
  options: OpenAiBodyOptions,
): Record<string, unknown> {
  const system = systemToOpenAi(params.system)
  const messages: OpenAiMessage[] = [
    ...(system ? [{ role: 'system', content: system }] : []),
    ...params.messages.flatMap(messageToOpenAi),
  ]

  const wantsJson = Boolean(params.jsonSchema)
  const sendTools = options.tools && (params.tools?.length ?? 0) > 0

  return {
    model: options.model,
    messages,
    max_tokens: options.maxTokens,
    ...(options.stream ? { stream: true, stream_options: { include_usage: true } } : {}),
    ...(sendTools
      ? {
          tools: (params.tools ?? []).map((tool) => ({
            type: 'function',
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.inputSchema,
            },
          })),
        }
      : {}),
    // `json_object`, never `json_schema`: the schema-constrained form is not
    // part of the compatibility surface most of these endpoints implement, and
    // sending it to one that does not know it is a 400 rather than a downgrade.
    // The agent validates the parsed object against the zod schema either way.
    ...(wantsJson && options.jsonMode && !sendTools ? { response_format: { type: 'json_object' } } : {}),
  }
}

interface OpenAiToolAccumulator {
  id: string
  name: string
  args: string
}

/**
 * Streams a `chat/completions` response and reassembles content blocks.
 *
 * Tool arguments arrive as `function.arguments` fragments that are only valid
 * JSON once the stream ends, so they are concatenated and parsed at the close —
 * the same arrangement `streamMessages` makes for `input_json_delta`. The index
 * on each `tool_calls` delta is what keeps two parallel calls apart; an
 * endpoint that omits it (some do) falls back to 0, which merges them, and the
 * agent's argument validation is what catches the result.
 */
export async function streamChatCompletions(request: WireRequest): Promise<ChatResult> {
  const doFetch = resolveFetch(request.fetchImpl)
  const response = await send(request, doFetch, {
    'content-type': 'application/json',
    accept: 'text/event-stream',
    ...request.headers,
  })

  if (!response.ok) await throwForStatus(response)
  if (!response.body) throw new AiError('provider', 'The response carried no body to stream.')

  let text = ''
  const tools = new Map<number, OpenAiToolAccumulator>()
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
      buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n')
      buffer = drainFrames(buffer)
    }
    buffer = drainFrames(`${buffer + decoder.decode()}\n\n`)
  } catch (error) {
    void reader.cancel().catch(() => undefined)
    if (request.signal?.aborted) throw new AiError('aborted', 'Cancelled.')
    if (error instanceof AiError) throw error
    throw new AiError('provider', errorMessage(error))
  } finally {
    reader.releaseLock()
  }

  const content: ContentPart[] = []
  if (text) content.push({ type: 'text', text })
  for (const [, call] of [...tools.entries()].sort(([a], [b]) => a - b)) {
    if (!call.name) continue
    content.push({
      type: 'tool_use',
      id: call.id || `call_${call.name}`,
      name: call.name,
      input: call.args ? (safeParse(call.args) ?? {}) : {},
    })
  }

  request.onEvent?.({ type: 'usage', usage, model })
  return { content, stopReason, usage, model }

  function drainFrames(source: string): string {
    let rest = source
    let boundary = rest.indexOf('\n\n')
    while (boundary !== -1) {
      handleFrame(rest.slice(0, boundary))
      rest = rest.slice(boundary + 2)
      boundary = rest.indexOf('\n\n')
    }
    return rest
  }

  function handleFrame(frame: string): void {
    const dataLines = frame
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).replace(/^ /, ''))
    if (dataLines.length === 0) return

    const raw = dataLines.join('\n')
    // The sentinel every OpenAI-compatible endpoint sends to close the stream.
    // It is not JSON, and parsing it would be a silent no-op that hid a real
    // parse failure behind it.
    if (raw.trim() === '[DONE]') return

    const payload = asRecord(safeParse(raw))
    if (!payload) return

    const error = asRecord(payload.error)
    if (error) throw new AiError('provider', asString(error.message) ?? 'The provider reported an error.')

    model = asString(payload.model) ?? model
    usage = mergeOpenAiUsage(usage, asRecord(payload.usage))

    const choice = asRecord((asArray(payload.choices) ?? [])[0])
    if (!choice) return

    const finish = asString(choice.finish_reason)
    if (finish) stopReason = toOpenAiStopReason(finish) ?? stopReason

    const delta = asRecord(choice.delta) ?? asRecord(choice.message)
    if (!delta) return

    const chunk = asString(delta.content)
    if (chunk) {
      text += chunk
      request.onEvent?.({ type: 'token', text: chunk })
    }

    for (const raw of asArray(delta.tool_calls) ?? []) {
      const entry = asRecord(raw)
      if (!entry) continue
      const index = asNumber(entry.index) ?? 0
      const fn = asRecord(entry.function)
      const existing = tools.get(index) ?? { id: '', name: '', args: '' }
      tools.set(index, {
        id: asString(entry.id) ?? existing.id,
        name: asString(fn?.name) ?? existing.name,
        args: existing.args + (asString(fn?.arguments) ?? ''),
      })
    }
  }
}

/**
 * OpenAI reports cumulative token counts in a single `usage` object, usually on
 * the last frame. There is no cache-read/cache-write split to map, so those two
 * stay zero — and `estimateCost` prices this tier at the reader's own endpoint,
 * which this app cannot know, so the figure it shows is a token count rather
 * than a claim about money.
 */
function mergeOpenAiUsage(current: TokenUsage, wire: Record<string, unknown> | undefined): TokenUsage {
  if (!wire) return current
  return {
    inputTokens: Math.max(current.inputTokens, numberOr(wire.prompt_tokens, 0)),
    outputTokens: Math.max(current.outputTokens, numberOr(wire.completion_tokens, 0)),
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
  }
}

const OPENAI_STOP_REASONS: Record<string, StopReason> = {
  stop: 'end_turn',
  tool_calls: 'tool_use',
  function_call: 'tool_use',
  length: 'max_tokens',
  content_filter: 'refusal',
}

function toOpenAiStopReason(value: string): StopReason | undefined {
  return OPENAI_STOP_REASONS[value]
}

/** Reads a NON-streamed `chat/completions` response into the same shape. */
export function parseChatCompletion(payload: unknown, fallbackModel: string): ChatResult {
  const body = asRecord(payload)
  const choice = asRecord((asArray(body?.choices) ?? [])[0])
  const message = asRecord(choice?.message)
  const content: ContentPart[] = []

  const text = asString(message?.content)
  if (text) content.push({ type: 'text', text })

  for (const raw of asArray(message?.tool_calls) ?? []) {
    const entry = asRecord(raw)
    const fn = asRecord(entry?.function)
    const name = asString(fn?.name)
    if (!name) continue
    content.push({
      type: 'tool_use',
      id: asString(entry?.id) ?? `call_${name}`,
      name,
      input: safeParse(asString(fn?.arguments) ?? '') ?? {},
    })
  }

  return {
    content,
    stopReason: toOpenAiStopReason(asString(choice?.finish_reason) ?? '') ?? 'end_turn',
    usage: mergeOpenAiUsage({ ...EMPTY_USAGE }, asRecord(body?.usage)),
    model: asString(body?.model) ?? fallbackModel,
  }
}
