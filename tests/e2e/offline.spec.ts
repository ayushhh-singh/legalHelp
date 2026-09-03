import { expect, literal, serviceWorkerReady, test } from './fixtures'

/**
 * The master context's zero-network-requests-for-user-data rule needs a real
 * browser to verify (see tests/e2e/README.md); this is the first check from
 * that list. It exercises the actual service worker built by vite-plugin-pwa
 * (vite.config.ts), not a mock.
 */
test('shows the offline chip when the network drops, and the shell survives a reload with no network', async ({
  page,
  context,
}) => {
  await page.goto('/')
  await expect(page.getByRole('main')).toBeVisible()

  // First install: clientsClaim (vite.config.ts) lets the new worker take
  // control of this already-open page without a reload.
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null)

  await context.setOffline(true)
  // Checked before the reload: Chromium/Playwright's offline emulation does
  // not keep navigator.onLine false across a navigation, so this is the
  // point where the online/offline listener (OfflineBadge) is reliably
  // testable. The reload below instead proves the actual offline-first
  // behaviour — the precached shell rendering with zero network available.
  await expect(page.getByTestId('offline-badge')).toBeVisible()

  await page.reload()
  await expect(page.getByRole('main')).toBeVisible()
})

/**
 * "Works fully offline" means the law lookup works offline, not merely that the
 * shell paints.
 *
 * The section tables are ordinary content-hashed chunks (src/modules/law/data.ts
 * imports them with `?raw`), so `globPatterns` in vite.config.ts precaches them
 * on install like any other JavaScript. That is the whole reason for that
 * decision, and this is the test that holds it: the lookup below runs on a page
 * that has never loaded /law while online.
 */
test('answers a section lookup with no network at all', async ({ page, context }) => {
  // Install the service worker from a route that does NOT load the section
  // tables, so nothing is warmed by having visited /law first.
  await page.goto('/settings')
  await expect(page.getByRole('main')).toBeVisible()
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null)

  await context.setOffline(true)
  await page.goto('/law')

  await expect(page.getByRole('heading', { level: 1, name: 'Law Converter' })).toBeVisible()
  await page.getByLabel(/Search a section/).fill('302')

  // The answer, from 3.9 MB of section text served entirely out of the cache.
  await expect(page.getByRole('heading', { name: 'Punishment for murder.' })).toBeVisible()
  await expect(page.getByText(/"302" is now BNS 103/)).toBeVisible()
})

/**
 * The same guarantee for the glossary: `data/glossary.json` reaches the
 * browser as a `?raw` dynamic import (`src/modules/utils/glossary/data.ts`),
 * precached through the ordinary JavaScript glob exactly like the statute —
 * an officer who has never opened `/utils/glossary` online must still be able
 * to look a term up on a train with no signal.
 */
test('answers a glossary lookup with no network at all', async ({ page, context }) => {
  await page.goto('/settings')
  await expect(page.getByRole('main')).toBeVisible()
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null)

  await context.setOffline(true)
  await page.goto('/utils/glossary')

  await expect(page.getByRole('heading', { level: 1, name: 'Hindi administrative glossary' })).toBeVisible()
  await page.getByLabel('Search the glossary').fill('Cabinet Secretary')
  await expect(page.getByText('मंत्रिमंडल सचिव')).toBeVisible()
})

/**
 * Every route, reloaded with the network switched off.
 *
 * The two lookups above prove the datasets are reachable offline. This proves
 * the shell is: `navigateFallback: '/index.html'` (vite.config.ts) means a
 * client-routed path like `/utils/pension` is never precached under its own
 * name, so a hard reload there has to be answered by the cached shell and then
 * re-routed by React Router. That is a different mechanism from a client-side
 * navigation, and it is the one an officer actually hits — a PWA is reopened,
 * not navigated to.
 *
 * `page.reload()` rather than `page.goto()`, deliberately: goto from an
 * already-loaded page can be served by the router without a document request
 * at all, which would pass this test without ever exercising the fallback.
 */
const EVERY_ROUTE = [
  // Onboarding is reachable offline on a device that has never completed it,
  // which is the likeliest first run for an officer installing this on a train.
  '/onboarding',
  '/law',
  '/law/whats-new',
  '/law/saved',
  '/pay',
  '/draft',
  '/draft/office-memorandum',
  // The document editor's own chunk carries Tiptap and ProseMirror — 141 KB
  // gzip — and an offline reload is what proves the service worker precached
  // it rather than fetching it when the officer first opened a document.
  '/draft/documents',
  '/draft/profile',
  '/draft/address-book',
  '/draft/numbering',
  '/draft/my-templates',
  '/learn',
  '/learn/review',
  // recharts is behind this route's own chunk; an offline reload is what proves
  // the chunk was precached rather than fetched on demand.
  '/learn/mock',
  '/learn/browse',
  '/learn/bookmarks',
  '/learn/reports',
  '/learn/settings',
  '/learn/review-queue',
  '/library',
  '/library/ccs-conduct',
  // The reader is what an officer actually opens on a train; the corpus chunk
  // it needs is precached rather than fetched on demand, and an offline reload
  // is what proves it.
  '/library/ccs-conduct/ccs-conduct-3',
  // Session 28's study screens. Every figure on them is arithmetic over rows
  // this device already holds, and the quiz draws from a precached catalogue,
  // so all three must work with no network at all.
  '/library/study',
  '/library/ccs-conduct/quiz/group-n-ccs-conduct-1',
  '/library/ccs-conduct/sheet/group-n-ccs-conduct-1',
  // Everything a reader wrote is in IndexedDB and everything they added is a
  // row, so these five must work with no network at all — which is the only
  // condition most of this session's work will ever be used under.
  '/library/mine',
  '/library/bookmarks',
  '/library/compare',
  '/library/search',
  '/library/add',
  '/utils',
  '/utils/glossary',
  '/utils/holidays',
  '/utils/leave',
  '/utils/pension',
  '/utils/portals',
  '/settings',
]

test('reloads every route with no network and still renders its own page', async ({ page, context }) => {
  /*
    One test, thirty-seven routes, two navigations each.

    The explicit budget is here for the reason `a11y.spec.ts`'s route sweep
    carries one: this is ONE test that does a great deal, and the default 30s
    is a ceiling on the whole loop rather than on any one route. Session 29's
    seven new `/draft` routes are what pushed it past — the failure was
    `/utils/portals`, thirty-fifth in the list and nothing to do with the
    change. An intermittent failure that passes in isolation is a budget, not a
    defect (CLAUDE.md); the per-route `toBeVisible` below keeps its own 30s, so
    a route that genuinely never renders still fails fast and by name.
  */
  test.setTimeout(300_000)

  await page.goto('/settings')
  await expect(page.getByRole('main')).toBeVisible()
  await serviceWorkerReady(page)

  await context.setOffline(true)

  for (const route of EVERY_ROUTE) {
    await page.goto(route)
    await page.reload()

    // A heading, not merely `main`: the fallback shell renders `main` for a
    // route it failed to resolve too, so asserting on `main` alone would pass
    // for a blank page. An <h1> means the route's own module chunk was in the
    // cache and ran.
    await expect(page.getByRole('heading', { level: 1 }), `${route} offline`).toBeVisible({
      timeout: 30_000,
    })
    // Escaped: every route here is a plain path today, but a future one
    // containing a `.` would silently match any character in that position.
    await expect(page, `${route} offline`).toHaveURL(new RegExp(`${literal(route)}$`))
  }
})
