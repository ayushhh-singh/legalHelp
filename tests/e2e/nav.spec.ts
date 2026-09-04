import { expect, test } from './fixtures'

/**
 * The two chromes, in a real browser.
 *
 * Before ADR-046 this file was about the "More" sheet's edge cases — tab order
 * into it, whether its `aria-controls` resolved while it was shut, whether it
 * closed on a link to the route already showing. There is no sheet any more:
 * five tabs fit the bottom bar at every width this app supports, so every
 * destination is on screen at every breakpoint and none of those questions can
 * be asked. What replaces them is the claim that made the sheet removable, plus
 * the one thing the new chrome does that the old one did not: it gets out of
 * the way at level 3.
 */

const MOBILE = { width: 390, height: 780 }

test('every tab is on the bar at every breakpoint, with no overflow', async ({ page }) => {
  // 767/768 and 1023/1024 are the two boundaries. A gap at any of them would
  // leave a section unreachable on that class of device — which is what the
  // "More" sheet existed to paper over.
  //
  // The expected COUNT is read from the widest viewport, where the sidebar
  // shows every destination there is, rather than written down here: a literal
  // is a second copy of `src/lib/nav.ts`'s length that goes stale the next time
  // a section is added.
  let expected: number | null = null

  for (const width of [1280, 320, 390, 767, 768, 1023, 1024]) {
    await page.setViewportSize({ width, height: 800 })
    await page.goto('/law')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

    const counted = await page.evaluate(() => {
      const shown = (el: Element | null) => !!el && el.getClientRects().length > 0
      const sidebar = document.querySelector('nav[aria-label="Main navigation"]')
      const bar = document.querySelector('nav[aria-label="Main tabs"]')
      return {
        reachable:
          (shown(sidebar) ? (sidebar?.querySelectorAll('a').length ?? 0) : 0) +
          [...(bar?.querySelectorAll('ul > li > a') ?? [])].filter(shown).length,
        // Nothing in either chrome may be a button: a button in a nav bar is an
        // overflow trigger, and there is no overflow.
        buttons:
          (sidebar?.querySelectorAll('button').length ?? 0) + (bar?.querySelectorAll('button').length ?? 0),
      }
    })

    expect(counted.buttons, `${width}px has a control in the nav that is not a link`).toBe(0)

    if (expected === null) {
      // A guard that counts zero is not a guard.
      expect(counted.reachable, 'the widest viewport reached no destinations at all').toBeGreaterThanOrEqual(
        5,
      )
      expected = counted.reachable
      continue
    }

    expect(counted.reachable, `${width}px reaches ${counted.reachable} of ${expected} tabs`).toBe(expected)
  }
})

test.describe('the tab bar on a phone', () => {
  test.use({ viewport: MOBILE })

  test('marks the section a deep page belongs to, not just the section root', async ({ page }) => {
    // A reader three levels into Study has to be able to see, without reading
    // the URL, which of the five they are in.
    await page.goto('/study/read')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30_000 })

    const bar = page.getByRole('navigation', { name: 'Main tabs' })
    await expect(bar.getByRole('link', { name: 'Study' })).toHaveAttribute('aria-current', 'page')
    await expect(bar.getByRole('link', { name: 'Law Converter' })).not.toHaveAttribute('aria-current', 'page')
  })

  test('gets out of the way at level 3, and gives back a way out', async ({ page }) => {
    await page.goto('/study/read/ccs-conduct/ccs-conduct-3')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30_000 })

    // No tab bar, no sidebar, no app top bar — and the FocusBar's own control
    // back to the page above, named after it.
    await expect(page.getByRole('navigation', { name: 'Main tabs' })).toHaveCount(0)
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toHaveCount(0)
    await expect(page.getByRole('banner')).toHaveCount(0)

    // By the sentence only the FocusBar's back control carries: the reader also
    // has a "Read aloud" button, and `/Read/` matched that one first.
    await page.getByRole('button', { name: /back to where this is filed/ }).click()
    await expect(page).toHaveURL(/\/study\/read\/ccs-conduct$/)

    // And the chrome is back.
    await expect(page.getByRole('navigation', { name: 'Main tabs' })).toBeVisible()
  })
})
