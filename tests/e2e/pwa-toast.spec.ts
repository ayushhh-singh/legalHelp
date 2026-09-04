import { expect, onPhone, test } from './fixtures'

/**
 * The service-worker toast, and the two ways it used to eat a tap.
 *
 * docs/DATA-GAPS.md #59: on a 412px viewport this bar sat exactly where the
 * Rules Trainer mock test's "Next question" button is and intercepted every
 * click on it. A reader who installed the app and started a mock test could not
 * finish one until they noticed the × — found only at a phone viewport in a
 * real browser, which is why the assertions here are geometric rather than
 * about the DOM.
 *
 * The toast is driven directly rather than waited for. Its own trigger is the
 * service worker's first `installed` event, which fires at most once per origin
 * for the life of a registration — so a spec that waited for it would pass on a
 * cold profile, pass again by accident on a warm one because the element it was
 * about to assert on was simply absent, and never fail. Setting the variable is
 * the honest version: it asserts the CONTRACT between `pwa.tsx`, which measures
 * the toast, and `App.tsx`, which reserves room for it — which is the thing
 * that was broken.
 */

/** `--tab-bar-height` plus the home indicator, both of which the toast must clear. */
const barHeightPx = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const root = getComputedStyle(document.documentElement)
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
    const raw = root.getPropertyValue('--tab-bar-height').trim()
    return raw.endsWith('rem') ? parseFloat(raw) * rem : parseFloat(raw) || 0
  })

test('the toast sits above the tab bar, not on it', async ({ page }) => {
  await page.goto('/learn')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

  const bar = await barHeightPx(page)
  const offset = await page.evaluate(() => {
    // Resolved by the browser, so `env()` and the breakpoint are both applied —
    // the flat `bottom-[4.5rem]` this replaced resolved fine too and was still
    // wrong, because it did not include the inset.
    const probe = document.createElement('div')
    probe.style.position = 'fixed'
    probe.style.bottom = 'var(--pwa-toast-bottom)'
    document.body.append(probe)
    const value = probe.getBoundingClientRect().bottom
    const bottom = window.innerHeight - value
    probe.remove()
    return bottom
  })

  if (onPhone(page)) {
    // Strictly above the bar. Equality would mean flush against it.
    expect(bar).toBeGreaterThan(0)
    expect(offset).toBeGreaterThan(bar)
  } else {
    // No tab bar at all from `lg`, so the toast is an ordinary corner card and
    // `--tab-bar-height` is genuinely zero rather than merely unused.
    expect(bar).toBe(0)
    expect(offset).toBeGreaterThan(0)
    expect(offset).toBeLessThan(40)
  }
})

test('a visible toast reserves room under the content instead of covering it', async ({ page }) => {
  await page.goto('/learn')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

  const paddingBottom = () =>
    page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('main')!).paddingBottom))

  const before = await paddingBottom()
  expect(before).toBeGreaterThan(0)

  // What `useReservedToastSpace` writes when a toast is on screen.
  await page.evaluate(() => document.documentElement.style.setProperty('--pwa-toast-space', '96px'))
  const during = await paddingBottom()
  expect(during).toBeCloseTo(before + 96, 0)

  // And every path by which the last toast goes must give the space back.
  await page.evaluate(() => document.documentElement.style.removeProperty('--pwa-toast-space'))
  expect(await paddingBottom()).toBeCloseTo(before, 0)
})

test('the reserved space is enough to clear a real toast on a phone', async ({ page }) => {
  test.skip(!onPhone(page), 'the overlap this is about only happens where the toast is full width')

  await page.goto('/learn')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

  // A toast is one line in English and can wrap to three in Hindi, which is why
  // `pwa.tsx` measures rather than reserving a fixed number. Assert the
  // arithmetic holds for a tall one: bottom offset + height must fit inside the
  // padding, or the top of the toast is over the content again.
  const fits = await page.evaluate(() => {
    const root = document.documentElement
    const rem = parseFloat(getComputedStyle(root).fontSize) || 16
    const raw = getComputedStyle(root).getPropertyValue('--tab-bar-height').trim()
    const toastHeight = 84
    root.style.setProperty('--pwa-toast-space', `${toastHeight + 16}px`)
    const padding = parseFloat(getComputedStyle(document.querySelector('main')!).paddingBottom)
    root.style.removeProperty('--pwa-toast-space')
    return {
      // Deliberately NOT defaulted to 0. An absent variable has to fail this
      // test, not quietly satisfy it: the first version read `|| 0`, and
      // against the pre-fix build — where neither variable existed — that made
      // `padding >= 0 + 12 + 84` true by arithmetic and the test passed on
      // exactly the code it was written to catch.
      bar: raw ? (raw.endsWith('rem') ? parseFloat(raw) * rem : parseFloat(raw)) : NaN,
      padding,
      toastHeight,
    }
  })

  expect(fits.bar, '--tab-bar-height is not defined').not.toBeNaN()
  expect(fits.bar).toBeGreaterThan(0)
  expect(fits.padding).toBeGreaterThanOrEqual(fits.bar + 12 + fits.toastHeight)
})
