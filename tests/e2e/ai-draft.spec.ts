import { audit, dismissPwaToasts, expect, formatViolations, showFormPane, test } from './fixtures'

/**
 * The drafting AI surface, in a real browser, with AI turned on.
 *
 * What this proves that `src/modules/drafting/components/AiDraftPanel.test.tsx`
 * cannot: that the panel renders correctly inside the real editor at a real
 * viewport, that it passes axe there (jsdom does not lay anything out, and the
 * two accessibility defects this project has actually shipped were both found
 * only by a real-browser axe run — ADR-028, ADR-029), and — the point of the
 * whole layer — that a reader can turn AI on, open the panel and read every
 * word of it WITHOUT a single request leaving the origin.
 *
 * That last one is the automatic `network` fixture's doing rather than this
 * spec's: no `allowCrossOrigin` is declared here, unlike `ai-byok.spec.ts`, so
 * any request to `api.anthropic.com` fails the test at teardown. Turning AI on
 * is not what sends anything; pressing "Draft it" is, and this spec never does.
 *
 * A full run against a live model is deliberately not here. The agent's policy
 * — the tool sequence, the checklist being evaluated rather than claimed, the
 * revision cap — is covered against `MockProvider` in the unit suite, where a
 * scripted turn is exact. Scripting Anthropic's SSE wire format in Playwright
 * would test the fixture.
 */

const FAKE_KEY = 'sk-ant-api03-playwright-not-a-real-key'

/** Turn AI on the way a reader does: consent, tier, key. Sends nothing. */
async function enableAi(page: import('@playwright/test').Page): Promise<void> {
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
}

test('the panel appears once AI is on, gates the brief box, and reaches no network', async ({ page }) => {
  await enableAi(page)

  await page.goto('/draft/office-memorandum')
  await dismissPwaToasts(page)
  await expect(page.getByRole('heading', { level: 1, name: 'Office Memorandum (O.M.)' })).toBeVisible()
  await showFormPane(page)

  const panel = page.getByRole('heading', { name: 'Draft with AI' })
  await expect(panel).toBeVisible({ timeout: 30_000 })

  // Collapsed: it says what it is and nothing else is downloaded or shown.
  await expect(page.getByLabel('What is this document for?')).toHaveCount(0)
  await page.getByRole('button', { name: 'Open', exact: true }).click()

  // The standing AI notice is permanent, not a toast, and is the first thing.
  await expect(page.getByRole('complementary', { name: 'AI notice' })).toBeVisible()
  await expect(page.getByText('Do not enter official, sensitive or classified content,')).toBeVisible()

  // The per-draft acknowledgement holds the brief box back.
  await expect(page.getByText('This draft leaves the device.')).toBeVisible()
  await expect(page.getByLabel('What is this document for?')).toHaveCount(0)

  const gated = await audit(page)
  expect(formatViolations(gated), 'axe violations on the gated AI panel').toEqual([])

  await page.getByRole('button', { name: 'It contains none of that — continue' }).click()
  await expect(page.getByLabel('What is this document for?')).toBeVisible()
  // Nothing is spendable until there is a brief.
  await expect(page.getByRole('button', { name: 'Draft it' })).toBeDisabled()

  const open = await audit(page)
  expect(formatViolations(open), 'axe violations on the open AI panel').toEqual([])
})

test('a field’s ✨ control offers the rewrites and runs none of them by itself', async ({ page }) => {
  await enableAi(page)

  await page.goto('/draft/office-memorandum')
  await dismissPwaToasts(page)
  await showFormPane(page)

  const improve = page.getByRole('button', { name: /^Improve wording — Subject$/ })
  await expect(improve).toBeVisible({ timeout: 30_000 })
  await improve.click()

  // It opens the panel and waits behind the same gate. Pressing a control on a
  // field must not be what sends a draft anywhere.
  await expect(page.getByText('This draft leaves the device.')).toBeVisible()
  await page.getByRole('button', { name: 'It contains none of that — continue' }).click()

  const request = page.getByRole('region', { name: 'Improve wording' })
  await expect(request).toBeVisible()
  await expect(request.getByRole('button', { name: 'Tighten it' })).toBeVisible()
  await expect(request.getByRole('button', { name: 'Write the other language' })).toBeVisible()

  const violations = await audit(page)
  expect(formatViolations(violations), 'axe violations on the rewrite request').toEqual([])
})
