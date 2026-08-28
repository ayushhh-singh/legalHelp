import { expect, test } from '@playwright/test'

/**
 * Tier 1, with api.anthropic.com intercepted.
 *
 * Two things are asserted, and they are the two that matter for a key the app
 * holds on someone else's behalf:
 *
 *   1. "Test connection" sends EXACTLY ONE request, only when pressed, with the
 *      three headers the direct-browser arrangement requires and nothing else.
 *   2. The key is never written to IndexedDB in the clear.
 *
 * The route is registered before navigation, so a request made at any earlier
 * point — on load, on consent, on choosing the tier — would be captured too and
 * would fail the count.
 */

const FAKE_KEY = 'sk-ant-api03-playwright-not-a-real-key'

test('sends exactly one request, with the expected headers, only on the button press', async ({ page }) => {
  const requests: { headers: Record<string, string>; body: string }[] = []

  await page.route('https://api.anthropic.com/**', async (route) => {
    const request = route.request()
    requests.push({ headers: request.headers(), body: request.postData() ?? '' })
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'msg_test',
        model: 'claude-sonnet-4-6',
        content: [],
        stop_reason: 'max_tokens',
        usage: { input_tokens: 8, output_tokens: 1 },
      }),
    })
  })

  await page.goto('/settings')

  await page.getByRole('button', { name: 'Read what this sends' }).click()
  await page.getByRole('button', { name: 'I have read this — enable AI' }).click()
  await page
    .getByRole('radiogroup', { name: 'How AI runs' })
    .getByRole('radio', { name: /Your own Anthropic key/ })
    .click()

  await page.getByLabel('Anthropic API key').fill(FAKE_KEY)
  await page.getByRole('button', { name: 'Save key' }).click()
  await expect(page.getByText('A key is stored on this device.')).toBeVisible()

  // Storing a key sends nothing.
  expect(requests).toHaveLength(0)

  await page.getByRole('button', { name: 'Test connection' }).click()
  await expect(page.getByText('The key works.')).toBeVisible()

  expect(requests).toHaveLength(1)
  const [sent] = requests
  expect(sent?.headers['x-api-key']).toBe(FAKE_KEY)
  expect(sent?.headers['anthropic-version']).toBe('2023-06-01')
  expect(sent?.headers['anthropic-dangerous-direct-browser-access']).toBe('true')

  const body = JSON.parse(sent?.body ?? '{}') as Record<string, unknown>
  expect(body.max_tokens).toBe(1)
  expect(body.stream).toBeUndefined()
  expect(body.tools).toBeUndefined()

  // The key is on the device only as ciphertext.
  const stored = await page.evaluate(async (): Promise<string> => {
    const open = indexedDB.open('sahayak')
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      open.onsuccess = () => resolve(open.result)
      open.onerror = () => reject(new Error(open.error?.message ?? 'could not open sahayak'))
    })
    const rows = await new Promise<unknown[]>((resolve, reject) => {
      const request = database.transaction('secrets').objectStore('secrets').getAll()
      request.onsuccess = () => resolve(request.result as unknown[])
      request.onerror = () => reject(new Error(request.error?.message ?? 'could not read secrets'))
    })
    return JSON.stringify(rows)
  })

  expect(stored).not.toContain('sk-ant')
  expect(stored).not.toContain(FAKE_KEY)
})

test('a rejected key is reported, and the failure is not silent', async ({ page }) => {
  await page.route('https://api.anthropic.com/**', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ error: { type: 'authentication_error', message: 'invalid x-api-key' } }),
    }),
  )

  await page.goto('/settings')
  await page.getByRole('button', { name: 'Read what this sends' }).click()
  await page.getByRole('button', { name: 'I have read this — enable AI' }).click()
  await page
    .getByRole('radiogroup', { name: 'How AI runs' })
    .getByRole('radio', { name: /Your own Anthropic key/ })
    .click()
  await page.getByLabel('Anthropic API key').fill(FAKE_KEY)
  await page.getByRole('button', { name: 'Save key' }).click()
  await page.getByRole('button', { name: 'Test connection' }).click()

  await expect(page.getByText(/The key was rejected: invalid x-api-key/)).toBeVisible()
})
