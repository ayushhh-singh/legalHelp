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

const ROUTES = ['/law', '/pay', '/draft', '/learn', '/utils', '/settings']

interface AxeViolation {
  id: string
  impact: string | null
  help: string
  nodes: { target: string[]; failureSummary?: string }[]
}

/**
 * Wait for every running CSS transition to finish.
 *
 * The nav items carry `transition-colors`, so switching theme animates their
 * text and background through intermediate colours for ~150ms. axe sampling
 * inside that window reported a real-looking `color-contrast` violation on a
 * pair that measures 8.1:1 once settled. Transient states are not what WCAG
 * 1.4.3 is about, and an arbitrary sleep would only hide the race — this waits
 * on the actual animations.
 */
async function settle(page: Page) {
  await page.evaluate(() =>
    Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined))),
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
