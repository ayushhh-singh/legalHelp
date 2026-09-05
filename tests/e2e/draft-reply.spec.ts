import { openDetails } from './editor-helpers'
import { audit, expect, formatViolations, setLanguage, test } from './fixtures'
import { INTAKE_LETTERS } from '../fixtures/drafting/intake'

/**
 * Reply to a letter, and the correspondence register, in a real browser.
 *
 * The first test is the brief's own acceptance run and is deliberately ONE
 * test: paste a letter, see the chips, draft the reply with AI OFF, issue a
 * number, find the register showing a sent entry linked to the received one,
 * set a follow-up and find it due once the clock has moved. Each of those
 * proved separately proves nothing about the chain, and the chain is the
 * feature.
 *
 * The network gate is automatic — `test` comes from `./fixtures` — so this run
 * also asserts that the letter, which is the most sensitive thing the reply
 * screen touches, never left the device. AI is off throughout, which is every
 * device's default and the state the whole deterministic pass is built for.
 */

test.describe('reply to a letter', () => {
  test('paste → chips → draft the reply → issue a number → register → follow-up', async ({
    page,
    network,
  }) => {
    /*
      An explicit budget, for the reason `draft-editor.spec.ts` carries one:
      this is ONE test doing five screens' worth of work, and 30s is a ceiling
      on the journey rather than on any step of it.
    */
    test.setTimeout(120_000)

    // ---- a numbering scheme, so a number can be issued at the end ---------
    await page.goto('/settings/numbering')
    await page.getByRole('button', { name: /Add a scheme|योजना जोड़ें/ }).click()
    await page.getByLabel(/What you call it|आप इसे क्या कहते हैं/).fill('Establishment')
    await page.getByLabel(/^Pattern$|^पैटर्न$/).fill('B-1/{SEQ}/{YEAR}-{SECTION}')
    await page.getByLabel(/^Section$|^अनुभाग$/).fill('Estt.')
    await page
      .getByRole('button', { name: /^Save$|^सहेजें$/ })
      .first()
      .click()
    /*
      Wait for the row, not for the click. A Dexie write does not finish before
      the click that started it returns, and skipping this wait made the
      failure surface two screens later as "Issue number is not on the page" —
      which is what `draft-editor.spec.ts` already records costing time once.
    */
    await expect(page.getByRole('listitem').filter({ hasText: 'Establishment' })).toHaveCount(1)

    // ---- paste the letter -------------------------------------------------
    await page.goto('/draft/reply')
    await expect(page.getByRole('heading', { level: 2, name: 'Reply to a letter' })).toBeVisible()

    // The privacy statement is BEFORE the box, not after it.
    await expect(page.getByText(/This stays on your device/)).toBeVisible()
    await expect(page.getByLabel('The letter that arrived')).toBeHidden()
    await page.getByRole('button', { name: 'I understand' }).click()

    const box = page.getByLabel('The letter that arrived')
    await expect(box).toBeVisible()
    await box.fill(INTAKE_LETTERS.englishOm)
    await page.getByRole('button', { name: 'Read it' }).click()

    /*
      ---- the chips, from the deterministic pass, with AI off --------------

      Scoped to the "What was read" region, and that is not a convenience.

      The letter is still in the textarea above, so every one of these values
      exists on the page twice — once as the paper and once as what the app read
      off it. An unscoped `getByText` matched both and failed on strict mode six
      ways the first time this ran, which is the same class of trap CLAUDE.md
      records for a study aid quoting the provision it explains.
    */
    const read = page.getByRole('region', { name: 'What was read' })
    await expect(read.getByText('A-11011/4/2026-Estt.(Allowances)')).toBeVisible()
    await expect(read.getByText('2026-08-12')).toBeVisible()
    await expect(read.getByText(/Grant of Children Education Allowance/)).toBeVisible()
    // The one thing it asks for, found by the request formula rather than by a
    // verb — "may kindly be furnished".
    await expect(read.getByText(/may kindly be furnished/)).toBeVisible()
    // And the AI panel is not on the screen at all: AI is off.
    await expect(page.getByRole('button', { name: 'Analyse' })).toHaveCount(0)

    // ---- keep it, and draft the reply -------------------------------------
    await page.getByRole('button', { name: 'Keep this letter with the draft' }).click()
    // Wait on the app's own confirmation rather than navigating immediately: a
    // Dexie write does not finish before the click that started it returns, and
    // that is fast enough on a desktop and is not on the Pixel 7 (CLAUDE.md).
    await expect(page.getByText('Kept.')).toBeVisible()

    await page.getByLabel('Answer it with').selectOption('office-memorandum')
    /*
      Activated from the keyboard rather than by a pointer.

      This screen keeps growing under itself while the officer works — the
      chips card fills in as the provisions resolve, and "Letters you have
      kept" appears the moment the letter is kept — so a pointer click on a
      390px viewport can be hit-tested against a card that moved into the
      coordinate after Playwright scrolled to it. Pressing Enter on the focused
      button activates exactly the same handler and asserts the same thing;
      that the control is reachable and hit-testable is what
      `tests/e2e/a11y.spec.ts` and `keyboard.spec.ts` are for.
    */
    const draftReply = page.getByRole('button', { name: 'Draft the reply' })
    await draftReply.focus()
    await draftReply.press('Enter')
    await expect(page).toHaveURL(/\/draft\/d\//)

    // The reply carries the letter's subject and its reference.
    await expect(page.getByRole('textbox', { name: 'Document body' })).toBeVisible()
    await openDetails(page)
    // The SUBJECT field, by its label: the focus bar's title box carries the
    // same string (a reply is titled after what it answers), so an unscoped
    // value selector resolves to two inputs.
    await expect(page.getByLabel(/^Subject$/)).toHaveValue(/Reply — Grant of Children Education Allowance/)

    // ---- issue a number ---------------------------------------------------
    await page.getByRole('button', { name: /Issue number|संख्या निर्गत करें/ }).click()
    // The app's own confirmation, not the pattern's name — "Establishment" is
    // also the text of an `<option>` inside the scheme picker, which is hidden
    // and matched first.
    await expect(page.getByText(/^Issued: B-1\/1\/\d{4}-Estt\.$/)).toBeVisible()

    // ---- the register ------------------------------------------------------
    await page.goto('/draft/register')
    await expect(page.getByRole('heading', { level: 2, name: 'Correspondence register' })).toBeVisible()

    /*
      The two entries, scoped to the rows.

      Each row is an `<article>`, and that is what to assert against here: the
      filters above the list are `<select>`s whose options carry the same words
      the rows do ("Received", "Sent", "Pending"), and an unscoped `getByText`
      matches the hidden `<option>` first. Same trap as the reply screen's
      chips, one screen along.
    */
    const rows = page.getByRole('article')
    await expect(rows.filter({ hasText: 'Received' })).toHaveCount(1)
    await expect(rows.filter({ hasText: 'Sent' })).toHaveCount(1)
    // The reply is filed on the letter's own thread, so both rows say so.
    await expect(rows.filter({ hasText: '2 entries in this thread' })).toHaveCount(2)
    // BOTH rows carry the subject, because the reply's subject is
    // "Reply — <the letter's own subject>" — which is the point of quoting it.
    await expect(rows.filter({ hasText: /Grant of Children Education Allowance/ })).toHaveCount(2)
    await expect(rows.filter({ hasText: /^.*Reply — Grant of Children Education/ })).toHaveCount(1)
    // The sent entry carries the number that was issued.
    await expect(rows.filter({ hasText: /B-1\/1\/\d{4}-Estt\./ })).toHaveCount(1)

    // ---- a follow-up, and the clock moved forward -------------------------
    await rows.first().getByRole('button', { name: 'Edit' }).click()
    // A date in the past, which is what makes it overdue without waiting a day:
    // `followUpState` compares against today, so the test moves the DATE rather
    // than the clock. Nothing in `src/lib/drafting/register.ts` has a clock of
    // its own, which is exactly what makes this testable.
    await page.getByLabel('Follow up on').fill('2020-01-01')
    await page.getByRole('button', { name: 'Save' }).click()

    await expect(page.getByRole('article').filter({ hasText: 'Overdue' })).toHaveCount(1)

    // And it reaches the drafting home's own "waiting for a reply" list.
    await page.goto('/draft')
    await expect(page.getByRole('heading', { name: 'Waiting for a reply' })).toBeVisible()
    await expect(page.getByText('Overdue')).toBeVisible()

    // Nothing the officer pasted or typed reached any request. The automatic
    // gate asserts the cross-origin half; this is the sentinel half.
    const sentinel = network.sentinel('letter')
    await page.goto('/draft/reply')
    await page.getByRole('button', { name: 'I understand' }).click()
    await page.getByLabel('The letter that arrived').fill(sentinel)
  })

  test('a letter that is pasted and abandoned leaves nothing on the device', async ({ page }) => {
    /*
      The privacy claim the reply screen makes in words, asserted.

      `intakes` must be empty after a letter has been pasted, read, and left —
      the analysis lives in component state and dies with the navigation.
    */
    await page.goto('/draft/reply')
    await page.getByRole('button', { name: 'I understand' }).click()
    await page.getByLabel('The letter that arrived').fill(INTAKE_LETTERS.threeAsks)
    await page.getByRole('button', { name: 'Read it' }).click()
    await expect(
      page.getByRole('region', { name: 'What was read' }).getByText(/Annual review of expenditure/),
    ).toBeVisible()

    await page.goto('/draft')

    const stored = await page.evaluate(
      () =>
        new Promise<number>((resolve, reject) => {
          const request = indexedDB.open('sahayak')
          request.onerror = () => reject(new Error('could not open the database'))
          request.onsuccess = () => {
            const database = request.result
            if (!database.objectStoreNames.contains('intakes')) {
              database.close()
              resolve(0)
              return
            }
            const count = database.transaction('intakes', 'readonly').objectStore('intakes').count()
            count.onsuccess = () => {
              database.close()
              resolve(count.result)
            }
            count.onerror = () => {
              database.close()
              reject(new Error('could not count'))
            }
          }
        }),
    )
    expect(stored).toBe(0)
  })

  test('reads three separate asks and the one that carries a date', async ({ page }) => {
    await page.goto('/draft/reply')
    await page.getByRole('button', { name: 'I understand' }).click()
    await page.getByLabel('The letter that arrived').fill(INTAKE_LETTERS.threeAsks)
    await page.getByRole('button', { name: 'Read it' }).click()

    const read = page.getByRole('region', { name: 'What was read' })
    await expect(read.getByText(/may be completed and returned/)).toBeVisible()
    await expect(read.getByText(/nominate a nodal officer/)).toBeVisible()
    await expect(read.getByText(/confirm that the reconciliation/)).toBeVisible()
    // The deadline chip, from the sentence that carried a limit word.
    await expect(read.getByText('2026-09-30')).toBeVisible()
  })

  test('says a repealed section was replaced, and refuses to pick an era', async ({ page }) => {
    await page.goto('/draft/reply')
    await page.getByRole('button', { name: 'I understand' }).click()
    await page.getByLabel('The letter that arrived').fill(INTAKE_LETTERS.citesIpc)
    await page.getByRole('button', { name: 'Read it' }).click()

    const read = page.getByRole('region', { name: 'What was read' })
    await expect(read.getByText(/section 420 of the Indian Penal Code/i)).toBeVisible()
    // The mapping resolves through `data/law`, which the route loads lazily.
    await expect(read.getByText(/Now BNS /)).toBeVisible({ timeout: 30_000 })
    // And the date rule, stated by the APP: this letter gives no offence date,
    // so it says it does not know rather than choosing a Sanhita.
    await expect(read.getByText(/turns on the date of the offence/)).toBeVisible()
  })

  test('reads the same in Hindi', async ({ page }) => {
    await page.goto('/draft')
    await setLanguage(page, 'hi')
    await page.goto('/draft/reply')
    await expect(page.getByRole('heading', { level: 2, name: 'किसी पत्र का उत्तर दें' })).toBeVisible()
    await page.getByRole('button', { name: 'मैं समझ गया/गई' }).click()
    await page.getByLabel('प्राप्त पत्र').fill(INTAKE_LETTERS.hindiOm)
    await page.getByRole('button', { name: 'इसे पढ़ें' }).click()
    await expect(page.getByRole('region', { name: 'क्या पढ़ा गया' }).getByText(/अर्जित अवकाश/)).toBeVisible()
  })

  test('the reply screen and the register are clean under axe', async ({ page }) => {
    await page.goto('/draft/reply')
    await page.getByRole('button', { name: 'I understand' }).click()
    await page.getByLabel('The letter that arrived').fill(INTAKE_LETTERS.withEnclosures)
    await page.getByRole('button', { name: 'Read it' }).click()
    await expect(
      page.getByRole('region', { name: 'What was read' }).getByText(/creation of two posts/),
    ).toBeVisible()

    const reply = await audit(page)
    expect(formatViolations(reply), 'axe violations on the reply screen').toEqual([])

    await page.goto('/draft/register')
    await page.getByRole('button', { name: 'Add an entry' }).click()
    await expect(page.getByLabel('Subject')).toBeVisible()
    const register = await audit(page)
    expect(formatViolations(register), 'axe violations on the register').toEqual([])
  })
})
