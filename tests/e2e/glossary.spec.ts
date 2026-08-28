import { expect, test, type Page } from '@playwright/test'

/**
 * The Hindi administrative glossary, in a real browser — both as its own
 * destination (`/utils/glossary`) and as the wider tab Session 10 added to
 * the Drafting Studio's existing glossary sheet.
 */

const field = (page: Page, id: string) => page.locator(`#draft-field-${id}`)

test.describe('/utils/glossary', () => {
  test('searches, filters by category, and offline-safe copy/favourite/recents all work together', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.goto('/utils/glossary')
    await expect(page.getByRole('heading', { level: 1, name: 'Hindi administrative glossary' })).toBeVisible()

    // Instant search, English -> Hindi.
    await page.getByLabel('Search the glossary').fill('Cabinet Secretary')
    await expect(page.getByText('मंत्रिमंडल सचिव')).toBeVisible()

    // A category filter that does not match the query empties the list.
    // The radio input itself is visually hidden behind its label (a chip),
    // so the click lands on the visible text — the same pattern
    // tests/e2e/law.spec.ts uses for the Act chips. Scoped to the radiogroup:
    // the fieldset's own (also sr-only) legend repeats "All categories".
    const categories = page.getByRole('radiogroup', { name: 'All categories' })
    await categories.getByText('Information technology', { exact: true }).click()
    await expect(page.getByText('No term matches that.')).toBeVisible()
    await categories.getByText('All categories', { exact: true }).click()
    await expect(page.getByText('मंत्रिमंडल सचिव')).toBeVisible()

    // Copy writes to the clipboard and to the recents list.
    await page.getByRole('button', { name: 'Copy Hindi' }).first().click()
    await expect(page.getByText('Copied to the clipboard.')).toBeVisible()

    // Favouriting persists in IndexedDB, so it survives a reload.
    await page.getByRole('button', { name: 'Save this term' }).first().click()
    await expect(page.getByRole('button', { name: 'Remove from saved' }).first()).toBeVisible()

    await page.reload()
    await page.getByLabel('Search the glossary').fill('Cabinet Secretary')
    await expect(page.getByRole('button', { name: 'Remove from saved' }).first()).toBeVisible()

    await page.getByRole('tab', { name: /Favourites/ }).click()
    await expect(page.getByText('मंत्रिमंडल सचिव')).toBeVisible()

    await page.getByRole('tab', { name: /Recently used/ }).click()
    await expect(page.getByText('मंत्रिमंडल सचिव')).toBeVisible()
  })

  test('an unfiltered visit stays inside the render cap, and says so', async ({ page }) => {
    await page.goto('/utils/glossary')
    await expect(page.getByText(/\d+ terms? — showing the first 100/)).toBeVisible()
    // The render cap is on the LIST, not the search: narrowing still reaches
    // terms outside the first 100.
    await page.getByLabel('Search the glossary').fill('Cabinet Secretary')
    await expect(page.getByText('मंत्रिमंडल सचिव')).toBeVisible()
  })

  test('a share link restores the term, and Copy link copies that same link', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])

    // The link itself, round-tripped: a fresh visit to a term's own URL
    // surfaces it without the reader typing anything.
    await page.goto('/utils/glossary?term=cabinet-secretary')
    await expect(page.getByText('मंत्रिमंडल सचिव')).toBeVisible()

    // Copy link, on that same row, produces the identical URL.
    await page.getByRole('button', { name: 'Copy link' }).first().click()
    await expect(page.getByText('Link copied to the clipboard.')).toBeVisible()
    const copied = await page.evaluate(() => navigator.clipboard.readText())
    expect(copied).toContain('/utils/glossary?term=cabinet-secretary')
  })
})

test.describe('the Drafting Studio’s glossary sheet', () => {
  test('the Full glossary tab searches the wider dataset and inserts through the same toolbar hook', async ({
    page,
  }) => {
    await page.goto('/draft/office-memorandum')
    await expect(page.getByRole('button', { name: 'Glossary' })).toBeVisible({ timeout: 30_000 })
    await page.getByRole('button', { name: 'Glossary' }).click()

    const sheet = page.getByRole('dialog', { name: 'Hindi administrative glossary' })
    await expect(sheet).toBeVisible()

    // Defaults to the 78-term structural glossary, unchanged.
    await expect(sheet.getByPlaceholder('Search the glossary')).toBeVisible()

    await sheet.getByRole('tab', { name: 'Full glossary' }).click()
    await sheet.getByLabel('Search the glossary').fill('Cabinet Secretary')
    await expect(sheet.getByText('मंत्रिमंडल सचिव')).toBeVisible()

    // A two-word query fuzzy-matches more than one term across 1,891 entries;
    // ranking puts the exact match first, which is what this asserts by
    // taking it rather than requiring a single result.
    await sheet.getByRole('button', { name: 'Insert the Hindi' }).first().click()
    await expect(sheet).toHaveCount(0)
    await expect(field(page, 'paras')).toHaveValue(/मंत्रिमंडल सचिव/)
  })

  test('the body editor offers a Hindi replacement for an English term typed in Hindi mode', async ({
    page,
  }) => {
    await page.goto('/draft/office-memorandum')
    await expect(field(page, 'paras')).toBeVisible({ timeout: 30_000 })

    // Write in Hindi: the suggestion strip is gated on the editing language,
    // not the app's own UI language, so this switches only the document.
    // Scoped to "Typing in" — the live preview's own language tabs carry a
    // second, unrelated हिंदी radio.
    await page.getByRole('radiogroup', { name: 'Typing in' }).getByRole('radio', { name: 'हिंदी' }).click()

    await field(page, 'paras').fill('Send this to the Cabinet Secretary for approval.')

    const suggestion = page.getByRole('button', { name: /Cabinet Secretary.*मंत्रिमंडल सचिव/ })
    await expect(suggestion).toBeVisible()
    await suggestion.click()

    await expect(field(page, 'paras')).toHaveValue(/Send this to the मंत्रिमंडल सचिव for approval\./)
  })
})
