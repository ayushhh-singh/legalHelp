import { describe, expect, it } from 'vitest'

import {
  DEFAULT_ALLOWED_MODELS,
  addToBudget,
  budgetKey,
  checkBody,
  checkBudget,
  checkRateLimit,
  clientIp,
  corsHeaders,
  countTokens,
  createTokenMeter,
  originAllowed,
  readConfig,
  windowKey,
} from '../src/policy'
import type { Env, KvLike } from '../src/types'

/**
 * The four guards, tested by calling them.
 *
 * `test/worker.test.ts` runs the same guards through workerd, which is what
 * proves the wiring; this file is what proves the decisions. A limit that is
 * off by one is not visible in an integration test that only ever sends one
 * request.
 */

function kv(initial: Record<string, string> = {}): KvLike & { store: Map<string, string> } {
  const store = new Map(Object.entries(initial))
  return {
    store,
    get: (key) => Promise.resolve(store.get(key) ?? null),
    put: (key, value) => {
      store.set(key, value)
      return Promise.resolve()
    },
  }
}

const ORIGIN = 'https://legalhelp.pages.dev'

function env(over: Partial<Env> = {}): Env {
  return { ALLOWED_ORIGINS: ORIGIN, RL: kv(), ...over }
}

describe('readConfig', () => {
  it('falls back to the built-in model allowlist rather than to an empty one', () => {
    // An empty allowlist would mean "allow nothing", which reads as a broken
    // deployment; a missing var must mean "the safe default", not "closed".
    expect(readConfig(env()).allowedModels).toEqual(DEFAULT_ALLOWED_MODELS)
    expect(readConfig(env({ ALLOWED_MODELS: '  ,  ' })).allowedModels).toEqual(DEFAULT_ALLOWED_MODELS)
  })

  it('keeps a deliberate zero apart from an unparseable value', () => {
    // Zero is meaningful here — "refuse everything" — so a typo must not
    // produce it by accident, and an explicit 0 must survive.
    expect(readConfig(env({ DAILY_TOKEN_BUDGET: '0' })).dailyTokenBudget).toBe(0)
    expect(readConfig(env({ DAILY_TOKEN_BUDGET: 'lots' })).dailyTokenBudget).toBe(500_000)
    expect(readConfig(env({ DAILY_TOKEN_BUDGET: '-5' })).dailyTokenBudget).toBe(500_000)
  })

  it('splits and trims the origin and model lists', () => {
    const config = readConfig(
      env({ ALLOWED_ORIGINS: ` ${ORIGIN} , https://x.test `, ALLOWED_MODELS: 'a, b' }),
    )
    expect(config.allowedOrigins).toEqual([ORIGIN, 'https://x.test'])
    expect(config.allowedModels).toEqual(['a', 'b'])
  })

  it('never lets the window be zero seconds', () => {
    // windowKey divides by it.
    expect(readConfig(env({ RATE_LIMIT_WINDOW_SECONDS: '0' })).rateLimitWindowSeconds).toBe(1)
  })
})

describe('CORS', () => {
  const config = readConfig(env())

  it('echoes only an allowlisted origin, and always varies on it', () => {
    expect(corsHeaders(ORIGIN, config)['access-control-allow-origin']).toBe(ORIGIN)
    expect(corsHeaders(ORIGIN, config).vary).toBe('Origin')
  })

  it('returns no allow-origin at all for an unlisted origin', () => {
    const headers = corsHeaders('https://evil.test', config)
    expect(headers['access-control-allow-origin']).toBeUndefined()
    expect(headers.vary).toBe('Origin')
  })

  it('never answers with a wildcard, for any input', () => {
    for (const origin of [ORIGIN, 'https://evil.test', '*', null]) {
      expect(Object.values(corsHeaders(origin, config))).not.toContain('*')
    }
  })

  it('refuses a request with no Origin header', () => {
    // Every non-browser caller has this shape, and those are exactly the
    // callers the operator is not paying for.
    expect(originAllowed(null, config)).toBe(false)
    expect(originAllowed(ORIGIN, config)).toBe(true)
    expect(originAllowed('https://legalhelp.pages.dev/', config)).toBe(false)
  })
})

describe('checkBody', () => {
  const config = readConfig(env({ ALLOWED_MODELS: 'claude-sonnet-4-6', MAX_OUTPUT_TOKENS: '1000' }))

  it('refuses a model that is not on the list', () => {
    const result = checkBody({ model: 'claude-opus-5', max_tokens: 10 }, config)
    expect(result.ok).toBe(false)
    expect(result.status).toBe(403)
    expect(result.reason).toContain('claude-opus-5')
  })

  it('accepts an allowlisted model and clamps max_tokens down', () => {
    const result = checkBody({ model: 'claude-sonnet-4-6', max_tokens: 64_000 }, config)
    expect(result.ok).toBe(true)
    expect(result.body?.max_tokens).toBe(1000)
  })

  it('leaves a smaller max_tokens alone and never raises it', () => {
    expect(checkBody({ model: 'claude-sonnet-4-6', max_tokens: 8 }, config).body?.max_tokens).toBe(8)
  })

  it('supplies max_tokens when the caller omitted it', () => {
    expect(checkBody({ model: 'claude-sonnet-4-6' }, config).body?.max_tokens).toBe(1000)
  })

  it('forwards every other field untouched', () => {
    const body = { model: 'claude-sonnet-4-6', stream: true, system: [{ type: 'text', text: 'x' }] }
    expect(checkBody(body, config).body).toMatchObject({ stream: true, system: body.system })
  })

  it('refuses a body that is not an object, and one with no model', () => {
    expect(checkBody('hello', config).status).toBe(400)
    expect(checkBody([], config).status).toBe(400)
    expect(checkBody({ max_tokens: 5 }, config).status).toBe(400)
  })
})

describe('checkRateLimit', () => {
  const config = readConfig(env({ RATE_LIMIT_PER_WINDOW: '3', RATE_LIMIT_WINDOW_SECONDS: '60' }))
  const NOW = Date.parse('2026-08-30T10:00:10.000Z')

  it('allows exactly the limit and then refuses', async () => {
    const store = kv()
    for (let i = 1; i <= 3; i += 1) {
      const decision = await checkRateLimit(store, '1.2.3.4', config, NOW)
      expect(decision.allowed).toBe(true)
      expect(decision.count).toBe(i)
    }
    const fourth = await checkRateLimit(store, '1.2.3.4', config, NOW)
    expect(fourth.allowed).toBe(false)
    expect(fourth.limit).toBe(3)
  })

  it('counts each IP separately', async () => {
    const store = kv()
    for (let i = 0; i < 3; i += 1) await checkRateLimit(store, 'a', config, NOW)
    expect((await checkRateLimit(store, 'a', config, NOW)).allowed).toBe(false)
    expect((await checkRateLimit(store, 'b', config, NOW)).allowed).toBe(true)
  })

  it('starts a fresh window at the next boundary', async () => {
    const store = kv()
    for (let i = 0; i < 3; i += 1) await checkRateLimit(store, 'a', config, NOW)
    expect((await checkRateLimit(store, 'a', config, NOW)).allowed).toBe(false)
    // 10:01:10 is in the next 60s window.
    expect((await checkRateLimit(store, 'a', config, NOW + 60_000)).allowed).toBe(true)
  })

  it('quantises the key so every request in one window shares it', () => {
    expect(windowKey('a', Date.parse('2026-08-30T10:00:00Z'), 60)).toBe(
      windowKey('a', Date.parse('2026-08-30T10:00:59Z'), 60),
    )
    expect(windowKey('a', Date.parse('2026-08-30T10:00:59Z'), 60)).not.toBe(
      windowKey('a', Date.parse('2026-08-30T10:01:00Z'), 60),
    )
  })

  it('reports the seconds left in the window, never zero', async () => {
    const store = kv()
    for (let i = 0; i < 3; i += 1) await checkRateLimit(store, 'a', config, NOW)
    // 10:00:10 into a 60s window: 50 seconds left.
    expect((await checkRateLimit(store, 'a', config, NOW)).retryAfter).toBe(50)
    // Exactly on the boundary the modulus is 0, which would be a Retry-After
    // of 0 — a client is entitled to read that as "retry immediately".
    const onBoundary = Date.parse('2026-08-30T10:00:00.000Z')
    const fresh = kv()
    for (let i = 0; i < 3; i += 1) await checkRateLimit(fresh, 'a', config, onBoundary)
    expect((await checkRateLimit(fresh, 'a', config, onBoundary)).retryAfter).toBe(60)
  })

  it('treats a corrupt counter as zero rather than as infinity', async () => {
    // A hand-edited or half-written KV value must not be able to lock a caller
    // out permanently, nor to read as NaN >= limit (which is false, and would
    // silently disable the limiter).
    const store = kv({ [windowKey('a', NOW, 60)]: 'not-a-number' })
    const decision = await checkRateLimit(store, 'a', config, NOW)
    expect(decision.allowed).toBe(true)
    expect(decision.count).toBe(1)
  })

  it('counts the request before it is forwarded', async () => {
    // Otherwise a caller who reliably triggers an upstream error is never
    // counted at all and can hold the limiter open indefinitely.
    const store = kv()
    await checkRateLimit(store, 'a', config, NOW)
    expect(store.store.get(windowKey('a', NOW, 60))).toBe('1')
  })
})

describe('the daily budget', () => {
  const config = readConfig(env({ DAILY_TOKEN_BUDGET: '1000' }))
  const NOW = Date.parse('2026-08-30T23:59:00.000Z')

  it('is keyed on the UTC day', () => {
    expect(budgetKey(NOW)).toBe('budget:2026-08-30')
    expect(budgetKey(NOW + 120_000)).toBe('budget:2026-08-31')
  })

  it('allows until the ceiling is reached, then refuses', async () => {
    const store = kv()
    expect((await checkBudget(store, config, NOW)).allowed).toBe(true)
    await addToBudget(store, 999, NOW)
    expect((await checkBudget(store, config, NOW)).allowed).toBe(true)
    await addToBudget(store, 1, NOW)
    const refused = await checkBudget(store, config, NOW)
    expect(refused.allowed).toBe(false)
    expect(refused.used).toBe(1000)
    expect(refused.limit).toBe(1000)
  })

  it('resets at the UTC day boundary', async () => {
    const store = kv()
    await addToBudget(store, 5_000, NOW)
    expect((await checkBudget(store, config, NOW)).allowed).toBe(false)
    expect((await checkBudget(store, config, NOW + 120_000)).allowed).toBe(true)
  })

  it('a budget of zero refuses the very first request', async () => {
    const zero = readConfig(env({ DAILY_TOKEN_BUDGET: '0' }))
    expect((await checkBudget(kv(), zero, NOW)).allowed).toBe(false)
  })

  it('ignores a non-positive addition rather than writing a key for it', async () => {
    const store = kv()
    await addToBudget(store, 0, NOW)
    await addToBudget(store, -10, NOW)
    expect(store.store.size).toBe(0)
  })
})

describe('countTokens', () => {
  it('adds the input and output halves of a streamed response', () => {
    const sse = [
      'event: message_start',
      'data: {"type":"message_start","message":{"model":"claude-sonnet-4-6","usage":{"input_tokens":120,"cache_read_input_tokens":30,"output_tokens":1}}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"hello"}}',
      '',
      'event: message_delta',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":64}}',
      '',
    ].join('\n')
    // 120 + 30 input, 64 output — the running output count replaces the 1 in
    // message_start rather than adding to it.
    expect(countTokens(sse)).toBe(214)
  })

  it('reads a non-streamed body, which is one line with no newline', () => {
    expect(countTokens(JSON.stringify({ usage: { input_tokens: 10, output_tokens: 5 } }))).toBe(15)
  })

  it('counts nothing rather than throwing on junk', () => {
    expect(countTokens('data: not json\n\ndata: [DONE]\n')).toBe(0)
    expect(countTokens('')).toBe(0)
  })

  it('gives the same answer however the chunk boundaries fall', () => {
    // The real stream arrives in arbitrary pieces, so a meter that only works
    // when a frame lands whole in one chunk works only in a test.
    const sse =
      'data: {"type":"message_start","message":{"usage":{"input_tokens":100}}}\n\n' +
      'data: {"type":"message_delta","usage":{"output_tokens":40}}\n\n'
    for (const size of [1, 3, 7, 17, 64, 4096]) {
      const meter = createTokenMeter()
      for (let i = 0; i < sse.length; i += size) meter.push(sse.slice(i, i + size))
      expect(meter.end(), `chunk size ${size}`).toBe(140)
    }
  })
})

describe('clientIp', () => {
  it('reads CF-Connecting-IP and ignores X-Forwarded-For', () => {
    // X-Forwarded-For is caller-supplied. Trusting it would let one caller
    // spread itself across as many rate-limit buckets as it liked.
    const request = new Request('https://proxy.test/v1/messages', {
      headers: { 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '198.51.100.1' },
    })
    expect(clientIp(request)).toBe('203.0.113.7')

    const spoofed = new Request('https://proxy.test/v1/messages', {
      headers: { 'x-forwarded-for': '198.51.100.1' },
    })
    expect(clientIp(spoofed)).toBe('unknown')
  })
})
