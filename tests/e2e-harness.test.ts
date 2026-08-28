import { readdirSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { evaluateGate } from './e2e/fixtures'

import { readFromRoot } from '@/test/paths'

/**
 * The end-to-end suite's own guard rail, run by `pnpm test` rather than by
 * Playwright — so it is checked on every commit, not only when a browser is
 * available.
 *
 * `tests/e2e/fixtures.ts` arms an automatic fixture that fails any test which
 * makes a cross-origin request, or which puts a sentinel value a test typed
 * into a request URL or body. That guarantee is worth exactly as much as the
 * number of specs that import it: a gate a spec author has to remember to
 * switch on is a gate the next spec forgets. This is what makes forgetting a
 * failing build rather than a silent hole.
 *
 * `import type` from `@playwright/test` is fine and expected — a type carries
 * no fixture and cannot bypass anything.
 */

const E2E_DIR = 'tests/e2e'

/**
 * The one spec allowed to use Playwright's own `test` directly, with the
 * reason. `csp.spec.ts` replays the production Content-Security-Policy from
 * `public/_headers` onto the document through `page.route`, which means it
 * deliberately manufactures request-level behaviour the gate is written to
 * treat as a defect. It is owned by the session that wrote the CSP; changing
 * its imports here would be changing its subject matter.
 */
const UNGATED: Readonly<Record<string, string>> = {
  'csp.spec.ts': 'replays the production CSP through page.route — see public/_headers',
}

const specs = readdirSync(E2E_DIR)
  .filter((name) => name.endsWith('.spec.ts'))
  .sort()

describe('the end-to-end privacy gate covers the whole suite', () => {
  it('finds the spec files it is asserting about', () => {
    // A guard that silently asserts over an empty list is not a guard.
    expect(specs.length).toBeGreaterThanOrEqual(10)
  })

  it.each(specs)('%s imports test and expect from the gated fixture', (name) => {
    const source = readFromRoot(E2E_DIR, name)

    if (name in UNGATED) {
      expect(source, `${name} is listed as ungated but no longer uses Playwright's own test`).toMatch(
        /from '@playwright\/test'/,
      )
      return
    }

    /*
      A value import from @playwright/test is the way the gate gets bypassed.

      Matched one statement at a time: a single regex spanning the whole file
      reads every import between the first and the last as one match. The
      whitespace is `\s*` rather than `\s+` on purpose — `import{expect,test}from
      '@playwright/test'` is valid TypeScript, and a guard whose whole job is to
      be un-bypassable must not be defeated by a formatting choice. Prettier
      would never produce that spacing, but the guard should not depend on
      prettier having run.
    */
    const statements = [...source.matchAll(/^import\s*([\s\S]*?)\s*from\s*'([^']+)'/gm)]
    const valueImport = statements.find(
      ([, clause = '', specifier]) =>
        specifier === '@playwright/test' && !clause.trimStart().startsWith('type '),
    )
    expect(
      valueImport?.[0] ?? null,
      `${name} imports a VALUE from @playwright/test. Import { expect, test } from './fixtures' instead, ` +
        `or add ${name} to UNGATED in this file with the reason.`,
    ).toBeNull()

    expect(source, `${name} does not import the gated fixture`).toMatch(/from '\.\/fixtures'/)
  })

  it('lists no exemption for a spec that no longer exists', () => {
    for (const name of Object.keys(UNGATED)) {
      expect(specs, `UNGATED names ${name}, which is not in ${E2E_DIR}`).toContain(name)
    }
  })

  it('states a reason for every exemption', () => {
    for (const [name, reason] of Object.entries(UNGATED)) {
      expect(reason.length, `${name} is exempt with no reason given`).toBeGreaterThan(20)
    }
  })
})

describe('the fixture itself', () => {
  const fixtures = readFromRoot(E2E_DIR, 'fixtures.ts')

  it('registers the network gate as an automatic fixture', () => {
    // `auto: true` is what makes a spec covered without mentioning `network`.
    // Without it every one of these specs would pass while asserting nothing.
    expect(fixtures).toMatch(/\{\s*auto:\s*true\s*\}/)
  })

  it('listens on the browser context, not only the page', () => {
    // A request made by the service worker, or by a second page a share sheet
    // opens, escapes a page-scoped listener entirely.
    expect(fixtures).toMatch(/context\.on\('request'/)
  })

  it('checks the request body as well as the URL', () => {
    expect(fixtures).toMatch(/postData/)
  })
})

describe('the gate actually fires — the same four cases, without a browser', () => {
  /*
    A guarantee nobody has watched fail is a guarantee nobody has tested.

    `evaluateGate` is the whole decision the fixture makes, split out of it so
    these four cases can run in `pnpm test` rather than only against a live
    Chromium. Each was first confirmed in a real browser — a spec that fetched
    https://example.com, one that put a sentinel in a query string, one that put
    it in a POST body, and one that typed a sentinel and never sent it — and
    each behaves here exactly as it did there.

    The fourth is not padding. A gate that fires on clean input gets weakened
    until it stops firing at all, so "does NOT flag a value that was typed and
    never left the device" is as load-bearing as the three that must fire.
  */
  const ORIGIN = 'http://localhost:4173'
  const sentinels = new Map([['SNTNL-subject-1', 'subject']])

  const request = (url: string, postData: string | null = null) => ({ method: 'GET', url, postData })

  it('catches a cross-origin request', () => {
    const verdict = evaluateGate({
      seen: [request(`${ORIGIN}/law`), request('https://example.com/beacon')],
      origin: ORIGIN,
      sentinels: new Map(),
      allowed: [],
    })
    expect(verdict.crossOrigin).toEqual(['GET https://example.com/beacon'])
  })

  it('catches a typed value in a query string', () => {
    const verdict = evaluateGate({
      seen: [request(`${ORIGIN}/data/x.json?q=SNTNL-subject-1`)],
      origin: ORIGIN,
      sentinels,
      allowed: [],
    })
    expect(verdict.leaked).toHaveLength(1)
    expect(verdict.leaked[0]).toContain('subject')
  })

  it('catches a typed value in a POST body', () => {
    const verdict = evaluateGate({
      seen: [request(`${ORIGIN}/data/x.json`, JSON.stringify({ subject: 'SNTNL-subject-1' }))],
      origin: ORIGIN,
      sentinels,
      allowed: [],
    })
    expect(verdict.leaked).toHaveLength(1)
  })

  it('catches a typed value that was percent-encoded on the way out', () => {
    /*
      This one has to be built by hand, and the reason is worth writing down.

      `network.sentinel()` folds its label to `[A-Za-z0-9-]`, so a minted value
      passes through percent-encoding unchanged and the raw-URL check alone
      would catch it — a test using a real sentinel here would pass whether or
      not `surfaces()` decoded anything, which is a test that proves nothing.
      The decode step earns its place only for a value containing a character
      that encoding rewrites, so that is what this uses.
    */
    const encodable = new Map([['SNTNL-om subject-9', 'om subject']])
    const verdict = evaluateGate({
      seen: [request(`${ORIGIN}/x?q=${encodeURIComponent('SNTNL-om subject-9')}`)],
      origin: ORIGIN,
      sentinels: encodable,
      allowed: [],
    })
    expect(verdict.leaked).toHaveLength(1)
  })

  it('mints a sentinel that no encoding can rewrite', () => {
    // The other half of the same argument: whatever an author passes as a
    // label, the value that goes into the field is encoding-stable.
    const slug = (label: string) => label.replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'value'
    for (const label of ['om subject', 'a/b?c=d', 'नमूना', '', '   ']) {
      const value = `SNTNL-${slug(label)}-1`
      expect(encodeURIComponent(value), `label ${JSON.stringify(label)}`).toBe(value)
    }
  })

  it('does NOT flag a value that was typed and never sent', () => {
    const verdict = evaluateGate({
      seen: [request(`${ORIGIN}/law`), request(`${ORIGIN}/assets/index-abc.js`)],
      origin: ORIGIN,
      sentinels,
      allowed: [],
    })
    expect(verdict).toEqual({ crossOrigin: [], leaked: [] })
  })

  it('honours a declared cross-origin exception, and only that one', () => {
    const verdict = evaluateGate({
      seen: [request('https://api.anthropic.com/v1/messages'), request('https://example.com/x')],
      origin: ORIGIN,
      sentinels: new Map(),
      allowed: [/^https:\/\/api\.anthropic\.com\//],
    })
    expect(verdict.crossOrigin).toEqual(['GET https://example.com/x'])
  })

  it('reports rather than throws on a request the URL parser cannot handle', () => {
    // The gate must never be the thing that crashes: a teardown that throws
    // reports nothing about any of the other requests in the test. A lone `%`
    // in a query string is ordinary input and used to kill decodeURIComponent.
    const verdict = evaluateGate({
      seen: [request(`${ORIGIN}/x?q=100%`), request('not-a-url'), request('about:blank')],
      origin: ORIGIN,
      sentinels,
      allowed: [],
    })
    expect(verdict.leaked).toEqual([])
    // An unparseable URL has no origin, so it is reported as off-origin rather
    // than silently skipped — a request nobody can classify is not one to trust.
    expect(verdict.crossOrigin).toEqual(['GET not-a-url', 'GET about:blank'])
  })
})
