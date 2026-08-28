import { expect, test } from '@playwright/test'

/**
 * The Pay & Allowances Calculator, in a real browser.
 *
 * Three of these are the brief's own acceptance checks — pick "ACIO" and see
 * the Special Security Allowance with its source, switch language and see the
 * labels move while the figures do not, and answer with no network at all. The
 * rest are the claims that would be expensive to be wrong about: that the URL
 * really is the state, and that an allowance whose rate has not been chosen
 * shows a choice rather than a confident nil.
 */

/**
 * The pickers are the last thing to render, so they are the "loaded" signal.
 *
 * The generous timeout is not a flake mask: the route imports 1.2 MB of
 * datasets before it can draw a figure, and this suite runs fully parallel
 * against one preview server, so several workers pull them at once on a cold
 * cache. Five seconds is the wrong budget for a first visit here.
 */
const jobPicker = (page: import('@playwright/test').Page) =>
  page.getByRole('combobox', { name: 'Post', exact: true })

const cityPicker = (page: import('@playwright/test').Page) =>
  page.getByRole('combobox', { name: 'Place of posting', exact: true })

async function openPay(page: import('@playwright/test').Page, query = '') {
  await page.goto(`/pay${query}`)
  await expect(page.getByRole('heading', { level: 1, name: 'Pay & Allowances' })).toBeVisible()
  // `exact` matters: Playwright matches a string name as a case-insensitive
  // SUBSTRING, and "Place of posting" contains "post".
  await expect(jobPicker(page)).toBeVisible({ timeout: 30_000 })
}

test('picking ACIO shows the Special Security Allowance and the order behind it', async ({ page }) => {
  await openPay(page)

  await jobPicker(page).fill('ACIO')
  await page.getByRole('option', { name: /Assistant Central Intelligence Officer, Grade-II/ }).click()

  // Level 7, cell 1 — ₹44,900 — and the allowance the post itself carries.
  await expect(page.getByRole('row', { name: /Special Security Allowance/ })).toBeVisible()
  await expect(
    page.getByRole('row', { name: /Special Security Allowance/ }).getByText('₹8,980'),
  ).toBeVisible()

  // Its source, as a link to the order, inside the "why" disclosure on the row.
  const allowanceRow = page.getByRole('listitem').filter({ hasText: 'Special Security Allowance' })
  const source = allowanceRow.getByRole('link').first()
  await expect(source).toHaveAttribute('href', /doe\.gov\.in/)
  await expect(source).toHaveAttribute('target', '_blank')
})

test('switching language moves the labels and leaves the figures alone', async ({ page }) => {
  await openPay(page, '?job=ib-acio-ii-executive&city=delhi&da=60')

  await expect(page.getByRole('rowheader', { name: /Basic pay/ })).toBeVisible()
  const netBefore = await page.getByText('₹92,156').first().textContent()

  await page.getByRole('button', { name: 'Switch to Hindi' }).click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'hi')

  await expect(page.getByRole('heading', { level: 1, name: 'वेतन एवं भत्ते' })).toBeVisible()
  await expect(page.getByText('मूल वेतन').first()).toBeVisible()
  await expect(page.getByText('सकल').first()).toBeVisible()

  // The numerals are Latin in both languages — a pay slip is read as a column
  // of figures, and Devanagari digits would break the tabular alignment.
  await expect(page.getByText('₹92,156').first()).toHaveText(netBefore ?? '')
  await expect(page.getByText('₹44,900').first()).toBeVisible()
})

test('a deep link restores the exact pay slip', async ({ page }) => {
  await openPay(page, '?job=ib-acio-ii-executive&level=7&cell=1&city=delhi&da=60')

  await expect(page.getByText('Level 7, cell 1')).toBeVisible()
  await expect(page.getByText('HRA class X')).toBeVisible()
  await expect(page.getByText('DA 60%')).toBeVisible()
  await expect(page.getByText('₹1,00,050').first()).toBeVisible()
})

test('the URL follows the form, so the slip can be shared', async ({ page }) => {
  await openPay(page)
  await jobPicker(page).fill('Tax Assistant')
  await page
    .getByRole('option', { name: /Tax Assistant/ })
    .first()
    .click()

  await expect(page).toHaveURL(/job=tax-assistant/)

  await cityPicker(page).fill('Kolkata')
  await page
    .getByRole('option', { name: /Kolkata/ })
    .first()
    .click()
  await expect(page).toHaveURL(/city=kolkata/)

  // And it survives a reload, which is the point of putting it there.
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Tax Assistant' })).toBeVisible()
  await expect(page.getByText('HRA class X')).toBeVisible()
})

test('an allowance with several admissible rates asks rather than guessing', async ({ page }) => {
  await openPay(page, '?job=capf-constable-gd&da=60')

  await page.getByRole('switch', { name: /Risk and Hardship Allowance/ }).click()
  const select = page.locator('#risk-and-hardship-allowance-rate')
  await expect(select).toBeVisible()

  await select.selectOption('r1h3')
  // ₹4,100 for Level 8 and below, raised once because DA crossed 50 per cent.
  await expect(page.getByText('₹5,125').first()).toBeVisible()
})

test('the 8th CPC panel never shows a projection without saying it is one', async ({ page }) => {
  // Through the tab bar rather than by deep link: the simulations tab has no
  // job picker, so `openPay` would be waiting for a control that is not there.
  await openPay(page, '?job=ib-acio-ii-executive&city=delhi&da=60')
  await page.getByRole('radio', { name: 'Simulations' }).click()
  await expect(page).toHaveURL(/tab=simulate/)

  await page.getByRole('radio', { name: '8th CPC' }).click()
  await expect(page.getByText(/Projection — not notified/)).toBeVisible()
  await expect(page.getByText(/no pay matrix/)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'What is not known' })).toBeVisible()
})

test('answers a pay calculation with no network at all', async ({ page, context }) => {
  // Install the service worker from a route that does NOT load the pay
  // datasets, so nothing is warmed by having visited /pay first.
  await page.goto('/settings')
  await expect(page.getByRole('main')).toBeVisible()
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null)

  await context.setOffline(true)
  await page.goto('/pay?job=ib-acio-ii-executive&city=delhi&da=60')

  // 1.2 MB of pay datasets, served entirely out of the precache.
  await expect(page.getByRole('heading', { level: 1, name: 'Pay & Allowances' })).toBeVisible()
  await expect(page.getByText('₹1,00,050').first()).toBeVisible()
  await expect(page.getByText('₹92,156').first()).toBeVisible()
})
