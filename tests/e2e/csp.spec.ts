import { readFileSync } from 'node:fs'
import { fileURLToPath, URL as NodeURL } from 'node:url'

import { expect, test, type Page } from '@playwright/test'

/**
 * The deployed app, under the deployed Content-Security-Policy.
 *
 * `public/_headers` is the one copy of the policy — there is no <meta
 * http-equiv> duplicate to drift from it. `vite preview` (playwright.config
 * .ts's webServer) does not read Cloudflare Pages' `_headers` format, so this
 * spec parses that file itself and replays every header onto each same-origin
 * response before the browser sees it. A policy edit is therefore exercised
 * here on the next run, and a rule that would break the app in production
 * fails the suite instead of the deploy.
 *
 * Two independent failure signals, because CSP is quiet by default: the
 * `securitypolicyviolation` event (what the browser refused) and console
 * errors (what broke as a result). The master context's acceptance line —
 * "console errors = failure" — is the second one.
 */

const HEADERS_FILE = fileURLToPath(new NodeURL('../../public/_headers', import.meta.url))

/** Every route the acceptance checks name, plus the two the palette reaches. */
const ROUTES = ['/', '/law', '/pay', '/draft', '/learn', '/utils', '/settings']

/**
 * Cloudflare Pages' `_headers` grammar: an unindented line is a path pattern,
 * an indented `Name: value` line belongs to the pattern above it, `#` is a
 * comment. Only the `/*` block is replayed — the others are cache policy,
 * which `vite preview` has its own opinion about and which no CSP depends on.
 */
function globalHeaders(): Record<string, string> {
  const headers: Record<string, string> = {}
  let inGlobalBlock = false

  for (const raw of readFileSync(HEADERS_FILE, 'utf8').split('\n')) {
    if (!raw.trim() || raw.trimStart().startsWith('#')) continue

    if (!/^\s/.test(raw)) {
      inGlobalBlock = raw.trim() === '/*'
      continue
    }
    if (!inGlobalBlock) continue

    const separator = raw.indexOf(':')
    if (separator === -1) continue
    headers[raw.slice(0, separator).trim()] = raw.slice(separator + 1).trim()
  }
  return headers
}

const HEADERS = globalHeaders()

/**
 * The one violation this app provokes on purpose, and why it is not a defect.
 *
 * zod 4 decides at import time whether it may JIT-compile its validators, by
 * evaluating `Function("")` inside a try/catch (its own `allowsEval` probe —
 * the same helper that special-cases the Cloudflare Workers user agent).
 * Under `script-src 'self'` the browser refuses, zod catches the exception and
 * takes its interpreted path, and every schema in the app keeps working. The
 * refusal is still REPORTED, because a probe cannot ask the browser a question
 * without asking it.
 *
 * Allowing 'unsafe-eval' to silence one caught feature detect would hand real
 * script injection a way in for nothing, so the probe is allowlisted here
 * instead — narrowly: script-src, blocked "eval", from a built chunk. Anything
 * else that evaluates a string still fails this suite.
 */
const isZodEvalProbe = (violation: Violation) =>
  violation.directive === 'script-src' &&
  violation.blocked === 'eval' &&
  /\/assets\/[\w-]+\.js$/.test(violation.source)

const CAUGHT_EVAL_CONSOLE_MESSAGE =
  /Refused to evaluate a string as JavaScript because 'unsafe-eval' is not an allowed source/

const unexpected = (found: Violation[]) => found.filter((violation) => !isZodEvalProbe(violation))

const unexpectedConsole = (messages: string[]) =>
  messages.filter((message) => !CAUGHT_EVAL_CONSOLE_MESSAGE.test(message))

type Violation = {
  directive: string
  blocked: string
  sample: string
  source: string
  line: number
}

async function armCsp(page: Page, origin: string) {
  /*
    Runs before any page script, and is injected by the browser rather than as
    a <script> tag, so the policy under test cannot block the listener that
    reports on it.

    Violations accumulate in sessionStorage rather than on `window`, because
    an init script re-runs on every navigation: a `window.__csp = []` at the
    top would wipe the record of the page just left, and a test that navigates
    twice before asserting would silently only ever check the last page. That
    is a coverage hole rather than a failure, which is the kind that survives.
  */
  await page.addInitScript(() => {
    const KEY = '__csp_violations'
    document.addEventListener('securitypolicyviolation', (event) => {
      const seen = JSON.parse(sessionStorage.getItem(KEY) ?? '[]') as unknown[]
      seen.push({
        directive: event.effectiveDirective || event.violatedDirective,
        blocked: event.blockedURI,
        sample: event.sample ?? '',
        source: event.sourceFile ?? '',
        line: event.lineNumber ?? 0,
      })
      sessionStorage.setItem(KEY, JSON.stringify(seen))
    })
  })

  // Only the document carries the policy, so only the document is rewritten.
  // Rewriting every asset too meant re-fetching several megabytes of statute
  // through the proxy on each run, and left in-flight `route.fetch()` calls
  // racing the end of the test.
  await page.route(`${origin}/**`, async (route) => {
    if (route.request().resourceType() !== 'document') return route.fallback()
    const response = await route.fetch()
    await route.fulfill({ response, headers: { ...response.headers(), ...HEADERS } })
  })
}

const violations = (page: Page) =>
  page.evaluate(() => JSON.parse(sessionStorage.getItem('__csp_violations') ?? '[]') as Violation[])

test.describe('under the production Content-Security-Policy', () => {
  test('public/_headers declares every header the brief asks for', () => {
    const csp = HEADERS['Content-Security-Policy'] ?? ''

    for (const directive of [
      "default-src 'self'",
      "script-src 'self'",
      "font-src 'self'",
      "img-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'none'",
    ]) {
      expect(csp, `Content-Security-Policy is missing "${directive}"`).toContain(directive)
    }

    // The brief asks for 'unsafe-inline' to be dropped from style-src if
    // nothing needs it. Radix Dialog's scroll lock does (ADR-030), so it
    // stays for style ELEMENTS and is refused for style attributes.
    expect(csp).toContain("style-src 'self' 'unsafe-inline'")
    expect(csp).toContain("style-src-attr 'none'")

    expect(HEADERS['Strict-Transport-Security']).toMatch(/max-age=\d{7,}/)
    expect(HEADERS['X-Content-Type-Options']).toBe('nosniff')
    expect(HEADERS['Referrer-Policy']).toBe('no-referrer')
    expect(HEADERS['Cross-Origin-Opener-Policy']).toBe('same-origin')

    const permissions = HEADERS['Permissions-Policy'] ?? ''
    for (const feature of ['camera=()', 'microphone=()', 'geolocation=()']) {
      expect(permissions, `Permissions-Policy is missing ${feature}`).toContain(feature)
    }
  })

  for (const route of ROUTES) {
    test(`${route} renders with no violation and no console error`, async ({ page, baseURL }) => {
      const origin = new URL(baseURL ?? 'http://localhost:4173').origin
      const consoleErrors: string[] = []
      page.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(message.text())
      })
      page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`))

      await armCsp(page, origin)
      await page.goto(route)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

      expect(unexpected(await violations(page))).toEqual([])
      expect(unexpectedConsole(consoleErrors)).toEqual([])
    })
  }

  /**
   * The three surfaces most likely to need an inline <style>: the command
   * palette (cmdk inside Radix Dialog, which pulls react-remove-scroll's
   * style singleton), the Trainer's recharts results chart, and the drafting
   * A4 preview. If style-src loses 'unsafe-inline' and one of them needs it,
   * this is the test that says so.
   */
  test('the dialog, the chart and the A4 preview need no inline style', async ({ page, baseURL }) => {
    const origin = new URL(baseURL ?? 'http://localhost:4173').origin
    const consoleErrors: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`))

    await armCsp(page, origin)

    await page.goto('/law')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

    // Radix Dialog + react-remove-scroll's injected <style>.
    await page.keyboard.press('ControlOrMeta+k')
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByRole('combobox').fill('hatya')
    await expect(page.getByRole('option').first()).toBeVisible()
    await page.keyboard.press('Escape')

    // The drafting A4 preview, which prints against a named @page rule.
    await page.goto('/draft/office-memorandum')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

    expect(unexpected(await violations(page))).toEqual([])
    expect(unexpectedConsole(consoleErrors)).toEqual([])
  })

  /**
   * The offline shell is served by the service worker, which CSP governs
   * through worker-src. A policy that registers fine online and refuses the
   * worker would take the whole offline promise with it.
   */
  test('the service worker registers and controls the page', async ({ page, baseURL }) => {
    const origin = new URL(baseURL ?? 'http://localhost:4173').origin
    await armCsp(page, origin)

    await page.goto('/law')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
      timeout: 30_000,
    })

    expect(unexpected(await violations(page))).toEqual([])
  })

  /**
   * The allowlist above is only safe while it is narrow. If a future
   * dependency evaluates a string for real — and means it — this is what
   * notices that the exemption stopped describing one caught probe.
   */
  test('nothing but that one probe is ever refused across every route', async ({ page, baseURL }) => {
    const origin = new URL(baseURL ?? 'http://localhost:4173').origin
    await armCsp(page, origin)

    for (const route of ROUTES) {
      await page.goto(route)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    }

    // One read, after seven navigations — sessionStorage carried them all.
    expect(unexpected(await violations(page))).toEqual([])
    // ...and inline style ATTRIBUTES stay refused, which is what
    // style-src-attr 'none' buys over a blanket 'unsafe-inline'.
    expect(HEADERS['Content-Security-Policy']).toContain("style-src-attr 'none'")
  })
})
