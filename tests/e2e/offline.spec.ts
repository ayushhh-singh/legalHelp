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
