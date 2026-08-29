import {
  ANTHROPIC_VERSION,
  addToBudget,
  checkBody,
  checkBudget,
  checkRateLimit,
  clientIp,
  corsHeaders,
  createTokenMeter,
  originAllowed,
  readConfig,
} from './policy'
import type { Env, ExecutionContextLike } from './types'

/**
 * Sahayak's Tier 2 proxy.
 *
 * It exists so that a reader who has no Anthropic account can still use the
 * app's AI surfaces: the operator's key sits here as a secret, the browser
 * sends no credential at all, and the wire format is byte-for-byte the one
 * `src/ai/providers/wire.ts` already speaks — which is why `ProxyProvider` is
 * thirty lines and shares every parser with Tier 1.
 *
 * WHAT THIS WORKER CAN SEE, said plainly because the app's consent modal says
 * it too: every prompt that passes through it. That is the entire difference
 * between Tier 1 and Tier 2, and it is why the operator's own honesty is part
 * of the arrangement. Concretely, this file:
 *
 *   - logs NO request body, NO response body and NO prompt text, ever. The
 *     only thing written anywhere is a per-IP counter and a per-day token
 *     total, both integers, both expiring.
 *   - reads exactly two fields of the request body (`model`, `max_tokens`) and
 *     forwards the rest untouched.
 *   - forwards no header the caller sent. The upstream request is built from
 *     scratch, so a `cookie`, a `referer`, a caller-supplied `x-api-key` or
 *     anything else identifying cannot cross this boundary by accident.
 *
 * Four guards run before the key is ever attached, in this order, cheapest
 * first: origin, rate limit, model allowlist, daily budget.
 */

const JSON_HEADERS = { 'content-type': 'application/json' }

function refuse(
  status: number,
  type: string,
  message: string,
  headers: Record<string, string>,
  extra: Record<string, string> = {},
): Response {
  // The Messages API's own error envelope, so `wire.ts#throwForStatus` reads a
  // refusal from here exactly as it reads one from Anthropic — the reader gets
  // a sentence rather than "the AI service could not be reached".
  return new Response(JSON.stringify({ type: 'error', error: { type, message } }), {
    status,
    headers: { ...JSON_HEADERS, ...headers, ...extra },
  })
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContextLike): Promise<Response> {
    const config = readConfig(env)
    const origin = request.headers.get('origin')
    const cors = corsHeaders(origin, config)
    const url = new URL(request.url)

    if (request.method === 'OPTIONS') {
      // 204 with the CORS headers when the origin is allowed, 403 when it is
      // not. A preflight that succeeds for an unlisted origin would let the
      // browser send the real request, which would then be refused anyway —
      // failing here is the same answer, one round trip earlier.
      if (!originAllowed(origin, config)) {
        return refuse(403, 'forbidden', 'This origin is not allowed.', cors)
      }
      return new Response(null, { status: 204, headers: cors })
    }

    // A liveness check that touches neither the key nor KV, so "is it
    // deployed?" is answerable without spending anything. It deliberately
    // reports whether a key is configured, and never any part of it.
    if (request.method === 'GET' && url.pathname === '/healthz') {
      return new Response(JSON.stringify({ ok: true, keyConfigured: Boolean(env.ANTHROPIC_API_KEY) }), {
        status: 200,
        headers: { ...JSON_HEADERS, ...cors },
      })
    }

    if (url.pathname !== '/v1/messages') {
      return refuse(404, 'not_found', 'This proxy serves POST /v1/messages only.', cors)
    }
    if (request.method !== 'POST') {
      return refuse(405, 'method_not_allowed', 'This proxy serves POST /v1/messages only.', cors)
    }

    if (!originAllowed(origin, config)) {
      return refuse(403, 'forbidden', 'This origin is not allowed.', cors)
    }

    if (!env.ANTHROPIC_API_KEY) {
      // Deployed with no secret. Said out loud rather than surfacing as an
      // upstream 401, which would read to the operator as a bad key rather
      // than an absent one. See README.md — `wrangler secret put`.
      return refuse(503, 'not_configured', 'This proxy has no API key configured.', cors)
    }

    const now = Date.now()

    const rate = await checkRateLimit(env.RL, clientIp(request), config, now)
    if (!rate.allowed) {
      return refuse(429, 'rate_limit_error', 'Too many requests. Try again shortly.', cors, {
        'retry-after': String(rate.retryAfter),
      })
    }

    let raw: unknown
    try {
      raw = await request.json()
    } catch {
      return refuse(400, 'invalid_request_error', 'The request body is not JSON.', cors)
    }

    const checked = checkBody(raw, config)
    if (!checked.ok || !checked.body) {
      return refuse(
        checked.status ?? 400,
        'invalid_request_error',
        checked.reason ?? 'The request was refused.',
        cors,
      )
    }

    const budget = await checkBudget(env.RL, config, now)
    if (!budget.allowed) {
      return refuse(
        429,
        'budget_exhausted',
        `This service's daily limit of ${budget.limit.toLocaleString('en-US')} tokens is used up. It resets at 00:00 UTC.`,
        cors,
      )
    }

    let upstream: Response
    try {
      upstream = await fetch(`${config.baseUrl}/v1/messages`, {
        method: 'POST',
        // Built from scratch. Nothing the caller sent is forwarded.
        headers: {
          'content-type': 'application/json',
          accept:
            request.headers.get('accept') === 'text/event-stream' ? 'text/event-stream' : 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify(checked.body),
      })
    } catch {
      // The upstream failure text is not passed on: it can carry account
      // detail, and there is nothing in it a reader of this app can act on.
      return refuse(502, 'api_error', 'The upstream service could not be reached.', cors)
    }

    const headers: Record<string, string> = {
      ...cors,
      'content-type': upstream.headers.get('content-type') ?? 'application/json',
      'cache-control': 'no-store',
    }

    if (!upstream.body) {
      return new Response(null, { status: upstream.status, headers })
    }

    // One branch goes to the caller untouched and unbuffered — this is what
    // makes an SSE stream arrive token by token rather than in one lump at the
    // end. The other is drained in the background purely to add up the two
    // `usage` objects; it never delays the first branch and it holds no text
    // beyond the frames it is reading.
    const [toCaller, toMeter] = upstream.body.tee()
    ctx.waitUntil(meter(toMeter, env, now))

    return new Response(toCaller, { status: upstream.status, headers })
  },
}

/**
 * Reads the duplicated response and adds its token usage to the day's total.
 *
 * Failures here are swallowed on purpose. This runs after the reader already
 * has their answer, so a parse error must not turn a delivered answer into a
 * 500 — the cost of losing a count is a slightly generous ceiling, and the
 * cost of throwing is an error nobody can attribute to anything.
 */
async function meter(stream: ReadableStream<Uint8Array>, env: Env, nowMs: number): Promise<void> {
  try {
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    const tokens = createTokenMeter()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      tokens.push(decoder.decode(value, { stream: true }))
    }
    tokens.push(decoder.decode())
    await addToBudget(env.RL, tokens.end(), nowMs)
  } catch {
    // Deliberately silent: see above. Nothing here is worth an operator's log
    // line, and a body must never reach one.
  }
}
