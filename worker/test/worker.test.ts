import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'
import { Miniflare } from 'miniflare'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * The same Worker, in workerd, through miniflare.
 *
 * `test/policy.test.ts` proves the decisions; this file proves the wiring, and
 * the two things only a real runtime can settle: that the outbound request is
 * built from scratch with the operator's key and NONE of the caller's headers,
 * and that an SSE response is streamed through rather than buffered.
 *
 * The upstream is stubbed with miniflare's `outboundService`, so this suite
 * reaches no network at all — which is also what lets it assert on exactly
 * what the Worker would have sent to Anthropic.
 */

const ORIGIN = 'https://legalhelp.pages.dev'
const KEY = 'sk-ant-worker-test-key'

interface Seen {
  url: string
  headers: Record<string, string>
  body: string
}

let mf: Miniflare
let seen: Seen[] = []
/** Set per test; the stub answers with whatever this returns. */
let upstream: (request: Request) => Response

/** The Worker is TypeScript; workerd runs JavaScript. */
async function bundle(): Promise<string> {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../src/index.ts', import.meta.url))],
    bundle: true,
    format: 'esm',
    target: 'es2022',
    platform: 'neutral',
    write: false,
  })
  return result.outputFiles[0]?.text ?? ''
}

function sse(frames: string[]): Response {
  return new Response(frames.join(''), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
}

const OK_JSON = () =>
  new Response(
    JSON.stringify({
      id: 'msg_1',
      model: 'claude-sonnet-4-6',
      content: [{ type: 'text', text: 'hello' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 100, output_tokens: 40 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )

beforeAll(async () => {
  const script = await bundle()
  upstream = OK_JSON
  mf = new Miniflare({
    modules: true,
    script,
    compatibilityDate: '2026-08-01',
    kvNamespaces: ['RL'],
    bindings: {
      ANTHROPIC_API_KEY: KEY,
      ALLOWED_ORIGINS: ORIGIN,
      ALLOWED_MODELS: 'claude-sonnet-4-6',
      RATE_LIMIT_PER_WINDOW: '4',
      RATE_LIMIT_WINDOW_SECONDS: '60',
      DAILY_TOKEN_BUDGET: '1000',
      MAX_OUTPUT_TOKENS: '256',
      // Any absolute URL: outboundService intercepts before DNS.
      ANTHROPIC_BASE_URL: 'https://upstream.invalid',
    },
    outboundService: async (request: Request) => {
      seen.push({
        url: request.url,
        headers: Object.fromEntries(request.headers),
        body: await request.text(),
      })
      return upstream(request) as unknown as Response
    },
  })
  await mf.ready
})

afterAll(async () => {
  await mf?.dispose()
})

async function post(
  body: unknown,
  init: { origin?: string | null; ip?: string; accept?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'cf-connecting-ip': init.ip ?? `10.0.0.${Math.floor(Math.random() * 200) + 1}`,
  }
  if (init.origin !== null) headers.origin = init.origin ?? ORIGIN
  if (init.accept) headers.accept = init.accept
  return (await mf.dispatchFetch('https://proxy.test/v1/messages', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })) as unknown as Response
}

const CALL = { model: 'claude-sonnet-4-6', max_tokens: 64, messages: [{ role: 'user', content: 'hi' }] }

describe('routing and CORS', () => {
  it('answers a preflight from the app origin and refuses one from anywhere else', async () => {
    const allowed = await mf.dispatchFetch('https://proxy.test/v1/messages', {
      method: 'OPTIONS',
      headers: { origin: ORIGIN },
    })
    expect(allowed.status).toBe(204)
    expect(allowed.headers.get('access-control-allow-origin')).toBe(ORIGIN)
    expect(allowed.headers.get('vary')).toBe('Origin')

    const refused = await mf.dispatchFetch('https://proxy.test/v1/messages', {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.test' },
    })
    expect(refused.status).toBe(403)
    expect(refused.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('refuses a POST from an unlisted origin, and one with no origin at all', async () => {
    seen = []
    expect((await post(CALL, { origin: 'https://evil.test' })).status).toBe(403)
    expect((await post(CALL, { origin: null })).status).toBe(403)
    // The refusal happens before the key is attached: nothing reached upstream.
    expect(seen).toHaveLength(0)
  })

  it('serves only POST /v1/messages', async () => {
    const wrongPath = await mf.dispatchFetch('https://proxy.test/v1/anything', {
      method: 'POST',
      headers: { origin: ORIGIN },
    })
    expect(wrongPath.status).toBe(404)

    const wrongMethod = await mf.dispatchFetch('https://proxy.test/v1/messages', {
      method: 'GET',
      headers: { origin: ORIGIN },
    })
    expect(wrongMethod.status).toBe(405)
  })

  it('has a health check that spends nothing and reveals no key', async () => {
    seen = []
    const response = await mf.dispatchFetch('https://proxy.test/healthz', {
      headers: { origin: ORIGIN },
    })
    const text = await response.text()
    expect(response.status).toBe(200)
    expect(JSON.parse(text)).toEqual({ ok: true, keyConfigured: true })
    expect(text).not.toContain(KEY)
    expect(seen).toHaveLength(0)
  })
})

describe('the model allowlist', () => {
  it('refuses a model the operator did not budget for, before forwarding', async () => {
    seen = []
    const response = await post({ ...CALL, model: 'claude-opus-5' })
    expect(response.status).toBe(403)
    expect(await response.text()).toContain('claude-opus-5')
    expect(seen).toHaveLength(0)
  })

  it('refuses a body that is not JSON', async () => {
    const response = await mf.dispatchFetch('https://proxy.test/v1/messages', {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': 'application/json', 'cf-connecting-ip': '10.9.9.9' },
      body: 'not json',
    })
    expect(response.status).toBe(400)
  })
})

describe('the upstream request', () => {
  it('carries the operator key and none of the caller headers', async () => {
    seen = []
    upstream = OK_JSON
    const response = await mf.dispatchFetch('https://proxy.test/v1/messages', {
      method: 'POST',
      headers: {
        origin: ORIGIN,
        'content-type': 'application/json',
        'cf-connecting-ip': '10.1.1.1',
        // Everything a browser or a hostile caller might attach.
        cookie: 'session=SENTINEL-COOKIE',
        referer: 'https://legalhelp.pages.dev/law?q=SENTINEL-QUERY',
        'x-api-key': 'sk-ant-CALLER-SUPPLIED',
        authorization: 'Bearer SENTINEL-BEARER',
        'user-agent': 'SENTINEL-UA',
      },
      body: JSON.stringify(CALL),
    })
    expect(response.status).toBe(200)

    expect(seen).toHaveLength(1)
    const sent = seen[0]!
    expect(sent.url).toBe('https://upstream.invalid/v1/messages')
    expect(sent.headers['x-api-key']).toBe(KEY)
    expect(sent.headers['anthropic-version']).toBe('2023-06-01')

    const asText = JSON.stringify(sent.headers)
    for (const sentinel of ['SENTINEL-COOKIE', 'SENTINEL-QUERY', 'SENTINEL-BEARER', 'SENTINEL-UA']) {
      expect(asText, `${sentinel} crossed the boundary`).not.toContain(sentinel)
    }
    expect(asText).not.toContain('sk-ant-CALLER-SUPPLIED')
  })

  it('clamps max_tokens and forwards every other field unchanged', async () => {
    seen = []
    await post({ ...CALL, max_tokens: 99_999, stream: false, temperature: 0.3 })
    const body = JSON.parse(seen[0]?.body ?? '{}') as Record<string, unknown>
    expect(body.max_tokens).toBe(256)
    expect(body.temperature).toBe(0.3)
    expect(body.messages).toEqual(CALL.messages)
  })
})

describe('streaming', () => {
  it('passes an SSE body through in pieces rather than in one lump', async () => {
    seen = []
    upstream = () =>
      sse([
        'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":10}}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"धारा 103"}}\n\n',
        'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":7}}\n\n',
      ])

    const response = await post({ ...CALL, stream: true }, { accept: 'text/event-stream' })
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    expect(response.headers.get('access-control-allow-origin')).toBe(ORIGIN)
    // A stream nobody may cache: it is one reader's answer.
    expect(response.headers.get('cache-control')).toBe('no-store')

    const text = await response.text()
    expect(text).toContain('message_start')
    expect(text).toContain('धारा 103')
    expect(text).toContain('message_delta')

    // `accept` is the one caller header the Worker echoes, and only as one of
    // two literal values — it is what decides whether Anthropic streams.
    expect(seen[0]?.headers.accept).toBe('text/event-stream')
  })
})

describe('the daily budget', () => {
  it('refuses once the day is spent, and says so in the Messages error envelope', async () => {
    // A fresh Miniflare so this test's KV is its own.
    const script = await bundle()
    const local = new Miniflare({
      modules: true,
      script,
      compatibilityDate: '2026-08-01',
      kvNamespaces: ['RL'],
      bindings: {
        ANTHROPIC_API_KEY: KEY,
        ALLOWED_ORIGINS: ORIGIN,
        ALLOWED_MODELS: 'claude-sonnet-4-6',
        RATE_LIMIT_PER_WINDOW: '100',
        DAILY_TOKEN_BUDGET: '120',
        ANTHROPIC_BASE_URL: 'https://upstream.invalid',
      },
      outboundService: () => OK_JSON() as unknown as Response,
    })
    await local.ready

    const send = () =>
      local.dispatchFetch('https://proxy.test/v1/messages', {
        method: 'POST',
        headers: { origin: ORIGIN, 'content-type': 'application/json', 'cf-connecting-ip': '10.2.2.2' },
        body: JSON.stringify(CALL),
      })

    // The first answer costs 140 tokens (100 in, 40 out), which is over the
    // 120-token ceiling — so the ceiling is crossed by at most one request,
    // exactly as checkBudget documents, and the SECOND one is refused.
    expect((await send()).status).toBe(200)

    // waitUntil settles when the instance is disposed of, and the metered
    // count is only written then. Waiting for the KV key is the honest way to
    // know the background write landed; polling a fixed sleep is not.
    // Miniflare's own KV type is not the runtime one; only `get` is needed.
    const kv = (await local.getKVNamespace('RL')) as unknown as {
      get: (key: string) => Promise<string | null>
    }
    const day = `budget:${new Date().toISOString().slice(0, 10)}`
    for (let i = 0; i < 100 && (await kv.get(day)) === null; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    expect(await kv.get(day)).toBe('140')

    const refused = await send()
    expect(refused.status).toBe(429)
    const payload = JSON.parse(await refused.text()) as { error?: { type?: string } }
    expect(payload.error?.type).toBe('budget_exhausted')

    await local.dispose()
  })
})

describe('the rate limit', () => {
  it('refuses the caller past the window limit and sets Retry-After', async () => {
    const ip = '10.3.3.3'
    seen = []
    upstream = OK_JSON

    for (let i = 0; i < 4; i += 1) {
      expect((await post(CALL, { ip })).status, `request ${i + 1}`).toBe(200)
    }
    const refused = await post(CALL, { ip })
    expect(refused.status).toBe(429)
    expect(Number(refused.headers.get('retry-after'))).toBeGreaterThan(0)

    // Another IP is unaffected, so the limit is per caller and not global.
    expect((await post(CALL, { ip: '10.4.4.4' })).status).toBe(200)
  })
})
