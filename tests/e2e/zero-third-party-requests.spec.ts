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
 * The first fields in this app that capture something a reader typed: the Law
 * Converter's search box and its offence-date picker (Session 4).
 *
 * `docs/DATA-GAPS.md` #4 recorded that "no user-entered value leaves the page"
 * was only ever checked against synthetic input, because until now there was no
 * field to type into. A search query and an offence date are the most
 * identifying things this module can receive — an offence date in particular —
 * so this types real values, opens a section, copies a citation and shares it,
 * and asserts that nothing crossed the origin.
 */
test('sends nothing while a query, an offence date and a citation are typed, opened and shared', async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL ?? 'http://localhost:4173').origin
  const crossOrigin: string[] = []

  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.origin !== origin) crossOrigin.push(`${request.method()} ${request.url()}`)
  })

  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/law')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

  await page.getByLabel('Date of offence').fill('2023-11-14')
  await expect(page.getByText(/Old law applies/)).toBeVisible()

  await page.getByLabel(/Search a section/).fill('sec 420 ipc')
  await expect(page.getByRole('heading', { name: 'Cheating.' })).toBeVisible()

  // Copy and share both hand text to the platform, never to a server.
  await page.getByRole('button', { name: 'Copy citation' }).click()
  await expect(page.getByText('Citation copied.')).toBeVisible()
  await page.getByRole('button', { name: 'Share as text' }).click()

  // Saving writes to IndexedDB on this device and nowhere else.
  await page.getByRole('button', { name: 'Save this section' }).click()
  await expect(page.getByText('Saved on this device.')).toBeVisible()

  expect(crossOrigin).toEqual([])
})

/**
 * Voice search, off by default (ADR-013 addendum).
 *
 * Speech recognition in Chrome is a NETWORK service — the captured audio is
 * streamed to Google — so "off by default" has to mean more than a grey button:
 * nothing may construct a recogniser until the reader has read the notice. This
 * replaces the global with a counting stub before the app loads, then uses the
 * page normally and asserts the count is still zero.
 */
test('never opens the microphone until the notice has been read', async ({ page, baseURL }) => {
  const origin = new URL(baseURL ?? 'http://localhost:4173').origin
  const crossOrigin: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.origin !== origin) crossOrigin.push(`${request.method()} ${request.url()}`)
  })

  await page.addInitScript(() => {
    const counter = { built: 0 }
    ;(window as unknown as { __speech: typeof counter }).__speech = counter
    class Stub {
      lang = ''
      continuous = false
      interimResults = false
      maxAlternatives = 0
      onresult = null
      onerror = null
      onend = null
      constructor() {
        counter.built += 1
      }
      start() {}
      stop() {}
      abort() {}
    }
    Object.defineProperty(window, 'SpeechRecognition', { value: Stub, configurable: true })
  })

  await page.goto('/law')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

  // The button exists, because this browser has the API.
  const mic = page.getByRole('button', { name: 'Search by voice' })
  await expect(mic).toBeVisible()

  // Using the page normally must not open it.
  await page.getByLabel(/Search a section/).fill('302')
  await expect(page.getByRole('heading', { name: 'Punishment for murder.' })).toBeVisible()

  // Pressing it opens the NOTICE, not the microphone.
  await mic.click()
  await expect(page.getByRole('dialog', { name: 'Before you use voice search' })).toBeVisible()
  await expect(page.getByText(/Your voice leaves this device/)).toBeVisible()
  await page.getByRole('button', { name: 'Not now' }).click()

  const built = await page.evaluate(
    () => (window as unknown as { __speech: { built: number } }).__speech.built,
  )
  expect(built, 'a recogniser was constructed without consent').toBe(0)
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
