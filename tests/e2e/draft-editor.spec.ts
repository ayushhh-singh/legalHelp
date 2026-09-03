import { audit, expect, formatViolations, setLanguage, test } from './fixtures'

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

/**
 * The editor's tabs, matched on the START of the accessible name.
 *
 * Two things force this. A plain string `name` is a case-insensitive SUBSTRING
 * match, so `'Review'` also matches "Preview" — CLAUDE.md records the same trap
 * costing half an hour on `{ name: 'Post' }` matching "Place of posting". And
 * `exact: true` fails too, because the Review tab's name legitimately carries
 * more than its label: when something must be fixed it gains an `aria-hidden`
 * dot and an `sr-only` sentence saying what the dot means, so a screen reader
 * hears "Review — 1 must be fixed" rather than "Review bullet".
 *
 * Anchoring at the start distinguishes "Review…" from "Preview" and keeps the
 * sr-only suffix, which is the part that is actually worth having.
 */
const tab = (name: string) => ['tab' as const, { name: new RegExp(`^${name}`) }] as const

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
    await page.goto('/draft/numbering')
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
    await page.getByRole(...tab('Details')).click()
    await page.getByLabel(/^Subject$/).fill('Children Education Allowance — clarification')
    await page.getByRole('button', { name: /Issue number|संख्या जारी करें/ }).click()
    await expect(page.getByLabel(/Reference number|संदर्भ संख्या/)).toHaveValue(/A-11011\/1\/\d{4}-Estt\./)

    // ---- save a version ----------------------------------------------------
    await page.getByRole(...tab('Versions')).click()
    await page.getByLabel(/What is this version|यह संस्करण क्या है/).fill('before the second para')
    await page.getByRole('button', { name: /Save this version|यह संस्करण सहेजें/ }).click()
    // Scoped to the list: the label also appears in the two compare selects.
    const versionList = page.getByRole('listitem').filter({ hasText: 'before the second para' })
    await expect(versionList).toHaveCount(1)

    // ---- edit ---------------------------------------------------------------
    await page.getByRole(...tab('Write')).click()
    await page.locator('.draft-editor-surface p').last().click()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.type('This supersedes the earlier clarification.')
    await expect(editor).toContainText('This supersedes the earlier clarification.')

    // ---- diff --------------------------------------------------------------
    await page.getByRole(...tab('Versions')).click()
    await page
      .getByRole('button', { name: /^Compare$|^तुलना करें$/ })
      .first()
      .click()
    await expect(page.getByText('This supersedes the earlier clarification.')).toBeVisible()

    // ---- restore ------------------------------------------------------------
    await page.getByRole('button', { name: /Restore this version|यह संस्करण पुनर्स्थापित करें/ }).click()
    await expect(page.getByText(/Restored\./)).toBeVisible()

    await page.getByRole(...tab('Write')).click()
    await expect(editor).toContainText(`${typed} is admissible.`)
    await expect(editor).not.toContainText('This supersedes the earlier clarification.')

    // …and the restore is itself undoable, because what was on screen was
    // snapshotted before it was written over.
    await page.getByRole(...tab('Versions')).click()
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

    await page.getByRole(...tab('Review')).click()
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

  test('the editor passes axe, and so does the document list', async ({ page }) => {
    await page.goto('/draft/new/office-memorandum')
    await expect(page).toHaveURL(/\/draft\/d\//)
    await expect(page.getByRole('textbox', { name: BODY })).toBeVisible()

    for (const name of ['Write', 'Details', 'Preview', 'Review', 'Versions', 'Notes to self']) {
      await page.getByRole(...tab(name)).click()
      const violations = await audit(page)
      expect(formatViolations(violations), name).toEqual([])
    }
  })

  test('the whole editor is reachable from the keyboard', async ({ page }) => {
    await page.goto('/draft/new/office-memorandum')
    await expect(page.getByRole('textbox', { name: BODY })).toBeVisible()

    // Every tab is a real tab, and the toolbar is a real toolbar.
    await expect(page.getByRole('tablist')).toBeVisible()
    for (const name of ['Write', 'Details', 'Preview', 'Review', 'Versions', 'Notes to self']) {
      await expect(page.getByRole(...tab(name))).toBeVisible()
    }
    await expect(page.getByRole('toolbar', { name: /Formatting|स्वरूपण/ })).toBeVisible()

    // Ctrl+P moves to the preview without a pointer.
    await page.keyboard.press('Control+p')
    await expect(page.getByRole(...tab('Preview'))).toHaveAttribute('aria-selected', 'true')
  })

  test('reads the same in Hindi', async ({ page }) => {
    await page.goto('/draft')
    await setLanguage(page, 'hi')
    await page.goto('/draft/new/office-memorandum')
    await expect(page).toHaveURL(/\/draft\/d\//)
    await expect(page.getByRole('tab', { name: 'लिखें' })).toBeVisible()
    await expect(page.getByRole('toolbar', { name: 'स्वरूपण' })).toBeVisible()
  })
})
