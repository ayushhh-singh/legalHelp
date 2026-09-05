import { audit, expect, formatViolations, onPhone, setLanguage, t, test } from './fixtures'

/**
 * The reader and the document editor as FOCUS screens (Session 35).
 *
 * These are the claims a jsdom test cannot make. Three kinds:
 *
 * 1. **A preference set in the bar survives a reload.** The "Aa" tray writes to
 *    IndexedDB, and the only way to know a write landed is to throw the page
 *    away and come back to it.
 * 2. **The phone's presentations are real.** `hidden lg:block` hides nothing in
 *    jsdom, so both the desktop rail and the mobile sheet are in that tree at
 *    once and neither can be asserted about. Here the CSS applies.
 * 3. **Escape out of the editor lands where the officer came from, with their
 *    work saved.** Both halves of that are browser behaviour — history, an
 *    unmount flush, and a real IndexedDB.
 *
 * The network gate is automatic (`test` comes from `./fixtures`), so each of
 * these is also an assertion that nothing typed here left the device.
 */

const WORK = 'ccs-conduct'
const UNIT = 'ccs-conduct-3'

/**
 * "Size 2 of 4", from the catalogue rather than typed here.
 *
 * `t()` deliberately does no interpolation — it reads a string out of the JSON
 * so a RENAMED key fails rather than silently asserting a stale literal — so
 * the one placeholder is filled in here. Writing "Size 4 of 4" by hand would
 * put the English wording in a second place and lose exactly that property.
 */
const sizeStep = (step: number) => t('en', 'library.type.sizeNow').replace('{{step}}', String(step))

test.describe('the reader', () => {
  test('the “Aa” tray sets the text size, and the size survives a reload', async ({ page }) => {
    await page.goto(`/study/read/${WORK}/${UNIT}`)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

    const aa = page.getByRole('button', { name: t('en', 'library.type.label'), exact: true })
    await aa.click()

    // The step is announced rather than only drawn, so it is also what a test
    // can read: an icon pair with dots between them says nothing.
    const step = page.getByText(sizeStep(2))
    await expect(step).toBeVisible()

    await page.getByRole('button', { name: t('en', 'library.type.larger') }).click()
    await page.getByRole('button', { name: t('en', 'library.type.larger') }).click()
    await expect(page.getByText(sizeStep(4))).toBeVisible()

    /*
      The reload is the point. Everything above happens in one page's memory;
      only a fresh document proves the Dexie write landed — and the tray is
      opened again, because the size it shows has to come back from storage
      rather than from the state that set it.
    */
    await page.reload()
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await page.getByRole('button', { name: t('en', 'library.type.label'), exact: true }).click()
    await expect(page.getByText(sizeStep(4))).toBeVisible()
  })

  test('the study rail comes back on the tab it was left on', async ({ page }) => {
    await page.goto(`/study/read/${WORK}/${UNIT}`)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

    if (onPhone(page)) {
      await page.getByRole('button', { name: t('en', 'library.railTabs.open') }).click()
    }
    const related = page.getByRole('tab', { name: t('en', 'library.railTabs.related') })
    await related.click()
    await expect(related).toHaveAttribute('aria-selected', 'true')

    await page.reload()
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    if (onPhone(page)) {
      await page.getByRole('button', { name: t('en', 'library.railTabs.open') }).click()
    }
    await expect(page.getByRole('tab', { name: t('en', 'library.railTabs.related') })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  test('the study panel is a sheet on a phone and a column on a desktop', async ({ page }) => {
    await page.goto(`/study/read/${WORK}/${UNIT}`)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

    const open = page.getByRole('button', { name: t('en', 'library.railTabs.open') })

    if (onPhone(page)) {
      // A rail below a 4,000-character provision is a rail nobody scrolls to,
      // so on a phone it is a floating button and a sheet over the page.
      await expect(open).toBeVisible()
      await open.click()
      await expect(page.getByRole('button', { name: t('en', 'library.railTabs.close') })).toBeVisible()
      await expect(page.getByRole('tab', { name: t('en', 'library.railTabs.understand') })).toBeVisible()
    } else {
      // Beside the text, so there is nothing to open.
      await expect(open).toBeHidden()
      await expect(page.getByRole('tab', { name: t('en', 'library.railTabs.understand') })).toBeVisible()
    }
  })

  test('the ⋯ menu and the “Aa” tray both pass axe, in Hindi and in the dark', async ({ page }) => {
    /*
      The route sweep in `a11y.spec.ts` covers this page at rest, in both
      languages and both themes. What it cannot reach is the two overlays: a
      popover that is `hidden` until it is pressed is invisible to a sweep that
      only loads the route. Both are swept here in the harder of the four
      combinations rather than all four, because the tokens are what decide
      contrast and `src/styles/tokens.test.ts` asserts those in both themes.
    */
    await page.goto(`/study/read/${WORK}/${UNIT}`)
    await setLanguage(page, 'hi')

    // Dark, from the ⋯ menu — which at this level is the only place the theme
    // toggle exists, because the app's top bar is hidden here.
    await page.getByRole('button', { name: t('hi', 'a11y.moreActions') }).click()
    await page.getByRole('button', { name: t('hi', 'a11y.toggleTheme') }).click()
    await expect(page.locator('html')).toHaveClass(/dark/)

    await page.getByRole('button', { name: t('hi', 'library.type.label'), exact: true }).click()
    expect(formatViolations(await audit(page)), 'the Aa tray').toEqual([])

    // Escape shuts the tray and NOT the route: the popover stops the press in
    // the capture phase, which is the "two Escape handlers on one press" rule
    // ADR-029's addendum records and this project has now hit three times.
    await page.keyboard.press('Escape')
    await expect(page).toHaveURL(new RegExp(`/study/read/${WORK}/${UNIT}$`))

    await page.getByRole('button', { name: t('hi', 'a11y.moreActions') }).click()
    expect(formatViolations(await audit(page)), 'the ⋯ menu').toEqual([])
  })
})

test.describe('the document editor', () => {
  test('opened from the register, Escape goes back to it with the edit saved', async ({ page, network }) => {
    test.setTimeout(120_000)
    const typed = network.sentinel('reply')

    // A document to find. The register lists what was ISSUED, so the document
    // has to have a number before it appears there.
    await page.goto('/settings/numbering')
    await page.getByRole('button', { name: /Add a scheme/ }).click()
    await page.getByLabel(/What you call it/).fill('Establishment')
    await page.getByLabel(/^Pattern$/).fill('A-11011/{SEQ}/{YEAR}-{SECTION}')
    await page.getByLabel(/^Section$/).fill('Estt.')
    await page
      .getByRole('button', { name: /^Save$/ })
      .first()
      .click()
    await expect(page.getByRole('listitem').filter({ hasText: 'Establishment' })).toHaveCount(1)

    await page.goto('/draft/new/office-memorandum')
    await expect(page).toHaveURL(/\/draft\/d\/[0-9a-f]{18}/)
    const documentUrl = page.url()

    await page.getByRole('button', { name: /More actions/ }).click()
    await page
      .locator('#focus-actions')
      .getByText(/Issue number/)
      .click()
    await page.getByRole('button', { name: /Issue number/ }).click()
    await expect(page.getByLabel(/Reference number/)).toHaveValue(/A-11011\/1\/\d{4}-Estt\./)

    // …now open it FROM the register, which is what makes the chevron pop
    // history rather than push the declared parent (ADR-046 §5).
    await page.goto('/draft/register')
    // Named, not "the level-2 heading": the register has two (its own masthead
    // and the Follow-ups card), which is the ordinary shape of a sub-tab page
    // now that `TabLayout` owns the section's `<h1>`.
    await expect(page.getByRole('heading', { level: 2, name: /Correspondence register/ })).toBeVisible()
    await expect(page.getByText(/A-11011\/1\/\d{4}-Estt\./).first()).toBeVisible()
    // The row's "open the document" control is an icon, so it is found by the
    // accessible name rather than by the number printed beside it.
    await page
      .getByRole('link', { name: /Open the document/ })
      .first()
      .click()
    await expect(page).toHaveURL(documentUrl)

    // The chevron names where it goes, and where it goes is the register.
    await expect(page.getByRole('button', { name: /Register/ })).toBeVisible()

    const editor = page.getByRole('textbox', { name: 'Document body' })
    await editor.click()
    await page.keyboard.press('End')
    await page.keyboard.type(` ${typed}`)
    await expect(editor).toContainText(typed)

    /*
      TWO presses of Escape, and the first one is the point.

      `FocusLayout` will not leave a screen while the caret is in an editable
      element, and in this editor it almost always is — so the first Escape
      takes the caret OUT of the document (an ordinary editor idiom; nothing is
      changed) and the second one leaves. One press would either be unreachable
      from the keyboard or would throw an officer out mid-sentence.
    */
    await page.keyboard.press('Escape')
    await expect(editor).not.toBeFocused()
    await page.keyboard.press('Escape')

    /*
      And it lands on the REGISTER, not on the document list.

      That is the history branch of `useBackTo` (ADR-046 §5) — which needed the
      register's own row to be an `AppLink`, and was not: every link into the
      editor was a plain `<Link>`, so the branch this app built for exactly this
      journey could not fire from anywhere.

      The write is debounced, so the assertion after it is that the unmount
      FLUSH landed it — a guard that navigated away and lost the last sentence
      would look identical on screen.
    */
    await expect(page).toHaveURL(/\/draft\/register$/)

    /*
      Poll IndexedDB, in this page, BEFORE navigating.

      The flush is an asynchronous Dexie write started by an unmount, and
      `page.goto` tears down the JavaScript context — on the Pixel 7 project the
      reload beat the write and reported "the sentence is gone", which is what a
      genuinely broken guard would also look like. Waiting on the STORE rather
      than on a screen keeps the claim exact: the flush landed the last
      sentence, and only then is it read back through the editor.
    */
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            new Promise<string>((resolve) => {
              const open = indexedDB.open('sahayak')
              open.onerror = () => resolve('')
              open.onsuccess = () => {
                const database = open.result
                const rows = database.transaction('documents').objectStore('documents').getAll()
                rows.onsuccess = () => {
                  resolve(JSON.stringify(rows.result))
                  database.close()
                }
                rows.onerror = () => resolve('')
              }
            }),
        ),
      )
      .toContain(typed)

    await page.goto(documentUrl)
    await expect(page.getByRole('textbox', { name: 'Document body' })).toContainText(typed)
  })

  test('the outline lists the spine and jumps into it', async ({ page }) => {
    test.skip(onPhone(page), 'the outline column is a desktop affordance; the phone has three tabs')

    await page.goto('/draft/new/office-memorandum')
    await expect(page).toHaveURL(/\/draft\/d\//)
    const editor = page.getByRole('textbox', { name: 'Document body' })
    await expect(editor).toBeVisible()

    // Write a spine: a heading, some prose under it, and a second heading.
    await page.locator('.draft-placeholder').first().click()
    await page.keyboard.press('Backspace')
    await page.keyboard.type('The first submission.')
    await page.keyboard.press('Enter')
    await page.keyboard.type('The second submission.')

    const outline = page.getByRole('navigation', { name: 'Outline' })
    await expect(outline.getByRole('listitem')).toHaveCount(2)

    // Pressing an entry puts the caret in that block, which is the difference
    // between an outline and a list of what the document happens to say.
    await outline.getByRole('button', { name: /^The first submission\.$/ }).click()
    await expect(editor).toBeFocused()
    await page.keyboard.type('X')
    await expect(editor).toContainText('XThe first submission.')
  })

  test('the phone gets Write, Preview and Check, and a desktop gets all three columns', async ({ page }) => {
    await page.goto('/draft/new/office-memorandum')
    await expect(page).toHaveURL(/\/draft\/d\//)
    await expect(page.getByRole('textbox', { name: 'Document body' })).toBeVisible()

    const phoneStrip = page.getByRole('tab', { name: t('en', 'draft.view.panel') })
    const outline = page.getByRole('navigation', { name: 'Outline' })

    if (onPhone(page)) {
      await expect(phoneStrip).toBeVisible()
      await expect(outline).toBeHidden()
      // "Check" swaps the panel in for the document, and back.
      await phoneStrip.click()
      await expect(page.getByRole('tablist', { name: 'About this document' })).toBeVisible()
      await page.getByRole('tab', { name: t('en', 'draft.view.write') }).click()
      await expect(page.getByRole('textbox', { name: 'Document body' })).toBeVisible()
    } else {
      await expect(phoneStrip).toBeHidden()
      await expect(outline).toBeVisible()
      // The panel is beside the document, not instead of it.
      await expect(page.getByRole('tablist', { name: 'About this document' })).toBeVisible()
      await expect(page.getByRole('textbox', { name: 'Document body' })).toBeVisible()
    }
  })
})
