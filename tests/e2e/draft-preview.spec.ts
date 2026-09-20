import { audit, expect, formatViolations, setLanguage, test } from './fixtures'

/**
 * The template gallery's read-only worked-example preview, in a real browser.
 *
 * `/draft/new/:type/preview` is deliberately a separate screen from
 * `/draft/new/:type`, which creates a real document and never renders a
 * sample. The journey below is the whole point of that separation: an
 * officer can read a filled example before choosing, and "Use this template"
 * still starts from nothing — the regression this session exists to prevent
 * forever is a document seeded with the specimen's own sentences.
 */

test.describe('the template preview', () => {
  test('gallery → preview → read it → Use this template → a blank real editor', async ({ page }) => {
    await page.goto('/draft/new')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

    // ---- both actions are on the card, and Preview does not create anything ---
    // The card's own primary click is still there, unchanged — Preview is a
    // second, separate control.
    await expect(page.getByRole('link', { name: 'Open Office Memorandum (O.M.)' })).toBeVisible()
    await page.getByRole('link', { name: 'Preview Office Memorandum (O.M.)' }).click()

    await expect(page).toHaveURL(/\/draft\/new\/office-memorandum\/preview$/)
    await expect(
      page.getByRole('heading', { level: 1, name: 'Office Memorandum (O.M.) — worked example' }),
    ).toBeVisible()

    // The focus bar's back control names its declared parent — the gallery
    // itself (`/draft/new`), never `/draft/new/office-memorandum` (the route
    // that creates a document) — because this screen was never a step on the
    // way to one.
    await page.getByRole('button', { name: /New/ }).first().click()
    await expect(page).toHaveURL(/\/draft\/new$/)
    await page.getByRole('link', { name: 'Preview Office Memorandum (O.M.)' }).click()
    await expect(page).toHaveURL(/\/draft\/new\/office-memorandum\/preview$/)

    // ---- the specimen itself is genuinely on screen ------------------------
    await expect(page.getByText('National Institute of Open Schooling')).toBeVisible()
    await expect(page.getByText('Doubts have been expressed')).toBeVisible()
    await expect(page.getByText(/example content only/i)).toBeVisible()

    // ---- the language toggle actually changes what is shown ---------------
    await page.getByRole('combobox', { name: 'Preview language' }).selectOption('hi')
    await expect(page.getByText('राष्ट्रीय मुक्त विद्यालयी शिक्षा संस्थान')).toBeVisible()
    await page.getByRole('combobox', { name: 'Preview language' }).selectOption('both')
    await expect(page.getByText('National Institute of Open Schooling')).toBeVisible()
    await expect(page.getByText('राष्ट्रीय मुक्त विद्यालयी शिक्षा संस्थान')).toBeVisible()

    expect(formatViolations(await audit(page)), 'the template preview').toEqual([])

    // ---- "Use this template" creates a document exactly as the card does --
    await page.getByRole('link', { name: 'Use this template' }).click()
    await page.waitForURL(/\/draft\/d\/[0-9a-f]+$/)

    // Blank: the placeholder chip the skeleton leaves is still there, and
    // NONE of the specimen's own words are — the one guarantee this whole
    // screen exists to keep.
    const editor = page.getByRole('textbox', { name: 'Document body' })
    await expect(editor).toBeVisible()
    await expect(editor).toContainText('{{mainPoint}}')
    await expect(editor).not.toContainText('Doubts have been expressed')
    await expect(editor).not.toContainText('National Institute of Open Schooling')
    await expect(page.getByText('Grant of Children Education Allowance')).toHaveCount(0)
  })

  test('reads in Hindi from the start when the app is', async ({ page }) => {
    await page.goto('/draft/new')
    await setLanguage(page, 'hi')
    await page.goto('/draft/new/office-memorandum/preview')
    await expect(
      page.getByRole('heading', { level: 1, name: 'कार्यालय ज्ञापन — उदाहरण' }),
    ).toBeVisible()
    await expect(page.getByRole('link', { name: 'यह टेम्पलेट प्रयोग करें' })).toBeVisible()

    expect(formatViolations(await audit(page)), 'the template preview in Hindi').toEqual([])
  })

  test('passes axe in the dark theme', async ({ page }) => {
    await page.goto('/law')
    await page.getByRole('button', { name: /dark theme|गहरे रंग/i }).click()
    await expect(page.locator('html')).toHaveClass(/dark/, { timeout: 30_000 })

    await page.goto('/draft/new/office-memorandum/preview')
    await expect(page.getByRole('link', { name: 'Use this template' })).toBeVisible()
    expect(formatViolations(await audit(page)), 'the template preview in dark theme').toEqual([])
  })
})
