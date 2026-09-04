import { expect, test } from './fixtures'

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
  await expect(page.getByRole('heading', { level: 2, name: 'Pay & Allowances' })).toBeVisible()
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

  await expect(page.getByRole('heading', { level: 2, name: 'वेतन एवं भत्ते' })).toBeVisible()
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
  await page.goto('/tools/salary?job=ib-acio-ii-executive&city=delhi&da=60')

  // 1.2 MB of pay datasets, served entirely out of the precache.
  await expect(page.getByRole('heading', { level: 2, name: 'Pay & Allowances' })).toBeVisible()
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

/**
 * The design system forbids sideways scrolling outright, and this page is the
 * one most likely to do it: four tabs, three tables wide enough to need their
 * own scroll containers, and a two-column grid whose items default to
 * `min-width: auto` — which is min-CONTENT width, not zero.
 */
const VIEWPORTS = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'small phone', width: 360, height: 780 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 900 },
] as const

for (const { name, width, height } of VIEWPORTS) {
  test(`on ${name}, no tab of the pay calculator scrolls sideways`, async ({ page }) => {
    await page.setViewportSize({ width, height })
    await openPay(page, '?job=ib-acio-ii-executive&city=delhi&da=60&pctc=1800000')

    for (const tab of ['Calculator', 'Simulations', 'Compare posts', 'Private vs government']) {
      await page.getByRole('radio', { name: tab, exact: true }).click()
      // Let the tab's own content settle before measuring the document.
      await expect(page.getByRole('radio', { name: tab, exact: true })).toHaveAttribute(
        'aria-checked',
        'true',
      )
      const { scrollWidth, innerWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }))
      expect(
        scrollWidth,
        `${name} / ${tab}: the page overflows by ${scrollWidth - innerWidth}px`,
      ).toBeLessThanOrEqual(innerWidth)
    }
  })
}

test('a wide table scrolls inside its own region, reachable from the keyboard', async ({ page }) => {
  // axe reports `scrollable-region-focusable` otherwise, and the columns past
  // the edge are then mouse-only.
  await page.setViewportSize({ width: 390, height: 844 })
  // Not `openPay`: the comparison has two post pickers, so it waits on one of
  // the side-specific ones instead.
  await page.goto('/tools/salary?job=ib-acio-ii-executive&city=delhi&da=60&tab=compare')
  await expect(page.getByRole('heading', { level: 2, name: 'Pay & Allowances' })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'First post', exact: true })).toBeVisible({
    timeout: 30_000,
  })

  const region = page.getByRole('region', { name: 'Difference' })
  await expect(region).toBeVisible()
  await expect(region).toHaveAttribute('tabindex', '0')
  const scrolls = await region.evaluate((el) => el.scrollWidth > el.clientWidth)
  expect(scrolls, 'the comparison table is not actually wider than its box').toBe(true)
})

test('no two controls on any tab share a DOM id', async ({ page }) => {
  // The comparison renders two of each picker at once. With one hard-coded id
  // apiece, both "Post" labels pointed at the first input — clicking the second
  // post's label focused the first post's box. axe reported nothing.
  await openPay(page, '?job=ib-acio-ii-executive&city=delhi&da=60&pctc=1800000')

  for (const tab of ['Calculator', 'Simulations', 'Compare posts', 'Private vs government']) {
    await page.getByRole('radio', { name: tab, exact: true }).click()
    await expect(page.getByRole('radio', { name: tab, exact: true })).toHaveAttribute('aria-checked', 'true')
    const duplicates = await page.evaluate(() => {
      const counts = new Map<string, number>()
      for (const element of document.querySelectorAll('[id]')) {
        counts.set(element.id, (counts.get(element.id) ?? 0) + 1)
      }
      return [...counts].filter(([, n]) => n > 1).map(([id, n]) => `${id} x${n}`)
    })
    expect(duplicates, `duplicate ids on the ${tab} tab`).toEqual([])

    // And every label resolves to a control that exists.
    const orphans = await page.evaluate(() =>
      [...document.querySelectorAll('label[for]')]
        .map((label) => label.getAttribute('for')!)
        .filter((id) => document.getElementById(id) === null),
    )
    expect(orphans, `labels pointing at nothing on the ${tab} tab`).toEqual([])
  }
})
