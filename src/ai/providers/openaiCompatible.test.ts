import { describe, expect, it, vi } from 'vitest'

import {
  capabilityNote,
  chatUrl,
  isLocalBaseUrl,
  isUsableBaseUrl,
  OpenAiCompatibleProvider,
} from './openaiCompatible'
import { buildChatCompletionsBody, parseChatCompletion } from './wire'

import { asRecord, parseJson } from '../json'
import { buildContext } from '../context'
import { buildSystem } from '../prompts'
import { AiError, type ChatParams, type ToolSpec } from '../types'

/**
 * The OpenAI-compatible tier, against a fetch double.
 *
 * Nothing here reaches a network. What is under test is the two halves this
 * tier adds — the wire translation between Anthropic's content blocks and
 * OpenAI's messages, and the HONESTY of the capability flags: an endpoint that
 * cannot call tools must produce a run that says so rather than one that
 * silently drops them.
 */

const BASE = 'https://api.example.test/v1'

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

const frame = (payload: unknown) => `data: ${JSON.stringify(payload)}`

function fakeFetch(respond: () => Response) {
  return vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => Promise.resolve(respond()))
}

const params = (over: Partial<ChatParams> = {}): ChatParams => ({
  system: buildSystem({ agentId: 'law-explain', language: 'en', context: buildContext([]) }),
  messages: [{ role: 'user', content: [{ type: 'text', text: 'What does Rule 3 require?' }] }],
  ...over,
})

const bodyOf = (mock: ReturnType<typeof fakeFetch>): Record<string, unknown> => {
  // `RequestInit['body']` is a union that includes Blob and FormData, and
  // `String()` on either yields "[object Object]" — a body assertion that
  // passes on nothing. This provider only ever sends a JSON string; anything
  // else is a defect, and reading it as one is how that would show.
  const body = mock.mock.calls[0]?.[1]?.body
  return typeof body === 'string' ? (asRecord(parseJson(body)) ?? {}) : {}
}

const TEXT_STREAM = [
  frame({
    model: 'llama-3.3-70b',
    choices: [{ index: 0, delta: { role: 'assistant', content: 'Rule 3 ' } }],
  }),
  frame({ choices: [{ index: 0, delta: { content: 'requires integrity.' } }] }),
  frame({
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    usage: { prompt_tokens: 900, completion_tokens: 40 },
  }),
  'data: [DONE]',
]

const TOOL_STREAM = [
  frame({
    model: 'llama-3.3-70b',
    choices: [
      {
        index: 0,
        delta: {
          role: 'assistant',
          tool_calls: [
            {
              index: 0,
              id: 'call_1',
              type: 'function',
              function: { name: 'get_section', arguments: '{"act"' },
            },
          ],
        },
      },
    ],
  }),
  frame({
    choices: [
      { index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: ':"bns","section":"103"}' } }] } },
    ],
  }),
  frame({
    choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
    usage: { prompt_tokens: 100, completion_tokens: 20 },
  }),
  'data: [DONE]',
]

describe('chatUrl', () => {
  it.each([
    ['https://x.test/v1', 'https://x.test/v1/chat/completions'],
    ['https://x.test/v1/', 'https://x.test/v1/chat/completions'],
    ['  https://x.test/v1//  ', 'https://x.test/v1/chat/completions'],
    // A reader who pasted the full path from the service's own documentation.
    ['https://x.test/v1/chat/completions', 'https://x.test/v1/chat/completions'],
  ])('%s → %s', (input, expected) => {
    expect(chatUrl(input)).toBe(expected)
  })
})

describe('isUsableBaseUrl and isLocalBaseUrl', () => {
  it('accepts http as well as https, because Ollama is http on localhost', () => {
    expect(isUsableBaseUrl('https://api.groq.com/openai/v1')).toBe(true)
    expect(isUsableBaseUrl('http://localhost:11434/v1')).toBe(true)
  })

  it('refuses anything that is not a URL', () => {
    expect(isUsableBaseUrl('api.groq.com')).toBe(false)
    expect(isUsableBaseUrl('')).toBe(false)
    expect(isUsableBaseUrl('ftp://x.test')).toBe(false)
    expect(isUsableBaseUrl('javascript:alert(1)')).toBe(false)
  })

  it('knows which addresses stay on this machine', () => {
    expect(isLocalBaseUrl('http://localhost:11434/v1')).toBe(true)
    expect(isLocalBaseUrl('http://127.0.0.1:8080')).toBe(true)
    expect(isLocalBaseUrl('https://api.groq.com/openai/v1')).toBe(false)
    expect(isLocalBaseUrl('not a url')).toBe(false)
  })
})

describe('capabilityNote', () => {
  it('reports what the run will actually do', () => {
    expect(capabilityNote(['tools'])).toEqual({ mode: 'tools', i18nKey: 'tools' })
    expect(capabilityNote(['json'])).toEqual({ mode: 'json', i18nKey: 'jsonFallback' })
    expect(capabilityNote([])).toEqual({ mode: 'text', i18nKey: 'textOnly' })
    expect(capabilityNote(undefined)).toEqual({ mode: 'text', i18nKey: 'textOnly' })
  })

  it('prefers tools where both are available', () => {
    expect(capabilityNote(['json', 'tools']).mode).toBe('tools')
  })
})

describe('the constructor', () => {
  it('refuses a base URL it cannot use, rather than 404ing at request time', () => {
    expect(() => new OpenAiCompatibleProvider({ baseUrl: 'nope', model: 'm' })).toThrow(AiError)
  })

  it('refuses an empty model name', () => {
    expect(() => new OpenAiCompatibleProvider({ baseUrl: BASE, model: '   ' })).toThrow(AiError)
  })
})

describe('capabilities', () => {
  it('reports only what the reader asserted', () => {
    const none = new OpenAiCompatibleProvider({ baseUrl: BASE, model: 'm' })
    expect(none.capabilities).toMatchObject({ streaming: true, tools: false, jsonMode: false })

    const both = new OpenAiCompatibleProvider({ baseUrl: BASE, model: 'm', supports: ['tools', 'json'] })
    expect(both.capabilities).toMatchObject({ tools: true, jsonMode: true })
  })

  it('does not invent a context window for somebody else’s model', () => {
    // A figure made up here would be shown to the reader as a fact about their
    // own service.
    expect(new OpenAiCompatibleProvider({ baseUrl: BASE, model: 'm' }).capabilities.maxContext).toBe(0)
  })

  it('reports localOnly for an address on this machine, and not otherwise', () => {
    expect(
      new OpenAiCompatibleProvider({ baseUrl: 'http://localhost:11434/v1', model: 'm' }).capabilities
        .localOnly,
    ).toBe(true)
    expect(new OpenAiCompatibleProvider({ baseUrl: BASE, model: 'm' }).capabilities.localOnly).toBe(false)
  })
})

describe('streaming', () => {
  it('reassembles text and reports usage and the model', async () => {
    const doFetch = fakeFetch(() => sseResponse(TEXT_STREAM))
    const provider = new OpenAiCompatibleProvider({
      baseUrl: BASE,
      model: 'llama-3.3-70b',
      fetchImpl: doFetch,
      readKey: () => Promise.resolve('sk-test'),
    })

    const result = await provider.chat(params())
    expect(result.content).toEqual([{ type: 'text', text: 'Rule 3 requires integrity.' }])
    expect(result.stopReason).toBe('end_turn')
    expect(result.model).toBe('llama-3.3-70b')
    expect(result.usage).toEqual({
      inputTokens: 900,
      outputTokens: 40,
      // No cache split exists on this wire format, and inventing one would put
      // a number on the cost line that describes nothing.
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    })
  })

  it('emits a token event per delta, so the answer streams on screen', async () => {
    const doFetch = fakeFetch(() => sseResponse(TEXT_STREAM))
    const provider = new OpenAiCompatibleProvider({
      baseUrl: BASE,
      model: 'm',
      fetchImpl: doFetch,
      readKey: () => Promise.resolve(null),
    })
    const tokens: string[] = []
    await provider.chat(params({ onEvent: (event) => event.type === 'token' && tokens.push(event.text) }))
    expect(tokens).toEqual(['Rule 3 ', 'requires integrity.'])
  })

  it('reassembles a tool call from fragmented arguments', async () => {
    const doFetch = fakeFetch(() => sseResponse(TOOL_STREAM))
    const provider = new OpenAiCompatibleProvider({
      baseUrl: BASE,
      model: 'm',
      supports: ['tools'],
      fetchImpl: doFetch,
      readKey: () => Promise.resolve(null),
    })
    const result = await provider.chat(params())
    expect(result.stopReason).toBe('tool_use')
    expect(result.content).toEqual([
      { type: 'tool_use', id: 'call_1', name: 'get_section', input: { act: 'bns', section: '103' } },
    ])
  })

  it('ignores the [DONE] sentinel rather than reporting a parse failure', async () => {
    const doFetch = fakeFetch(() => sseResponse(['data: [DONE]']))
    const provider = new OpenAiCompatibleProvider({
      baseUrl: BASE,
      model: 'm',
      fetchImpl: doFetch,
      readKey: () => Promise.resolve(null),
    })
    await expect(provider.chat(params())).resolves.toMatchObject({ content: [] })
  })

  it('surfaces an error frame as a provider failure', async () => {
    const doFetch = fakeFetch(() => sseResponse([frame({ error: { message: 'model not found' } })]))
    const provider = new OpenAiCompatibleProvider({
      baseUrl: BASE,
      model: 'm',
      fetchImpl: doFetch,
      readKey: () => Promise.resolve(null),
    })
    await expect(provider.chat(params())).rejects.toThrow(/model not found/)
  })
})

describe('the key', () => {
  it('sends a bearer token when one is stored', async () => {
    const doFetch = fakeFetch(() => sseResponse(TEXT_STREAM))
    const provider = new OpenAiCompatibleProvider({
      baseUrl: BASE,
      model: 'm',
      fetchImpl: doFetch,
      readKey: () => Promise.resolve('sk-secret'),
    })
    await provider.chat(params())
    const headers = doFetch.mock.calls[0]?.[1]?.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer sk-secret')
  })

  it('sends NO authorization header when there is no key', async () => {
    // A local Ollama needs none, and refusing to run without one would rule out
    // the only option on this tier that sends nothing over a network.
    const doFetch = fakeFetch(() => sseResponse(TEXT_STREAM))
    const provider = new OpenAiCompatibleProvider({
      baseUrl: 'http://localhost:11434/v1',
      model: 'm',
      fetchImpl: doFetch,
      readKey: () => Promise.resolve(null),
    })
    await provider.chat(params())
    const headers = doFetch.mock.calls[0]?.[1]?.headers as Record<string, string>
    expect(headers.authorization).toBeUndefined()
  })

  it('sends nothing identifying the reader or this app', async () => {
    const doFetch = fakeFetch(() => sseResponse(TEXT_STREAM))
    const provider = new OpenAiCompatibleProvider({
      baseUrl: BASE,
      model: 'm',
      fetchImpl: doFetch,
      readKey: () => Promise.resolve('sk-secret'),
    })
    await provider.chat(params())
    const headers = doFetch.mock.calls[0]?.[1]?.headers as Record<string, string>
    expect(Object.keys(headers).sort()).toEqual(['accept', 'authorization', 'content-type'])
  })
})

describe('status mapping', () => {
  const failing = (status: number, body = '{"error":{"message":"nope"}}') =>
    new OpenAiCompatibleProvider({
      baseUrl: BASE,
      model: 'm',
      fetchImpl: fakeFetch(() => new Response(body, { status })),
      readKey: () => Promise.resolve('k'),
    })

  it('maps 401 and 403 to auth', async () => {
    await expect(failing(401).chat(params())).rejects.toMatchObject({ code: 'auth' })
    await expect(failing(403).chat(params())).rejects.toMatchObject({ code: 'auth' })
  })

  it('maps 429 to rate_limited', async () => {
    await expect(failing(429).chat(params())).rejects.toMatchObject({ code: 'rate_limited' })
  })

  it('maps everything else to provider, and carries the endpoint’s own message', async () => {
    await expect(failing(500).chat(params())).rejects.toMatchObject({ code: 'provider', message: 'nope' })
  })

  it('falls back to the status when the body carries no message', async () => {
    await expect(failing(503, 'Service Unavailable').chat(params())).rejects.toThrow(/Service Unavailable/)
  })
})

describe('buildChatCompletionsBody', () => {
  const tool: ToolSpec = {
    name: 'get_section',
    description: 'Read a section.',
    inputSchema: { type: 'object', properties: {} },
  }

  it('flattens the system blocks in order into one system message', () => {
    // Prompt caching is an Anthropic feature with an Anthropic representation;
    // there is no equivalent here. The ORDER is what src/ai/prompts.ts
    // guarantees and it survives.
    const body = buildChatCompletionsBody(params(), {
      model: 'm',
      maxTokens: 100,
      stream: true,
      tools: false,
      jsonMode: false,
    })
    const messages = body.messages as { role: string; content: string }[]
    expect(messages[0]?.role).toBe('system')
    expect(messages[0]?.content).toContain('Sahayak')
    expect(body.stream).toBe(true)
  })

  it('sends tools only when the endpoint supports them', () => {
    const without = buildChatCompletionsBody(params({ tools: [tool] }), {
      model: 'm',
      maxTokens: 100,
      stream: true,
      tools: false,
      jsonMode: true,
    })
    expect(without.tools).toBeUndefined()

    const with_ = buildChatCompletionsBody(params({ tools: [tool] }), {
      model: 'm',
      maxTokens: 100,
      stream: true,
      tools: true,
      jsonMode: true,
    })
    expect(with_.tools).toEqual([
      {
        type: 'function',
        function: { name: 'get_section', description: 'Read a section.', parameters: tool.inputSchema },
      },
    ])
  })

  it('asks for a JSON object when a schema was wanted and tools are not in play', () => {
    const body = buildChatCompletionsBody(
      params({ jsonSchema: { name: 'answer', schema: { type: 'object' } } }),
      { model: 'm', maxTokens: 100, stream: true, tools: false, jsonMode: true },
    )
    // `json_object`, not `json_schema`: the schema-constrained form is not part
    // of the compatibility surface most of these endpoints implement.
    expect(body.response_format).toEqual({ type: 'json_object' })
  })

  it('asks for nothing special when the endpoint does neither', () => {
    const body = buildChatCompletionsBody(
      params({ jsonSchema: { name: 'answer', schema: { type: 'object' } } }),
      { model: 'm', maxTokens: 100, stream: true, tools: false, jsonMode: false },
    )
    expect(body.response_format).toBeUndefined()
    expect(body.tools).toBeUndefined()
  })

  it('turns a tool RESULT turn into role: tool messages, ahead of any user text', () => {
    const body = buildChatCompletionsBody(
      params({
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'q' }] },
          {
            role: 'assistant',
            content: [{ type: 'tool_use', id: 'c1', name: 'get_section', input: { section: '103' } }],
          },
          {
            role: 'user',
            content: [
              { type: 'tool_result', toolUseId: 'c1', content: '[T1] {"found":true}' },
              { type: 'text', text: 'and now?' },
            ],
          },
        ],
      }),
      { model: 'm', maxTokens: 100, stream: true, tools: true, jsonMode: false },
    )
    const messages = body.messages as { role: string; tool_call_id?: string }[]
    expect(messages.map((message) => message.role)).toEqual(['system', 'user', 'assistant', 'tool', 'user'])
    expect(messages[3]?.tool_call_id).toBe('c1')
  })

  it('serialises a tool call’s arguments as a JSON string, which is what the format wants', () => {
    const body = buildChatCompletionsBody(
      params({
        messages: [
          { role: 'assistant', content: [{ type: 'tool_use', id: 'c1', name: 'f', input: { a: 1 } }] },
        ],
      }),
      { model: 'm', maxTokens: 100, stream: true, tools: true, jsonMode: false },
    )
    const assistant = (body.messages as Record<string, unknown>[])[1]
    const calls = assistant?.tool_calls as { function: { arguments: string } }[]
    expect(calls[0]?.function.arguments).toBe('{"a":1}')
  })
})

describe('parseChatCompletion', () => {
  it('reads a non-streamed reply into the same shape', () => {
    const result = parseChatCompletion(
      {
        model: 'gpt-x',
        choices: [{ message: { content: 'hello' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 1 },
      },
      'fallback',
    )
    expect(result).toMatchObject({
      content: [{ type: 'text', text: 'hello' }],
      stopReason: 'end_turn',
      model: 'gpt-x',
    })
  })

  it('maps length to truncation, so a cut-off answer is never shown as complete', () => {
    expect(
      parseChatCompletion({ choices: [{ message: { content: 'half' }, finish_reason: 'length' }] }, 'm')
        .stopReason,
    ).toBe('max_tokens')
  })

  it('reads a tool call from a non-streamed reply', () => {
    const result = parseChatCompletion(
      {
        choices: [
          {
            message: { tool_calls: [{ id: 'c1', function: { name: 'f', arguments: '{"a":2}' } }] },
            finish_reason: 'tool_calls',
          },
        ],
      },
      'm',
    )
    expect(result.content).toEqual([{ type: 'tool_use', id: 'c1', name: 'f', input: { a: 2 } }])
  })

  it('survives a reply with no choices at all', () => {
    expect(parseChatCompletion({}, 'm')).toMatchObject({ content: [], model: 'm' })
  })
})

describe('testConnection', () => {
  it('makes exactly one request, of one token', async () => {
    const doFetch = fakeFetch(
      () =>
        new Response(JSON.stringify({ model: 'm', choices: [{ message: { content: 'ok' } }] }), {
          status: 200,
        }),
    )
    const provider = new OpenAiCompatibleProvider({
      baseUrl: BASE,
      model: 'm',
      fetchImpl: doFetch,
      readKey: () => Promise.resolve('k'),
    })
    await provider.testConnection()
    expect(doFetch).toHaveBeenCalledTimes(1)
    expect(bodyOf(doFetch).max_tokens).toBe(1)
    expect(bodyOf(doFetch).stream).toBeUndefined()
  })
})
