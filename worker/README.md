# Sahayak's Tier 2 proxy

A Cloudflare Worker that forwards `POST /v1/messages` to Anthropic under **your**
key, so a reader of the app who has no Anthropic account can still use its AI
surfaces.

It is a separate package on purpose. The app's `pnpm install` does not touch it,
nothing here reaches `src/`, and the app builds and ships perfectly well with no
proxy deployed at all — `VITE_AI_PROXY_URL` unset means the "Shared service"
tier is not offered.

Read `docs/AI.md` §2 and §12 in the repository root before deploying this. The
one sentence that matters: **this Worker sees every prompt that passes through
it.** That is the whole difference between Tier 1 (the reader's own key, no
server of ours in the path) and Tier 2, and the app's consent modal says so to
the reader in both languages. Deploying it makes you the operator of that
promise.

---

## Deploy it in five steps

```bash
cd worker
pnpm install --ignore-workspace          # miniflare, wrangler, esbuild, vitest
pnpm exec wrangler login                 # 1. authorise wrangler against your account
pnpm exec wrangler kv namespace create RL   # 2. create the counters namespace
#    paste the id it prints into wrangler.toml, replacing REPLACE_WITH_YOUR_KV_NAMESPACE_ID
pnpm exec wrangler secret put ANTHROPIC_API_KEY   # 3. paste your key at the prompt
#    edit ALLOWED_ORIGINS in wrangler.toml to your app's origin
pnpm deploy                              # 4. wrangler deploy
```

5. Take the URL wrangler prints (`https://sahayak-ai-proxy.<subdomain>.workers.dev`),
   set it as `VITE_AI_PROXY_URL` in the app's build environment, and rebuild the
   app. The tier appears in Settings only in a build that had that variable.

Check it without spending anything:

```bash
curl -s https://sahayak-ai-proxy.<subdomain>.workers.dev/healthz \
     -H 'origin: https://legalhelp.pages.dev'
# {"ok":true,"keyConfigured":true}
```

`keyConfigured: false` means step 3 did not take. `/healthz` never returns any
part of the key.

### The secret is a secret, not a var

`wrangler secret put ANTHROPIC_API_KEY` stores it encrypted in Cloudflare and it
never appears in `wrangler.toml`, which is in git. Putting it under `[vars]`
instead would commit your key to the repository. There is no code path in this
Worker that reads a key from anywhere else.

### GitHub Actions

`.github/workflows/deploy-worker.yml` in the repository root deploys this from
CI. It is **`workflow_dispatch` only** — it never runs on a push — and it needs
two repository secrets, `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (the
same two the Pages deploy already uses). It does not set `ANTHROPIC_API_KEY`:
that is put once, by hand, with `wrangler secret put`, and a redeploy keeps it.

---

## What it does, in order

| #   | Guard                                                    | Refusal                   |
| --- | -------------------------------------------------------- | ------------------------- |
| 1   | `Origin` must be on `ALLOWED_ORIGINS`                    | `403`, no CORS headers    |
| 2   | Per-IP rate limit, fixed window in KV                    | `429` with `Retry-After`  |
| 3   | `model` must be on `ALLOWED_MODELS`                      | `403`, naming the model   |
| 4   | The day's token total must be under `DAILY_TOKEN_BUDGET` | `429`, `budget_exhausted` |

Only then is the key attached and the request forwarded. All four refusals are
in the Messages API's own error envelope, so the app's `wire.ts` reads a
refusal from here exactly as it reads one from Anthropic — the reader gets a
sentence, not "the AI service could not be reached".

The response body — streamed or not — is passed through untouched and
unbuffered. A second, duplicated copy of the stream is read in the background
solely to add up the two `usage` objects and write the day's total; it never
delays a byte.

## What it can see, and what it keeps

It can see every prompt. It keeps none of them.

- **No body is logged.** Not the request, not the response, not one line of
  prompt text. `src/index.ts` contains no `console` call at all.
- **Two fields of the request body are read** — `model` and `max_tokens` — and
  everything else is forwarded unread and unchanged.
- **No header the caller sent is forwarded.** The upstream request is built from
  scratch, so a cookie, a referer, a caller-supplied `x-api-key` or a user agent
  cannot cross this boundary by accident. `accept` is the one exception and it is
  reduced to one of two literal values, because it is what decides whether
  Anthropic streams.
- **Two integers are written to KV**: a per-IP counter that expires with its
  window, and a per-UTC-day token total that expires after 48 hours.
- Cloudflare's own request logs (`[observability]`) record method, path, status
  and timing — never bodies. Turn the block off in `wrangler.toml` if you would
  rather have none.

## Configuration

Everything except the key is a `[vars]` entry in `wrangler.toml`, so a
deployment's limits are readable in the file that deployed it.

| Var                         | Default                              | What it does                                                                           |
| --------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------- |
| `ALLOWED_ORIGINS`           | —                                    | Comma-separated. Scheme and host, no trailing slash. An empty list refuses everything. |
| `ALLOWED_MODELS`            | `claude-sonnet-4-6,claude-haiku-4-5` | Comma-separated. Claude Opus 5 is deliberately absent — see below.                     |
| `RATE_LIMIT_PER_WINDOW`     | `20`                                 | Requests per IP per window.                                                            |
| `RATE_LIMIT_WINDOW_SECONDS` | `60`                                 |                                                                                        |
| `DAILY_TOKEN_BUDGET`        | `500000`                             | Input + output, across every caller, per UTC day.                                      |
| `MAX_OUTPUT_TOKENS`         | `4096`                               | `max_tokens` is clamped down to this, never raised to it.                              |

**Opus is not on the default allowlist** because Tier 2 spends the operator's
money and Tier 1 spends the reader's. The app offers Opus in its model picker;
a reader on Tier 2 who selects it gets a clear `403` naming the model rather
than a bill you did not expect. Add it if you want to pay for it.

**A budget of `0` refuses every request**, deliberately. That is the difference
between an unset var (which falls back to the default) and a var set to zero
(which is a decision) — `readConfig` keeps the two apart, and there is a test
for it.

## The limits are guardrails, not accounting

KV is eventually consistent and rate-limits writes to one per second per key, so
a burst arriving inside one second can undercount. This is stated rather than
worked around: these limits exist to stop one caller draining an operator's
credit over minutes, and a fixed window in KV does that on the free tier.

The daily budget is checked _before_ a request is forwarded and written _after_
the response is metered, so the ceiling is crossed by at most one request rather
than enforced to the token. `test/worker.test.ts` asserts exactly that
behaviour, so it cannot drift into something looser without a test failing.

A Durable Object would count both exactly. It is the upgrade path, and it is not
needed to make the guarantee this Worker actually claims.

## Tests

```bash
pnpm test         # 42: policy.test.ts by calling, worker.test.ts through workerd
pnpm typecheck
```

`test/policy.test.ts` proves the four decisions by calling them with a
Map-backed KV stub — a limit that is off by one is not visible in an
integration test that only ever sends one request. `test/worker.test.ts` runs
the same Worker in **miniflare** (real workerd), with the upstream stubbed by
`outboundService`, and proves the two things only a runtime can settle: that the
outbound request carries the operator's key and none of the caller's headers,
and that an SSE body is streamed through rather than buffered. Neither suite
reaches the network.

The app's own `pnpm check` at the repository root does **not** run these — this
is a separate package with its own dependency tree, and pulling workerd into the
app's install to test a Worker the app does not import would be the wrong trade.
CI runs them in their own job (`.github/workflows/ci.yml`, job `worker`).

## Cost

See `docs/AI.md` §10 in the repository root for the per-run arithmetic. In
short: a grounded run in this app is roughly 1.5–4k input tokens (most of it
served from the prompt cache after the first call) and a few hundred output
tokens. At Sonnet's $3 / $15 per million, the default 500,000-token daily
ceiling is well under two US dollars a day even if it is reached every day.
