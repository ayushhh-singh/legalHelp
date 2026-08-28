import { expect, test } from '@playwright/test'

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
