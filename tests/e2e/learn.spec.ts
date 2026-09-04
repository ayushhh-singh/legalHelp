import type { Page } from '@playwright/test'

import { dismissPwaToasts, expect, test } from './fixtures'

/**
 * The Rules Trainer, in a real browser, against the committed `data/rules`.
 *
 * The first test is the session brief's own acceptance run in one go: start a
 * review, reveal a card, toggle the app's language mid-card and see the SAME
 * card in the other language, grade it, watch the next card arrive, grade
 * that one too, and see Home's counts reflect both — all while counting every
 * request the page makes and asserting none crossed the origin. `Rule 1` and
 * `Rule 2` of the CCS (Conduct) Rules are asserted by name rather than by
 * position alone: they are the first two `approved` cards in
 * `data/rules/cards/ccs-conduct.json`, ccs-conduct is the first act in
 * `src/modules/trainer/data.ts`'s `ACT_IDS`, and a fresh device with every act
 * enabled and no review history offers new cards in exactly that order
 * (`buildQueue`'s round robin starts at `order[0]`) — so this is the FIRST
 * card any fresh install of this app will ever show, not a fixture.
 */

/**
 * One statistic on the Practise tab, by its own label.
 *
 * `.last()` because ADR-046 put the four stats inside ONE "Today" card, which
 * is itself a `<section>` — so an unfiltered `hasText` matches the card as well
 * as the `StatCard` inside it, and the card contains every figure on the
 * screen. The innermost match is the one that is about this label.
 */
const homeStat = (page: Page, label: string) => page.locator('section', { hasText: label }).last()

test('start review → reveal → grade Good → next card → finish → home counts update, and a language toggle mid-card keeps the same card', async ({
  page,
  baseURL,
}) => {
  const origin = new URL(baseURL ?? 'http://localhost:4173').origin
  const crossOrigin: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).origin !== origin) crossOrigin.push(`${request.method()} ${request.url()}`)
  })

  await page.goto('/study/practise')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await page.getByRole('link', { name: /Start review|पुनरीक्षण आरंभ करें/ }).click()

  await expect(page).toHaveURL(/\/study\/practise\/review/)
  await expect(page.getByText('Rule 1, Central Civil Services (Conduct) Rules, 1964')).toBeVisible({
    timeout: 30_000,
  })
  await expect(page.getByText('Short title, commencement and application', { exact: false })).toBeVisible()

  /*
    Toggle the app's language mid-card — the same card must still be on screen,
    in the other language, not reset to the queue's first card again.

    A review session is a FOCUS screen since ADR-046, so the app's top bar is
    hidden and the toggle lives in the FocusBar's ⋯ menu. That the control is
    still reachable from inside a session is the point: an officer who wants to
    read a rule in Hindi should not have to leave the card to do it.
  */
  const openMenu = async () => page.getByRole('button', { name: 'More actions' }).click()

  await openMenu()
  await page.getByRole('button', { name: 'Switch to Hindi' }).click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'hi')
  await expect(page.getByText('नियम 1, केंद्रीय सिविल सेवा (आचरण) नियम, 1964')).toBeVisible()

  await page.getByRole('button', { name: 'अन्य क्रियाएँ' }).click()
  await page.getByRole('button', { name: 'अंग्रेज़ी में बदलें' }).click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(page.getByText('Rule 1, Central Civil Services (Conduct) Rules, 1964')).toBeVisible()

  await page.getByRole('button', { name: 'Show answer' }).click()
  await expect(page.getByRole('button', { name: /^Good/ })).toBeVisible()
  await page.getByRole('button', { name: /^Good/ }).click()

  // The next card — CCS (Conduct) Rule 2, the second approved card in the file.
  await expect(page.getByText('Rule 2, Central Civil Services (Conduct) Rules, 1964')).toBeVisible({
    timeout: 10_000,
  })
  await expect(page.getByText('Definitions', { exact: false })).toBeVisible()

  await page.getByRole('button', { name: 'Show answer' }).click()
  await page.getByRole('button', { name: /^Good/ }).click()

  await page.getByRole('link', { name: 'Back to Home' }).click()
  await expect(page).toHaveURL(/\/study\/practise$/)
  await expect(homeStat(page, 'Reviewed today').getByText('2', { exact: true })).toBeVisible()
  await expect(homeStat(page, 'New today').getByText('2', { exact: true })).toBeVisible()

  expect(crossOrigin).toEqual([])
})

test('a mock test can be completed start to finish', async ({ page }) => {
  await page.goto('/study/practise/mock')
  await expect(page.getByRole('button', { name: 'Start test' })).toBeVisible({ timeout: 30_000 })

  // 10 questions, no timer — the defaults — over every rule book.
  await page.getByRole('button', { name: 'Start test' }).click()

  // On a phone the service worker's "Ready to work offline." toast is a
  // full-width bar just above the tab bar, waiting for an acknowledgement —
  // exactly where "Next question" is, and it intercepts every click on it.
  // docs/DATA-GAPS.md #59; a real reader dismisses it, which is what this does.
  await dismissPwaToasts(page)

  for (let i = 0; i < 10; i += 1) {
    await expect(page.getByRole('radiogroup', { name: 'Answer options' })).toBeVisible()
    await page.getByRole('radiogroup', { name: 'Answer options' }).getByRole('radio').first().click()
    await page.getByRole('button', { name: /Next question|Finish test/ }).click()
  }

  await expect(page.getByRole('heading', { name: 'Results' })).toBeVisible()
  await expect(page.getByText(/\d+ \/ 10 correct/)).toBeVisible()
})

test('the whole review loop works with no network at all', async ({ page, context }) => {
  // Warm the service worker, exactly as tests/e2e/offline.spec.ts does.
  await page.goto('/study/practise')
  await expect(page.getByRole('link', { name: 'Start review' })).toBeVisible({ timeout: 30_000 })
  await page.goto('/study/practise/review')
  await expect(page.getByText('Rule 1, Central Civil Services (Conduct) Rules, 1964')).toBeVisible({
    timeout: 30_000,
  })
  await page.evaluate(() => navigator.serviceWorker?.ready)

  await context.setOffline(true)
  await page.reload()

  await expect(page.getByRole('heading', { name: 'Review' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('Rule 1, Central Civil Services (Conduct) Rules, 1964')).toBeVisible()
  await page.getByRole('button', { name: 'Show answer' }).click()
  await expect(page.getByRole('button', { name: /^Good/ })).toBeVisible()

  await context.setOffline(false)
})

test('a topic’s Copy link on Browse produces the same URL a review-scope link uses', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/study/practise/browse')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByText('Central Civil Services (Conduct) Rules, 1964', { exact: false })).toBeVisible({
    timeout: 30_000,
  })

  await page.getByRole('button', { name: 'Copy link to this rule book' }).first().click()
  await expect(page.getByText('Link copied to the clipboard.')).toBeVisible()
  const copied = await page.evaluate(() => navigator.clipboard.readText())
  expect(copied).toContain('/study/practise/review?act=ccs-conduct')

  // The link itself restores the same scoped review the weak-area chips on
  // Home already use `?act=` for.
  await page.goto('/study/practise/review?act=ccs-conduct')
  await expect(page.getByText('Rule 1, Central Civil Services (Conduct) Rules, 1964')).toBeVisible({
    timeout: 30_000,
  })
})
