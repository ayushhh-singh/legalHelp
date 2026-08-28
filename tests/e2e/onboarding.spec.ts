import { expect, test } from './fixtures'

/**
 * First-run onboarding, in a real browser.
 *
 * `/` is the one route it gates (App.tsx, ADR-028), so every other spec in
 * this suite — all of which navigate straight to a specific route on a fresh
 * profile — is untouched by it. This file is the one that actually opens `/`.
 */

test('walks language, post/city and the privacy step, then lands on the law page and stays onboarded', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: 'Choose your language' })).toBeVisible()

  // Step 1: language switches immediately, the same control Settings uses.
  await page.getByRole('radio', { name: 'हिन्दी' }).click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'hi')
  await page.getByRole('button', { name: 'आगे बढ़ें' }).click()

  // Step 2: pick a post — the same ACIO acceptance case the Pay suite covers —
  // and a city, both optional.
  await expect(page.getByRole('heading', { name: 'आपका पद और शहर (वैकल्पिक)' })).toBeVisible()
  const jobPicker = page.getByRole('combobox', { name: 'पद', exact: true })
  await expect(jobPicker).toBeVisible({ timeout: 30_000 })
  await jobPicker.fill('ACIO')
  await page.getByRole('option', { name: /सहायक केंद्रीय आसूचना अधिकारी, ग्रेड-II/ }).click()

  const cityPicker = page.getByRole('combobox', { name: 'तैनाती का स्थान', exact: true })
  await cityPicker.fill('Delhi')
  await page
    .getByRole('option', { name: /^दिल्ली/ })
    .first()
    .click()

  // The RTI s.24 note names the brief's own worked example.
  await expect(page.getByText(/शासकीय गुप्त बात अधिनियम/)).toBeVisible()

  await page.getByRole('button', { name: 'आगे बढ़ें' }).click()

  // Step 3: the three promises, then finish.
  await expect(page.getByRole('heading', { name: 'शुरू करने से पहले' })).toBeVisible()
  await page.getByRole('button', { name: 'समझ गया/गई' }).click()

  await expect(page.getByRole('heading', { level: 1, name: 'विधि परिवर्तक' })).toBeVisible()

  // Reloading the actual start_url must not show onboarding a second time.
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: 'विधि परिवर्तक' })).toBeVisible()

  // The post/city choice reached the Pay calculator: opening a bare /pay
  // restores the onboarding-time scenario from IndexedDB and writes it back
  // into the URL (PayPage.tsx), the same "the URL is the state" contract a
  // shared link relies on.
  await page.goto('/pay')
  await expect(page).toHaveURL(/job=ib-acio-ii-executive/)
  await expect(page).toHaveURL(/city=delhi/)
})

test('"Skip setup" finishes onboarding with no post or city chosen', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: 'Choose your language' })).toBeVisible()

  await page.getByRole('button', { name: 'Skip setup' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Law Converter' })).toBeVisible()

  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: 'Law Converter' })).toBeVisible()
})

test('a deep link is never interrupted by onboarding on a fresh device', async ({ page }) => {
  await page.goto('/law?q=302')
  await expect(page.getByRole('heading', { level: 1, name: 'Law Converter' })).toBeVisible()
  await expect(page.getByText(/"302" is now BNS 103/)).toBeVisible()
})
