import { expect, test } from './fixtures'

/**
 * The Hindi administrative glossary, in a real browser, as its own destination
 * (`/tools/glossary`). The wider tab Session 10 added to the Drafting Studio's
 * glossary sheet had two tests here too; see the note further down for where
 * they went.
 */

test.describe('/tools/glossary', () => {
  test('searches, filters by category, and offline-safe copy/favourite/recents all work together', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.goto('/tools/glossary')
    await expect(page.getByRole('heading', { level: 2, name: 'Hindi administrative glossary' })).toBeVisible()

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
    await page.goto('/tools/glossary')
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
    await page.goto('/tools/glossary?term=cabinet-secretary')
    await expect(page.getByText('मंत्रिमंडल सचिव')).toBeVisible()

    // Copy link, on that same row, produces the identical URL.
    await page.getByRole('button', { name: 'Copy link' }).first().click()
    await expect(page.getByText('Link copied to the clipboard.')).toBeVisible()
    const copied = await page.evaluate(() => navigator.clipboard.readText())
    expect(copied).toContain('/tools/glossary?term=cabinet-secretary')
  })
})

/*
  The Drafting Studio's glossary sheet and its body-editor suggestion strip had
  two browser tests here, and both are gone with ADR-046: the only screen that
  mounted either was the Session 8 form-and-preview editor at `/draft/<type>`,
  which that ADR deleted. `GlossarySheet`, `PhraseSheet` and `AiDraftPanel` are
  still in the tree with their unit tests green and NO screen mounting them —
  `docs/DATA-GAPS.md` #93 is where that is recorded, because three shipped
  surfaces losing their only route is a gap and not a tidy-up.
*/
