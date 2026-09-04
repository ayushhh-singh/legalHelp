import { expect, test } from './fixtures'

/**
 * Installability, on every route the session brief names.
 *
 * Lighthouse dropped its PWA category in v12, so there is no audit left to
 * point at (ADR-008, docs/DATA-GAPS.md #8). What Chrome actually requires to
 * offer "Install app" is a short, checkable list, and every item on it is
 * origin-wide rather than per-page — one manifest, one service worker scoped
 * to `/`. The reason to check it on each route anyway is the SPA fallback:
 * `/tools/salary` is not a file, it is public/_redirects serving index.html, and a
 * fallback that stopped carrying the manifest link would make the app
 * installable from its home page and from nowhere else. That is exactly the
 * failure a reader arriving on a shared deep link would hit.
 *
 * The one requirement not asserted here is HTTPS, which localhost is exempt
 * from and which Cloudflare Pages supplies.
 */

const ROUTES = ['/', '/law', '/tools/salary', '/draft', '/study/practise', '/tools']

type Manifest = {
  name?: string
  short_name?: string
  start_url?: string
  display?: string
  icons?: { sizes: string; src: string }[]
}

test('every route serves the manifest, the icons and a controlling service worker', async ({ page }) => {
  for (const route of ROUTES) {
    await page.goto(route)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

    const href = await page.locator('link[rel="manifest"]').getAttribute('href')
    expect(href, `${route} serves no manifest link`).toBeTruthy()

    // Fetched through Playwright's own request context, never `fetch` inside
    // page.evaluate: eslint.config.js forbids `fetch` outside
    // src/ai/providers/wire.ts and src/lib/dataUpdates.ts, and that rule is
    // worth more than the convenience of writing around it.
    const response = await page.request.get(new URL(href ?? '', page.url()).toString())
    expect(response.ok(), `${route}: the manifest did not load`).toBe(true)

    const manifest = (await response.json()) as Manifest
    expect(manifest.name).toBeTruthy()
    expect(manifest.short_name).toBeTruthy()
    expect(manifest.start_url).toBe('/')
    expect(manifest.display).toBe('standalone')

    const icons = manifest.icons ?? []
    expect(
      icons.map((icon) => icon.sizes),
      `${route}: manifest icon sizes`,
    ).toEqual(expect.arrayContaining(['192x192', '512x512']))

    for (const icon of icons) {
      const iconResponse = await page.request.get(new URL(icon.src, page.url()).toString())
      expect(iconResponse.status(), `${route}: icon ${icon.src}`).toBe(200)
    }
  }

  // Scoped to the origin, so this is asserted once rather than six times.
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
    timeout: 30_000,
  })
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope)
  expect(new URL(scope).pathname).toBe('/')
})

/**
 * A deep link is the case public/_redirects exists for, and the one a
 * hand-written 404 page would silently break.
 */
test('a deep link into a module serves the shell, not a 404', async ({ page }) => {
  for (const route of ['/law/whats-new', '/tools/glossary', '/study/practise/browse']) {
    const response = await page.goto(route)
    expect(response?.status(), `${route} did not serve 200`).toBe(200)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  }
})
