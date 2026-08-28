import { readdirSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

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

    // A value import from @playwright/test is the way the gate gets bypassed.
    // Matched one statement at a time: a single regex spanning the whole file
    // reads every import between the first one and the last as one match.
    const statements = [...source.matchAll(/^import\s+([\s\S]*?)\s+from\s+'([^']+)'/gm)]
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
