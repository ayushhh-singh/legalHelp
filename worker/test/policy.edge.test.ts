import { describe, expect, it } from 'vitest'

import { checkBody, originAllowed, readConfig } from '../src/policy'
import type { Env, KvLike } from '../src/types'

/**
 * An edge-case pass over the Worker's guards, after ADR-037.
 *
 * Both defects here are the same shape: a value that is the right TYPE and the
 * wrong value. `typeof x === 'number'` admits NaN, and a hostname string admits
 * a trailing slash. Each was confirmed to fail against the committed code
 * before its fix.
 */

const kv = (): KvLike => ({ get: () => Promise.resolve(null), put: () => Promise.resolve() })
const env = (over: Partial<Env> = {}): Env => ({ ALLOWED_ORIGINS: 'https://a.test', RL: kv(), ...over })

describe('max_tokens that is a number and is not a quantity', () => {
  /*
    `typeof NaN === 'number'`, so NaN went straight through Math.floor, Math.min
    and Math.max unchanged — every one of them propagates it — and
    `JSON.stringify({max_tokens: NaN})` writes `null`. The operator's key was
    then spent on a request Anthropic answers with a 400, and the reader was
    told "the upstream service could not be reached".
  */
  const config = readConfig(env({ ALLOWED_MODELS: 'm', MAX_OUTPUT_TOKENS: '1000' }))

  it('treats NaN as an absent value rather than forwarding it', () => {
    const result = checkBody({ model: 'm', max_tokens: Number.NaN }, config)
    expect(result.ok).toBe(true)
    expect(result.body?.max_tokens).toBe(1000)
    // The assertion that actually matters: what goes on the wire.
    expect(JSON.stringify(result.body)).toContain('"max_tokens":1000')
  })

  it('treats Infinity as the ceiling and a negative as the floor', () => {
    expect(checkBody({ model: 'm', max_tokens: Infinity }, config).body?.max_tokens).toBe(1000)
    expect(checkBody({ model: 'm', max_tokens: -Infinity }, config).body?.max_tokens).toBe(1)
    expect(checkBody({ model: 'm', max_tokens: -5 }, config).body?.max_tokens).toBe(1)
    expect(checkBody({ model: 'm', max_tokens: 0 }, config).body?.max_tokens).toBe(1)
  })

  it('never emits a max_tokens that JSON.stringify turns into null', () => {
    for (const value of [Number.NaN, Infinity, -Infinity, 0, -1, 1.7, 2 ** 53]) {
      const body = checkBody({ model: 'm', max_tokens: value }, config).body
      expect(JSON.stringify(body), `max_tokens ${String(value)}`).not.toContain('"max_tokens":null')
    }
  })
})

describe('ALLOWED_ORIGINS written the way an operator writes a URL', () => {
  /*
    A browser's Origin header never carries a path or a trailing slash, so a
    wrangler.toml saying `https://app.test/` matched nothing and the Worker
    answered 403 to every request from the app it was deployed for — with no
    hint anywhere as to why. README.md says "no trailing slash", which is a
    documented footgun rather than a fixed one.

    Only the CONFIGURED side is normalised. A REQUEST whose Origin has a
    trailing slash is still refused: browsers do not send that, so it is not a
    real caller.
  */
  it('accepts a configured origin written with a trailing slash', () => {
    const config = readConfig(env({ ALLOWED_ORIGINS: 'https://a.test/, https://b.test//' }))
    expect(config.allowedOrigins).toEqual(['https://a.test', 'https://b.test'])
    expect(originAllowed('https://a.test', config)).toBe(true)
    expect(originAllowed('https://b.test', config)).toBe(true)
  })

  it('still refuses a request Origin that carries one', () => {
    const config = readConfig(env({ ALLOWED_ORIGINS: 'https://a.test' }))
    expect(originAllowed('https://a.test/', config)).toBe(false)
  })
})
