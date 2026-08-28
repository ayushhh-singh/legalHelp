import type { Page } from '@playwright/test'

import { audit, expect, formatViolations, LANGUAGES, setLanguage, t, test } from './fixtures'

/**
 * Keyboard-only runs through the Law Converter and the Rules Trainer, and the
 * two motion and announcement guarantees that only a real browser can check.
 *
 * "Keyboard-only" here means literally that: no `click()`, no `fill()` on a
 * locator, nothing that teleports focus. Every step is `Tab`, `Shift+Tab`,
 * `Enter`, `Space`, an arrow or a printable character sent to whatever
 * `document.activeElement` happens to be. That is the whole point — an
 * `expect(button).toBeVisible()` passes for a control that no amount of tabbing
 * can ever reach, and a `.click()` passes for one whose focus order sends the
 * reader through forty list items to get back out.
 *
 * These are separate from `a11y.spec.ts`, which asks axe a static question
 * about the markup. Reachability and focus order are behaviour, and axe has no
 * opinion about either.
 */

/**
 * What has focus right now, described the way a person would describe it.
 *
 * The `<label>` lookup is not optional detail: a form control's accessible name
 * usually comes from a separate element, so a description built from
 * `aria-label` and `innerText` alone renders every input in this app as `input
 * ""` — which makes a focus trail unreadable exactly when it is needed.
 */
async function focused(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null
    if (!el || el === document.body) return '<nothing>'

    const labels = (el as HTMLInputElement).labels
    const text =
      el.getAttribute('aria-label') ||
      (labels?.length ? (labels[0]?.textContent ?? '') : '') ||
      el.innerText?.trim() ||
      el.getAttribute('placeholder') ||
      ''
    const role = el.getAttribute('role')
    return `${el.tagName.toLowerCase()}${role ? `[${role}]` : ''} "${text.trim().slice(0, 60)}"`
  })
}

/**
 * Tab until `matches` says the focused element is the one wanted, or give up.
 *
 * The cap is what makes this a test rather than a loop: a control that takes
 * more than `limit` presses to reach is a control a keyboard user does not
 * really have, and failing with the focus trail attached is what makes the
 * result diagnosable.
 */
async function tabTo(
  page: Page,
  matches: (description: string) => boolean,
  { limit = 40, reverse = false } = {},
): Promise<string[]> {
  const trail: string[] = []
  for (let i = 0; i < limit; i += 1) {
    await page.keyboard.press(reverse ? 'Shift+Tab' : 'Tab')
    const description = await focused(page)
    trail.push(description)
    if (matches(description)) return trail
  }
  throw new Error(
    `Never reached the target in ${limit} ${reverse ? 'Shift+Tab' : 'Tab'} presses. Focus trail:\n  ` +
      trail.join('\n  '),
  )
}

for (const language of LANGUAGES) {
  test(`the Law Converter is usable with the keyboard alone (${language})`, async ({ page }) => {
    await page.goto('/law')
    await setLanguage(page, language)
    // Reload after the toggle: setting the language leaves focus ON the toggle,
    // so the first Tab would start from the header rather than from the top of
    // the document — and "the skip link is first" is a claim about a fresh
    // load, which is the only time it matters.
    await page.reload()
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

    // The skip link is first, which is the whole reason it exists.
    await page.keyboard.press('Tab')
    expect(await focused(page)).toContain('a ')

    // Reach the search box by tabbing, and type into it by pressing keys —
    // never `locator.fill()`, which sets the value without focus ever moving.
    const searchLabel = t(language, 'law.search.label')
    await tabTo(page, (description) => description.includes(searchLabel) || description.includes('search'))
    await page.keyboard.type('302')

    await expect(page.getByRole('list', { name: t(language, 'law.search.resultsLabel') })).toBeVisible({
      timeout: 30_000,
    })

    // Open the top hit with Enter, from the keyboard.
    await tabTo(page, (description) => description.includes('103') || description.includes('BNS'))
    await page.keyboard.press('Enter')

    await expect(page.getByRole('heading', { level: 2 }).first()).toBeVisible()

    // And the section's own actions are reachable from where the reader now is,
    // without going back to the top of the page.
    await tabTo(page, (description) => description.includes(t(language, 'law.actions.copy')), { limit: 60 })
  })
}

test('the Rules Trainer can be reviewed with the keyboard alone', async ({ page }) => {
  await page.goto('/learn')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

  await tabTo(page, (description) => description.includes(t('en', 'trainer.home.startReview')), {
    limit: 60,
  })
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/learn\/review/)

  // The review screen's own shortcuts, which are the point of it: a reader
  // working through fifty cards is not reaching for a mouse each time.
  const reveal = page.getByRole('button', { name: t('en', 'trainer.card.showAnswer') })
  await expect(reveal).toBeVisible({ timeout: 30_000 })

  // Space reveals an open-recall card without focusing anything first.
  await page.keyboard.press('Space')
  const good = page.getByRole('button', { name: /^Good/ })
  await expect(good).toBeVisible()

  // 1-4 grade it. This is `CardView`'s own document-level handler, so it works
  // wherever focus happens to be — which is what makes it usable.
  await page.keyboard.press('3')
  await expect(
    page
      .getByRole('button', { name: t('en', 'trainer.card.showAnswer') })
      .or(page.getByText(t('en', 'trainer.review.sessionComplete')))
      .first(),
  ).toBeVisible({ timeout: 30_000 })
})

test('prefers-reduced-motion is honoured, and the page still settles', async ({ page }) => {
  // `src/styles/index.css` collapses every animation and transition to 0.01ms
  // under the OS setting. The claim is checked against the COMPUTED style in a
  // real browser rather than by grepping the stylesheet, because a Tailwind
  // utility ships its own `transition-duration` and layer order decides which
  // `!important` wins — which no amount of reading either file settles.
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/law')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

  const durations = await page.evaluate(() =>
    [...document.querySelectorAll('a, button, [class*="transition"]')].slice(0, 60).map((node) => {
      const style = getComputedStyle(node)
      return { transition: style.transitionDuration, animation: style.animationDuration }
    }),
  )

  expect(durations.length).toBeGreaterThan(5)
  const moving = durations.filter(
    (d) => Number.parseFloat(d.transition) > 0.05 || Number.parseFloat(d.animation) > 0.05,
  )
  expect(moving, 'something still animates for longer than 50ms under reduced motion').toEqual([])

  // And the app is not merely still — it still works, and still audits clean.
  await page.getByLabel(t('en', 'law.search.label')).fill('302')
  await expect(page.getByRole('heading', { name: 'Punishment for murder.' }).first()).toBeVisible({
    timeout: 30_000,
  })
  expect(formatViolations(await audit(page))).toEqual([])
})

test('the theme toggle still animates when reduced motion is NOT requested', async ({ page }) => {
  // The negative half. Without it the test above passes just as well against a
  // stylesheet that has had every transition deleted, which would be a
  // different app rather than an accessible one.
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/law')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

  const durations = await page.evaluate(() =>
    [...document.querySelectorAll('[class*="transition"]')]
      .slice(0, 40)
      .map((node) => Number.parseFloat(getComputedStyle(node).transitionDuration)),
  )
  expect(durations.some((duration) => duration > 0.05)).toBe(true)
})

test('a copy confirmation is announced, not only drawn', async ({ page, context }) => {
  // Every copy affordance in the app writes into a live region. The icon swap
  // alone is `aria-hidden`, so to a screen reader an un-announced copy is a
  // button that did nothing at all — which is what `/utils/portals` used to do.
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])

  for (const [route, ready, action, confirmation] of [
    ['/utils/portals', 'utils.portals.title', 'utils.portals.copyUrl', 'utils.portals.copied'],
    ['/law?q=302&code=bns', 'pages.law.title', 'law.actions.copy', 'law.actions.copied'],
  ] as const) {
    await page.goto(route)
    await expect(page.getByRole('heading', { level: 1, name: t('en', ready) })).toBeVisible({
      timeout: 30_000,
    })

    const button = page.getByRole('button', { name: t('en', action) }).first()
    await expect(button).toBeVisible({ timeout: 30_000 })
    await button.click()

    const live = page.getByText(t('en', confirmation))
    await expect(live, `${route} announced nothing`).toBeVisible()

    // In a live region, not merely on the page: `role="status"` implies
    // `aria-live="polite"`, and either spelling counts.
    const announced = await live.evaluate((node) => Boolean(node.closest('[aria-live], [role="status"]')))
    expect(announced, `${route}'s confirmation is not inside a live region`).toBe(true)
  }
})
