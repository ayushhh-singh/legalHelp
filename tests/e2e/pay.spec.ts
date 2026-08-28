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

test('the post list is not clipped by the card it opens inside', async ({ page }) => {
  // The card carried `overflow-hidden` for the sake of its file tab, which made
  // the card's own bounds the popup's: a list of sixty posts rendered two.
  await openPay(page)
  await jobPicker(page).click()

  const listbox = page.getByRole('listbox')
  await expect(listbox).toBeVisible()
  const options = listbox.getByRole('option')
  expect(await options.count()).toBeGreaterThan(10)

  const card = page
    .locator('section')
    .filter({ has: jobPicker(page) })
    .first()
  const listBox = (await listbox.boundingBox())!
  const cardBox = (await card.boundingBox())!

  // Layout is not the test. `getBoundingClientRect` reports the same box
  // whether or not an ancestor clips it, and Playwright's `toBeVisible` does
  // not consider ancestor overflow either — both passed against the bug. What
  // has to be asserted is what is PAINTED, so this hit-tests a point below the
  // card's own bottom edge and requires the listbox to be what is there.
  const probeY = cardBox.y + cardBox.height + 8
  expect(probeY, 'the list is not tall enough to reach past the card').toBeLessThan(
    listBox.y + Math.min(listBox.height, 280),
  )
  const paintsBelowTheCard = await page.evaluate(
    // An object, not a tuple: `noUncheckedIndexedAccess` types a destructured
    // array element as `number | undefined`.
    ({ x, y }: { x: number; y: number }) =>
      Boolean(document.elementFromPoint(x, y)?.closest('[role="listbox"]')),
    { x: listBox.x + listBox.width / 2, y: probeY },
  )
  expect(paintsBelowTheCard).toBe(true)
})

test('a switch keeps its knob inside its track, on and off', async ({ page }) => {
  // The knob had no `left` anchor, so it fell back to its static position —
  // which inside a button is where centred text would start. Measured, the ON
  // knob's box began exactly at the track's right edge, outside it.
  await openPay(page, '?job=capf-constable-gd&da=60')

  for (const [name, expected] of [
    [/Children Education Allowance/, 'on'],
    [/Hostel Subsidy/, 'off'],
  ] as const) {
    const control = page.getByRole('switch', { name })
    await control.scrollIntoViewIfNeeded()
    await expect(control).toHaveAttribute('aria-checked', expected === 'on' ? 'true' : 'false')

    const inside = await control.evaluate((el) => {
      const knob = el.firstElementChild!.getBoundingClientRect()
      const track = el.getBoundingClientRect()
      return {
        left: +(knob.left - track.left).toFixed(1),
        right: +(track.right - knob.right).toFixed(1),
        top: +(knob.top - track.top).toFixed(1),
      }
    })
    expect(inside.left, `${expected} knob is left of its track`).toBeGreaterThan(0)
    expect(inside.right, `${expected} knob is right of its track`).toBeGreaterThan(0)
    expect(inside.top).toBeGreaterThan(0)
    // And it actually moves: the off knob sits at the left, the on knob right.
    if (expected === 'on') expect(inside.left).toBeGreaterThan(inside.right)
    else expect(inside.right).toBeGreaterThan(inside.left)
  }

  // The state is written out, not carried by the knob's position alone.
  await expect(page.getByText('OFF').first()).toBeVisible()
  await expect(page.getByText('ON').first()).toBeVisible()
})
