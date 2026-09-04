import type { Page } from '@playwright/test'

import { audit, expect, formatViolations as format, storedSetting, test } from './fixtures'

/**
 * axe over the built shell, in a real browser, across every route x both
 * languages x both themes.
 *
 * This is the run that can actually evaluate `color-contrast`: jsdom has no
 * layout or paint, so src/app/App.a11y.test.tsx has to disable that rule and it
 * reports as *incomplete* there, not *pass*. Closes docs/DATA-GAPS.md #2.
 *
 * `audit`, `settle` and the axe source itself live in `./fixtures` rather than
 * here, because `tests/e2e/keyboard.spec.ts` audits too and two copies of an
 * axe harness would drift. axe-core is injected from node_modules rather than
 * fetched — the hard rule is that this app makes no third-party request, and
 * that includes its own tests; the network gate in that same fixture would fail
 * this spec if it ever were.
 */

const ROUTES = [
  '/law',
  '/law/whats-new',
  '/law/saved',
  '/pay',
  '/draft',
  // The editor is as much markup again as the picker — a guided form, a body
  // toolbar, an A4 preview and an export bar — and the picker sweep would
  // never see any of it.
  '/draft/office-memorandum',
  // Session 29's document editor and the four screens around it. The editor is
  // the one that matters — a six-tab tablist, a `role="toolbar"` of twenty-odd
  // controls and a contenteditable surface, none of which the picker sweep can
  // see — and `/draft/d/:id` is parameterised, so `EXEMPT` in
  // `tests/route-coverage.test.ts` names the instance this sweep visits.
  '/draft/documents',
  '/draft/profile',
  '/draft/address-book',
  '/draft/numbering',
  '/draft/my-templates',
  '/draft/import',
  '/draft/reply',
  '/draft/register',
  '/learn',
  // The review card itself — a radiogroup of options, four grade buttons and a
  // report dialog — is the single most-used screen in the Trainer and was swept
  // by neither this sweep nor the offline one until `tests/route-coverage.test.ts`
  // was written to notice. Every route around it was covered, which is why.
  '/learn/review',
  '/learn/browse',
  '/learn/mock',
  '/learn/settings',
  '/learn/bookmarks',
  '/learn/reports',
  '/learn/review-queue',
  '/library',
  // The reader is where the Library's markup actually is — a sticky progress
  // header, four groups of type controls, the unit itself and a related rail —
  // and the shelf sweep would see none of it. The work page is the table of
  // contents and the search box.
  '/library/ccs-conduct',
  '/library/ccs-conduct/ccs-conduct-3',
  // Session 28's four study screens. The quiz is a radio-shaped option list and
  // a results table; the sheet is a printable document; the hub is the weekly
  // review with a goal FORM in it — three number inputs and a select, which is
  // where a missing label costs a reader most.
  '/library/study',
  '/library/ccs-conduct/quiz/group-n-ccs-conduct-1',
  '/library/ccs-conduct/sheet/group-n-ccs-conduct-1',
  // Session 27's five screens. Each is as much markup again as the shelf, and
  // four of them are mostly FORM — filter selects, a picker pair, a file input
  // and a review list — which is where a missing label costs a reader most.
  '/library/mine',
  '/library/bookmarks',
  '/library/compare',
  '/library/search',
  '/library/add',
  '/utils',
  // 1,891 terms is as much markup as the picker sweep would never see —
  // /utils alone never renders a single row of it.
  '/utils/glossary',
  // Utilities' other four tools, each of which is a form and a results panel
  // the hub route never renders: a month grid and a restricted-holiday picker,
  // six number inputs, a scheme radio group, and a searchable directory. The
  // sweep covered none of them until this session.
  '/utils/holidays',
  '/utils/leave',
  '/utils/pension',
  '/utils/portals',
  '/settings',
  '/onboarding',
]

/**
 * A route that renders a skeleton first must be audited AFTER its data lands.
 *
 * `/pay` imports 1.2 MB of datasets before it can draw a single figure, and its
 * `<h1>` is on screen for the whole of that. Auditing on the h1 alone would run
 * axe over the skeleton and pass the route without ever having seen the form —
 * which is a green tick for a page nobody checked.
 */
const READY: Readonly<Record<string, RegExp>> = {
  '/pay': /Post|पद/,
}

/**
 * Routes whose data lands after the `<h1>` and which have no combobox to wait
 * on. Auditing before the template arrives would run axe over a skeleton and
 * pass the editor without having seen the form.
 */
const READY_BUTTON: Readonly<Record<string, RegExp>> = {
  '/draft/office-memorandum': /Fill with the worked example|नमूने से भरें/,
  '/learn/mock': /Start test|टेस्ट आरंभ करें/,
}

/**
 * Routes whose data lands after the `<h1>` and whose ready signal is plain
 * text rather than a named control — the glossary's result count, which
 * `GlossaryPage.tsx` renders only once `data/glossary.json` has settled.
 */
const READY_TEXT: Readonly<Record<string, RegExp>> = {
  '/utils/glossary': /\d+ terms?|\d+ शब्द/,
  // Every rule book's collapsed row carries its rule count, once
  // `data/rules`'s twelve card files have loaded — present whether or not the
  // reader has reviewed a single card yet.
  '/learn/browse': /\d+ rules?|\d+ नियम/,
  '/learn/settings': /New cards per day|प्रतिदिन नए कार्ड/,
  // Home renders EITHER the first-run empty state or the full dashboard on a
  // fresh device, and both carry this control — but it is a <Link>, not a
  // <button> (`asChild`), so it has to be matched by text rather than role.
  '/learn': /Start review|पुनरीक्षण आरंभ करें/,
}

/**
 * Set language and theme ONCE, from the real controls. Both are persisted in
 * IndexedDB and survive navigation, so toggling per route would flip them back
 * — and the toggle's accessible name changes with its state, so the second
 * click would not even find a button.
 */
async function setChrome(page: Page, language: 'en' | 'hi', theme: 'light' | 'dark') {
  await page.goto(ROUTES[0] ?? '/law')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

  // The generous timeouts are the same budget question as the test timeout
  // below: this is the first thing each of the four sweeps does, four workers
  // start it at once, and a toggle that has been clicked and not yet re-rendered
  // is contention rather than a defect.
  if (language === 'hi') {
    await page.getByRole('button', { name: 'Switch to Hindi' }).click()
    await expect(page.locator('html')).toHaveAttribute('lang', 'hi', { timeout: 30_000 })
  }
  if (theme === 'dark') {
    await page.getByRole('button', { name: /dark theme|गहरे रंग/i }).click()
    await expect(page.locator('html')).toHaveClass(/dark/, { timeout: 30_000 })
  }

  /*
    Wait for what was TOGGLED to be in IndexedDB, not merely applied to the DOM.

    The toggles apply in memory synchronously and persist asynchronously, so the
    first navigation below can outrun the write and land on a page that hydrates
    back to the default — the same race `tests/e2e/theme.spec.ts` documents. It
    became a real flake when this sweep grew from six routes to eight.

    Only a toggled preference is waited for: a default is never written, so
    waiting for `theme: light` would wait for a row that will never exist.
  */
  for (const [key, value] of [
    ['language', language === 'hi' ? 'hi' : null],
    ['theme', theme === 'dark' ? 'dark' : null],
  ] as const) {
    if (!value) continue
    await expect.poll(() => storedSetting(page, key), { timeout: 30_000 }).toBe(value)
  }
}

for (const language of ['en', 'hi'] as const) {
  for (const theme of ['light', 'dark'] as const) {
    test(`no axe violations in ${language} / ${theme}`, async ({ page }) => {
      /*
        Four minutes, not the default thirty seconds.

        This is one test that navigates 21 routes and runs a full axe pass on
        each; a quiet run takes about 21 seconds, which is already at the
        default ceiling before any contention. Under `pnpm test:e2e`'s four
        workers across two projects it went over — as a 30s test timeout, and
        as a 5s `expect` timeout on the `<h1>` of whichever route happened to
        be loading when another worker took the CPU. Both are budgets rather
        than defects: every case passes at `--workers=1`, and splitting the
        sweep per route would multiply the setChrome() cost by 21.

        Raised deliberately and stated here, rather than left to be
        rediscovered as a flake in CI — the same conclusion CLAUDE.md records
        for tests/rules-data.test.ts.
      */
      test.setTimeout(240_000)

      await setChrome(page, language, theme)

      for (const route of ROUTES) {
        await page.goto(route)
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30_000 })
        const ready = READY[route]
        if (ready) await expect(page.getByRole('combobox', { name: ready }).first()).toBeVisible()
        const readyButton = READY_BUTTON[route]
        if (readyButton) {
          await expect(page.getByRole('button', { name: readyButton }).first()).toBeVisible({
            timeout: 30_000,
          })
        }
        const readyText = READY_TEXT[route]
        if (readyText) {
          await expect(page.getByText(readyText).first()).toBeVisible({ timeout: 30_000 })
        }
        // The preference is read back out of IndexedDB after a navigation;
        // audit the page the reader actually sees, not the pre-hydration one.
        await expect(page.locator('html')).toHaveAttribute('lang', language, { timeout: 30_000 })
        if (theme === 'dark') {
          await expect(page.locator('html')).toHaveClass(/dark/, { timeout: 30_000 })
        }

        expect(format(await audit(page)), `${route} (${language}/${theme})`).toEqual([])
      }
    })
  }
}

/**
 * The Pay module's other three tabs.
 *
 * The route sweep above audits `/pay` as it opens, which is the calculator.
 * The simulations, the comparison and the private-versus-government panels are
 * as much markup again — a range input, three data tables and two more
 * comboboxes — and none of it would ever be looked at by the sweep.
 */
for (const [tab, ready] of [
  ['simulate', 'Annual increment'],
  ['compare', 'Second post'],
  ['private', 'The private package'],
] as const) {
  test(`no axe violations on the pay ${tab} tab`, async ({ page }) => {
    await page.goto('/pay?job=ib-acio-ii-executive&city=delhi&da=60&pctc=1800000')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.getByRole('combobox', { name: /Post/ }).first()).toBeVisible({ timeout: 30_000 })

    await page.getByRole('radio', { name: TAB_LABELS[tab] }).click()
    await expect(page.getByText(ready).first()).toBeVisible()

    expect(format(await audit(page)), `/pay (${tab})`).toEqual([])
  })
}

const TAB_LABELS = {
  simulate: 'Simulations',
  compare: 'Compare posts',
  private: 'Private vs government',
} as const

test('the audit still finishes when an infinite animation is on the page', async ({ page }) => {
  // Regression guard for settle(). <Skeleton/> renders `animate-pulse`, whose
  // `finished` promise never resolves; awaiting it hung this spec until
  // Playwright's timeout. /pay renders one while its datasets load, but only
  // for a moment, so this injects exactly what <Skeleton/> renders rather than
  // racing it — otherwise the guard only works when the load happens to be slow.
  await page.goto('/law')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await page.evaluate(() => {
    const skeleton = document.createElement('div')
    skeleton.className = 'animate-pulse bg-muted h-4 w-20 rounded-md'
    document.querySelector('main')?.appendChild(skeleton)
  })
  await expect.poll(() => page.evaluate(() => document.getAnimations().length)).toBeGreaterThan(0)

  expect(format(await audit(page))).toEqual([])
})

/**
 * The Law Converter with a result open — the densest surface in the app, and
 * the one the default sweep above never reaches, because it needs a query.
 *
 * A section card carries a status pill, a coral trap banner, a marigold
 * curated-Hindi notice, a word-level diff in tulsi and coral, and a seven-column
 * classification table. Every one of those is a tinted background with a paired
 * -foreground on it, which is exactly where a contrast failure hides.
 */
for (const language of ['en', 'hi'] as const) {
  for (const theme of ['light', 'dark'] as const) {
    test(`no axe violations on an open section card in ${language} / ${theme}`, async ({ page }) => {
      await setChrome(page, language, theme)
      // BNS 103: a trap banner, curated Hindi, a two-row classification table
      // and a heading diff, all on one card.
      await page.goto('/law?q=302&date=2024-06-30')
      await expect(page.getByRole('heading', { name: /Punishment for murder|हत्या/ })).toBeVisible()

      expect(format(await audit(page)), `law card (${language}/${theme})`).toEqual([])
    })
  }
}

test('no axe violations while browsing a whole Act', async ({ page }) => {
  // 531 rows in the DOM at once, one of which carries the tab stop. Worth its
  // own run: the sweep above never picks a code, and a list this long is where
  // a roving tabindex goes wrong.
  await page.goto('/law')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await page.getByText('BNSS · CrPC', { exact: true }).click()
  await expect(page.getByRole('list', { name: 'Search results' })).toBeVisible()

  expect(format(await audit(page))).toEqual([])
})

test('no axe violations with the More sheet open', async ({ page }) => {
  // The one piece of chrome that is not on screen by default. 390px so the
  // sheet's own breakpoint (<768px) applies.
  await page.setViewportSize({ width: 390, height: 780 })
  await page.goto('/law')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await page.getByRole('button', { name: 'More destinations' }).click()
  await expect(page.getByRole('button', { name: 'More destinations' })).toHaveAttribute(
    'aria-expanded',
    'true',
  )

  expect(format(await audit(page))).toEqual([])
})

/**
 * The command palette, empty and with results on screen, and the shortcuts
 * help sheet — none of the three is on screen in the default sweep above.
 * `Command.Dialog` wraps Radix Dialog (focus trap, `role="dialog"`,
 * Escape-to-close) and cmdk's own `Command.Input` supplies the ARIA 1.2
 * combobox wiring (`role="combobox"`, `aria-controls`, `aria-activedescend-
 * ant`) — this is what actually proves neither has a hole, in a browser axe
 * can evaluate `color-contrast` and focus order in.
 */
test('no axe violations on the command palette, empty and with results', async ({ page }) => {
  await page.goto('/law')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

  await page.getByRole('button', { name: 'Open command palette' }).first().click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('combobox')).toBeFocused()
  expect(format(await audit(page)), 'palette (empty)').toEqual([])

  await page.getByRole('combobox').fill('murder')
  await expect(page.getByRole('option').first()).toBeVisible({ timeout: 15_000 })
  expect(format(await audit(page)), 'palette (with results)').toEqual([])
})

test('no axe violations on the shortcuts help sheet', async ({ page }) => {
  await page.goto('/law')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

  await page.keyboard.press('?')
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible()
  expect(format(await audit(page))).toEqual([])
})

/**
 * The consent modal and the enabled AI surface, in both themes.
 *
 * Neither is on screen in the default state the sweep above audits: the modal
 * only opens on a click, and the coral AI banner only renders once a tier has
 * been chosen. Both are exactly the kind of surface where a contrast or a
 * focus-order defect hides, so each gets its own run.
 */
for (const theme of ['light', 'dark'] as const) {
  test(`no axe violations on the AI consent modal and banner in ${theme}`, async ({ page }) => {
    await setChrome(page, 'en', theme)
    await page.goto('/settings')
    await expect(page.getByRole('heading', { name: 'AI features' })).toBeVisible()

    await page.getByRole('button', { name: 'Read what this sends' }).click()
    await expect(page.getByRole('dialog', { name: 'Before you turn on AI' })).toBeVisible()
    expect(format(await audit(page)), `consent modal (${theme})`).toEqual([])

    await page.getByRole('button', { name: 'I have read this — enable AI' }).click()
    await page
      .getByRole('radiogroup', { name: 'How AI runs' })
      .getByRole('radio', { name: /Your own Anthropic key/ })
      .click()
    // The classified-content banner is now on screen, coral on its own tint.
    await expect(page.getByText(/Do not enter official, sensitive or classified/)).toBeVisible()

    expect(format(await audit(page)), `AI banner (${theme})`).toEqual([])
  })
}

/**
 * Onboarding steps 2 and 3 — neither is on screen from a bare `/onboarding`,
 * which the sweep above audits as step 1, so each gets its own run: step 2
 * once the Pay datasets have loaded behind the job/city pickers, step 3 with
 * the three-promise list.
 */
test('no axe violations on onboarding steps 2 and 3', async ({ page }) => {
  await page.goto('/onboarding')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByRole('combobox', { name: /Post/ })).toBeVisible({ timeout: 30_000 })
  expect(format(await audit(page)), 'onboarding step 2').toEqual([])

  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByRole('heading', { name: 'Before you begin' })).toBeVisible()
  expect(format(await audit(page)), 'onboarding step 3').toEqual([])
})
