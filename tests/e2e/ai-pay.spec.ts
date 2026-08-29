import { audit, dismissPwaToasts, expect, formatViolations, test } from './fixtures'

/**
 * The Pay calculator's agent, in a real browser, with AI turned on.
 *
 * Same shape as `tests/e2e/ai-tutor.spec.ts` and `ai-draft.spec.ts`: proves the
 * surface renders, passes axe, and reaches no network — no `allowCrossOrigin`
 * is declared, so the automatic `network` fixture fails the test at teardown
 * on any cross-origin request. Pressing "Explain my payslip" or "Compare
 * these two posts for me" is what would spend a request, and this spec never
 * does; the agent's grounding and neutrality checks are covered against
 * `MockProvider` in `src/ai/agents/pay.test.ts`.
 */

const FAKE_KEY = 'sk-ant-api03-playwright-not-a-real-key'

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

test('the calculator offers "Explain my payslip" once a post is picked and AI is on', async ({ page }) => {
  await enableAi(page)

  await page.goto('/pay?job=ib-acio-ii-executive')
  await dismissPwaToasts(page)
  await expect(page.getByRole('heading', { level: 1, name: 'Pay & Allowances' })).toBeVisible()

  await expect(page.getByRole('complementary', { name: 'AI notice' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Explain my payslip' })).toBeVisible()

  const violations = await audit(page)
  expect(formatViolations(violations), 'axe violations with the pay AI panel on screen').toEqual([])
})

test('the compare tab offers a neutral-summary action once both posts are picked', async ({ page }) => {
  await enableAi(page)

  await page.goto('/pay?tab=compare&job=ib-acio-ii-executive&b_job=aso-css')
  await dismissPwaToasts(page)
  await expect(page.getByRole('button', { name: 'Compare these two posts for me' })).toBeVisible()
})

test('AI off — no explain action renders, no post picked — no explain action either', async ({ page }) => {
  await page.goto('/pay?job=ib-acio-ii-executive')
  await dismissPwaToasts(page)
  await expect(page.getByRole('heading', { level: 1, name: 'Pay & Allowances' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Explain my payslip' })).toHaveCount(0)
  await expect(page.getByRole('complementary', { name: 'AI notice' })).toHaveCount(0)
})
