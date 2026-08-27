import { expect, test } from '@playwright/test'

const ROUTES = ['/law', '/pay', '/draft', '/learn', '/utils', '/settings']

/**
 * The runtime half of the master context's hard rule ("Zero network requests
 * carrying user-entered data (enforced by a Playwright test)"). The static
 * half is tests/no-external-urls.test.ts, which sweeps built source for
 * fetchable references — this instead watches actual requests a real browser
 * makes while using the app.
 *
 * Scoped to "no cross-origin request happens at all" — the strongest, most
 * testable form of the rule while the app has no field that captures
 * user-entered data yet (see docs/DATA-GAPS.md #4). It doubles as a
 * regression check for vite.config.ts's runtime-caching same-origin scoping.
 */
test('makes no cross-origin request while browsing every route or switching language', async ({
  page,
  baseURL,
}) => {
  const origin = new URL(baseURL ?? 'http://localhost:4173').origin
  const crossOrigin: string[] = []

  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.origin !== origin) crossOrigin.push(`${request.method()} ${request.url()}`)
  })

  for (const route of ROUTES) {
    await page.goto(route)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  }

  // The language toggle is a different code path (i18next resource lookup, a
  // full re-render) — worth the same guarantee.
  await page.locator('header button').first().click()
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

  expect(crossOrigin).toEqual([])
})
