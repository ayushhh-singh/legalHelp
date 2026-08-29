import type { Env, KvLike } from './types'

/**
 * Every decision this Worker makes before a single byte reaches Anthropic, as
 * pure functions over plain values.
 *
 * They are separated from `index.ts` for the reason the app's own
 * `src/lib/**` is separated from its components: a limit that is wrong is
 * wrong silently. A rate limiter written inline in a fetch handler can only be
 * tested by standing up a runtime; written here it is tested by calling it.
 * `index.ts` is then the wiring, and the miniflare suite covers the wiring.
 */

/* ------------------------------------------------------------------ *
 * Defaults
 * ------------------------------------------------------------------ */

/**
 * The model ids `src/ai/models.ts` offers, and nothing else.
 *
 * This list exists because the key is the OPERATOR's. Without it a caller who
 * found the URL could bill the operator for Opus at will, or for a model with
 * a different price the operator never budgeted for. `ALLOWED_MODELS` in
 * wrangler.toml overrides it; this is the fallback so a Worker deployed with
 * no vars at all is still closed rather than open.
 */
export const DEFAULT_ALLOWED_MODELS: readonly string[] = ['claude-sonnet-4-6', 'claude-haiku-4-5']

export const DEFAULT_RATE_LIMIT_PER_WINDOW = 20
export const DEFAULT_RATE_LIMIT_WINDOW_SECONDS = 60
export const DEFAULT_DAILY_TOKEN_BUDGET = 500_000
export const DEFAULT_MAX_OUTPUT_TOKENS = 4_096
export const ANTHROPIC_BASE_URL = 'https://api.anthropic.com'
export const ANTHROPIC_VERSION = '2023-06-01'

/** Parsed, clamped configuration. Every caller reads this, never `env` directly. */
export interface Config {
  allowedOrigins: readonly string[]
  allowedModels: readonly string[]
  rateLimitPerWindow: number
  rateLimitWindowSeconds: number
  dailyTokenBudget: number
  maxOutputTokens: number
  baseUrl: string
}

/**
 * A missing or unparseable number falls back to the default rather than to
 * zero. Zero is a real, meaningful value here — it means "refuse everything" —
 * so `Number(undefined)` quietly producing it would turn a typo in
 * wrangler.toml into a Worker that looks deployed and answers nothing.
 */
function positiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback
  const parsed = Number(raw.trim())
  if (!Number.isFinite(parsed) || parsed < 0) return fallback
  return Math.floor(parsed)
}

function list(raw: string | undefined): string[] {
  if (!raw) return []
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

/**
 * The same, with a trailing slash taken off each entry.
 *
 * An operator writes an origin the way they write a URL, and a browser's
 * `Origin` header never carries a path or a trailing slash — so
 * `ALLOWED_ORIGINS = "https://app.test/"` matched nothing and the Worker
 * answered 403 to every request from the app it was deployed for, with no hint
 * anywhere as to why. README.md documenting "no trailing slash" is a footgun
 * described rather than removed.
 *
 * Only the CONFIGURED side is normalised: `originAllowed()` still refuses a
 * REQUEST whose Origin carries one, because no browser sends that and a caller
 * that does is not one of ours.
 */
function originList(raw: string | undefined): string[] {
  return list(raw).map((origin) => origin.replace(/\/+$/, ''))
}

export function readConfig(env: Env): Config {
  const models = list(env.ALLOWED_MODELS)
  return {
    allowedOrigins: originList(env.ALLOWED_ORIGINS),
    allowedModels: models.length > 0 ? models : DEFAULT_ALLOWED_MODELS,
    rateLimitPerWindow: positiveInt(env.RATE_LIMIT_PER_WINDOW, DEFAULT_RATE_LIMIT_PER_WINDOW),
    rateLimitWindowSeconds: Math.max(
      1,
      positiveInt(env.RATE_LIMIT_WINDOW_SECONDS, DEFAULT_RATE_LIMIT_WINDOW_SECONDS),
    ),
    dailyTokenBudget: positiveInt(env.DAILY_TOKEN_BUDGET, DEFAULT_DAILY_TOKEN_BUDGET),
    maxOutputTokens: Math.max(1, positiveInt(env.MAX_OUTPUT_TOKENS, DEFAULT_MAX_OUTPUT_TOKENS)),
    baseUrl: (env.ANTHROPIC_BASE_URL ?? ANTHROPIC_BASE_URL).replace(/\/+$/, ''),
  }
}

/* ------------------------------------------------------------------ *
 * CORS
 * ------------------------------------------------------------------ */

/**
 * The app's origin, or nothing.
 *
 * `*` is never returned, and there is deliberately no "reflect whatever the
 * caller sent" branch: reflecting an origin is the same as having no allowlist
 * at all, and this Worker spends the operator's money. An unlisted origin gets
 * a response with no CORS headers, which the browser then refuses to hand to
 * the page — the request is also refused on the server side by
 * `originAllowed()`, so the two do not depend on each other.
 *
 * `Vary: Origin` is not optional: without it, Cloudflare's own cache can serve
 * one origin's CORS headers to another origin's request.
 */
export function corsHeaders(origin: string | null, config: Config): Record<string, string> {
  const base: Record<string, string> = { vary: 'Origin' }
  if (!origin || !config.allowedOrigins.includes(origin)) return base
  return {
    ...base,
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type, accept',
    'access-control-max-age': '86400',
  }
}

/**
 * An origin the allowlist does not name is refused outright.
 *
 * A request with NO Origin header — curl, another Worker, a server-side
 * script — is refused too. That is deliberate and it is the point of a tier
 * whose whole purpose is to serve one web app: "no origin" is the shape every
 * non-browser caller has, and those are exactly the callers the operator is
 * not paying for.
 */
export function originAllowed(origin: string | null, config: Config): boolean {
  return origin !== null && config.allowedOrigins.includes(origin)
}

/* ------------------------------------------------------------------ *
 * The request body
 * ------------------------------------------------------------------ */

export interface BodyCheck {
  ok: boolean
  /** Present when ok — the body to forward, with max_tokens clamped. */
  body?: Record<string, unknown>
  /** Present when not ok. */
  status?: number
  reason?: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Checks the model against the allowlist and clamps `max_tokens`.
 *
 * The body is otherwise passed through UNREAD and UNCHANGED. That is a
 * privacy decision as much as a simplicity one: this Worker is a pipe the
 * operator pays for, and the less of the officer's prompt it inspects — let
 * alone stores — the smaller the difference between Tier 2 and Tier 1. The
 * two fields it does read are the two that decide what the operator is
 * billed.
 */
export function checkBody(raw: unknown, config: Config): BodyCheck {
  if (!isRecord(raw)) {
    return { ok: false, status: 400, reason: 'The request body must be a JSON object.' }
  }

  const model = raw.model
  if (typeof model !== 'string' || model.length === 0) {
    return { ok: false, status: 400, reason: 'The request names no model.' }
  }
  if (!config.allowedModels.includes(model)) {
    return {
      ok: false,
      status: 403,
      reason: `This proxy does not serve the model "${model}".`,
    }
  }

  // `Number.isFinite`, not `typeof === 'number'`: NaN is a number, and every one
  // of Math.floor, Math.min and Math.max propagates it unchanged — so a NaN
  // reached JSON.stringify, which writes it as `null`, and the operator's key
  // was spent on a request Anthropic answers with a 400. A value that is not a
  // finite quantity is treated as an absent one. Infinity IS finite-bounded by
  // the Math.min below, so it needs no special case.
  const asked =
    typeof raw.max_tokens === 'number' && !Number.isNaN(raw.max_tokens)
      ? raw.max_tokens
      : config.maxOutputTokens
  const clamped = Math.max(1, Math.min(Math.floor(asked), config.maxOutputTokens))

  return { ok: true, body: { ...raw, max_tokens: clamped } }
}

/* ------------------------------------------------------------------ *
 * Rate limiting
 * ------------------------------------------------------------------ */

/**
 * A fixed window per IP, counted in KV.
 *
 * KV is eventually consistent and rate-limits writes to one per second per
 * key, so a burst arriving in the same second can undercount. That is stated
 * rather than worked around: this limit exists to stop one caller draining an
 * operator's credit over minutes, and a fixed window in KV does that on the
 * free tier. A Durable Object would count exactly; it is the upgrade path in
 * README.md and it is not needed to make the guarantee this one claims.
 *
 * The window start is quantised so every request in the same window reads and
 * writes the same key, and `expirationTtl` retires the key rather than a
 * cleanup job.
 */
export interface RateDecision {
  allowed: boolean
  count: number
  limit: number
  /** Seconds until the current window ends; used for Retry-After. */
  retryAfter: number
}

export function windowKey(ip: string, nowMs: number, windowSeconds: number): string {
  const start = Math.floor(nowMs / 1000 / windowSeconds) * windowSeconds
  return `rl:${ip}:${start}`
}

export async function checkRateLimit(
  kv: KvLike,
  ip: string,
  config: Config,
  nowMs: number,
): Promise<RateDecision> {
  const key = windowKey(ip, nowMs, config.rateLimitWindowSeconds)
  const seconds = Math.floor(nowMs / 1000)
  const retryAfter =
    config.rateLimitWindowSeconds - (seconds % config.rateLimitWindowSeconds) || config.rateLimitWindowSeconds

  const stored = Number((await kv.get(key)) ?? '0')
  const count = Number.isFinite(stored) && stored > 0 ? Math.floor(stored) : 0

  if (count >= config.rateLimitPerWindow) {
    return { allowed: false, count, limit: config.rateLimitPerWindow, retryAfter }
  }

  // Written before forwarding, not after: a request that is going to be
  // expensive must be counted even if the upstream call then fails, or a
  // caller can hold the limiter open by triggering errors.
  await kv.put(key, String(count + 1), { expirationTtl: config.rateLimitWindowSeconds + 60 })
  return { allowed: true, count: count + 1, limit: config.rateLimitPerWindow, retryAfter }
}

/* ------------------------------------------------------------------ *
 * The daily budget
 * ------------------------------------------------------------------ */

/** UTC, not IST: it is the operator's bill, and Anthropic bills in UTC days. */
export function budgetKey(nowMs: number): string {
  return `budget:${new Date(nowMs).toISOString().slice(0, 10)}`
}

export interface BudgetDecision {
  allowed: boolean
  used: number
  limit: number
}

/**
 * Checked BEFORE the request is forwarded, the same way the app's own
 * `runAgent` checks its monthly ceiling before each provider call: a run that
 * would start over the limit does not start. The count is written afterwards
 * from the usage the response reports, so the ceiling is crossed by at most
 * one request rather than enforced to the token.
 */
export async function checkBudget(kv: KvLike, config: Config, nowMs: number): Promise<BudgetDecision> {
  const stored = Number((await kv.get(budgetKey(nowMs))) ?? '0')
  const used = Number.isFinite(stored) && stored > 0 ? Math.floor(stored) : 0
  return { allowed: used < config.dailyTokenBudget, used, limit: config.dailyTokenBudget }
}

/** Two days of TTL so a key written just before midnight still reads back. */
export async function addToBudget(kv: KvLike, tokens: number, nowMs: number): Promise<void> {
  if (tokens <= 0) return
  const key = budgetKey(nowMs)
  const stored = Number((await kv.get(key)) ?? '0')
  const used = Number.isFinite(stored) && stored > 0 ? Math.floor(stored) : 0
  await kv.put(key, String(used + tokens), { expirationTtl: 60 * 60 * 48 })
}

/* ------------------------------------------------------------------ *
 * Counting what was spent
 * ------------------------------------------------------------------ */

/**
 * Adds up the token usage a Messages response reports, streamed or not.
 *
 * For a stream that means the `message_start` frame (input, plus cache reads
 * and writes) and the `message_delta` frame (the final output count). Both are
 * read from text that has ALREADY been forwarded to the caller — nothing here
 * delays a byte, and nothing here sees anything but the two usage objects.
 *
 * It is an incremental meter rather than a function over the whole body
 * because a Worker that buffered somebody's complete answer to count it would
 * scale its memory with the length of that answer. `push()` keeps only the
 * trailing partial line; everything else is a pair of integers.
 *
 * Anything it cannot parse counts as zero. An undercount means the operator's
 * ceiling is generous, which is the right direction for a failure whose
 * alternative is refusing a reader an answer over a parse error.
 */
export interface TokenMeter {
  push(chunk: string): void
  /** Flushes the trailing partial line and returns input + output. */
  end(): number
}

export function createTokenMeter(): TokenMeter {
  let pending = ''
  let input = 0
  let output = 0

  const consider = (usage: unknown) => {
    if (!isRecord(usage)) return
    const numberAt = (key: string) => (typeof usage[key] === 'number' ? usage[key] : 0)
    // `message_delta` reports a running output total and omits the input
    // fields, so the larger of the two is kept rather than added — the same
    // rule src/ai/providers/wire.ts#mergeUsage follows, for the same reason.
    input = Math.max(
      input,
      numberAt('input_tokens') +
        numberAt('cache_creation_input_tokens') +
        numberAt('cache_read_input_tokens'),
    )
    output = Math.max(output, numberAt('output_tokens'))
  }

  const line = (raw: string) => {
    const trimmed = raw.startsWith('data:') ? raw.slice(5).trim() : raw.trim()
    if (!trimmed || !trimmed.startsWith('{')) return
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      return
    }
    if (!isRecord(parsed)) return
    consider(parsed.usage)
    if (isRecord(parsed.message)) consider(parsed.message.usage)
  }

  return {
    push(chunk) {
      pending += chunk
      let boundary = pending.indexOf('\n')
      while (boundary !== -1) {
        line(pending.slice(0, boundary))
        pending = pending.slice(boundary + 1)
        boundary = pending.indexOf('\n')
      }
      // A non-streamed body is one very long line with no newline at all, so
      // the buffer cannot simply be capped — end() is what flushes it.
    },
    end() {
      if (pending) {
        line(pending)
        pending = ''
      }
      return input + output
    },
  }
}

/** The whole-string form. Used by the non-streaming path and by the tests. */
export function countTokens(text: string): number {
  const meter = createTokenMeter()
  meter.push(text)
  return meter.end()
}

/**
 * The client's IP, as Cloudflare reports it.
 *
 * `CF-Connecting-IP` is set by the edge and cannot be spoofed by the caller;
 * `X-Forwarded-For` can be, so it is NOT consulted. With neither present —
 * which in practice means a local `wrangler dev` — every caller shares one
 * bucket, which is the safe direction for a limiter.
 */
export function clientIp(request: Request): string {
  return request.headers.get('cf-connecting-ip') ?? 'unknown'
}
