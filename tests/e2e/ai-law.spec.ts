import { audit, dismissPwaToasts, expect, formatViolations, test } from './fixtures'

/**
 * The Law Converter's "Ask" surface, in a real browser.
 *
 * What this proves that `src/modules/law/askPanel.test.tsx` cannot: that the
 * panel renders correctly inside the real converter at a real viewport, that it
 * passes axe there (jsdom lays nothing out, and both accessibility defects this
 * project has actually shipped were found only by a real-browser axe run —
 * ADR-028, ADR-029), and — the point of the whole layer — that a reader can
 * turn AI on, open `/law` and read every word of the panel WITHOUT a single
 * request leaving the origin.
 *
 * That last one is the automatic `network` fixture's doing rather than this
 * spec's: no `allowCrossOrigin` is declared here, unlike `ai-byok.spec.ts`, so
 * any request to `api.anthropic.com` fails the test at teardown. Turning AI on
 * is not what sends anything; pressing Ask is, and this spec never does.
 *
 * A full run against a live model is deliberately not here. The agent's policy
 * — the two passes, the labelled snippets, the citations re-derived from the
 * tool results, the date rule — is covered against `MockProvider` in the unit
 * suite, where a scripted turn is exact.
 */

const FAKE_KEY = 'sk-ant-api03-playwright-not-a-real-key'

/** Turn AI on the way a reader does: consent, tier, key. Sends nothing. */
async function enableAi(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/settings/ai')
  await page.getByRole('button', { name: 'Read what this sends' }).click()
  await page.getByRole('button', { name: 'I have read this — enable AI' }).click()
  await page
    .getByRole('radiogroup', { name: 'How AI runs' })
    .getByRole('radio', { name: /Your own Anthropic key/ })
    .click()
  await page.getByLabel('Anthropic API key').fill(FAKE_KEY)
  await page.getByRole('button', { name: 'Save key' }).click()
  await expect(page.getByText('A key is stored on this device.')).toBeVisible()
}

test('with AI off — every device’s default — there is no Ask input', async ({ page }) => {
  await page.goto('/law')
  await dismissPwaToasts(page)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

  await expect(page.getByRole('heading', { name: 'Ask about a section' })).toHaveCount(0)
  await expect(page.getByLabel('What do you want to know?')).toHaveCount(0)
  await expect(page.getByRole('complementary', { name: 'AI notice' })).toHaveCount(0)

  // The converter itself is untouched by the panel's absence.
  await page.getByLabel(/Search a section/).fill('302')
  await expect(page.getByText('Punishment for murder.').first()).toBeVisible({ timeout: 30_000 })
})

test('with AI on the panel appears under the search, and reaches no network', async ({ page, network }) => {
  await enableAi(page)

  await page.goto('/law')
  await dismissPwaToasts(page)

  const panel = page.getByRole('heading', { name: 'Ask about a section' })
  await expect(panel).toBeVisible({ timeout: 30_000 })

  // The standing AI notice is permanent, not a toast, and sits above the input.
  await expect(page.getByRole('complementary', { name: 'AI notice' })).toBeVisible()
  await expect(page.getByText('Do not enter official, sensitive or classified content,')).toBeVisible()

  const question = page.getByLabel('What do you want to know?')
  await expect(question).toBeVisible()
  // Nothing is spendable until there is a question.
  await expect(page.getByRole('button', { name: 'Ask', exact: true })).toBeDisabled()

  const sentinel = network.sentinel('law-question')
  await question.fill(sentinel)
  await expect(page.getByRole('button', { name: 'Ask', exact: true })).toBeEnabled()

  const violations = await audit(page)
  expect(formatViolations(violations), 'axe violations on the Ask panel').toEqual([])
})

test('the offence date above is named in the panel’s own hint', async ({ page }) => {
  await enableAi(page)

  await page.goto('/law?date=2024-06-20')
  await dismissPwaToasts(page)

  await expect(page.getByRole('heading', { name: 'Ask about a section' })).toBeVisible({
    timeout: 30_000,
  })
  // The date rule is a fact about the reader's own matter, so the panel says
  // which date it will use rather than leaving them to wonder.
  await expect(page.getByText(/The offence date above \(2024-06-20\) is used/)).toBeVisible()
})
