import { describe, expect, it, vi } from 'vitest'

import { buildMessagesBody, streamMessages, postJson } from './wire'

import { buildContext } from '../context'
import { buildSystem } from '../prompts'
import type { ChatParams } from '../types'

/**
 * The transport, at its edges. Everything here is a shape a real server or a
 * real network can produce and a naive reader cannot survive.
 */

function streamOf(text: string): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text))
      controller.close()
    },
  })
  return new Response(body, { status: 200 })
}

/** Emits the payload in arbitrary byte-sized pieces, as a real socket would. */
function chunkedStream(text: string, size: number): Response {
  const bytes = new TextEncoder().encode(text)
  let offset = 0
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset >= bytes.length) {
          controller.close()
          return
        }
        controller.enqueue(bytes.slice(offset, offset + size))
        offset += size
      },
    }),
    { status: 200 },
  )
}

const call = (response: () => Response, signal?: AbortSignal) =>
  streamMessages({
    url: 'https://api.anthropic.com/v1/messages',
    headers: {},
    body: { model: 'claude-sonnet-4-6' },
    ...(signal ? { signal } : {}),
    fetchImpl: vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => Promise.resolve(response())),
  })

const START =
  'event: message_start\ndata: {"type":"message_start","message":{"model":"claude-sonnet-4-6","usage":{"input_tokens":10}}}'
const TEXT_START =
  'event: x\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}'
const DELTA =
  'event: x\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}'
const STOP =
  'event: x\ndata: {"type":"message_delta","delta":{"stop_reason":"max_tokens"},"usage":{"output_tokens":7}}'

describe('SSE framing', () => {
  it('reads a stream framed with CRLF, not just LF', async () => {
    const result = await call(() => streamOf([START, TEXT_START, DELTA, STOP].join('\r\n\r\n') + '\r\n\r\n'))

    expect(result.content).toEqual([{ type: 'text', text: 'Hello' }])
    expect(result.stopReason).toBe('max_tokens')
  })

  it('survives a CR and its LF arriving in different chunks', async () => {
    // Normalising only the newest chunk would leave that pair intact and
    // mis-frame everything after it, so the whole buffer is normalised.
    const payload = [START, TEXT_START, DELTA, STOP].join('\r\n\r\n') + '\r\n\r\n'
    const result = await call(() => chunkedStream(payload, 1))

    expect(result.content).toEqual([{ type: 'text', text: 'Hello' }])
    expect(result.stopReason).toBe('max_tokens')
  })

  it('does not lose the last frame when the stream ends without a blank line', async () => {
    // That frame is usually the message_delta carrying stop_reason and the
    // output token count — dropping it reports end_turn for a truncated turn.
    const result = await call(() => streamOf([START, TEXT_START, DELTA, STOP].join('\n\n')))

    expect(result.stopReason).toBe('max_tokens')
    expect(result.usage.outputTokens).toBe(7)
  })

  it('accepts `data:` with no space after the colon', async () => {
    const frame = 'data:{"type":"content_block_start","index":0,"content_block":{"type":"text","text":"hi"}}'
    const result = await call(() => streamOf(`${frame}\n\n`))

    expect(result.content).toEqual([{ type: 'text', text: 'hi' }])
  })

  it('joins a data field split across several lines, as the SSE grammar says', async () => {
    const frame = [
      'data: {"type":"content_block_start","index":0,',
      'data: "content_block":{"type":"text","text":"split"}}',
    ].join('\n')
    const result = await call(() => streamOf(`${frame}\n\n`))

    expect(result.content).toEqual([{ type: 'text', text: 'split' }])
  })

  it('ignores comment and empty frames rather than failing on them', async () => {
    const result = await call(() =>
      streamOf([': keep-alive', START, TEXT_START, DELTA].join('\n\n') + '\n\n'),
    )

    expect(result.content).toEqual([{ type: 'text', text: 'Hello' }])
  })

  it('reassembles a text block delivered one byte at a time', async () => {
    const result = await call(() => chunkedStream([START, TEXT_START, DELTA, DELTA].join('\n\n') + '\n\n', 1))

    expect(result.content).toEqual([{ type: 'text', text: 'HelloHello' }])
  })
})

describe('transport failures', () => {
  it('reports a cancelled request as aborted, not as an unreachable service', async () => {
    // fetch rejects with a DOMException on abort, never with an AiError; without
    // classifying it the reader is told the AI service could not be reached.
    const controller = new AbortController()
    controller.abort()

    await expect(
      streamMessages({
        url: 'https://api.anthropic.com/v1/messages',
        headers: {},
        body: {},
        signal: controller.signal,
        fetchImpl: vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
          Promise.reject(new DOMException('The operation was aborted.', 'AbortError')),
        ),
      }),
    ).rejects.toMatchObject({ code: 'aborted' })
  })

  it('reports a dropped connection as a provider failure', async () => {
    await expect(
      streamMessages({
        url: 'https://api.anthropic.com/v1/messages',
        headers: {},
        body: {},
        fetchImpl: vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
          Promise.reject(new TypeError('Failed to fetch')),
        ),
      }),
    ).rejects.toMatchObject({ code: 'provider', message: 'Failed to fetch' })
  })

  it('classifies a cancelled non-streaming ping the same way', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(
      postJson({
        url: 'https://api.anthropic.com/v1/messages',
        headers: {},
        body: {},
        signal: controller.signal,
        fetchImpl: vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
          Promise.reject(new DOMException('aborted', 'AbortError')),
        ),
      }),
    ).rejects.toMatchObject({ code: 'aborted' })
  })

  it('refuses a 200 that carries no body to read', async () => {
    await expect(call(() => new Response(null, { status: 200 }))).rejects.toMatchObject({
      code: 'provider',
    })
  })
})

describe('buildMessagesBody', () => {
  const params = (over: Partial<ChatParams> = {}): ChatParams => ({
    system: buildSystem({ agentId: 'law-explain', language: 'en', context: buildContext([]) }),
    messages: [{ role: 'user', content: [{ type: 'text', text: 'q' }] }],
    ...over,
  })

  it('drops an empty system block instead of sending one the API rejects', () => {
    const body = buildMessagesBody(
      params({ system: [{ text: 'Persona.', cache: true }, { text: '   ' }, { text: '' }] }),
      { effort: 'medium', stream: true },
    )

    expect(body.system).toEqual([{ type: 'text', text: 'Persona.', cache_control: { type: 'ephemeral' } }])
  })

  it('clamps max_tokens to what the model can actually emit', () => {
    const body = buildMessagesBody(params({ maxTokens: 10_000_000, model: 'claude-haiku-4-5' }), {
      effort: 'medium',
      stream: true,
    })

    expect(body.max_tokens).toBe(32_000)
  })
})
