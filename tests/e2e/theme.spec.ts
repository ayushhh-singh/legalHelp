import { expect, test } from '@playwright/test'

/**
 * ADR-010 reverses ADR-006: light is the default and dark applies only from the
 * in-app toggle. This is the check that matters — it runs the real stylesheet in
 * a real browser with the OS emulated as dark, which is exactly the situation
 * the old palette got wrong on purpose and the new one must get right.
 */

const LIGHT_BACKGROUND = 'rgb(247, 249, 252)' // --background, :root
const DARK_BACKGROUND = 'rgb(6, 18, 37)' // --background, .dark

const bodyBackground = (page: import('@playwright/test').Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor)

test.describe('dark is an explicit choice, never the OS setting', () => {
  test.use({ colorScheme: 'dark' })

  test('stays light on a dark system until the toggle is used', async ({ page }) => {
    await page.goto('/law')
    await expect(page.getByRole('main')).toBeVisible()

    // The system prefers dark. The app must not.
    expect(await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(true)
    expect(await bodyBackground(page)).toBe(LIGHT_BACKGROUND)
    expect(await page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(false)

    // Toggling gives dark...
    await page.getByRole('button', { name: /dark theme|गहरे रंग/i }).click()
    await expect.poll(() => bodyBackground(page)).toBe(DARK_BACKGROUND)

    // ...and it survives a reload, because it is stored in IndexedDB.
    await page.reload()
    await expect(page.getByRole('main')).toBeVisible()
    await expect.poll(() => bodyBackground(page)).toBe(DARK_BACKGROUND)

    // Toggling back gives light again, on a system that still prefers dark.
    await page.getByRole('button', { name: /light theme|हल्के रंग/i }).click()
    await expect.poll(() => bodyBackground(page)).toBe(LIGHT_BACKGROUND)
  })
})
