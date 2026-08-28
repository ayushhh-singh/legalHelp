import { expect, test } from '@playwright/test'

const ROUTES = [
  '/law',
  '/pay',
  '/draft',
  '/draft/office-memorandum',
  '/learn',
  '/utils',
  '/utils/glossary',
  '/settings',
  '/onboarding',
]

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
 * The glossary's own capture surface (Session 10): a search box, a copy
 * button that writes to the clipboard, and a favourite toggle that writes to
 * IndexedDB — none of which may leave the device.
 */
test('sends nothing while the glossary is searched, copied and saved', async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL ?? 'http://localhost:4173').origin
  const crossOrigin: string[] = []

  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.origin !== origin) crossOrigin.push(`${request.method()} ${request.url()}`)
  })

  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/utils/glossary')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

  await page.getByLabel('Search the glossary').fill('Cabinet Secretary')
  await expect(page.getByText('मंत्रिमंडल सचिव')).toBeVisible()

  await page.getByRole('button', { name: 'Copy Hindi' }).first().click()
  await expect(page.getByText('Copied to the clipboard.')).toBeVisible()

  await page.getByRole('button', { name: 'Save this term' }).first().click()
  await expect(page.getByRole('button', { name: 'Remove from saved' }).first()).toBeVisible()

  expect(crossOrigin).toEqual([])
})

/**
 * The command palette (Session 14): every section it searches is a `?raw`
 * dynamic import over the same datasets each module already loads this way
 * (ADR-013 and friends) — opening it and typing across several of them must
 * not turn into a request any more than opening those modules' own pages
 * does.
 */
test('sends nothing while the command palette is opened, searched across sections, and used to navigate', async ({
  page,
  baseURL,
}) => {
  const origin = new URL(baseURL ?? 'http://localhost:4173').origin
  const crossOrigin: string[] = []

  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.origin !== origin) crossOrigin.push(`${request.method()} ${request.url()}`)
  })

  await page.goto('/law')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

  await page.keyboard.press('Control+k')
  await expect(page.getByRole('dialog')).toBeVisible()

  for (const query of ['hatya', 'ACIO', 'avar sachiv', 'OM']) {
    await page.getByRole('combobox').fill(query)
    await expect(page.getByRole('option').first()).toBeVisible({ timeout: 20_000 })
  }

  await page.getByRole('option').first().click()
  await expect(page.getByRole('dialog')).toBeHidden()

  expect(crossOrigin).toEqual([])
})

/**
 * The Rules Trainer's own capture surfaces (Session 12): a grade, a bookmark,
 * a free-text report note and a settings change — the report note in
 * particular is the closest thing in this module to an open text field, and
 * it is exactly the kind of value this rule exists to keep on the device.
 */
test('sends nothing while a card is graded, bookmarked, reported and a setting changed', async ({
  page,
  baseURL,
}) => {
  const origin = new URL(baseURL ?? 'http://localhost:4173').origin
  const crossOrigin: string[] = []

  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.origin !== origin) crossOrigin.push(`${request.method()} ${request.url()}`)
  })

  await page.goto('/learn/review')
  await expect(page.getByRole('heading', { name: 'Review' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('Rule 1, Central Civil Services (Conduct) Rules, 1964')).toBeVisible({
    timeout: 30_000,
  })

  await page.getByRole('button', { name: 'Bookmark this card' }).click()
  await page.getByRole('button', { name: 'Report this card' }).click()
  await page.getByLabel('Note (optional)').fill('The Hindi reads oddly here — please check.')
  await page.getByRole('button', { name: 'Submit report' }).click()
  await expect(page.getByText('Report saved.')).toBeVisible()

  await page.getByRole('button', { name: 'Show answer' }).click()
  await page.getByRole('button', { name: /^Good/ }).click()

  await page.goto('/learn/settings')
  await expect(page.getByLabel('New cards per day')).toBeVisible({ timeout: 30_000 })
  await page.getByLabel('New cards per day').fill('5')

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

/**
 * First-run onboarding (ADR-028) is the first thing a fresh install shows,
 * and it is the one place a reader picks a post and a city before they have
 * seen anything else in the app — worth the same guarantee as every other
 * form here, checked over the full walk rather than a single field.
 */
test('sends nothing while onboarding is walked through, post and city included', async ({
  page,
  baseURL,
}) => {
  const origin = new URL(baseURL ?? 'http://localhost:4173').origin
  const crossOrigin: string[] = []

  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.origin !== origin) crossOrigin.push(`${request.method()} ${request.url()}`)
  })

  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: 'Choose your language' })).toBeVisible()
  await page.getByRole('button', { name: 'Continue' }).click()

  const jobPicker = page.getByRole('combobox', { name: 'Post', exact: true })
  await expect(jobPicker).toBeVisible({ timeout: 30_000 })
  await jobPicker.fill('ACIO')
  await page.getByRole('option', { name: /Assistant Central Intelligence Officer, Grade-II/ }).click()

  const cityPicker = page.getByRole('combobox', { name: 'Place of posting', exact: true })
  await cityPicker.fill('Delhi')
  await page.getByRole('option', { name: /^Delhi/ }).first().click()
  await page.getByRole('button', { name: 'Continue' }).click()

  await expect(page.getByRole('heading', { name: 'Before you begin' })).toBeVisible()
  await page.getByRole('button', { name: 'Understood' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Law Converter' })).toBeVisible()

  expect(crossOrigin).toEqual([])
})
