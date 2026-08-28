import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

import { test as base, expect, type Page, type Request } from '@playwright/test'

import en from '../../src/i18n/en.json' with { type: 'json' }
import hi from '../../src/i18n/hi.json' with { type: 'json' }

/**
 * The shared end-to-end harness: a privacy gate that arms itself for every test
 * that imports this file, plus the bilingual and accessibility helpers the
 * journey specs need.
 *
 * Import `test` and `expect` from HERE, not from `@playwright/test`. That is
 * the whole enforcement mechanism for the master context's hard rule — "Zero
 * network requests carrying user-entered data (enforced by a Playwright test)"
 * — because a gate that has to be switched on per spec is a gate the next spec
 * forgets. `tests/e2e-harness.test.ts` fails if a spec file imports
 * `@playwright/test` directly, so the rule cannot be forgotten by accident
 * either.
 */

/* ------------------------------------------------------------------ *
 * Bilingual labels
 * ------------------------------------------------------------------ */

export type Language = 'en' | 'hi'
export const LANGUAGES = ['en', 'hi'] as const satisfies readonly Language[]

const CATALOGUE: Record<Language, unknown> = { en, hi }

/**
 * One translation, by the same dotted key the app uses.
 *
 * Reading the catalogue rather than hard-coding Hindi strings in the spec is
 * what makes a bilingual journey test honest: if a key is renamed the spec
 * fails to find it here rather than silently asserting against a stale string,
 * and there is no second copy of the Hindi to drift from `hi.json`.
 */
export function t(language: Language, key: string): string {
  const value = key
    .split('.')
    .reduce<unknown>(
      (node, part) =>
        node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined,
      CATALOGUE[language],
    )
  if (typeof value !== 'string') {
    throw new Error(`No ${language} string for "${key}" — check src/i18n/${language}.json`)
  }
  return value
}

/**
 * A string, escaped so it can be dropped into a `RegExp` and mean itself.
 *
 * Anything read out of the i18n catalogue is prose, and prose has full stops,
 * brackets and question marks in it — `Export .ics`, `Your post and city
 * (optional)`. Interpolated raw into a pattern those stop being literal, and a
 * matcher that quietly matches the wrong thing is worse than one that fails.
 */
export const literal = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/* ------------------------------------------------------------------ *
 * The privacy gate
 * ------------------------------------------------------------------ */

export interface SeenRequest {
  method: string
  url: string
  postData: string | null
}

export interface NetworkGate {
  /**
   * Mint a value to type into a field, and register it as something that must
   * never appear in a request.
   *
   * Sentinels rather than realistic input, deliberately: "302" or "Delhi" would
   * appear in a chunk filename or a cached dataset URL by coincidence, and a
   * privacy assertion that produces false positives gets weakened until it
   * produces false negatives instead. `SNTNL-<label>-<n>` appears nowhere in
   * this repository except where a test puts it.
   */
  sentinel(label: string): string
  /** Everything the browser asked for during this test, in order. */
  seen(): readonly SeenRequest[]
  /**
   * Permit a cross-origin request matching this pattern for this test alone.
   * Nothing in the app should need one; it exists so a spec that deliberately
   * provokes a blocked request can still assert the block.
   */
  allowCrossOrigin(pattern: RegExp): void
}

/**
 * Everything a request could carry a typed value in: the URL and the body.
 *
 * Both defensive steps here are about the gate never being the thing that
 * crashes. `new URL` throws on a scheme it cannot parse, and
 * `decodeURIComponent` throws `URIError` on a lone `%` — and a query string
 * containing a bare percent sign is ordinary user input, not an attack. A
 * privacy gate that dies on an unusual request reports nothing about the
 * requests around it, which is the one failure it cannot afford; falling back
 * to the raw URL still catches a sentinel, because a sentinel is plain ASCII
 * and survives encoding unchanged.
 */
function surfaces(request: SeenRequest): string[] {
  let search: string
  try {
    search = decodeURIComponent(new URL(request.url).search)
  } catch {
    search = ''
  }
  return [request.url, search, request.postData ?? ''].filter(Boolean)
}

/** Same reasoning: an unparseable URL is reported, never thrown over. */
function originOf(url: string): string | null {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

export interface GateVerdict {
  crossOrigin: string[]
  leaked: string[]
}

/**
 * The whole decision the gate makes, as a pure function.
 *
 * Split out from the fixture so it can be tested without a browser:
 * `tests/e2e-harness.test.ts` runs it over synthetic request lists and asserts
 * that it catches a cross-origin request, a sentinel in a query string and a
 * sentinel in a POST body, and that it does NOT flag a value that was typed but
 * never sent. That last one is as important as the other three — a gate that
 * fires on clean input gets weakened until it stops firing at all.
 *
 * A guarantee nobody has watched fail is a guarantee nobody has tested.
 */
export function evaluateGate({
  seen,
  origin,
  sentinels,
  allowed,
}: {
  seen: readonly SeenRequest[]
  origin: string
  sentinels: ReadonlyMap<string, string>
  allowed: readonly RegExp[]
}): GateVerdict {
  const crossOrigin = seen
    .filter((request) => originOf(request.url) !== origin)
    .filter((request) => !allowed.some((pattern) => pattern.test(request.url)))
    .map((request) => `${request.method} ${request.url}`)

  const leaked: string[] = []
  for (const request of seen) {
    const text = surfaces(request)
    for (const [value, label] of sentinels) {
      if (text.some((surface) => surface.includes(value))) {
        leaked.push(`"${label}" (${value}) in ${request.method} ${request.url}`)
      }
    }
  }

  return { crossOrigin, leaked }
}

interface Fixtures {
  network: NetworkGate
}

export const test = base.extend<Fixtures>({
  network: [
    async ({ context, baseURL }, use, testInfo) => {
      const origin = new URL(baseURL ?? 'http://localhost:4173').origin
      const seen: SeenRequest[] = []
      const sentinels = new Map<string, string>()
      const allowed: RegExp[] = []
      let minted = 0

      const record = (request: Request) => {
        seen.push({ method: request.method(), url: request.url(), postData: request.postData() })
      }

      /*
        On the CONTEXT, not the page, and in Node rather than in the page.

        Both halves matter. A request made by the service worker, or by a second
        page a share sheet opens, escapes a page-scoped listener entirely —
        confirmed by driving it: a `fetch` from `context.newPage()` is caught
        here and would not have been on `page`.

        And because the record lives in this closure rather than in the page,
        navigation cannot wipe it. An `addInitScript` re-runs on every
        navigation, so a gate that accumulated into a page global would quietly
        forget every route but the last — a coverage hole rather than a failure,
        which is the kind that survives. (tests/e2e/csp.spec.ts hit exactly that
        and now accumulates in sessionStorage.) Driven both ways too: a leak on
        the FIRST of five navigations is still caught after the other four.
      */
      context.on('request', record)

      const gate: NetworkGate = {
        sentinel(label) {
          minted += 1
          // The label is folded to `[A-Za-z0-9-]` so the minted value survives
          // every encoding a request might apply to it — percent-encoding, form
          // encoding, JSON escaping — unchanged. A label with a space in it
          // would otherwise be the one sentinel the URL check could miss, and
          // it would miss it silently. `surfaces()` decodes as well, but a value
          // that never needs decoding cannot be lost to an encoding nobody
          // anticipated.
          const slug = label.replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'value'
          const value = `SNTNL-${slug}-${minted}`
          sentinels.set(value, label)
          return value
        },
        seen: () => seen,
        allowCrossOrigin(pattern) {
          allowed.push(pattern)
        },
      }

      await use(gate)

      context.off('request', record)

      // Teardown is the assertion. Running it here rather than in each spec is
      // what makes the guarantee hold across the WHOLE suite: a spec author has
      // to do nothing to be covered, and cannot opt out by forgetting.
      const { crossOrigin, leaked } = evaluateGate({ seen, origin, sentinels, allowed })

      expect(crossOrigin, `${testInfo.title} made a cross-origin request`).toEqual([])
      expect(leaked, `${testInfo.title} put a typed value into a request`).toEqual([])
    },
    // `auto` is the point: every test that imports this `test` is gated,
    // whether or not it mentions the fixture.
    { auto: true },
  ],
})

export { expect }

/* ------------------------------------------------------------------ *
 * Chrome: language, theme, storage
 * ------------------------------------------------------------------ */

/** One row out of the `settings` store, or null while it is not there yet. */
export function storedSetting(page: Page, key: string): Promise<string | null> {
  return page.evaluate(
    (name) =>
      new Promise<string | null>((resolve) => {
        const open = indexedDB.open('sahayak')
        open.onerror = () => resolve(null)
        open.onsuccess = () => {
          const request = open.result.transaction('settings').objectStore('settings').get(name)
          request.onerror = () => resolve(null)
          request.onsuccess = () => {
            const row = request.result as { value?: unknown } | undefined
            resolve(row === undefined ? null : String(row.value))
          }
        }
      }),
    key,
  )
}

/**
 * Put the app into a language, from the real control, and wait for the
 * preference to reach IndexedDB.
 *
 * Waiting for the stored row rather than the `lang` attribute is not
 * belt-and-braces: the toggle applies in memory synchronously and persists
 * asynchronously, so a navigation immediately afterwards can outrun the write
 * and land on a page that hydrates back to English. `tests/e2e/theme.spec.ts`
 * documents the same race for the theme.
 */
export async function setLanguage(page: Page, language: Language): Promise<void> {
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

  // Idempotent, because the preference is persisted and survives navigation: a
  // journey that sets Hindi and then opens a second route arrives already in
  // Hindi, and the toggle's accessible name has changed with its state, so a
  // second unconditional click would wait 30s for a button that says something
  // else now.
  const current = await page.locator('html').getAttribute('lang')
  if (current === language) return

  await page
    .getByRole('button', { name: language === 'hi' ? 'Switch to Hindi' : 'अंग्रेज़ी में बदलें' })
    .click()
  await expect(page.locator('html')).toHaveAttribute('lang', language)
  await expect.poll(() => storedSetting(page, 'language')).toBe(language)
}

/** Wait for the service worker to control the page, which is what makes offline work. */
export async function serviceWorkerReady(page: Page): Promise<void> {
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
    timeout: 30_000,
  })
}

/* ------------------------------------------------------------------ *
 * axe
 * ------------------------------------------------------------------ */

const require = createRequire(import.meta.url)

/**
 * axe-core is injected from node_modules rather than fetched — the hard rule is
 * that this app makes no third-party request, and that includes its own tests.
 * The privacy gate above would fail the test if it did.
 */
export const AXE_SOURCE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8')

export interface AxeViolation {
  id: string
  impact: string | null
  help: string
  nodes: { target: string[]; failureSummary?: string }[]
}

/**
 * Wait for every FINITE running animation to finish.
 *
 * Infinite ones are filtered out, and that is not a detail: `Skeleton` renders
 * `animate-pulse`, whose `finished` promise never resolves. Awaiting it would
 * hang a spec until Playwright's timeout the first time any page renders a
 * skeleton — a failure that would look like a flake.
 */
export async function settle(page: Page): Promise<void> {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  )
}

export async function audit(page: Page): Promise<AxeViolation[]> {
  await settle(page)
  await page.evaluate(AXE_SOURCE)
  return page.evaluate(async () => {
    const results = await (
      window as unknown as {
        axe: { run: (ctx: Document, opts: unknown) => Promise<{ violations: AxeViolation[] }> }
      }
    ).axe.run(document, { resultTypes: ['violations'] })
    return results.violations
  })
}

export const formatViolations = (violations: readonly AxeViolation[]): string[] =>
  violations.map((v) => `${v.impact ?? '?'} ${v.id} @ ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)

/*
  There is no "serious or critical only" filter here on purpose.

  The session brief asked for zero serious and critical violations; the sweeps
  in a11y.spec.ts assert zero of ANY impact, which is stricter and has been
  achievable on every route since Session 1. A filter would exist only to let a
  moderate violation through, and nothing in this app needs that yet — add one
  when something does, with the reason.
*/

/* ------------------------------------------------------------------ *
 * Viewport-dependent helpers
 * ------------------------------------------------------------------ */

/** True in the `mobile-chromium` project, where the shell is a different shape. */
export const onPhone = (page: Page): boolean => (page.viewportSize()?.width ?? 1280) < 1024

/**
 * Bring the Drafting Studio's A4 preview and its export bar on screen.
 *
 * Below 1024px the editor is two TABS rather than two columns, and the export
 * bar lives in the preview one — so a spec that fills the form and then reaches
 * for "Word (.docx)" finds a button that is genuinely not on the page. On a
 * desktop both panes are always rendered and this does nothing.
 */
export async function showPreviewPane(page: Page, language: Language = 'en'): Promise<void> {
  if (!onPhone(page)) return
  // `.first()`, not the bare locator: Playwright matches a string name as a
  // SUBSTRING, so the check ("is there at least one?") permitted a state the
  // action forbids ("there is exactly one") — two matches would fail as a
  // strict-mode violation rather than as anything a reader could diagnose.
  const tab = page.getByRole('radio', { name: t(language, 'draft.editor.tabs.preview') }).first()
  if ((await tab.count()) > 0) await tab.click()
}

/** The form half of the same two-tab layout. */
export async function showFormPane(page: Page, language: Language = 'en'): Promise<void> {
  if (!onPhone(page)) return
  const tab = page.getByRole('radio', { name: t(language, 'draft.editor.tabs.form') }).first()
  if ((await tab.count()) > 0) await tab.click()
}

/**
 * Dismiss the service worker's "Ready to work offline." notice.
 *
 * KNOWN DEFECT, not a test convenience — `docs/DATA-GAPS.md` #59. On a phone
 * that toast is a full-width bar pinned just above the tab bar, it waits for an
 * acknowledgement rather than timing out, and it sits exactly where a
 * bottom-anchored primary action does: it intercepted every click on the mock
 * test's "Next question" button until it was dismissed, which means a reader
 * who installs the app and starts a mock test cannot finish one until they
 * notice the ×. A real reader can dismiss it, which is what this does; the
 * finding is recorded rather than papered over.
 */
export async function dismissPwaToasts(page: Page): Promise<void> {
  const dismiss = page.getByRole('button', { name: t('en', 'pwa.dismiss') })
  for (let i = (await dismiss.count()) - 1; i >= 0; i -= 1) {
    await dismiss
      .nth(i)
      .click({ timeout: 2000 })
      .catch(() => undefined)
  }
}
