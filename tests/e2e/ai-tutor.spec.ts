import { audit, dismissPwaToasts, expect, formatViolations, test } from './fixtures'

/**
 * The Rules Trainer's coaching agent, in a real browser, with AI turned on.
 *
 * As `tests/e2e/ai-draft.spec.ts` does for the drafting agent: this proves the
 * surface renders, passes axe, and reaches no network at all — the automatic
 * `network` fixture is what actually proves the last one, since no
 * `allowCrossOrigin` is declared here. Pressing "Explain" or "Give me a
 * scenario" is what would spend a request, and this spec never does; the
 * agent's own policy (grounding, the refusal to invent a citation, the
 * propose_card write path) is covered against `MockProvider` in
 * `src/ai/agents/tutor.test.ts`, where a scripted turn is exact.
 */

const FAKE_KEY = 'sk-ant-api03-playwright-not-a-real-key'

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

test('the review session offers a scenario action once AI is on, and reaches no network', async ({
  page,
}) => {
  await enableAi(page)

  await page.goto('/study/practise/review')
  await dismissPwaToasts(page)
  // The first card a fresh device ever shows — see learn.spec.ts's own note.
  await expect(page.getByText('Rule 1, Central Civil Services (Conduct) Rules, 1964')).toBeVisible({
    timeout: 30_000,
  })

  await expect(page.getByRole('complementary', { name: 'AI notice' })).toBeVisible()
  const scenarioButton = page.getByRole('button', { name: 'Give me a scenario on this rule' })
  await expect(scenarioButton).toBeVisible()
  // No wrong answer has been recorded on a plain rule card, so "Explain" is
  // not offered — there is nothing yet for it to explain.
  await expect(page.getByRole('button', { name: 'Explain' })).toHaveCount(0)

  const violations = await audit(page)
  expect(formatViolations(violations), 'axe violations with the AI panel on screen').toEqual([])
})

test('the home screen offers a focus plan action once AI is on', async ({ page }) => {
  await enableAi(page)

  // A fresh device shows the first-run empty state, not the dashboard the
  // focus plan card lives on — grade one card first, as learn.spec.ts does.
  await page.goto('/study/practise/review')
  await dismissPwaToasts(page)
  await expect(page.getByRole('button', { name: 'Show answer' })).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: 'Show answer' }).click()
  await page.getByRole('button', { name: /^Good/ }).click()

  await page.getByRole('link', { name: 'Back to Home' }).click()
  await expect(page).toHaveURL(/\/study\/practise$/)
  await expect(page.getByRole('button', { name: 'Get a focus plan' })).toBeVisible()
})

test('AI off — neither action renders, and the panel downloads nothing', async ({ page }) => {
  await page.goto('/study/practise/review')
  await dismissPwaToasts(page)
  await expect(page.getByText('Rule 1, Central Civil Services (Conduct) Rules, 1964')).toBeVisible({
    timeout: 30_000,
  })

  await expect(page.getByRole('button', { name: 'Give me a scenario on this rule' })).toHaveCount(0)
  await expect(page.getByRole('complementary', { name: 'AI notice' })).toHaveCount(0)
})
