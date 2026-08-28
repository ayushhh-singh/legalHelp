import { readFileSync } from 'node:fs'
import { inflateRawSync } from 'node:zlib'

import { expect, test, type Page } from '@playwright/test'

/**
 * The Drafting Studio, in a real browser.
 *
 * The first test is the brief's own acceptance run, end to end and in one go:
 * write an Office Memorandum, watch the checklist go green, export a `.docx`,
 * open the file that actually landed on disk and read the subject out of its
 * XML, switch the preview to Hindi and see the manual's own title, reload and
 * find the draft where it was left — all while counting every request the page
 * makes and asserting that none of them crossed the origin.
 *
 * It is deliberately ONE test rather than six. The claim being made is about
 * the whole flow: a request counter that is only armed for the export proves
 * nothing about the typing, and a draft restored in a test of its own proves
 * nothing about a draft that was exported first.
 */

/** `word/document.xml` out of a real .docx, without a zip dependency. */
function documentXml(path: string): string {
  const buffer = readFileSync(path)
  const name = Buffer.from('word/document.xml')

  for (let at = 0; at + 30 <= buffer.length; at += 1) {
    if (buffer.readUInt32LE(at) !== 0x04034b50) continue
    const method = buffer.readUInt16LE(at + 8)
    const compressed = buffer.readUInt32LE(at + 18)
    const nameLength = buffer.readUInt16LE(at + 26)
    const extraLength = buffer.readUInt16LE(at + 28)
    const start = at + 30
    if (!buffer.subarray(start, start + nameLength).equals(name)) continue

    const body = buffer.subarray(start + nameLength + extraLength)
    return method === 0
      ? body.subarray(0, compressed).toString('utf8')
      : inflateRawSync(body).toString('utf8')
  }
  throw new Error('word/document.xml is not in the archive')
}

const field = (page: Page, id: string) => page.locator(`#draft-field-${id}`)

/**
 * The English box of a field that has been split into two.
 *
 * A field holds ONE shared value until its two issues diverge, and CSMOP's
 * worked example diverges for the subject, the body and the file number — the
 * specimen really does print `A-11011/2/2026-Estt.` and
 * `ए-11011/2/2026-स्थापना`. So after "Fill with the worked example" those
 * fields have an `-en` and a `-hi` box, while the telephone number and the
 * e-mail address, which the specimen prints identically, stay as one.
 */
const splitField = (page: Page, id: string, side: 'en' | 'hi') => page.locator(`#draft-field-${id}-${side}`)

const SUBJECT = 'Grant of Children Education Allowance — clarification regarding.'

test('writes an O.M., clears the checklist, exports a real .docx, and survives a reload — with no network', async ({
  page,
  baseURL,
}) => {
  const origin = new URL(baseURL ?? 'http://localhost:4173').origin
  const crossOrigin: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).origin !== origin) {
      crossOrigin.push(`${request.method()} ${request.url()}`)
    }
  })

  // ---- the picker ---------------------------------------------------------
  await page.goto('/draft')
  await expect(page.getByRole('heading', { level: 1, name: 'Drafting Studio' })).toBeVisible()

  const card = page.getByRole('link', { name: 'Open Office Memorandum (O.M.)' })
  await expect(card).toBeVisible({ timeout: 30_000 })
  // The one-line "use when" the picker loads index.json for.
  await expect(page.getByText('Everyday business between Departments')).toBeVisible()
  await card.click()

  // ---- the editor ---------------------------------------------------------
  await expect(page).toHaveURL(/\/draft\/office-memorandum/)
  await expect(page.getByRole('heading', { level: 1, name: 'Office Memorandum (O.M.)' })).toBeVisible()

  // The privacy banner the brief requires on every editor.
  await expect(page.getByText('Drafts stay on this device.')).toBeVisible()

  // An empty form must FAIL required items — otherwise "all green" below
  // proves nothing about the checklist.
  const checklistButton = page.getByRole('button', { name: /^Checklist/ })
  await expect(checklistButton).toBeVisible({ timeout: 30_000 })
  await checklistButton.click()
  await expect(page.getByRole('dialog', { name: 'Checklist' })).toBeVisible()
  await expect(page.getByText(/required items? still failing/)).toBeVisible()
  await page.keyboard.press('Escape')

  // Fill from CSMOP's own worked example, then make the subject our own so the
  // .docx assertion is about text this test typed.
  await page.getByRole('button', { name: 'Fill with the worked example' }).click()
  await splitField(page, 'subject', 'en').fill(SUBJECT)

  // A field the specimen prints identically in both issues stays as ONE box:
  // nobody should have to maintain a second copy of a telephone number.
  await expect(field(page, 'phone')).toHaveValue('011-2309 2590')

  // ---- the checklist goes green ------------------------------------------
  await checklistButton.click()
  const drawer = page.getByRole('dialog', { name: 'Checklist' })
  await expect(drawer).toBeVisible()
  await expect(drawer.getByText('Every item passes.')).toBeVisible()
  await expect(drawer.getByText('Not yet')).toHaveCount(0)
  await page.keyboard.press('Escape')

  // ---- export -------------------------------------------------------------
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Word (.docx)' }).click()
  const download = await downloadPromise

  // Named after the file number, which is how a document is filed.
  expect(download.suggestedFilename()).toBe('A-11011-2-2026-Estt (EN).docx')

  const path = await download.path()
  const xml = documentXml(path)
  expect(xml).toContain('<w:document')
  expect(xml).toContain('Grant of Children Education Allowance')
  expect(xml).toContain('OFFICE MEMORANDUM')
  // A4 and one-inch margins.
  expect(xml).toMatch(/w:w="11906"/)
  expect(xml).toMatch(/w:top="1440"/)
  // Nothing unresolved reached a signed document.
  expect(xml).not.toMatch(/\{\{[a-zA-Z]/)

  // ---- the Hindi issue ----------------------------------------------------
  // Scoped to the group: "Typing in" and "Preview language" both offer a
  // radio called हिंदी, and they do different things.
  await page
    .getByRole('radiogroup', { name: 'Preview language' })
    .getByRole('radio', { name: 'हिंदी' })
    .click()
  await expect(page.getByText('कार्यालय ज्ञापन').first()).toBeVisible()
  await expect(page.getByText('भारत सरकार').first()).toBeVisible()

  // ---- reload restores it from Dexie -------------------------------------
  await expect(page).toHaveURL(/[?&]d=[0-9a-f]{18}/)
  const before = page.url()
  await page.reload()
  await expect(page.getByRole('heading', { level: 1, name: 'Office Memorandum (O.M.)' })).toBeVisible()
  await expect(splitField(page, 'subject', 'en')).toHaveValue(SUBJECT, { timeout: 30_000 })
  expect(page.url()).toBe(before)

  // ---- and the whole of that touched nothing off-origin -------------------
  expect(crossOrigin).toEqual([])
})

test('a required item still failing holds the export back, and a recommended one only asks', async ({
  page,
}) => {
  await page.goto('/draft/office-memorandum')
  await expect(page.getByRole('button', { name: /^Checklist/ })).toBeVisible({ timeout: 30_000 })

  // An empty form: required items failing, so the export is blocked outright.
  await expect(page.getByText('A required item is still failing')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Word (.docx)' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Print / PDF' })).toBeDisabled()

  // "Copy as text" is deliberately OUTSIDE the gate — an app must not hold an
  // officer's own words hostage to its own checklist.
  await expect(page.getByRole('button', { name: 'Copy as text' })).toBeEnabled()

  // The worked example passes everything, so nothing is held back.
  await page.getByRole('button', { name: 'Fill with the worked example' }).click()
  await expect(page.getByText('A required item is still failing')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Word (.docx)' })).toBeEnabled()

  // Emptying the copy-to list fails a RECOMMENDED item only: the export is
  // offered behind one press rather than refused.
  await splitField(page, 'copyTo', 'en').fill('')
  await splitField(page, 'copyTo', 'hi').fill('')
  await expect(page.getByText('Only recommended items are failing')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Word (.docx)' })).toBeDisabled()
  await page.getByRole('button', { name: 'Export anyway' }).click()
  await expect(page.getByRole('button', { name: 'Word (.docx)' })).toBeEnabled()
})

test('one text serves both issues until the officer separates them', async ({ page }) => {
  await page.goto('/draft/office-memorandum')
  await expect(page.getByRole('button', { name: 'Fill with the worked example' })).toBeVisible({
    timeout: 30_000,
  })

  await field(page, 'subject').fill('Leave rules')

  // Typed once, it appears in BOTH issues — which is what makes equal
  // bilingual footing bearable to type for a file number or a telephone number.
  await page
    .getByRole('radiogroup', { name: 'Preview language' })
    .getByRole('radio', { name: 'Side by side' })
    .click()
  await expect(page.getByText('Leave rules')).toHaveCount(2)

  // Separated, the Hindi is the officer's own. The control names its own
  // field — there are fifteen of them on this form.
  await page.getByRole('button', { name: 'Write Hindi separately — Subject' }).click()
  await splitField(page, 'subject', 'hi').fill('अवकाश नियम')
  await expect(page.getByText('Leave rules')).toHaveCount(1)
  await expect(page.getByText('अवकाश नियम')).toHaveCount(1)
})

test('the phrase library offers only what belongs to this form, and inserts at the caret', async ({
  page,
}) => {
  await page.goto('/draft/office-memorandum')
  await expect(page.getByRole('button', { name: 'Phrase' })).toBeVisible({ timeout: 30_000 })

  await field(page, 'paras').fill('')
  await page.getByRole('button', { name: 'Phrase' }).click()

  const sheet = page.getByRole('dialog', { name: 'Phrase library' })
  await expect(sheet).toBeVisible()
  // Focus lands on the search box, not the close button.
  await expect(sheet.getByPlaceholder('Search phrases')).toBeFocused()

  await sheet.getByRole('button', { name: 'Insert' }).first().click()

  await expect(sheet).toHaveCount(0)
  await expect(field(page, 'paras')).toHaveValue(/undersigned is directed/)
})

test('the glossary prints the manual’s Hindi, not the one everyone expects', async ({ page }) => {
  await page.goto('/draft/office-memorandum')
  await expect(page.getByRole('button', { name: 'Glossary' })).toBeVisible({ timeout: 30_000 })

  await page.getByRole('button', { name: 'Glossary' }).click()
  const sheet = page.getByRole('dialog', { name: 'Hindi administrative glossary' })
  await expect(sheet).toBeVisible()

  // Searching for the rendering an officer would guess finds the term…
  await sheet.getByPlaceholder('Search the glossary').fill('सर्वोच्च अग्रता')
  // …and what it shows is what CSMOP 2022 actually prints.
  // `exact`, because the term's own note also quotes the printed form — the
  // strict-mode violation that catching this taught.
  await expect(sheet.getByText('परम अग्रता', { exact: true })).toBeVisible()
  await expect(sheet.getByText(/Also written/)).toBeVisible()
})

test('a draft can be duplicated, renamed and deleted with an undo', async ({ page }) => {
  await page.goto('/draft/office-memorandum')
  await expect(page.getByRole('button', { name: 'Fill with the worked example' })).toBeVisible({
    timeout: 30_000,
  })
  await field(page, 'subject').fill('First draft')
  // Wait for the debounced write to land in IndexedDB.
  await expect(page).toHaveURL(/[?&]d=[0-9a-f]{18}/)

  await page.getByRole('link', { name: 'All forms' }).click()
  const row = page.getByRole('link', { name: /First draft/ })
  await expect(row).toBeVisible()

  await page.getByRole('button', { name: 'Duplicate — First draft' }).click()
  await expect(page.getByRole('link', { name: /Copy of First draft/ })).toBeVisible()

  await page.getByRole('button', { name: 'Delete — First draft', exact: true }).click()
  await expect(page.getByRole('link', { name: /^First draft/ })).toHaveCount(0)

  // Delete is undoable, deliberately without a timeout racing the reader.
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(page.getByRole('link', { name: /First draft/ }).first()).toBeVisible()
})

test('a keystroke typed just before leaving the page is not lost', async ({ page }) => {
  /*
    The autosave is debounced by 600ms. Leaving within that window used to
    CANCEL the pending write rather than flush it, so the draft in the recent
    list was a sentence behind the one that had been on screen. This types and
    navigates immediately, with no wait between them.
  */
  await page.goto('/draft/office-memorandum')
  await expect(page.getByRole('button', { name: 'Fill with the worked example' })).toBeVisible({
    timeout: 30_000,
  })

  await field(page, 'subject').fill('Typed and left at once')
  await page.getByRole('link', { name: 'All forms' }).click()

  await expect(page.getByRole('link', { name: /Typed and left at once/ })).toBeVisible()
})

test('the whole editor works with no network at all', async ({ page, context }) => {
  // Warm the service worker, exactly as tests/e2e/offline.spec.ts does.
  await page.goto('/draft')
  await expect(page.getByRole('link', { name: 'Open Office Memorandum (O.M.)' })).toBeVisible({
    timeout: 30_000,
  })
  await page.goto('/draft/office-memorandum')
  await expect(page.getByRole('button', { name: 'Fill with the worked example' })).toBeVisible({
    timeout: 30_000,
  })
  await page.evaluate(() => navigator.serviceWorker?.ready)

  await context.setOffline(true)
  await page.reload()

  await expect(page.getByRole('heading', { level: 1, name: 'Office Memorandum (O.M.)' })).toBeVisible({
    timeout: 30_000,
  })
  await page.getByRole('button', { name: 'Fill with the worked example' }).click()

  // The template, the engine and the checklist all came off the device.
  await expect(page.getByText('OFFICE MEMORANDUM').first()).toBeVisible()
  await expect(page.getByRole('button', { name: /^Checklist/ })).toBeVisible()

  await context.setOffline(false)
})
