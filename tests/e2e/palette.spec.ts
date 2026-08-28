import { expect, test } from '@playwright/test'

/**
 * The global command palette (Ctrl/⌘-K) and the shortcut chords that reach
 * it, in a real browser.
 *
 * Every search here reuses the module's OWN engine (`src/components/palette/
 * sections.ts`) rather than a second one, so these queries are the same ones
 * each module's own suite already proves work — this spec is checking that
 * the palette reaches them, not re-testing the matching itself.
 */

test.describe('command palette', () => {
  test('opens from the search button, finds a law section, and navigating closes it', async ({ page }) => {
    await page.goto('/law')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

    await page.getByRole('button', { name: 'Open command palette' }).first().click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()

    const input = page.getByRole('combobox')
    await expect(input).toBeFocused()

    // Roman-Hindi "hatya" -> हत्या -> murder, the law module's own bilingual
    // offence lexicon (scripts/ingest/lexicon.json).
    await input.fill('hatya')
    const hit = page.getByRole('option', { name: /murder|हत्या/i }).first()
    await expect(hit).toBeVisible({ timeout: 20_000 })
    await hit.click()

    await expect(dialog).toBeHidden()
    await expect(page).toHaveURL(/\/law\?/)
    await expect(page.getByRole('heading', { name: /murder|हत्या/i })).toBeVisible()
  })

  test('opens with Ctrl/Cmd+K from any route', async ({ page }) => {
    await page.goto('/pay')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

    await page.keyboard.press('Control+k')
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByRole('combobox')).toBeFocused()

    // The same chord closes it again.
    await page.keyboard.press('Control+k')
    await expect(page.getByRole('dialog')).toBeHidden()
  })

  test('finds a job post by an acronym its own title never spells out', async ({ page }) => {
    await page.goto('/law')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await page.keyboard.press('Control+k')
    await page.getByRole('combobox').fill('ACIO')

    await expect(
      page.getByRole('option', { name: /Assistant Central Intelligence Officer/i }).first(),
    ).toBeVisible({ timeout: 20_000 })
  })

  test('finds glossary terms by roman Hindi', async ({ page }) => {
    await page.goto('/law')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await page.keyboard.press('Control+k')
    await page.getByRole('combobox').fill('avar sachiv')

    // "sachiv" -> सचिव -> "Secretary" is the roman-Hindi reach being proven
    // here — the same transliteration `src/lib/transliterate.ts` gives every
    // module. "avar" alone matches no glossary entry (there is no "Under
    // Secretary" record in `data/glossary.json`), so the query's real answer
    // is the "…Secretary" family the fold still reaches.
    await expect(page.getByRole('option', { name: /सचिव/ }).first()).toBeVisible({ timeout: 20_000 })
  })

  test('finds a document type by its acronym', async ({ page }) => {
    await page.goto('/law')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await page.keyboard.press('Control+k')
    await page.getByRole('combobox').fill('OM')

    await expect(page.getByRole('option', { name: /Office Memorandum/i })).toBeVisible({ timeout: 20_000 })
  })

  test('Escape closes the palette', async ({ page }) => {
    await page.goto('/law')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await page.keyboard.press('Control+k')
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toBeHidden()
  })
})

test.describe('global keyboard shortcuts', () => {
  test('g then a letter jumps to each module', async ({ page }) => {
    await page.goto('/law')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

    const cases: Array<[string, RegExp]> = [
      ['p', /\/pay/],
      ['d', /\/draft/],
      ['e', /\/learn/],
      ['u', /\/utils/],
      ['l', /\/law/],
    ]

    for (const [letter, urlPattern] of cases) {
      await page.keyboard.press('g')
      await page.keyboard.press(letter)
      await expect(page).toHaveURL(urlPattern)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    }
  })

  test('does not fire while typing in a field', async ({ page }) => {
    await page.goto('/law')
    await page.getByLabel(/Search a section/).fill('g')
    await page.getByLabel(/Search a section/).press('p')
    // Still on /law — "gp" typed into the search box must not be read as the
    // "go to Pay" chord.
    await expect(page).toHaveURL(/\/law/)
    await expect(page.getByLabel(/Search a section/)).toHaveValue('gp')
  })

  test('? opens the shortcuts help sheet', async ({ page }) => {
    await page.goto('/law')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await page.keyboard.press('?')

    const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('Go to Law Converter')).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
  })

  test('/ focuses the current page’s own search box', async ({ page }) => {
    await page.goto('/utils/glossary')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    // Focus something else first, so the shortcut has to move it.
    await page.getByRole('button', { name: 'Open command palette' }).first().focus()

    await page.keyboard.press('/')
    await expect(page.getByLabel('Search the glossary')).toBeFocused()
  })
})
