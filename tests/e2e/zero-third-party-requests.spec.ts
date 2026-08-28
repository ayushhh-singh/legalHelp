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

/**
 * The AI layer's half of the same rule (Session 3A). It is dormant by default,
 * and "dormant" has to mean more than "the button is grey": reading the consent
 * notice, accepting it and choosing a tier must all still send nothing.
 */
test('sends nothing while the AI section is read, consented to and configured', async ({ page, baseURL }) => {
  const origin = new URL(baseURL ?? 'http://localhost:4173').origin
  const crossOrigin: string[] = []

  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.origin !== origin) crossOrigin.push(`${request.method()} ${request.url()}`)
  })

  await page.goto('/settings')

  // Visible, and off.
  const heading = page.getByRole('heading', { name: 'AI features' })
  await expect(heading).toBeVisible()
  await expect(page.getByText('off', { exact: true })).toBeVisible()

  // Every control is disabled until the notice has been read.
  const tiers = page.getByRole('radiogroup', { name: 'How AI runs' })
  await expect(tiers.getByRole('radio', { name: /Your own Anthropic key/ })).toBeDisabled()

  await page.getByRole('button', { name: 'Read what this sends' }).click()
  const dialog = page.getByRole('dialog', { name: 'Before you turn on AI' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText(/Never enter official, sensitive or classified content/)).toBeVisible()
  await dialog.getByRole('button', { name: 'I have read this — enable AI' }).click()

  // Consent alone does not turn anything on, and choosing a tier with no key
  // does not either.
  await expect(page.getByText('off', { exact: true })).toBeVisible()
  await tiers.getByRole('radio', { name: /Your own Anthropic key/ }).click()
  await expect(page.getByText('needs setup')).toBeVisible()
  await expect(page.getByLabel('Anthropic API key')).toBeVisible()

  expect(crossOrigin).toEqual([])
})
