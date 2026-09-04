import type { Page } from '@playwright/test'

import { expect, onPhone, test } from './fixtures'

/**
 * The Law Converter, in a real browser.
 *
 * The unit suite covers ranking against the committed datasets
 * (`tests/law-search.test.ts`); what only a browser can prove is that the
 * 3.9 MB of section text actually arrives on this route, that the keyboard
 * path works, and that the clipboard really receives a citation.
 */

/** The section tables load as their own chunks; wait for the first result. */
async function search(page: Page, query: string) {
  await page.goto('/law')
  await expect(page.getByRole('heading', { level: 2, name: 'Law Converter' })).toBeVisible()
  await page.getByLabel(/Search a section/).fill(query)
}

test('a roman-Hindi search reaches the section, and the citation reaches the clipboard', async ({
  page,
  context,
}) => {
  // The acceptance path from the brief: type "hatya", see BNS 103, copy the
  // citation, and find "103" in the clipboard.
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await search(page, 'hatya')

  const results = page.getByRole('list', { name: 'Search results' })
  await expect(results.getByRole('button').filter({ hasText: 'BNS 103' })).toBeVisible()

  await results.getByRole('button').filter({ hasText: 'BNS 103' }).click()
  await expect(page.getByRole('heading', { name: 'Punishment for murder.' })).toBeVisible()

  await page.getByRole('button', { name: 'Copy citation' }).click()
  await expect(page.getByText('Citation copied.')).toBeVisible()

  const clipboard = await page.evaluate(() => navigator.clipboard.readText())
  expect(clipboard).toContain('103')
  expect(clipboard).toContain('Bharatiya Nyaya Sanhita, 2023')
  expect(clipboard).toContain('302')
})

test('the number-swap trap is shown, not merely avoided', async ({ page }) => {
  await search(page, '302')

  // The answer first...
  const results = page.getByRole('list', { name: 'Search results' })
  await expect(results.getByRole('button').first()).toContainText('BNS 103')
  // ...and the trap warning on the card.
  await expect(page.getByText(/"302" is now BNS 103/)).toBeVisible()
  // ...and BNS 302 offered as the other reading, below.
  await expect(results.getByRole('button').filter({ hasText: 'BNS 302' })).toBeVisible()
})

test('the curated-Hindi warning appears on the view that shows curated Hindi', async ({ page }) => {
  // docs/DATA-GAPS.md #18. BNS 103's Hindi is hand-authored, its English is the
  // Act's own words, so the warning belongs in Hindi and would be a false alarm
  // in English.
  await search(page, 'bns 103')
  await expect(page.getByRole('heading', { name: 'Punishment for murder.' })).toBeVisible()
  await expect(page.getByText(/Sahayak translation, not the statutory Hindi/)).toHaveCount(0)

  await page.getByRole('button', { name: 'Switch to Hindi' }).click()
  await expect(page.getByText(/सहायक द्वारा किया गया अनुवाद/)).toBeVisible()
})

test('a repealed provision with no counterpart says so', async ({ page }) => {
  await search(page, 'ipc 377')
  await expect(page.getByText('IPC 377 has no counterpart')).toBeVisible()
})

test('picking a code with an empty search box browses that Act', async ({ page }) => {
  await page.goto('/law')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  // Nothing typed: the chips used to select a filter over nothing at all.
  await expect(page.getByText('Type a section number or a word')).toBeVisible()

  // The radio itself is `sr-only`; the label is what a reader clicks and what
  // carries the 44px target.
  await page.getByText('BSA · IEA', { exact: true }).click()
  await expect(page.getByRole('radio', { name: 'BSA · IEA' })).toBeChecked()
  await expect(page.getByText(/Browsing the Bharatiya Sakshya Adhiniyam, 2023 — 170 sections/)).toBeVisible()

  const results = page.getByRole('list', { name: 'Search results' })
  await expect(results.getByRole('button').first()).toContainText('BSA 1')

  // Every section of the Act is there — no window, no cap, nothing to scroll
  // past into blank space (ADR-016).
  expect(await results.getByRole('button').count()).toBe(170)
  await expect(results.getByRole('button').last()).toContainText('BSA 170')

  // Browsing is a list, not an answer: nothing is opened until a row is
  // clicked, and no "why this matched" badge is shown, because nothing matched.
  await expect(results.getByText('Matches the wording')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Copy citation' })).toHaveCount(0)
  await expect(page.getByText(/Showing the first/)).toHaveCount(0)

  await results.getByRole('button').first().click()
  await expect(page.getByRole('heading', { name: /Short title/ })).toBeVisible()

  // Typing replaces the browse list with real results.
  await page.getByLabel(/Search a section/).fill('63')
  await expect(page.getByText(/Browsing the/)).toHaveCount(0)
})

test('the All chip browses all three codes, even though it is already selected', async ({ page }) => {
  // A radio that is already checked fires no change event, so the most obvious
  // chip on the page was the one that appeared broken.
  await page.goto('/law')
  await expect(page.getByRole('radio', { name: 'All' })).toBeChecked()

  await page.getByText('All', { exact: true }).click()
  await expect(page.getByText(/Browsing all three codes — 1059 sections/)).toBeVisible({ timeout: 20_000 })

  const results = page.getByRole('list', { name: 'Search results' })
  await expect(results.getByRole('button').first()).toContainText('BNS 1')
  expect(await results.getByRole('button').count()).toBe(1059)
  await expect(results.getByRole('button').last()).toContainText('BSA 170')
})

test('browsing survives a reload, because the intent is in the URL', async ({ page }) => {
  await page.goto('/law?browse=1&code=bsa')
  await expect(page.getByText(/Browsing the Bharatiya Sakshya Adhiniyam, 2023/)).toBeVisible()
  await page.reload()
  await expect(page.getByText(/Browsing the Bharatiya Sakshya Adhiniyam, 2023/)).toBeVisible()
})

test('the browse list holds every row of the Act, end to end', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/law?browse=1&code=bns')
  const results = page.getByRole('list', { name: 'Search results' })
  await expect(results.getByRole('button').first()).toContainText('BNS 1')

  // No window, so there is nothing to scroll past into blank space (ADR-016).
  expect(await results.getByRole('button').count()).toBe(358)
  await expect(results.getByRole('button').last()).toContainText('BNS 358')

  // And the pane really scrolls to it: the last row sits at the very bottom of
  // the scrollable content, which is only true if all 358 rows have height.
  const atEnd = await page.evaluate(() => {
    const pane = document.getElementById('law-results')?.parentElement
    if (!pane) return null
    pane.scrollTop = pane.scrollHeight
    return { scrollTop: pane.scrollTop, scrollHeight: pane.scrollHeight, clientHeight: pane.clientHeight }
  })
  expect(atEnd?.scrollHeight).toBe(358 * 76)
  expect(atEnd?.scrollTop).toBe((atEnd?.scrollHeight ?? 0) - (atEnd?.clientHeight ?? 0))
})

test('opening a section keeps the search box on a desktop and reveals it on a phone', async ({ page }) => {
  // This one drives BOTH viewports itself, by setting them, so running it a
  // second time under the mobile project would only repeat it with a different
  // starting size. The desktop project is where it belongs.
  test.skip(onPhone(page), 'sets its own viewports; runs once, on desktop-chromium')

  // Two panes on a wide screen: the card is already beside the list, so
  // nothing should move and the search box must stay where it is.
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/law?browse=1&code=bns')
  const wide = page.getByRole('list', { name: 'Search results' })
  await expect(wide.getByRole('button').first()).toContainText('BNS 1')
  // Wait for the row to be ON SCREEN before clicking it. Without this the
  // click can land while the 358-row list is still laying out, Chromium
  // scrolls the focused row into view, and the assertion below reads a
  // scroll the APP never asked for — which shows up as a flake under load
  // rather than as a real regression in the two-pane layout.
  const row = wide.getByRole('button').nth(3)
  /*
    Scrolled into view first, and that is not a workaround. ADR-046 put the
    section's own `<h1>` and the sub-tab strip above this list, so the fourth
    row starts a little below the fold on a 900px-tall window — and the
    assertion this test actually makes is about what the APP does after the
    click, not about where the row happened to start.
  */
  await row.scrollIntoViewIfNeeded()
  await expect(row).toBeInViewport()
  const before = await page.evaluate(() => window.scrollY)
  await row.click()
  await expect(page.getByRole('heading', { name: 'Punishments.' })).toBeVisible()
  // Not exactly zero: focusing the clicked row nudges the page a pixel or two.
  // What matters is that the search box is still on screen, not that nothing
  // moved at all.
  expect(Math.abs((await page.evaluate(() => window.scrollY)) - before)).toBeLessThan(40)
  await expect(page.getByLabel(/Search a section/)).toBeInViewport()

  // Stacked on a phone the card is far below the fold, which is the case where
  // a reader taps a row and cannot tell that anything happened.
  await page.setViewportSize({ width: 390, height: 780 })
  await page.goto('/law?browse=1&code=bns')
  const narrow = page.getByRole('list', { name: 'Search results' })
  await expect(narrow.getByRole('button').first()).toContainText('BNS 1')
  await narrow.getByRole('button').nth(3).click()
  await expect.poll(() => page.evaluate(() => window.scrollY), { timeout: 5000 }).toBeGreaterThan(200)
  await expect(page.getByRole('heading', { name: 'Punishments.' })).toBeInViewport()
})

test('an open section can be closed again', async ({ page }) => {
  // Beside the list it is a pane, and a pane a reader cannot shut has taken
  // over the screen.
  await search(page, '302')
  await expect(page.getByRole('heading', { name: 'Punishment for murder.' })).toBeVisible()

  await page.getByRole('button', { name: 'Close this section' }).click()
  await expect(page.getByRole('button', { name: 'Copy citation' })).toHaveCount(0)
  // The results are still there to pick from.
  await expect(page.getByRole('list', { name: 'Search results' })).toBeVisible()

  // Re-opening one works, and so does a new query — closing is about THIS
  // search, not a mode the reader is now stuck in.
  await page.getByRole('list', { name: 'Search results' }).getByRole('button').first().click()
  await expect(page.getByRole('heading', { name: 'Punishment for murder.' })).toBeVisible()
  await page.getByRole('button', { name: 'Close this section' }).click()
  await page.getByLabel(/Search a section/).fill('420')
  await expect(page.getByRole('heading', { name: 'Cheating.' })).toBeVisible()
})

test('the direction toggle is inert while browsing, and says so', async ({ page }) => {
  // Direction decides what a bare NUMBER means, so with nothing typed it has
  // nothing to decide. Leaving it live changed the URL and reordered nothing,
  // which reads as a broken control.
  await page.goto('/law?browse=1&code=bns')
  await expect(page.getByRole('list', { name: 'Search results' })).toBeVisible()
  await expect(page.getByRole('radio', { name: 'New → Old' })).toBeDisabled()
  await expect(page.getByText('Applies to a search. You are reading the Act in order.')).toBeVisible()

  // With a query it is live again, and it really does reorder.
  await page.getByLabel(/Search a section/).fill('302')
  const rows = page.getByRole('list', { name: 'Search results' }).getByRole('button')
  await expect(rows.first()).toContainText('BNS 103')
  await page.getByText('New → Old', { exact: true }).click()
  await expect(rows.first()).toContainText('BNS 302')
})

/**
 * The two failures a screenshot caught and a unit test could not.
 *
 * Both are about layout under real constraints, which is why they live here:
 * jsdom has no layout, so neither could have been seen in the unit suite.
 */
for (const [name, width, height] of [
  ['phone', 390, 780],
  ['tablet', 768, 1024],
  ['tablet landscape', 1024, 768],
  ['desktop', 1440, 900],
] as const) {
  test(`on ${name}, opening a deep row keeps the list populated`, async ({ page }) => {
    // Opening a section reflows the list from full width into a column, and
    // the browser clamps its scroll position when it does. The windowed version
    // computed its rows from the remembered offset and rendered every one of
    // them off screen, so the list went BLANK on a click.
    await page.setViewportSize({ width, height })
    await page.goto('/law?browse=1&code=bns')
    const list = page.getByRole('list', { name: 'Search results' })
    await expect(list.getByRole('button').first()).toContainText('BNS 1')

    await page.evaluate(() => {
      const pane = document.getElementById('law-results')?.parentElement
      if (pane) pane.scrollTop = 150 * 76
    })

    await list.getByRole('button').nth(2).click()
    await expect(page.getByRole('button', { name: 'Close this section' })).toBeVisible()
    // Every row still there. The windowed version rendered them at coordinates
    // the reader was no longer looking at, and the list appeared to be empty.
    expect(await list.getByRole('button').count(), 'the list emptied on click').toBe(358)
    await expect(list.getByRole('button').last()).toContainText('BNS 358')
  })

  test(`on ${name}, the page never scrolls sideways`, async ({ page }) => {
    // The design system forbids it outright. The card carries a 36rem
    // classification table, and a grid item's default `min-width: auto` is its
    // min-content width — so without `min-w-0` the card was 576px wide inside a
    // 390px phone.
    await page.setViewportSize({ width, height })
    await page.goto('/law?q=302')
    await expect(page.getByRole('heading', { name: 'Punishment for murder.' })).toBeVisible()

    const { scrollWidth, innerWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }))
    expect(scrollWidth, `${name}: the page overflows by ${scrollWidth - innerWidth}px`).toBeLessThanOrEqual(
      innerWidth,
    )
  })
}

test('the offence date decides which code applies', async ({ page }) => {
  await page.goto('/law')
  const date = page.getByLabel('Date of offence')

  await date.fill('2024-06-30')
  await expect(page.getByText(/Old law applies/)).toBeVisible()
  await expect(page.getByText(/BNSS section 531/)).toBeVisible()

  await date.fill('2024-07-01')
  await expect(page.getByText(/New law applies/)).toBeVisible()
})

test('a deep link restores the exact view', async ({ page }) => {
  await page.goto('/law?code=bns&q=302&dir=old-new&date=2024-08-01')

  await expect(page.getByLabel(/Search a section/)).toHaveValue('302')
  await expect(page.getByLabel('Date of offence')).toHaveValue('2024-08-01')
  await expect(page.getByRole('radio', { name: 'BNS · IPC' })).toBeChecked()
  await expect(page.getByText(/New law applies/)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Punishment for murder.' })).toBeVisible()
})

test('the keyboard alone gets from anywhere on the page to an open section', async ({ page }) => {
  await page.goto('/law')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

  // "/" focuses the search from anywhere.
  await page.getByRole('heading', { level: 1 }).click()
  await page.keyboard.press('/')
  await expect(page.getByLabel(/Search a section/)).toBeFocused()

  await page.keyboard.type('420')
  // Wait for the results for the WHOLE query: the search runs against a
  // deferred value, so the list is briefly showing the hits for "4" and "42".
  const list = page.getByRole('list', { name: 'Search results' })
  await expect(list.getByRole('button').first()).toContainText('BNS 318')

  // ArrowDown moves into the list; Enter opens what is focused.
  await page.keyboard.press('ArrowDown')
  await expect(list.getByRole('button').first()).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'Cheating.' })).toBeVisible()

  // ArrowUp from the first row goes back to the field rather than nowhere.
  await page.keyboard.press('ArrowUp')
  await expect(page.getByLabel(/Search a section/)).toBeFocused()
})

test('saving a section keeps it, on this device, across a reload', async ({ page }) => {
  await search(page, 'bns 103')
  await page.getByRole('button', { name: 'Save this section' }).click()
  await expect(page.getByText('Saved on this device.')).toBeVisible()

  await page.goto('/law/saved')
  await expect(page.getByRole('heading', { name: 'Saved sections' })).toBeVisible()
  const saved = page.getByRole('list', { name: 'Saved' })
  await expect(saved.getByRole('link', { name: /BNS 103/ })).toBeVisible()

  await page.reload()
  await expect(saved.getByRole('link', { name: /BNS 103/ })).toBeVisible()

  // Removing it takes it off the list without a refetch (useLiveQuery).
  await page.getByRole('button', { name: 'Remove BNS section 103 from saved' }).click()
  await expect(page.getByText('Nothing saved yet')).toBeVisible()
})

test("what's new cites a real section for every bullet", async ({ page }) => {
  await page.goto('/law/whats-new')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

  // Each bullet links to the section it names; following one has to land on it.
  await expect(page.getByText('BNS 111')).toBeVisible()
  await page.getByRole('link', { name: 'Open this section' }).first().click()
  await expect(page).toHaveURL(/\/law\?/)
  await expect(page.getByRole('heading', { name: 'Organised crime.', exact: true })).toBeVisible()
})

test('the Law Converter stays the active navigation item on its sub-routes', async ({ page }) => {
  // ONE nav config array drives both chromes (src/lib/nav.ts), and each labels
  // its own landmark: the sidebar is "Main navigation" from 1024px, the bottom
  // tab bar is "Main tabs" below it. Asserting the sidebar's name on a phone
  // would be asserting against a landmark that is not rendered at all.
  const navName = onPhone(page) ? 'Main tabs' : 'Main navigation'

  for (const route of ['/law', '/law/whats-new', '/law/saved']) {
    await page.goto(route)
    // The chrome marks the current page for screen readers as well as visually.
    await expect(
      page.getByRole('navigation', { name: navName }).getByRole('link', { name: /Law Converter/ }),
    ).toHaveAttribute('aria-current', 'page')
  }
})
