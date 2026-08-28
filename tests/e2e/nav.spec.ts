import type { Page } from '@playwright/test'

import { expect, test } from './fixtures'

/**
 * The bottom bar's edge cases, in a real browser. Each of these is a defect
 * that was found by probing rather than by the suite, and each would be
 * invisible to a jsdom test: they are about tab order, IDREF resolution and
 * viewport breakpoints.
 */

const MOBILE = { width: 390, height: 780 }

const focusedLabel = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement
    if (!el) return 'none'
    return `${el.tagName}:${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)}`
  })

test.describe('bottom bar', () => {
  test.use({ viewport: MOBILE })

  test('Tab from the open More button lands inside the sheet', async ({ page }) => {
    // The sheet is painted above the bar but must FOLLOW its trigger in the
    // DOM, or forward Tab skips the sheet entirely and leaves the page.
    await page.goto('/law')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

    const more = page.getByRole('button', { name: 'More destinations' })
    await more.focus()
    await page.keyboard.press('Enter')
    await expect(more).toHaveAttribute('aria-expanded', 'true')

    await page.keyboard.press('Tab')
    expect(await focusedLabel(page)).toContain('Utilities')
    await page.keyboard.press('Tab')
    expect(await focusedLabel(page)).toContain('Settings')
  })

  test('aria-controls always resolves, open or shut', async ({ page }) => {
    await page.goto('/law')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

    const target = () => page.evaluate(() => !!document.getElementById('nav-more-sheet'))
    const visible = () =>
      page.evaluate(() => (document.getElementById('nav-more-sheet')?.getClientRects().length ?? 0) > 0)

    expect(await target()).toBe(true)
    expect(await visible()).toBe(false)

    await page.getByRole('button', { name: 'More destinations' }).click()
    expect(await visible()).toBe(true)
  })

  test('closes when the destination it links to is the one already showing', async ({ page }) => {
    // `openedAt === pathname` alone leaves the sheet open here, because
    // navigating to the current route never changes the pathname.
    await page.goto('/utils')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

    await page.getByRole('button', { name: 'More destinations' }).click()
    const sheet = page.locator('#nav-more-sheet')
    await expect(sheet).toBeVisible()

    await sheet.getByRole('link', { name: 'Utilities' }).click()
    await expect(sheet).toBeHidden()
  })

  test('closes on Escape and on a click outside', async ({ page }) => {
    await page.goto('/law')
    const sheet = page.locator('#nav-more-sheet')

    await page.getByRole('button', { name: 'More destinations' }).click()
    await expect(sheet).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(sheet).toBeHidden()

    await page.getByRole('button', { name: 'More destinations' }).click()
    await expect(sheet).toBeVisible()
    await page.getByRole('main').click({ position: { x: 10, y: 10 } })
    await expect(sheet).toBeHidden()
  })
})

test('every destination is reachable at every breakpoint', async ({ page }) => {
  // 767/768 and 1023/1024 are the two boundaries. A gap at any of them would
  // leave a module unreachable on that class of device.
  for (const width of [320, 390, 767, 768, 1023, 1024, 1280]) {
    await page.setViewportSize({ width, height: 800 })
    await page.goto('/law')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

    const reachable = await page.evaluate(() => {
      const shown = (el: Element | null) => !!el && el.getClientRects().length > 0
      const sidebar = document.querySelector('nav[aria-label="Main navigation"]')
      const bar = document.querySelector('nav[aria-label="Main tabs"]')
      const inSidebar = shown(sidebar) ? (sidebar?.querySelectorAll('a').length ?? 0) : 0
      const inBar = [...(bar?.querySelectorAll('ul > li > a') ?? [])].filter(shown).length
      const behindMore = shown(bar?.querySelector('button') ?? null)
        ? (document.querySelectorAll('#nav-more-sheet a').length ?? 0)
        : 0
      return inSidebar + inBar + behindMore
    })

    expect(reachable, `${width}px reaches ${reachable} of 6 destinations`).toBe(6)
  }
})
