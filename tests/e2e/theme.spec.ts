import { expect, test } from './fixtures'

/**
 * ADR-010 reverses ADR-006: light is the default and dark applies only from the
 * in-app toggle. This is the check that matters — it runs the real stylesheet in
 * a real browser with the OS emulated as dark, which is exactly the situation
 * the old palette got wrong on purpose and the new one must get right.
 */

const LIGHT_BACKGROUND = 'rgb(247, 249, 252)' // --background, :root
const DARK_BACKGROUND = 'rgb(6, 18, 37)' // --background, .dark

type Page = import('@playwright/test').Page

const bodyBackground = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor)

/**
 * The theme as IndexedDB actually holds it.
 *
 * Reading it is not pedantry: the toggle applies in memory synchronously and
 * persists asynchronously, so polling the rendered colour and reloading
 * immediately races the write and intermittently reloads into light. Waiting on
 * the stored value is also the stronger assertion — it is the persistence that
 * has to survive the reload, not the paint.
 */
const storedTheme = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<string | null>((resolve) => {
        const open = indexedDB.open('sahayak')
        open.onerror = () => resolve(null)
        open.onsuccess = () => {
          const request = open.result.transaction('settings').objectStore('settings').get('theme')
          request.onerror = () => resolve(null)
          request.onsuccess = () => resolve((request.result as { value?: string } | undefined)?.value ?? null)
        }
      }),
  )

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
    await expect.poll(() => storedTheme(page)).toBe('dark')
    await page.reload()
    await expect(page.getByRole('main')).toBeVisible()
    await expect.poll(() => bodyBackground(page)).toBe(DARK_BACKGROUND)

    // Toggling back gives light again, on a system that still prefers dark.
    await page.getByRole('button', { name: /light theme|हल्के रंग/i }).click()
    await expect.poll(() => bodyBackground(page)).toBe(LIGHT_BACKGROUND)
    await expect.poll(() => storedTheme(page)).toBe('light')
  })
})
