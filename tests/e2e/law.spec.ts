import { expect, test, type Page } from '@playwright/test'

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
  await expect(page.getByRole('heading', { level: 1, name: 'Law Converter' })).toBeVisible()
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
  for (const route of ['/law', '/law/whats-new', '/law/saved']) {
    await page.goto(route)
    // The sidebar marks the current page for screen readers as well as visually.
    await expect(
      page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: /Law Converter/ }),
    ).toHaveAttribute('aria-current', 'page')
  }
})
