import {
  editorMenu,
  openDetails,
  panelTab,
  showDocument,
  showExport,
  showPreview,
  tab,
} from './editor-helpers'
import { audit, expect, formatViolations, onPhone, setLanguage, test } from './fixtures'

/**
 * The document editor, in a real browser.
 *
 * The first test is the brief's own acceptance run and is deliberately ONE
 * test: create an Office Memorandum from the form library, fill the
 * placeholders the skeleton left, issue a reference number, save a version,
 * edit the document, diff the version against what is on screen, and restore
 * it. A restore proved in a test of its own proves nothing about a restore
 * after a real edit.
 *
 * The network gate is automatic — `test` comes from `./fixtures` — so every one
 * of these runs also asserts that nothing the officer typed left the device.
 * That is the whole promise the Drafting Studio makes, and it now covers an
 * editor as well as a form.
 */

const BODY = 'Document body'

test.describe('the document editor', () => {
  test('create → fill → issue a number → save a version → edit → diff → restore', async ({
    page,
    network,
  }) => {
    /*
      An explicit budget, for the reason `a11y.spec.ts`'s route sweep and
      `offline.spec.ts`'s carry one: this is ONE test doing a dozen things —
      four navigations, two documents' worth of typing, an issue, a version, a
      diff and a restore — and the default 30s is a ceiling on the whole
      journey, not on any step of it. It runs in about 12s on an idle machine
      and timed out twice at the "Issue number" step with four workers
      competing. An intermittent failure that passes in isolation is a budget,
      not a defect (CLAUDE.md); every `expect` below keeps its own default, so a
      step that genuinely never happens still fails fast and by name.
    */
    test.setTimeout(120_000)

    const typed = network.sentinel('body')

    // ---- a numbering scheme, so "Issue number" has something to issue -----
    await page.goto('/settings/numbering')
    await page.getByRole('button', { name: /Add a scheme|योजना जोड़ें/ }).click()
    await page.getByLabel(/What you call it|आप इसे क्या कहते हैं/).fill('Establishment')
    const patternBox = page.getByLabel(/^Pattern$|^पैटर्न$/)
    await patternBox.fill('A-11011/{SEQ}/{YEAR}-{SECTION}')
    await page.getByLabel(/^Section$|^अनुभाग$/).fill('Estt.')
    await expect(page.getByText(/Next number will be A-11011\/1\/\d{4}-Estt\./)).toBeVisible()
    await page
      .getByRole('button', { name: /^Save$|^सहेजें$/ })
      .first()
      .click()

    /*
      Wait for the row to appear in the list before navigating away.

      A Dexie write does not finish before the click that started it returns —
      CLAUDE.md records this costing a Library test a failure reported two
      screens away ("My Study shows no entry" rather than "the write was cut
      off"). Here it would have surfaced as "Issue number is not on the page",
      which is exactly as misleading. Wait on the app's own confirmation.
    */
    await expect(page.getByRole('listitem').filter({ hasText: 'Establishment' })).toHaveCount(1)

    // ---- create an Office Memorandum from the library ---------------------
    await page.goto('/draft/new/office-memorandum')
    await expect(page).toHaveURL(/\/draft\/d\/[0-9a-f]{18}/)
    const documentUrl = page.url()

    // The skeleton left a chip where the officer has to say something.
    const editor = page.getByRole('textbox', { name: BODY })
    await expect(editor).toBeVisible()
    await expect(editor).toContainText('{{mainPoint}}')

    // ---- fill the placeholder ---------------------------------------------
    // Select the chip and type over it: a placeholder is an inline atom, so one
    // keypress replaces the whole thing rather than half of it.
    await page.locator('.draft-placeholder').first().click()
    await page.keyboard.press('Backspace')
    await page.keyboard.type(`It is hereby clarified that ${typed} is admissible.`)
    await expect(editor).not.toContainText('{{mainPoint}}')

    // Typing continues where the caret is — the editor is uncontrolled, and a
    // component that re-seeded itself on every keystroke would put this second
    // run at the end of the document instead. jsdom cannot see this at all
    // (`Range.getClientRects` is absent there), which is why the claim is here.
    await page.keyboard.type(' Further orders will follow.')
    await expect(editor).toContainText(`${typed} is admissible. Further orders will follow.`)

    // ---- the details, and the number --------------------------------------
    await openDetails(page)
    await page.getByLabel(/^Subject$/).fill('Children Education Allowance — clarification')
    await page.getByRole('button', { name: /Issue number|संख्या जारी करें/ }).click()
    await expect(page.getByLabel(/Reference number|संदर्भ संख्या/)).toHaveValue(/A-11011\/1\/\d{4}-Estt\./)

    // ---- save a version ----------------------------------------------------
    await panelTab(page, 'Versions')
    await page.getByLabel(/What is this version|यह संस्करण क्या है/).fill('before the second para')
    await page.getByRole('button', { name: /Save this version|यह संस्करण सहेजें/ }).click()
    // Scoped to the list: the label also appears in the two compare selects.
    const versionList = page.getByRole('listitem').filter({ hasText: 'before the second para' })
    await expect(versionList).toHaveCount(1)

    // ---- edit ---------------------------------------------------------------
    // Beside the panel on a desktop (outline, document, panel); behind the
    // strip's "Write" on a phone.
    if (onPhone(page)) await showDocument(page)
    await page.locator('.draft-editor-surface p').last().click()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.type('This supersedes the earlier clarification.')
    await expect(editor).toContainText('This supersedes the earlier clarification.')

    // ---- diff --------------------------------------------------------------
    await panelTab(page, 'Versions')
    await page
      .getByRole('button', { name: /^Compare$|^तुलना करें$/ })
      .first()
      .click()
    /*
      Scoped to the right-hand panel BY ID. On a desktop the document is on
      screen beside it and the sentence being diffed is in both, so an unscoped
      match resolves to two elements — and `getByRole('tabpanel')` is two as
      well, because the middle column is one too (it is what the phone's strip
      swaps). The id is the only thing that names this one panel.
    */
    await expect(
      page.locator('#draft-panel-body').getByText('This supersedes the earlier clarification.'),
    ).toBeVisible()

    // ---- restore ------------------------------------------------------------
    await page.getByRole('button', { name: /Restore this version|यह संस्करण पुनर्स्थापित करें/ }).click()
    await expect(page.getByText(/Restored\./)).toBeVisible()

    if (onPhone(page)) await showDocument(page)
    await expect(editor).toContainText(`${typed} is admissible.`)
    await expect(editor).not.toContainText('This supersedes the earlier clarification.')

    // …and the restore is itself undoable, because what was on screen was
    // snapshotted before it was written over.
    await panelTab(page, 'Versions')
    // Scoped to the list again: the label is also in the two compare selects.
    await expect(
      page.getByRole('listitem').filter({ hasText: /Before a restore|पुनर्स्थापन से पहले/ }),
    ).toHaveCount(1)

    // ---- and it is all still there after a reload ---------------------------
    await page.goto(documentUrl)
    await expect(page.getByRole('textbox', { name: BODY })).toContainText(`${typed} is admissible.`)
  })

  test('the export gate reports an unfilled placeholder as something to fix', async ({ page }) => {
    await page.goto('/draft/new/sanction-order')
    await expect(page).toHaveURL(/\/draft\/d\//)

    await panelTab(page, 'Review')
    // The skeleton of a sanction order leaves several blanks, and every one of
    // them is an ERROR rather than a suggestion: `{{amount}}` printed on a
    // signed financial sanction is the failure this whole layer exists to stop.
    await expect(page.getByText(/has not been filled in/).first()).toBeVisible()
    // The count line, not the tab's sr-only marker and not the export note.
    await expect(page.getByText(/^\d+ must be fixed$/)).toBeVisible()
  })

  test('a document written by a newer build is refused rather than half-read', async ({ page }) => {
    // Make a real document first, so the database is at the current version and
    // the `documents` store exists — opening it by name from a page that has
    // not used Dexie yet finds no store at all.
    await page.goto('/draft/new/office-memorandum')
    await expect(page).toHaveURL(/\/draft\/d\//)
    const id = page.url().split('/').pop() ?? ''

    await page.evaluate(async (documentId) => {
      const request = indexedDB.open('sahayak')
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error ?? new Error('indexedDB.open failed'))
      })
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction('documents', 'readwrite')
        const store = transaction.objectStore('documents')
        const read = store.get(documentId)
        read.onsuccess = () => {
          const row = read.result as { doc: { docModelVersion: number } }
          row.doc.docModelVersion = 99
          store.put(row)
        }
        transaction.oncomplete = () => resolve()
        transaction.onerror = () => reject(transaction.error ?? new Error('the write failed'))
      })
      database.close()
    }, id)

    await page.goto(`/draft/d/${id}`)
    await expect(page.getByText(/written by a newer version of the app/)).toBeVisible()
    await expect(page.getByText(/document model version 99/)).toBeVisible()
  })

  test('the editor passes axe, on every panel and with the details open', async ({ page }) => {
    await page.goto('/draft/new/office-memorandum')
    await expect(page).toHaveURL(/\/draft\/d\//)
    await expect(page.getByRole('textbox', { name: BODY })).toBeVisible()

    for (const name of ['Review', 'Change', 'Versions', 'Notes to self']) {
      await panelTab(page, name)
      const violations = await audit(page)
      expect(formatViolations(violations), name).toEqual([])
    }

    // The details card, the preview and the export are the three things the
    // middle column can be, and each is a different set of controls.
    if (onPhone(page)) await showDocument(page)
    await openDetails(page)
    expect(formatViolations(await audit(page)), 'details').toEqual([])

    await showPreview(page)
    expect(formatViolations(await audit(page)), 'preview').toEqual([])

    await showExport(page)
    expect(formatViolations(await audit(page)), 'export').toEqual([])
  })

  test('the whole editor is reachable from the keyboard', async ({ page }) => {
    await page.goto('/draft/new/office-memorandum')
    await expect(page.getByRole('textbox', { name: BODY })).toBeVisible()

    // Every panel tab is a real tab, and the toolbar is a real toolbar.
    if (onPhone(page)) await page.getByRole('tab', { name: /^Check/ }).click()
    await expect(
      page.getByRole('tablist', { name: /About this document|इस दस्तावेज़ के बारे में/ }),
    ).toBeVisible()
    for (const name of ['Review', 'Change', 'Versions', 'Notes to self']) {
      await expect(page.getByRole(...tab(name))).toBeVisible()
    }
    if (onPhone(page)) await showDocument(page)
    await expect(page.getByRole('toolbar', { name: /Formatting|स्वरूपण/ })).toBeVisible()

    // Ctrl+E opens the export without a pointer…
    await page.keyboard.press('Control+e')
    await expect(page.getByText(/Word \(\.docx\)/).first()).toBeVisible()

    // …and Ctrl+P goes to the PRINT ROUTE, where paper, language and the
    // generated `@page` rule are chosen (ADR-042 §5) rather than to a preview.
    await page.keyboard.press('Control+p')
    await expect(page).toHaveURL(/\/draft\/d\/[0-9a-f]+\/print$/)
  })

  test('reads the same in Hindi', async ({ page }) => {
    await page.goto('/draft')
    await setLanguage(page, 'hi')
    await page.goto('/draft/new/office-memorandum')
    await expect(page).toHaveURL(/\/draft\/d\//)
    if (onPhone(page)) await page.getByRole('tab', { name: /^जाँच/ }).click()
    await expect(page.getByRole('tab', { name: 'समीक्षा' })).toBeVisible()
    if (onPhone(page)) await page.getByRole('tab', { name: 'लिखें' }).click()
    await expect(page.getByRole('toolbar', { name: 'स्वरूपण' })).toBeVisible()
  })

  test('the controls an edge-case pass found dead are reachable and do something', async ({ page }) => {
    /*
      Seven controls shipped wired up, labelled in both languages, and unable to
      do anything (ADR-041's second addendum). Each one is pressed here, because
      the way they were found was a sweep for i18n keys nothing referenced — and
      a key being referenced is not the same as the control working.
    */
    await page.goto('/settings/profile')

    // The nudge on the picker, while there is no profile.
    await page.goto('/draft')
    await expect(page.getByText(/Set up your drafting profile/)).toBeVisible()

    // A letterhead and an unticked -Sd/- reach the page.
    await page.goto('/settings/profile')
    await page.getByLabel('Name', { exact: true }).fill('A.B.C.')
    await page.getByLabel(/^Letterhead lines 1$/).fill('ESTABLISHMENT SECTION')
    await page.getByLabel(/print -Sd\/- above the name/i).uncheck()
    await page.getByRole('button', { name: /Save profile/ }).click()
    await expect(page.getByText('Profile saved.')).toBeVisible()

    // …and the nudge is gone.
    await page.goto('/draft')
    await expect(page.getByText(/Set up your drafting profile/)).toHaveCount(0)

    await page.goto('/draft/new/office-memorandum')
    await expect(page).toHaveURL(/\/draft\/d\//)
    await showPreview(page)
    await expect(page.getByText('ESTABLISHMENT SECTION').first()).toBeVisible()
    await expect(page.getByText('-Sd/-')).toHaveCount(0)
    await showDocument(page)

    // The shortcuts sheet, on Ctrl+/.
    await page.keyboard.press('Control+/')
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByText(/Editor shortcuts|संपादक शॉर्टकट/)).toBeVisible()
    await page.keyboard.press('Escape')

    // Converting numerals says how many it changed.
    await page.getByRole('textbox', { name: BODY }).click()
    await page.keyboard.type('Rule 12 of 2026.')
    await page.getByRole('button', { name: /To Devanagari/ }).click()
    await expect(page.getByRole('textbox', { name: BODY })).toContainText('१२')

    // "Save as my template", the brief's item 6 — in the ⋯ menu now.
    await editorMenu(page, /Save as my template/)
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByLabel(/Template name/).fill('My O.M.')
    await page.getByRole('button', { name: /^Save template$/ }).click()
    // Wait on the app's OWN confirmation before navigating. A Dexie write does
    // not finish before the click that started it returns — CLAUDE.md records
    // this costing a Library test a failure reported two screens away, and this
    // test reproduced it exactly: `/draft/templates` was empty because the
    // navigation beat the write, not because saving was broken.
    await expect(page.getByText(/Saved as "My O\.M\."/)).toBeVisible()
    await page.goto('/draft/templates')
    await expect(page.getByText('My O.M.')).toBeVisible()
  })

  test('deleting an addressee asks first and can be undone', async ({ page }) => {
    await page.goto('/settings/address-book')
    await page.getByRole('button', { name: /Add an addressee/ }).click()
    await page.getByLabel('Name', { exact: true }).fill('Shri X')
    await page.getByRole('button', { name: /^Save$/ }).click()
    await expect(page.getByText('Shri X')).toBeVisible()

    // One press asks…
    await page.getByRole('button', { name: /^Delete$/ }).click()
    await expect(page.getByText(/Delete Shri X\?/)).toBeVisible()
    // …and the row is still there until the second.
    await expect(page.getByRole('listitem').filter({ hasText: 'Shri X' })).toHaveCount(1)

    await page
      .getByRole('button', { name: /^Delete$/ })
      .last()
      .click()
    await expect(page.getByRole('listitem').filter({ hasText: 'Shri X' })).toHaveCount(0)

    // And it comes back.
    await page.getByRole('button', { name: /^Undo$/ }).click()
    await expect(page.getByRole('listitem').filter({ hasText: 'Shri X' })).toHaveCount(1)
  })
})
