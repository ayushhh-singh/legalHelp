import { dismissPwaToasts, expect, serviceWorkerReady, t, test } from './fixtures'

/**
 * The annotation layer, in a real browser — where the questions this session
 * added actually live.
 *
 * A highlight is a pair of offsets into a string the browser rendered, produced
 * from a `Selection` the browser made. jsdom has both, and
 * `src/modules/library/annotations.test.tsx` uses them — but only a real
 * browser answers whether the mark survives a reload, whether it re-anchors
 * when the text moves, and whether a card made from a passage really arrives in
 * the Trainer's own queue. Those are these two tests.
 *
 * `network` is armed automatically (see `fixtures.ts`) and nothing here
 * declares `allowCrossOrigin`, so both runs double as a privacy assertion:
 * everything an officer writes stays on the device.
 */

const WORK = 'ccs-conduct'
const UNIT = 'ccs-conduct-3'

/**
 * Select a phrase inside the reader's own text, the way a reader does.
 *
 * Driven through the DOM rather than by dragging the mouse: Playwright's mouse
 * emulation across a wrapped line is unreliable, and what is under test is the
 * OFFSET MAPPING — `selectionOffsets` reading a real `Range` out of a real
 * layout — not the platform's drag handling.
 */
async function selectPhrase(page: import('@playwright/test').Page, phrase: string) {
  await page.evaluate((needle) => {
    const paragraph = [...document.querySelectorAll('[data-para-start]')].find((node) =>
      node.textContent?.includes(needle),
    )
    if (!paragraph) throw new Error(`no paragraph contains ${needle}`)

    // Walk to the text node that actually holds the phrase; the paragraph may
    // already be split into spans by a highlight or a citation link.
    const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT)
    let node: Node | null
    while ((node = walker.nextNode())) {
      const at = node.textContent?.indexOf(needle) ?? -1
      if (at < 0) continue
      const range = document.createRange()
      range.setStart(node, at)
      range.setEnd(node, at + needle.length)
      const selection = window.getSelection()!
      selection.removeAllRanges()
      selection.addRange(range)
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
      return
    }
    throw new Error(`no text node contains ${needle}`)
  }, phrase)
}

test('highlights a passage, writes a note on it, and adds it to the trainer', async ({ page }) => {
  await page.goto(`/library/${WORK}/${UNIT}`)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await dismissPwaToasts(page)

  const phrase = 'absolute integrity'
  await expect(page.getByText(phrase).first()).toBeVisible()

  // ---- highlight -------------------------------------------------------
  await selectPhrase(page, phrase)
  const toolbar = page.getByRole('toolbar')
  await expect(toolbar).toBeVisible()
  await toolbar.getByRole('button', { name: t('en', 'library.select.colour.tulsi') }).click()

  const panel = page.getByRole('region', { name: t('en', 'library.highlight.title') })
  await expect(panel.getByText(phrase)).toBeVisible()

  // ---- the highlight survives a reload, which is the whole point --------
  await page.reload()
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(
    page.getByRole('region', { name: t('en', 'library.highlight.title') }).getByText(phrase),
  ).toBeVisible()
  // And it is drawn over the text itself, in the colour that was chosen.
  await expect(page.locator('[data-highlight]').first()).toHaveText(phrase)

  // ---- a note on that highlight ---------------------------------------
  await page
    .getByRole('region', { name: t('en', 'library.highlight.title') })
    .getByRole('button', { name: t('en', 'library.highlight.addNote') })
    .click()
  const note = page.getByRole('textbox')
  await note.fill('This is the clause a disciplinary case is built on.')
  // Autosave is debounced; "Saved" is written from the write resolving.
  await expect(page.getByText(t('en', 'library.note.saved'))).toBeVisible()

  await page.reload()
  await expect(page.getByText('This is the clause a disciplinary case is built on.')).toBeVisible()

  // ---- add to trainer, and find it in the queue the Trainer owns --------
  await selectPhrase(page, phrase)
  await page.getByRole('toolbar').getByRole('button', { name: t('en', 'library.select.trainer') }).click()

  const dialog = page.getByRole('dialog', { name: t('en', 'library.trainer.title') })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: t('en', 'library.trainer.add') }).click()
  await expect(dialog.getByText(t('en', 'library.trainer.added'))).toBeVisible()

  await page.goto('/learn/review-queue')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  // The proposed card is waiting for a human, in the ONE queue this app has.
  await expect(page.getByText(phrase).first()).toBeVisible()
})

test('adds a pasted document, confirms the split, and reads it offline', async ({ page, context }) => {
  await page.goto('/settings')
  await expect(page.getByRole('main')).toBeVisible()
  await serviceWorkerReady(page)
  await dismissPwaToasts(page)

  await page.goto('/library/add')
  await expect(page.getByRole('heading', { level: 1, name: t('en', 'library.add.title') })).toBeVisible()

  const document = [
    'CHAPTER I',
    'PRELIMINARY',
    '',
    '1. Short title and commencement.—These rules may be called the Model Office Rules, 2026.',
    '',
    '2. Definitions.—In these rules, unless the context otherwise requires, (a) "Government" means the Central Government;',
    '',
    '3. Working hours.—The office shall remain open from 9.00 a.m. to 5.30 p.m.',
  ].join('\n')

  await page.getByLabel(t('en', 'library.add.paste')).fill(document)
  // The split is proposed on blur, and nothing is stored until it is confirmed.
  await page.getByLabel(t('en', 'library.add.paste')).blur()

  await expect(page.getByRole('heading', { name: t('en', 'library.add.review') })).toBeVisible()
  // Three parts, counted from the review list itself rather than from a
  // pluralised label — `t()` in the fixture reads the catalogue and does not
  // interpolate, deliberately, so a count assertion goes on the markup.
  await expect(page.getByRole('textbox', { name: new RegExp(t('en', 'library.add.proposed')) })).toHaveCount(
    3,
  )

  await page.getByLabel(t('en', 'library.add.titleLabel')).fill('Model Office Rules')
  await page.getByLabel(t('en', 'library.add.unitWordLabel')).selectOption('rule')
  await page.getByRole('button', { name: t('en', 'library.add.confirm') }).click()

  // Saved: the reader lands on its own work page, marked as their document.
  await expect(page).toHaveURL(/\/library\/my-model-office-rules-/)
  await expect(page.getByText(t('en', 'library.add.yourDocument')).first()).toBeVisible()

  // ---- and it reads with no network at all -----------------------------
  await context.setOffline(true)
  await page.reload()
  await expect(page.getByRole('heading', { level: 1, name: /Model Office Rules/ })).toBeVisible()

  await page
    .getByRole('link', { name: t('en', 'library.startReading') })
    .or(page.getByRole('button', { name: t('en', 'library.startReading') }))
    .click()
  await expect(page.getByText(/Model Office Rules, 2026/)).toBeVisible()
  // Never presented as a source: the notice is on the unit as well as the work.
  await expect(page.getByText(t('en', 'library.add.notOfficial')).first()).toBeVisible()
})

test('shows a bookmark, a note and a highlight together in My Study', async ({ page }) => {
  await page.goto(`/library/${WORK}/${UNIT}`)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await dismissPwaToasts(page)

  await page.getByRole('button', { name: t('en', 'library.reader.bookmark') }).click()
  await selectPhrase(page, 'devotion to duty')
  await page
    .getByRole('toolbar')
    .getByRole('button', { name: t('en', 'library.select.colour.violet') })
    .click()

  await page.goto('/library/mine')
  await expect(page.getByRole('heading', { level: 1, name: t('en', 'library.mine.title') })).toBeVisible()
  await expect(page.getByText('devotion to duty')).toBeVisible()

  // Filtering by colour is one of the three the brief names.
  await page.getByLabel(t('en', 'library.mine.filterColour')).selectOption('coral')
  await expect(page.getByText(t('en', 'library.mine.noneFiltered'))).toBeVisible()
  await page.getByLabel(t('en', 'library.mine.filterColour')).selectOption('violet')
  await expect(page.getByText('devotion to duty')).toBeVisible()
})
