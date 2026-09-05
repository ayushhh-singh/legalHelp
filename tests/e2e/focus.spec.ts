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

/** The unit's action row, which on a phone is also the way into the rail. */
const actions = (page: import('@playwright/test').Page) =>
  page.getByRole('group', { name: t('en', 'library.reader.actions') })

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
      await actions(page)
        .getByRole('button', { name: t('en', 'library.reader.railShow') })
        .click()
    }
    const related = page.getByRole('tab', { name: t('en', 'library.railTabs.related') })
    await related.click()
    await expect(related).toHaveAttribute('aria-selected', 'true')

    await page.reload()
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    if (onPhone(page)) {
      await actions(page)
        .getByRole('button', { name: t('en', 'library.reader.railShow') })
        .click()
    }
    await expect(page.getByRole('tab', { name: t('en', 'library.railTabs.related') })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  test('the study panel is a sheet on a phone and a column on a desktop', async ({ page }) => {
    await page.goto(`/study/read/${WORK}/${UNIT}`)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

    const open = actions(page).getByRole('button', { name: t('en', 'library.reader.railShow') })

    if (onPhone(page)) {
      // A rail below a 4,000-character provision is a rail nobody scrolls to,
      // so on a phone it is a sheet, opened from the action row.
      await expect(page.getByRole('tab', { name: t('en', 'library.railTabs.understand') })).toBeHidden()
      await open.click()
      await expect(page.getByRole('button', { name: t('en', 'library.railTabs.close') })).toBeVisible()
      await expect(page.getByRole('tab', { name: t('en', 'library.railTabs.understand') })).toBeVisible()
    } else {
      // Beside the text already, so the control hides it rather than opens it.
      await expect(page.getByRole('tab', { name: t('en', 'library.railTabs.understand') })).toBeVisible()
      await expect(open).toHaveCount(0)
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

/**
 * The edge-case pass (ADR-047's addendum).
 *
 * Every test in this block was confirmed to FAIL against the commit that
 * introduced the screens it is about, before its fix was written. The family is
 * one sentence: **an overlay is something the officer is INSIDE, and this
 * session added five of them without asking what happens at their edges.**
 */
test.describe('the editor’s outline', () => {
  test('ignores a drop that is not one of its own rows', async ({ page }) => {
    test.skip(onPhone(page), 'the outline column is a desktop affordance')
    /*
      `onDrop` read `text/plain` as a row index — and `text/plain` is what every
      drag in the world carries, so dragging the character "1" out of the
      document, or in from another application, silently reordered an officer's
      paragraphs. In a browser, because jsdom has no `DataTransfer` and a test
      written there fails with a `ReferenceError` whatever the code does.
    */
    await page.goto('/draft/new/office-memorandum')
    await expect(page.getByRole('textbox', { name: 'Document body' })).toBeVisible()
    await page.locator('.draft-placeholder').first().click()
    await page.keyboard.press('Backspace')
    await page.keyboard.type('First point.')
    await page.keyboard.press('Enter')
    await page.keyboard.type('Second point.')

    const outline = page.getByRole('navigation', { name: 'Outline' })
    await expect(outline.getByRole('listitem')).toHaveCount(2)
    const before = await outline.getByRole('listitem').allInnerTexts()

    const drop = (type: string, value: string) =>
      outline
        .getByRole('listitem')
        .first()
        .evaluate(
          (element, payload) => {
            const data = new DataTransfer()
            data.setData(payload.type, payload.value)
            element.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: data }))
          },
          { type, value },
        )

    await drop('text/plain', '1')
    await page.waitForTimeout(300)
    expect(await outline.getByRole('listitem').allInnerTexts()).toEqual(before)

    // …and the outline's OWN drag still reorders, so this is a guard rather
    // than a feature that stopped working.
    await drop('application/x-sahayak-outline', '1')
    await expect.poll(() => outline.getByRole('listitem').allInnerTexts()).not.toEqual(before)
  })
})

test.describe('the reader’s overlays', () => {
  /** Select the first few words of a paragraph — the case that goes off-screen. */
  async function selectFromTheMargin(page: import('@playwright/test').Page, chars = 40) {
    /*
      `[data-para-start]` — the provision's own paragraphs, which is also the
      one thing `src/modules/library/selection.ts` maps a DOM range against.
      A plain `p` under the card matches the hint inside the highlight tray too,
      which is `hidden` and would make this wait 30s for the wrong element.
    */
    const para = page.locator('[data-para-start]').first()
    await expect(para).toBeVisible()
    const box = (await para.boundingBox())!
    await page.mouse.move(box.x + 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + chars, box.y + box.height / 2, { steps: 8 })
    await page.mouse.up()
  }

  test('the selection toolbar stays inside the viewport at the left margin', async ({ page }) => {
    /*
      THE ONE A READER REPORTED. `anchor()` clamped `top` at both ends and never
      touched `left`, and the toolbar is `translateX(-50%)` about the middle of
      the selection — so marking the first two words of a provision put the
      whole colour row at x = -91 and the first swatch entirely off the screen.
      Highlighting "did not work" because the control was not reachable.
    */
    await page.goto('/study/read/bns/1')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await selectFromTheMargin(page)

    const toolbar = page.getByRole('toolbar', { name: /What to do with/ })
    await expect(toolbar).toBeVisible()
    const box = (await toolbar.boundingBox())!
    const viewport = page.viewportSize()!
    expect(box.x, 'the toolbar starts off the left edge').toBeGreaterThanOrEqual(0)
    expect(box.x + box.width, 'the toolbar runs off the right edge').toBeLessThanOrEqual(viewport.width)

    // …and every control in it can actually be pressed.
    for (const control of await toolbar.getByRole('button').all()) {
      const swatch = (await control.boundingBox())!
      expect(swatch.x).toBeGreaterThanOrEqual(0)
      expect(swatch.x + swatch.width).toBeLessThanOrEqual(viewport.width)
    }
  })

  test('a selection does not survive a jump to another provision', async ({ page }) => {
    /*
      The DOM selection outlives the navigation, because React reuses the
      paragraph nodes — so after `j` the browser still reports a range, mapped
      on to WHATEVER words now occupy those nodes. The floating toolbar and the
      action row both offered to highlight it, and the stored quote was words
      the officer never marked, in a provision they had just left.
    */
    await page.goto('/study/read/bns/1')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await selectFromTheMargin(page, 120)
    await expect(page.getByRole('toolbar', { name: /What to do with/ })).toBeVisible()

    await page.keyboard.press('j')
    await expect(page).toHaveURL(/\/study\/read\/bns\/2$/)

    // Nothing is selected on the provision the reader is now looking at.
    await expect(page.getByRole('toolbar', { name: /What to do with/ })).toHaveCount(0)
    const group = page.getByRole('group', { name: 'What to do with this provision' })
    await group.getByRole('button', { name: /^Highlight/ }).click()
    await expect(
      group.getByRole('group', { name: 'Highlights' }).getByRole('button', { name: 'Yellow' }),
    ).toBeDisabled()
  })

  test('the unit switcher closes when the reader presses the page behind it', async ({ page }) => {
    test.skip(onPhone(page), 'the study rail used to dismiss it is a sheet on a phone')
    /*
      It had an Escape handler and nothing else, so the list stayed open over
      the provision — and being an overlay, it swallowed the press meant for the
      text underneath. Every other menu in this app closes on an outside
      pointer-down.
    */
    await page.goto('/study/read/bns/1')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

    const switcher = page.getByRole('button', { name: /Go to another provision/ })
    await switcher.click()
    await expect(switcher).toHaveAttribute('aria-expanded', 'true')

    await page.getByRole('tab', { name: t('en', 'library.railTabs.related') }).click()
    await expect(switcher).toHaveAttribute('aria-expanded', 'false')
  })

  test('Escape closes an open tray whatever has focus, and does not leave the page', async ({ page }) => {
    /*
      An overlay that tells `FocusLayout` to stand down (`data-focus-overlay`)
      has to handle the press ITSELF, unconditionally. `Popover` only handled
      Escape when the event target was inside it, so with focus anywhere else
      the press did nothing at all: the tray was stuck open AND the route could
      not be left. Suppressing a global control and then not replacing it is
      worse than not suppressing it.
    */
    await page.goto('/study/read/bns/1')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

    const aa = page.getByRole('button', { name: t('en', 'library.type.label'), exact: true })
    await aa.click()
    await expect(aa).toHaveAttribute('aria-expanded', 'true')

    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.keyboard.press('Escape')

    await expect(aa).toHaveAttribute('aria-expanded', 'false')
    await expect(page).toHaveURL(/\/study\/read\/bns\/1$/)
  })
})
