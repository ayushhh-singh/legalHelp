import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { audit, expect, formatViolations, setLanguage, test } from './fixtures'

/**
 * Import and export, in a real browser.
 *
 * Everything here needs one: `mammoth` and `pdfjs-dist` run against a real
 * `File`, the `.docx` writer packs a real archive, a download reaches a real
 * disk, and `window.print()` needs a real print stylesheet. jsdom has none of
 * those, which is why the unit suite tests the mapping and the geometry and
 * this file tests the wiring.
 *
 * The network gate is automatic — `test` comes from `./fixtures` — so every run
 * here also asserts that nothing about the officer's document left the device.
 * That is the whole claim the import screen makes above the file picker, and it
 * is the one an officer cannot check for themselves.
 */

const FIXTURES = resolve(process.cwd(), 'tests/fixtures/drafting')
const fixture = (name: string) => resolve(FIXTURES, name)

const tab = (name: string) => ['tab' as const, { name: new RegExp(`^${name}`) }] as const

test.describe('importing a document', () => {
  test('a .docx → the review screen → a document → export → re-import', async ({ page }) => {
    /*
      One test, deliberately. A round trip proved in four separate tests is
      four tests that each pass against a broken round trip: the export test
      exports something the import test never sees. The budget is explicit for
      the reason `draft-editor.spec.ts` carries one — this is a dozen steps and
      the default 30s is a ceiling on the journey, not on any step of it.
    */
    test.setTimeout(180_000)

    await page.goto('/draft/import')
    await expect(page.getByRole('heading', { name: /Import a document/ })).toBeVisible()

    await page.locator('input[type="file"]').setInputFiles(fixture('om.docx'))

    // ---- the review screen states what was read and what was lost ---------
    await expect(page.getByText('A-11011/2/2026-Estt.(Allowances)')).toBeVisible()
    await expect(page.getByText(/Children Education Allowance/).first()).toBeVisible()
    await expect(page.getByText(/Labelled in the file/).first()).toBeVisible()
    // The one lossy step in this file, named before anything is saved.
    await expect(page.getByText(/numbered paragraph\(s\) were recognised/)).toBeVisible()

    expect(formatViolations(await audit(page)), 'the import review screen').toEqual([])

    // ---- create the document ---------------------------------------------
    await page.getByRole('button', { name: /Create the document/ }).click()
    await page.waitForURL(/\/draft\/d\/[0-9a-f]+/)
    const documentUrl = page.url()

    // The text really arrived, structure and all.
    await expect(page.getByText(/Doubts have been expressed/).first()).toBeVisible()

    // ---- the export gate refuses, and says where to go -------------------
    await page.getByRole(...tab('Export')).click()
    /*
      An imported letter has no signature block, and CSMOP 9.2(x) makes one a
      required item — so the export is held back. That is correct, and what the
      first browser run of this spec found is that the card SAID "open the
      checklist to see which" and offered no way to. It does now, and this
      asserts the whole path rather than the sentence.
    */
    await expect(page.getByText(/A required item is still failing/)).toBeVisible()
    await page.getByRole('button', { name: /Open the checklist/ }).click()
    await expect(page.getByText(/Signature block carries designation/)).toBeVisible()

    // ---- fill it in, exactly as an officer would --------------------------
    await page.getByRole(...tab('Details')).click()
    await page
      .getByLabel(/^Name$/)
      .last()
      .fill('A.B.C.')
    await page
      .getByLabel(/^Designation$/)
      .last()
      .fill('Under Secretary')
    await page.getByLabel(/^Telephone$/).fill('011-23092345')
    await page.getByLabel(/^E-mail$/).fill('us.estt@nic.in')

    // ---- export it -------------------------------------------------------
    await page.getByRole(...tab('Export')).click()
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: /Word \(\.docx\)/ }).click()
    const file = await download
    /*
      Saved under its own NAME, not read from the temporary path.

      Playwright writes a download to a temp file with no extension, and the
      importer decides which reader to run from the extension — so re-importing
      `download.path()` directly asks this app to import a file called
      `abc123`. It refuses, correctly, and the round trip proves nothing. This
      is also what surfaced `extensionOf` returning the last character of a name
      with no dot in it.
    */
    const exported = resolve(process.cwd(), 'test-results', file.suggestedFilename())
    await file.saveAs(exported)
    expect(file.suggestedFilename()).toMatch(/\.docx$/)
    // A real archive, not a zero-byte download — the `requestAnimationFrame`
    // revoke exists because Safari produces exactly that when it is revoked
    // synchronously.
    expect(readFileSync(exported).length).toBeGreaterThan(1000)

    // ---- re-import it ----------------------------------------------------
    await page.goto('/draft/import')
    await page.locator('input[type="file"]').setInputFiles(exported)
    await expect(page.getByText('A-11011/2/2026-Estt.(Allowances)')).toBeVisible()
    await expect(page.getByText(/Children Education Allowance/).first()).toBeVisible()

    await page.goto(documentUrl)
    await expect(page.getByText(/Doubts have been expressed/).first()).toBeVisible()
  })

  test('a scanned PDF is refused with something the officer can act on', async ({ page }) => {
    await page.goto('/draft/import')
    await page.locator('input[type="file"]').setInputFiles(fixture('scanned.pdf'))
    // NO OCR, and the message says what to do instead rather than "failed".
    await expect(page.getByRole('alert')).toContainText(/scan/)
    await expect(page.getByRole('alert')).toContainText(/Paste the text instead/)
    // The paste box it points at is on the same screen.
    await expect(page.getByRole('button', { name: /Use this text/ })).toBeVisible()
  })

  test('an older .doc under a .docx name says how to convert it', async ({ page }) => {
    await page.goto('/draft/import')
    await page.locator('input[type="file"]').setInputFiles(fixture('actually-a-doc.docx'))
    await expect(page.getByRole('alert')).toBeVisible()
  })

  test('the header of a Word file is offered as a letterhead and never applied', async ({ page }) => {
    await page.goto('/draft/import')
    await page.locator('input[type="file"]').setInputFiles(fixture('headers-footers.docx'))
    // Scoped to the letterhead list, not the whole page: the "not imported"
    // notice quotes the same line as an example, so an unscoped `getByText`
    // matches two elements and fails on strict mode. Asserting on the row's own
    // element is what the test always meant.
    await expect(
      page.getByRole('listitem').filter({ hasText: /^भारत सरकार \/ Government of India$/ }),
    ).toBeVisible()
    const checkbox = page.getByRole('checkbox', { name: /Use these as this document/ })
    await expect(checkbox).toBeVisible()
    // Offered, and the officer decides — a header may be a page number, a
    // confidentiality stamp or a letterhead, and only they know which.
    await expect(checkbox).toBeChecked()
  })

  test('the whole screen works in Hindi', async ({ page }) => {
    // `setLanguage` waits for an `h1`, so it needs a page. Calling it before
    // the first `goto` runs it against `about:blank`.
    await page.goto('/draft/import')
    await setLanguage(page, 'hi')
    await expect(page.getByRole('heading', { name: /दस्तावेज़ आयात करें/ })).toBeVisible()
    await page.locator('input[type="file"]').setInputFiles(fixture('om.docx'))
    await expect(page.getByText(/फ़ाइल में नामांकित/).first()).toBeVisible()
  })
})

test.describe('the print route', () => {
  test('renders the document, its page counters and its instructions', async ({ page }) => {
    await page.goto('/draft/import')
    await page.locator('input[type="file"]').setInputFiles(fixture('om.docx'))
    await page.getByRole('button', { name: /Create the document/ }).click()
    await page.waitForURL(/\/draft\/d\/[0-9a-f]+/)
    const id = /\/draft\/d\/([0-9a-f]+)/.exec(page.url())?.[1] ?? ''
    expect(id).not.toBe('')

    await page.goto(`/draft/d/${id}/print`)
    await expect(page.getByRole('heading', { name: /^Print$/ })).toBeVisible()
    await expect(page.getByText(/choose “Save as PDF”|Save as PDF/i).first()).toBeVisible()

    // The generated `@page` rule is literal text, because `@page { size:
    // var(--x) }` is invalid CSS in every browser and falls back to the
    // printer's default — which is Letter in some locales.
    const css = await page.locator('style').allTextContents()
    expect(css.join('\n')).toContain('size: 210mm 297mm;')

    // The counters exist as real elements, so the print engine has somewhere
    // to put `counter(page)` — the numbers themselves only exist on paper.
    await expect(page.locator('.draft-page-number')).toHaveCount(1)
    await expect(page.locator('.draft-page-total')).toHaveCount(1)

    // Letter is offered and changes the rule that will actually be applied.
    await page.getByLabel(/Paper/).selectOption('Letter')
    await expect
      .poll(async () => (await page.locator('style').allTextContents()).join('\n'))
      .toContain('size: 215.9mm 279.4mm;')

    expect(formatViolations(await audit(page)), 'the print route').toEqual([])
  })
})

test.describe('batch export', () => {
  test('a zip with one entry per selected document', async ({ page }) => {
    test.setTimeout(180_000)

    // Two documents, both real, both created through the importer.
    for (const name of ['om.docx', 'headers-footers.docx']) {
      await page.goto('/draft/import')
      await page.locator('input[type="file"]').setInputFiles(fixture(name))
      await page.getByRole('button', { name: /Create the document/ }).click()
      await page.waitForURL(/\/draft\/d\/[0-9a-f]+/)
    }

    await page.goto('/draft/documents')
    await page.getByRole('button', { name: /Select all/ }).click()
    await expect(page.getByText(/2 selected/)).toBeVisible()

    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: /Download as a \.zip/ }).click()
    const zip = await download
    const path = await zip.path()
    const bytes = readFileSync(path)

    // Two local file headers and an end-of-central-directory record saying two.
    // The local-file-header signature, `PK\x03\x04`, written as bytes rather
    // than as a regular expression: a control character in a pattern is what
    // `no-control-regex` exists to catch, and counting bytes is clearer anyway.
    let signatures = 0
    for (let at = 0; at + 4 <= bytes.length; at += 1) {
      if (bytes[at] === 0x50 && bytes[at + 1] === 0x4b && bytes[at + 2] === 0x03 && bytes[at + 3] === 0x04) {
        signatures += 1
      }
    }
    expect(signatures).toBe(2)
    expect(bytes.toString('latin1')).toContain('.docx')

    await expect(page.getByText(/2 document\(s\) exported/)).toBeVisible()
  })

  test('copying every selected document as text needs no checklist to pass', async ({ page }) => {
    await page.goto('/draft/import')
    await page.locator('input[type="file"]').setInputFiles(fixture('om.docx'))
    await page.getByRole('button', { name: /Create the document/ }).click()
    await page.waitForURL(/\/draft\/d\/[0-9a-f]+/)

    await page.goto('/draft/documents')
    await page.getByRole('button', { name: /Select all/ }).click()
    await page.getByRole('button', { name: /Copy all as plain text/ }).click()
    // The confirmation is inside a live region, which is what every other copy
    // affordance in this app owes the reader.
    await expect(page.locator('[aria-live="polite"]').filter({ hasText: /Copied|refused/ })).toBeVisible()
  })
})
