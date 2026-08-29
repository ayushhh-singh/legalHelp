/**
 * The Worker's own vocabulary.
 *
 * Deliberately NOT `@cloudflare/workers-types`. The whole surface this Worker
 * touches is four KV methods, `Request`/`Response`/`ReadableStream` (all of
 * which Node 24 and workerd both have), and `ctx.waitUntil`. Declaring that
 * much here instead of pulling a types package means `worker/test/policy.test.ts`
 * runs under plain Vitest with a Map-backed stub, and the same source
 * typechecks in both places. If this Worker ever needs a Durable Object or an
 * R2 bucket, that is the moment to add the real types — not before.
 */

/** The subset of KVNamespace this Worker uses. */
export interface KvLike {
  get(key: string): Promise<string | null>
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>
}

export interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void
}

/**
 * Everything the Worker is configured with.
 *
 * `ANTHROPIC_API_KEY` is a SECRET (`wrangler secret put`), never a `[vars]`
 * entry — a var lands in wrangler.toml, and wrangler.toml is in git. The rest
 * are plain vars, so a deployment's limits are readable from the file that
 * deployed it.
 */
export interface Env {
  ANTHROPIC_API_KEY?: string
  /** Comma-separated. An origin not on this list is refused, CORS and all. */
  ALLOWED_ORIGINS?: string
  /** Comma-separated model ids. Anything else is refused before forwarding. */
  ALLOWED_MODELS?: string
  /** Requests per IP per RATE_LIMIT_WINDOW_SECONDS. */
  RATE_LIMIT_PER_WINDOW?: string
  RATE_LIMIT_WINDOW_SECONDS?: string
  /** Input + output tokens per UTC day, across every caller. */
  DAILY_TOKEN_BUDGET?: string
  /** Upper bound on `max_tokens`, whatever the caller asked for. */
  MAX_OUTPUT_TOKENS?: string
  /** Overridden only by the tests. Production talks to Anthropic. */
  ANTHROPIC_BASE_URL?: string
  RL: KvLike
}
