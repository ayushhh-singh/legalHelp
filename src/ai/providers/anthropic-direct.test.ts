import { describe, expect, it, vi } from 'vitest'

import { ANTHROPIC_MESSAGES_URL, AnthropicDirectProvider, headersFor } from './anthropic-direct'
import { ProxyProvider, messagesUrl } from './proxy'
import { LocalProvider } from './local'
import { ANTHROPIC_VERSION } from './wire'

import { asRecord, parseJson } from '../json'
import { buildContext } from '../context'
import { buildSystem } from '../prompts'
import { toolSpecs, clearRegistry } from '../tools/registry'
import { registerBuiltinTools } from '../tools/index'
import type { ChatParams } from '../types'

const KEY = 'sk-ant-api03-test'

/** One SSE frame per array entry, in the wire's own framing. */
function sseResponse(frames: readonly string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder()
      for (const frame of frames) controller.enqueue(encoder.encode(`${frame}\n\n`))
      controller.close()
    },
  })
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

const frame = (payload: unknown) => `event: x\ndata: ${JSON.stringify(payload)}`

/**
 * A fetch double that keeps fetch's own parameter list, so `mock.calls` stays a
 * two-element tuple and the assertions below can read the URL and the body
 * without casting through `undefined`.
 */
function fakeFetch(respond: () => Response) {
  return vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => Promise.resolve(respond()))
}

const HAPPY_STREAM = [
  frame({
    type: 'message_start',
    message: {
      model: 'claude-sonnet-4-6',
      usage: { input_tokens: 1200, cache_read_input_tokens: 900, output_tokens: 0 },
    },
  }),
  frame({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
  frame({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Checking' } }),
  frame({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ' the table.' } }),
  frame({ type: 'content_block_stop', index: 0 }),
  frame({
    type: 'content_block_start',
    index: 1,
    content_block: { type: 'tool_use', id: 'toolu_9', name: 'dataset_versions', input: {} },
  }),
  frame({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"a"' } }),
  frame({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: ':1}' } }),
  frame({ type: 'content_block_stop', index: 1 }),
  frame({ type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 64 } }),
  frame({ type: 'message_stop' }),
]

function chatParams(over: Partial<ChatParams> = {}): ChatParams {
  return {
    system: buildSystem({ agentId: 'law-explain', language: 'en', context: buildContext([]) }),
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Which datasets?' }] }],
    ...over,
  }
}

const bodyOf = (fetchImpl: ReturnType<typeof fakeFetch>, call = 0): Record<string, unknown> => {
  const body = fetchImpl.mock.calls[call]?.[1]?.body
  return asRecord(parseJson(typeof body === 'string' ? body : '{}')) ?? {}
}

describe('AnthropicDirectProvider — headers', () => {
  it('sends the key, a pinned API version and the browser-access opt-in, and nothing else', () => {
    expect(headersFor(KEY)).toEqual({
      'x-api-key': KEY,
      'anthropic-version': ANTHROPIC_VERSION,
      'anthropic-dangerous-direct-browser-access': 'true',
    })
    // No header identifies the reader, the device or this app.
    expect(Object.keys(headersFor(KEY))).toHaveLength(3)
  })
})

describe('AnthropicDirectProvider — testConnection', () => {
  it('sends exactly one request, of one token, to the Messages endpoint', async () => {
    const fetchImpl = fakeFetch(
      () =>
        new Response(JSON.stringify({ model: 'claude-sonnet-4-6', content: [], stop_reason: 'max_tokens' }), {
          status: 200,
        }),
    )
    const provider = new AnthropicDirectProvider({
      model: 'claude-sonnet-4-6',
      fetchImpl: fetchImpl,
      readKey: () => Promise.resolve(KEY),
    })

    await provider.testConnection()

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(ANTHROPIC_MESSAGES_URL)

    expect(fetchImpl.mock.calls[0]?.[1]?.headers).toMatchObject(headersFor(KEY))

    const body = bodyOf(fetchImpl)
    expect(body.max_tokens).toBe(1)
    expect(body.stream).toBeUndefined()
    expect(body.tools).toBeUndefined()
    // An adaptive-thinking model cannot answer inside one token, so the ping
    // switches thinking off rather than 400-ing.
    expect(body.thinking).toEqual({ type: 'disabled' })
  })

  it('makes no request at all when no key is stored', async () => {
    const fetchImpl = fakeFetch(() => new Response(null, { status: 200 }))
    const provider = new AnthropicDirectProvider({
      model: 'claude-sonnet-4-6',
      fetchImpl: fetchImpl,
      readKey: () => Promise.resolve(null),
    })

    await expect(provider.testConnection()).rejects.toMatchObject({ code: 'no_key' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('reports a rejected key as an auth failure, not a generic one', async () => {
    const fetchImpl = fakeFetch(
      () => new Response(JSON.stringify({ error: { message: 'invalid x-api-key' } }), { status: 401 }),
    )
    const provider = new AnthropicDirectProvider({
      model: 'claude-sonnet-4-6',
      fetchImpl: fetchImpl,
      readKey: () => Promise.resolve(KEY),
    })

    await expect(provider.testConnection()).rejects.toMatchObject({
      code: 'auth',
      status: 401,
      message: 'invalid x-api-key',
    })
  })
})

describe('AnthropicDirectProvider — streaming', () => {
  const provider = (fetchImpl: ReturnType<typeof fakeFetch>, model = 'claude-sonnet-4-6') =>
    new AnthropicDirectProvider({
      model,
      fetchImpl: fetchImpl,
      readKey: () => Promise.resolve(KEY),
    })

  it('reassembles text and tool arguments from the delta frames', async () => {
    const fetchImpl = fakeFetch(() => sseResponse(HAPPY_STREAM))
    const tokens: string[] = []

    const result = await provider(fetchImpl).chat(
      chatParams({
        onEvent: (event) => {
          if (event.type === 'token') tokens.push(event.text)
        },
      }),
    )

    expect(tokens).toEqual(['Checking', ' the table.'])
    expect(result.content).toEqual([
      { type: 'text', text: 'Checking the table.' },
      // The arguments arrived in two fragments and are only valid JSON joined.
      { type: 'tool_use', id: 'toolu_9', name: 'dataset_versions', input: { a: 1 } },
    ])
    expect(result.stopReason).toBe('tool_use')
    expect(result.model).toBe('claude-sonnet-4-6')
  })

  it('keeps the input counts from message_start and the output count from message_delta', async () => {
    const fetchImpl = fakeFetch(() => sseResponse(HAPPY_STREAM))
    const result = await provider(fetchImpl).chat(chatParams())

    expect(result.usage).toEqual({
      inputTokens: 1200,
      outputTokens: 64,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 900,
    })
  })

  it('places the cache breakpoints the caller asked for', async () => {
    clearRegistry()
    registerBuiltinTools()
    const fetchImpl = fakeFetch(() => sseResponse(HAPPY_STREAM))

    await provider(fetchImpl).chat(chatParams({ tools: toolSpecs() }))
    const body = bodyOf(fetchImpl)

    const system = body.system as { text: string; cache_control?: unknown }[]
    expect(system[0]?.cache_control).toEqual({ type: 'ephemeral' })
    expect(system.at(-1)?.cache_control).toBeUndefined()

    const tools = body.tools as { name: string; cache_control?: unknown }[]
    expect(tools.filter((tool) => tool.cache_control)).toHaveLength(1)
    expect(tools.at(-1)?.cache_control).toEqual({ type: 'ephemeral' })
  })

  it('omits parameters the chosen model does not accept', async () => {
    const fetchImpl = fakeFetch(() => sseResponse(HAPPY_STREAM))

    await provider(fetchImpl, 'claude-haiku-4-5').chat(chatParams())
    const haikuBody = bodyOf(fetchImpl)
    // Pre-4.6: no adaptive thinking, and `effort` is rejected outright.
    expect(haikuBody.thinking).toBeUndefined()
    expect(haikuBody.output_config).toBeUndefined()

    const fetchSonnet = fakeFetch(() => sseResponse(HAPPY_STREAM))
    await provider(fetchSonnet).chat(chatParams())
    expect(bodyOf(fetchSonnet).thinking).toEqual({ type: 'adaptive' })
    expect(bodyOf(fetchSonnet).output_config).toEqual({ effort: 'medium' })
  })

  it('asks for a structured answer when a schema is supplied', async () => {
    const fetchImpl = fakeFetch(() => sseResponse(HAPPY_STREAM))

    await provider(fetchImpl).chat(
      chatParams({ jsonSchema: { name: 'mapping', schema: { type: 'object' } } }),
    )

    expect(bodyOf(fetchImpl).output_config).toMatchObject({
      format: { type: 'json_schema', name: 'mapping', schema: { type: 'object' } },
    })
  })

  it('turns a mid-stream error frame into a provider error', async () => {
    const fetchImpl = fakeFetch(() =>
      sseResponse([
        frame({ type: 'message_start', message: { model: 'claude-sonnet-4-6', usage: {} } }),
        frame({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }),
      ]),
    )

    await expect(provider(fetchImpl).chat(chatParams())).rejects.toMatchObject({
      code: 'provider',
      message: 'Overloaded',
    })
  })
})

describe('ProxyProvider', () => {
  it('speaks the same wire format with no credential of any kind', async () => {
    const fetchImpl = fakeFetch(() => sseResponse(HAPPY_STREAM))
    const provider = new ProxyProvider({
      baseUrl: 'https://ai.example.test/',
      model: 'claude-sonnet-4-6',
      fetchImpl: fetchImpl,
    })

    await provider.chat(chatParams())

    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://ai.example.test/v1/messages')
    const headers = (fetchImpl.mock.calls[0]?.[1]?.headers ?? {}) as Record<string, string>
    expect(headers['x-api-key']).toBeUndefined()
    expect(Object.keys(headers)).toEqual(['content-type', 'accept'])
  })

  it('appends the endpoint exactly once, whatever the base URL looks like', () => {
    expect(messagesUrl('https://a.test')).toBe('https://a.test/v1/messages')
    expect(messagesUrl('https://a.test///')).toBe('https://a.test/v1/messages')
    // Whoever deploys the Worker is as likely to paste the full endpoint.
    expect(messagesUrl('https://a.test/v1/messages')).toBe('https://a.test/v1/messages')
    expect(messagesUrl('https://a.test/v1/messages/')).toBe('https://a.test/v1/messages')
  })
})

describe('LocalProvider', () => {
  it('declares itself local-only and refuses to run in this build', async () => {
    const provider = new LocalProvider()

    expect(provider.capabilities.localOnly).toBe(true)
    await expect(provider.chat(chatParams())).rejects.toMatchObject({ code: 'not_installed' })
  })
})
