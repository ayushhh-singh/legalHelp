import { readFileSync } from 'node:fs'

import type { Page } from '@playwright/test'

import { expect, LANGUAGES, setLanguage, t, test, type Language } from './fixtures'

/**
 * The eight journeys from the session brief, each run in BOTH languages and —
 * through `playwright.config.ts`'s project matrix — on both a desktop and a
 * phone viewport.
 *
 * These are deliberately not a second copy of `law.spec.ts`, `pay.spec.ts`,
 * `draft.spec.ts` and `learn.spec.ts`. Those specs assert the deep behaviour of
 * one module each, in English, on a desktop: the ranking of a search, the
 * figures on a pay slip, the XML inside a `.docx`. What was missing was the
 * cheap, broad question those cannot answer — *does the journey work at all in
 * Hindi, and does it work at all on a phone* — and that question is answered by
 * running one path through each module under all four combinations rather than
 * by asserting more deeply in one.
 *
 * Every label is read out of `src/i18n/{en,hi}.json` through `t()`. Hard-coding
 * the Hindi in the spec would create a second copy to drift from the
 * catalogue — and a renamed key would then silently assert against a string the
 * app no longer renders, which is worse than failing.
 *
 * The suite-wide privacy gate in `fixtures.ts` is armed for all of these
 * automatically: every one is also a test that the journey sends nothing.
 */

/**
 * Open a route with the language already applied, and wait for its own heading.
 *
 * The language is set from the header toggle on the route itself rather than
 * seeded into IndexedDB: the toggle is the control an officer uses, and setting
 * the preference behind the app's back would test a state the app can reach
 * only by a route no reader takes.
 */
/**
 * BNS 103's heading in each language: English is the Act's own text, Hindi is
 * the hand-curated overlay. Not an i18n key in either case.
 */
const MURDER: Record<Language, string> = {
  en: 'Punishment for murder.',
  hi: 'हत्या के लिए दण्ड।',
}

/**
 * `level` is 2 by default because most of these are SUB-TAB pages: since
 * ADR-046 `TabLayout` owns the section's `<h1>` and the page below it starts at
 * `<h2>`. A detail page — Settings' own index, for one — still owns its `<h1>`,
 * and passes 1.
 */
async function open(page: Page, language: Language, route: string, titleKey: string, level: 1 | 2 = 2) {
  await page.goto(route)
  await setLanguage(page, language)
  await expect(page.getByRole('heading', { level, name: t(language, titleKey) })).toBeVisible({
    timeout: 30_000,
  })
}

for (const language of LANGUAGES) {
  test.describe(`in ${language}`, () => {
    /* ---------------------------------------------------------------- *
     * 1. Law Converter — look a section up and copy the citation
     * ---------------------------------------------------------------- */
    test('looks up a section and copies its citation', async ({ page, context }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'])
      await open(page, language, '/law', 'pages.law.title')

      await page.getByLabel(t(language, 'law.search.label')).fill('302')

      // The heading is Act text, not a translation key — and in Hindi it is the
      // CURATED Hindi from `data/law/overlays/`, which is a different code path
      // from every other string on the page and carries its own "Verify" banner
      // (DATA-GAPS #18). Asserting it per language is what exercises that path.
      await expect(page.getByRole('heading', { name: MURDER[language] }).first()).toBeVisible({
        timeout: 30_000,
      })

      const copy = page.getByRole('button', { name: t(language, 'law.actions.copy') })
      await expect(copy).toBeVisible()
      await copy.click()

      // The confirmation is announced, not merely drawn — `SectionActions.tsx`
      // renders it into a `role="status"` live region.
      await expect(page.getByText(t(language, 'law.actions.copied'))).toBeVisible()

      const clipboard = await page.evaluate(() => navigator.clipboard.readText())
      expect(clipboard).toContain('103')
      expect(clipboard.length).toBeGreaterThan(10)
    })

    /* ---------------------------------------------------------------- *
     * 2. Pay — the IB ACIO-II slip
     * ---------------------------------------------------------------- */
    test('shows the IB ACIO-II pay slip with the same figures in either language', async ({ page }) => {
      await open(page, language, '/tools/salary?job=ib-acio-ii-executive&city=delhi&da=60', 'pages.pay.title')

      // Level 7, cell 1. The numerals are Latin in BOTH languages — a pay slip
      // is read as a column of figures and Devanagari digits would break the
      // `tabular-nums` alignment (ADR-018), so the SAME string is asserted in
      // both runs and that is the point of asserting it here rather than in
      // pay.spec.ts, which only ever sees English.
      await expect(page.getByText('₹44,900').first()).toBeVisible({ timeout: 30_000 })
      await expect(page.getByText('₹8,980').first()).toBeVisible() // 20% SSA
      await expect(page.getByText('₹1,00,050').first()).toBeVisible() // gross

      await expect(page.getByText(/[०-९]/)).toHaveCount(0)
    })

    /* ---------------------------------------------------------------- *
     * 3. Drafting — open the O.M. and see the live preview follow a keystroke
     * ---------------------------------------------------------------- */
    test('opens the Office Memorandum and previews what is typed', async ({ page, network }) => {
      await page.goto('/draft/documents')
      await setLanguage(page, language)
      /*
        `/draft/new/<type>` creates the document and opens the editor — the one
        way in since ADR-046 removed the Session 8 form-and-preview editor. The
        journey is the same one an officer takes from the New tab.
      */
      await page.goto('/draft/new/office-memorandum')
      await expect(page).toHaveURL(/\/draft\/d\//, { timeout: 30_000 })

      // The editor's own tabs are what say it has loaded.
      await expect(page.getByRole('tab', { name: /^Write|^लिखें/ })).toBeVisible({ timeout: 30_000 })

      const subject = network.sentinel('om-subject')
      await page.getByRole('tab', { name: /^Details|^विवरण/ }).click()
      await page
        .getByLabel(/^Subject|^विषय/)
        .first()
        .fill(subject)

      // The A4 preview is the point of the editor: what was typed has to be on
      // the page immediately, with no save step.
      await page.getByRole('tab', { name: /^Preview|^पूर्वावलोकन/ }).click()
      await expect(page.getByText(subject).last()).toBeVisible()
    })

    /* ---------------------------------------------------------------- *
     * 4. Trainer — grade one card and watch the queue move
     * ---------------------------------------------------------------- */
    test('grades a card and the queue moves on', async ({ page }) => {
      await open(page, language, '/study/practise', 'pages.learn.title')

      const start = page.getByRole('link', { name: t(language, 'trainer.home.startReview') })
      await expect(start).toBeVisible({ timeout: 30_000 })
      await start.click()

      await expect(page).toHaveURL(/\/study\/practise\/review/)

      // The first card a fresh device shows is CCS (Conduct) Rule 1 — a `rule`
      // card, which is open recall: reveal, then grade. `learn.spec.ts` asserts
      // that card by name in English; what this adds is that the whole loop
      // works with the interface in Hindi.
      const reveal = page.getByRole('button', { name: t(language, 'trainer.card.showAnswer') })
      await expect(reveal).toBeVisible({ timeout: 30_000 })
      await reveal.click()

      // A plain string, not a RegExp built from the catalogue: Playwright matches
      // a string name as a case-insensitive SUBSTRING, which is what is wanted
      // here (the button appends its interval hint), and none of the four grade
      // labels is a substring of another in either language. Interpolating a
      // catalogue value into a pattern would make a label containing a regex
      // metacharacter silently match the wrong thing.
      const good = page.getByRole('button', { name: t(language, 'trainer.grade.Good') })
      await expect(good).toBeVisible()
      await good.click()

      // Either the next card is up, or the session is finished — both are the
      // queue having moved. Asserting a specific next card would pin this to
      // whatever `data/rules` happens to serve second.
      await expect(
        page
          .getByRole('button', { name: t(language, 'trainer.card.showAnswer') })
          .or(page.getByText(t(language, 'trainer.review.sessionComplete')))
          .first(),
      ).toBeVisible({ timeout: 30_000 })
    })

    /* ---------------------------------------------------------------- *
     * 5. Utilities — all four tools answer
     * ---------------------------------------------------------------- */
    test('answers in the holiday calendar', async ({ page }) => {
      await open(page, language, '/tools/holidays', 'utils.holidays.title')
      await expect(page.getByText(t(language, 'utils.holidays.gazettedListTitle'))).toBeVisible({
        timeout: 30_000,
      })
      await expect(page.getByRole('button', { name: t(language, 'utils.holidays.exportIcs') })).toBeVisible()
    })

    test('computes a leave balance', async ({ page }) => {
      await open(page, language, '/tools/leave', 'utils.leave.title')

      await page.getByLabel(t(language, 'utils.leave.doj')).fill('2020-01-01')
      await page.getByLabel(t(language, 'utils.leave.asOf')).fill('2026-01-01')

      // Six full years at 2.5 days a month is 180 days of Earned Leave, under
      // the 300-day cap — a figure worked out from Rule 27 rather than read off
      // a run of the code.
      // `exact` matters: the page subtitle names all four kinds of leave in one
      // sentence, so a substring match finds six elements and none of them is
      // the balance card.
      await expect(
        page.getByRole('heading', { name: t(language, 'utils.leave.el'), exact: true }),
      ).toBeVisible()
      await expect(page.getByText('180', { exact: false }).first()).toBeVisible()
    })

    test('computes a superannuation date', async ({ page }) => {
      await open(page, language, '/tools/pension', 'utils.pension.title')

      // Born on the 1st: FR 56(a) retires such an officer at the end of the
      // PRECEDING month, so 1 August 1966 + 60 gives 31 July 2026, not 31
      // August. The one edge case worth driving through the real UI.
      await page.getByLabel(t(language, 'utils.pension.dob')).fill('1966-08-01')
      await expect(
        page.getByText(t(language, 'utils.pension.superannuationDate'), { exact: true }),
      ).toBeVisible()
      // 31 July 2026, not 31 August: age in law is attained the day BEFORE the
      // birth anniversary, so an officer born on the 1st retires at the end of
      // the preceding month (`superannuationDate()` gets this from one formula
      // rather than a special case — ADR-026).
      await expect(page.getByText('2026-07-31', { exact: true })).toBeVisible()
    })

    test('finds a portal and copies its URL out loud', async ({ page, context }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'])
      await open(page, language, '/tools/portals', 'utils.portals.title')

      await page.getByLabel(t(language, 'utils.portals.searchLabel')).fill('CGHS')
      const copy = page.getByRole('button', { name: t(language, 'utils.portals.copyUrl') }).first()
      await expect(copy).toBeVisible({ timeout: 30_000 })
      await copy.click()

      // The copy used to be announced by nothing at all — the button swapped an
      // `aria-hidden` icon and said nothing. This is the regression guard for
      // the live region that fixed it.
      await expect(page.getByText(t(language, 'utils.portals.copied'))).toBeVisible()
      expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('http')
    })

    /* ---------------------------------------------------------------- *
     * 6. Onboarding
     * ---------------------------------------------------------------- */
    test('walks through onboarding and lands in the app', async ({ page }) => {
      /*
        The language is set from a TAB route: `/onboarding` is a focus route
        (ADR-046) and renders no app top bar, deliberately — a reader halfway
        through a three-step flow has nowhere useful to navigate to.
      */
      await page.goto('/home')
      await setLanguage(page, language)
      await page.goto('/onboarding')
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

      await expect(page.getByText(t(language, 'onboarding.step1.title'))).toBeVisible()
      await page.getByRole('button', { name: t(language, 'onboarding.continue') }).click()

      await expect(page.getByText(t(language, 'onboarding.step2.title'))).toBeVisible()
      await page.getByRole('button', { name: t(language, 'onboarding.continue') }).click()

      // The three promises. They are the reason a reader is asked to trust this
      // app with nothing, so they are asserted by their own strings.
      await expect(page.getByText(t(language, 'onboarding.step3.onDevice'))).toBeVisible()
      await expect(page.getByText(t(language, 'onboarding.step3.noAccounts'))).toBeVisible()
      await expect(page.getByText(t(language, 'onboarding.step3.noAnalytics'))).toBeVisible()

      await page.getByRole('button', { name: t(language, 'onboarding.understood') }).click()
      await expect(page).not.toHaveURL(/onboarding/)

      // And it does not come back: a bare `/` on a device that has finished
      // onboarding goes to the app, not round again.
      await page.goto('/')
      await expect(page).not.toHaveURL(/onboarding/)
    })

    /* ---------------------------------------------------------------- *
     * 7. Settings — export, then erase
     * ---------------------------------------------------------------- */
    test('exports a backup and then erases everything', async ({ page }) => {
      // Something to export, so the assertions are about real rows rather than
      // an empty file: a saved section and a language preference.
      await page.goto('/law?q=302&code=bns')
      await setLanguage(page, language)
      await expect(page.getByRole('heading', { name: MURDER[language] }).first()).toBeVisible({
        timeout: 30_000,
      })
      await page.getByRole('button', { name: t(language, 'law.actions.favourite') }).click()

      // Export and erase are one page since ADR-046, deliberately: the one
      // thing somebody about to erase everything should have in front of them
      // is the control that exports it first.
      await open(page, language, '/settings/backup', 'pages.settings.backup.title', 1)

      const download = page.waitForEvent('download')
      await page.getByRole('button', { name: t(language, 'pages.settings.backup.export') }).click()
      const file = await download

      // A real file, named for this app, holding this device's own rows.
      expect(file.suggestedFilename()).toMatch(/sahayak.*\.json$/)
      const path = await file.path()
      const backup = JSON.parse(readFileSync(path, 'utf8')) as { tables?: Record<string, unknown[]> }

      expect(backup.tables, 'the backup carries no tables at all').toBeDefined()
      expect(Object.keys(backup.tables ?? {})).toContain('lawFavourites')
      // The AI key vault and the answer cache are excluded BY NAME, and that is
      // a privacy property rather than a size one: a backup an officer mails to
      // themselves must not carry their API key (src/lib/backup.ts).
      for (const excluded of ['secrets', 'aiAnswers', 'aiUsage']) {
        expect(Object.keys(backup.tables ?? {}), `${excluded} is in the backup`).not.toContain(excluded)
      }

      // ---- erase ----------------------------------------------------------
      const confirm = page.getByLabel(
        t(language, 'pages.settings.erase.confirmLabel').replace('{{word}}', 'ERASE'),
      )
      const eraseButton = page.getByRole('button', { name: t(language, 'pages.settings.erase.action') })

      // Gated: the button does nothing until the word is typed exactly. This is
      // the one irreversible action in the app, so it earns the friction a
      // destructive git command would get.
      await expect(eraseButton).toBeDisabled()
      await confirm.fill('erase please')
      await expect(eraseButton).toBeDisabled()
      await confirm.fill('ERASE')
      await expect(eraseButton).toBeEnabled()
      await eraseButton.click()

      // The proof is where the reload lands. `App.tsx` sends a bare `/` to
      // onboarding only on a device that has never completed or skipped it —
      // so arriving there means the `onboarded` row really is gone, which no
      // amount of reading the erase function's return value would show.
      await expect(page).toHaveURL(/\/onboarding/, { timeout: 30_000 })
      await expect(page.getByText(t('en', 'onboarding.step1.title'))).toBeVisible()
    })
  })
}
