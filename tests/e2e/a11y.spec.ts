import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

import { expect, test, type Page } from '@playwright/test'

/**
 * axe over the built shell, in a real browser, across every route x both
 * languages x both themes.
 *
 * This is the run that can actually evaluate `color-contrast`: jsdom has no
 * layout or paint, so src/app/App.a11y.test.tsx has to disable that rule and it
 * reports as *incomplete* there, not *pass*. Closes docs/DATA-GAPS.md #2.
 *
 * axe-core is injected from node_modules rather than fetched — the hard rule is
 * that this app makes no third-party request, and that includes its own tests.
 */
const require = createRequire(import.meta.url)
const AXE_SOURCE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8')

const ROUTES = ['/law', '/law/whats-new', '/law/saved', '/pay', '/draft', '/learn', '/utils', '/settings']

interface AxeViolation {
  id: string
  impact: string | null
  help: string
  nodes: { target: string[]; failureSummary?: string }[]
}

/**
 * Wait for every FINITE running animation to finish.
 *
 * The nav items carry `transition-colors`, so switching theme animates their
 * text and background through intermediate colours for ~150ms. axe sampling
 * inside that window reported a real-looking `color-contrast` violation on a
 * pair that measures 8.1:1 once settled. Transient states are not what WCAG
 * 1.4.3 is about, and an arbitrary sleep would only hide the race — this waits
 * on the actual animations.
 *
 * Infinite ones are filtered out, and that is not a detail: `Skeleton` renders
 * `animate-pulse`, whose `finished` promise never resolves. Awaiting it would
 * hang this spec until Playwright's 30s timeout the first time any page renders
 * a skeleton — a failure that would look like a flake and arrive in whichever
 * session happens to add one.
 */
async function settle(page: Page) {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  )
}

async function audit(page: Page): Promise<AxeViolation[]> {
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

const format = (violations: AxeViolation[]) =>
  violations.map((v) => `${v.impact ?? '?'} ${v.id} @ ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)

/**
 * Set language and theme ONCE, from the real controls. Both are persisted in
 * IndexedDB and survive navigation, so toggling per route would flip them back
 * — and the toggle's accessible name changes with its state, so the second
 * click would not even find a button.
 */
async function setChrome(page: Page, language: 'en' | 'hi', theme: 'light' | 'dark') {
  await page.goto(ROUTES[0] ?? '/law')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

  if (language === 'hi') {
    await page.getByRole('button', { name: 'Switch to Hindi' }).click()
    await expect(page.locator('html')).toHaveAttribute('lang', 'hi')
  }
  if (theme === 'dark') {
    await page.getByRole('button', { name: /dark theme|गहरे रंग/i }).click()
    await expect(page.locator('html')).toHaveClass(/dark/)
  }

  /*
    Wait for what was TOGGLED to be in IndexedDB, not merely applied to the DOM.

    The toggles apply in memory synchronously and persist asynchronously, so the
    first navigation below can outrun the write and land on a page that hydrates
    back to the default — the same race `tests/e2e/theme.spec.ts` documents. It
    became a real flake when this sweep grew from six routes to eight.

    Only a toggled preference is waited for: a default is never written, so
    waiting for `theme: light` would wait for a row that will never exist.
  */
  for (const [key, value] of [
    ['language', language === 'hi' ? 'hi' : null],
    ['theme', theme === 'dark' ? 'dark' : null],
  ] as const) {
    if (!value) continue
    await expect.poll(() => storedSetting(page, key)).toBe(value)
  }
}

/** One row out of the `settings` store, or null while it is not there yet. */
function storedSetting(page: Page, key: string): Promise<string | null> {
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

for (const language of ['en', 'hi'] as const) {
  for (const theme of ['light', 'dark'] as const) {
    test(`no axe violations in ${language} / ${theme}`, async ({ page }) => {
      await setChrome(page, language, theme)

      for (const route of ROUTES) {
        await page.goto(route)
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
        // The preference is read back out of IndexedDB after a navigation;
        // audit the page the reader actually sees, not the pre-hydration one.
        await expect(page.locator('html')).toHaveAttribute('lang', language)
        if (theme === 'dark') await expect(page.locator('html')).toHaveClass(/dark/)

        expect(format(await audit(page)), `${route} (${language}/${theme})`).toEqual([])
      }
    })
  }
}

test('the audit still finishes when an infinite animation is on the page', async ({ page }) => {
  // Regression guard for settle(). <Skeleton/> renders `animate-pulse`, whose
  // `finished` promise never resolves; awaiting it hung this spec until
  // Playwright's timeout. No page renders one yet, so inject exactly what it
  // renders — otherwise the guard only starts working after the bug reappears.
  await page.goto('/law')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await page.evaluate(() => {
    const skeleton = document.createElement('div')
    skeleton.className = 'animate-pulse bg-muted h-4 w-20 rounded-md'
    document.querySelector('main')?.appendChild(skeleton)
  })
  await expect.poll(() => page.evaluate(() => document.getAnimations().length)).toBeGreaterThan(0)

  expect(format(await audit(page))).toEqual([])
})

/**
 * The Law Converter with a result open — the densest surface in the app, and
 * the one the default sweep above never reaches, because it needs a query.
 *
 * A section card carries a status pill, a coral trap banner, a marigold
 * curated-Hindi notice, a word-level diff in tulsi and coral, and a seven-column
 * classification table. Every one of those is a tinted background with a paired
 * -foreground on it, which is exactly where a contrast failure hides.
 */
for (const language of ['en', 'hi'] as const) {
  for (const theme of ['light', 'dark'] as const) {
    test(`no axe violations on an open section card in ${language} / ${theme}`, async ({ page }) => {
      await setChrome(page, language, theme)
      // BNS 103: a trap banner, curated Hindi, a two-row classification table
      // and a heading diff, all on one card.
      await page.goto('/law?q=302&date=2024-06-30')
      await expect(page.getByRole('heading', { name: /Punishment for murder|हत्या/ })).toBeVisible()

      expect(format(await audit(page)), `law card (${language}/${theme})`).toEqual([])
    })
  }
}

test('no axe violations while browsing a whole Act', async ({ page }) => {
  // A windowed list of 531 rows, where only a slice is in the DOM and one row
  // carries the tab stop. Worth its own run: the sweep above never picks a code.
  await page.goto('/law')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await page.getByText('BNSS · CrPC', { exact: true }).click()
  await expect(page.getByRole('list', { name: 'Search results' })).toBeVisible()

  expect(format(await audit(page))).toEqual([])
})

for (const theme of ['light', 'dark'] as const) {
  test(`no axe violations with the microphone listening in ${theme}`, async ({ page }) => {
    // There is no consent notice any more (ADR-017) — the surface to audit is
    // the button and the live region that says the microphone is open.
    await page.addInitScript(() => {
      class Stub {
        lang = ''
        continuous = false
        interimResults = false
        maxAlternatives = 0
        onresult = null
        onerror = null
        onend = null
        static available() {
          return Promise.resolve('available')
        }
        static install() {
          return Promise.resolve(true)
        }
        start() {}
        stop() {}
        abort() {}
      }
      Object.defineProperty(Stub.prototype, 'processLocally', { value: false, writable: true })
      Object.defineProperty(window, 'SpeechRecognition', { value: Stub, configurable: true })
      Reflect.deleteProperty(window, 'webkitSpeechRecognition')
    })
    await setChrome(page, 'en', theme)
    await page.goto('/law')
    await page.getByRole('button', { name: 'Search by voice' }).click()
    await expect(page.getByRole('button', { name: 'Stop listening' })).toBeVisible()

    expect(format(await audit(page)), `microphone (${theme})`).toEqual([])
  })
}

test('no axe violations with the More sheet open', async ({ page }) => {
  // The one piece of chrome that is not on screen by default. 390px so the
  // sheet's own breakpoint (<768px) applies.
  await page.setViewportSize({ width: 390, height: 780 })
  await page.goto('/law')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await page.getByRole('button', { name: 'More destinations' }).click()
  await expect(page.getByRole('button', { name: 'More destinations' })).toHaveAttribute(
    'aria-expanded',
    'true',
  )

  expect(format(await audit(page))).toEqual([])
})

/**
 * The consent modal and the enabled AI surface, in both themes.
 *
 * Neither is on screen in the default state the sweep above audits: the modal
 * only opens on a click, and the coral AI banner only renders once a tier has
 * been chosen. Both are exactly the kind of surface where a contrast or a
 * focus-order defect hides, so each gets its own run.
 */
for (const theme of ['light', 'dark'] as const) {
  test(`no axe violations on the AI consent modal and banner in ${theme}`, async ({ page }) => {
    await setChrome(page, 'en', theme)
    await page.goto('/settings')
    await expect(page.getByRole('heading', { name: 'AI features' })).toBeVisible()

    await page.getByRole('button', { name: 'Read what this sends' }).click()
    await expect(page.getByRole('dialog', { name: 'Before you turn on AI' })).toBeVisible()
    expect(format(await audit(page)), `consent modal (${theme})`).toEqual([])

    await page.getByRole('button', { name: 'I have read this — enable AI' }).click()
    await page
      .getByRole('radiogroup', { name: 'How AI runs' })
      .getByRole('radio', { name: /Your own Anthropic key/ })
      .click()
    // The classified-content banner is now on screen, coral on its own tint.
    await expect(page.getByText(/Do not enter official, sensitive or classified/)).toBeVisible()

    expect(format(await audit(page)), `AI banner (${theme})`).toEqual([])
  })
}
