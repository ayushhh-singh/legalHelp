import { dismissPwaToasts, expect, serviceWorkerReady, setLanguage, t, test } from './fixtures'

/**
 * The Library, in a real browser.
 *
 * The brief's own acceptance flow is the first test: open a work OFFLINE, read
 * three units, reload, and check that "continue reading" comes back to the
 * third. That exercises the two things unit tests cannot reach — whether the
 * corpus chunk was actually precached, and whether progress written to
 * IndexedDB survives a navigation and a reload.
 *
 * `network` is armed automatically for every test in this file (see
 * `fixtures.ts`); nothing here declares `allowCrossOrigin`, so the run is also
 * a privacy assertion: reading a rule book reaches no host at all.
 */

const WORK = 'ccs-conduct'
/** Three real, consecutive rules of the CCS (Conduct) Rules, 1964. */
const UNITS = ['ccs-conduct-1', 'ccs-conduct-2', 'ccs-conduct-3']

test('reads three units offline and comes back to the third after a reload', async ({ page, context }) => {
  // Install the service worker from a route that loads NONE of the Library's
  // chunks, so nothing is warmed by having been there first.
  await page.goto('/settings')
  await expect(page.getByRole('main')).toBeVisible()
  await serviceWorkerReady(page)
  await dismissPwaToasts(page)

  await context.setOffline(true)

  await page.goto('/library')
  await expect(page.getByRole('heading', { level: 1, name: t('en', 'library.title') })).toBeVisible()

  // The shelf, then the work, then the reader — every byte out of the cache.
  await page.getByRole('link', { name: 'Central Civil Services (Conduct) Rules, 1964' }).click()
  await expect(page).toHaveURL(new RegExp(`/library/${WORK}$`))
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Conduct')

  await page
    .getByRole('button', { name: t('en', 'library.startReading') })
    .or(page.getByRole('link', { name: t('en', 'library.startReading') }))
    .click()
  await expect(page).toHaveURL(new RegExp(`/library/${WORK}/${UNITS[0]}$`))

  // Rules 1 -> 2 -> 3, through the reader's own Next control.
  for (const unitId of UNITS.slice(1)) {
    await page.getByRole('link', { name: new RegExp(`^${t('en', 'library.reader.next')}`) }).click()
    await expect(page).toHaveURL(new RegExp(`/library/${WORK}/${unitId}$`))
  }

  // The third unit is real text, not a skeleton: Rule 3 is the integrity rule.
  await expect(page.getByText(/absolute integrity/i).first()).toBeVisible()

  // Progress is written on arrival, so it is already there — no dwell needed.
  await page.reload()
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

  await page.goto('/library')
  const resume = page.getByRole('link', { name: t('en', 'library.continueReading') })
  await expect(resume).toBeVisible()
  await resume.click()
  await expect(page).toHaveURL(new RegExp(`/library/${WORK}/${UNITS[2]}$`))
})

test('searches inside a work and opens the hit', async ({ page }) => {
  await page.goto(`/library/${WORK}`)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

  await page.getByLabel(t('en', 'library.search.within')).fill('absolute integrity')

  const hit = page.getByRole('link', { name: /General/ }).first()
  await expect(hit).toBeVisible()
  await hit.click()
  await expect(page).toHaveURL(new RegExp(`/library/${WORK}/ccs-conduct-3$`))
})

test('moves between units with j and k, and not while typing', async ({ page }) => {
  await page.goto(`/library/${WORK}/${UNITS[1]}`)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

  await page.keyboard.press('j')
  await expect(page).toHaveURL(new RegExp(`/library/${WORK}/${UNITS[2]}$`))

  /**
   * THE SECOND PRESS IS THE ONE THAT CATCHES ANYTHING, and only here.
   *
   * The reader's key handler first shipped as a mount-only listener reading a
   * "latest ref" updated in an effect — the shape `useGlobalShortcuts` uses.
   * That ref lands after paint, and the neighbours change on every navigation,
   * so a `k` arriving between the re-render and the effect flush read the
   * PREVIOUS unit's neighbours and went back two rules: from Rule 3 to Rule 1.
   *
   * The equivalent jsdom test passes against that version — React flushes
   * passive effects between two `userEvent` interactions, so the window never
   * opens under a test renderer. Only a real browser presses fast enough.
   */
  await page.keyboard.press('k')
  await expect(page).toHaveURL(new RegExp(`/library/${WORK}/${UNITS[1]}$`))

  // Home jumps to the first unit of the work.
  await page.keyboard.press('Home')
  await expect(page).toHaveURL(new RegExp(`/library/${WORK}/${UNITS[0]}$`))
})

test('states the missing Hindi text rather than showing an empty pane', async ({ page }) => {
  // No source in this dataset publishes a readable Hindi text layer (ADR-023),
  // so "read in Hindi" must announce that and show the English — never a blank
  // page, and never a machine translation.
  await page.goto(`/library/${WORK}/${UNITS[2]}`)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

  await page.getByRole('button', { name: t('en', 'library.lang.hi'), exact: true }).click()

  await expect(page.getByText(t('en', 'library.reader.noHindi'))).toBeVisible()
  // The English text is still on the page under that notice.
  await expect(page.getByText(/absolute integrity/i).first()).toBeVisible()
})

test('is reachable in Hindi, from the More sheet on a phone and the sidebar on a desktop', async ({
  page,
}) => {
  await page.goto('/settings')
  await setLanguage(page, 'hi')

  await page.goto('/library')
  await expect(page.getByRole('heading', { level: 1, name: t('hi', 'library.title') })).toBeVisible()

  // A Hindi reader gets Hindi headings on a rule book whose English source
  // prints none — the authored headings scripts/authoring/hindi/*.json carries.
  await page.goto('/library/fr-sr')
  await expect(page.getByText('संक्षिप्त नाम और प्रारंभ')).toBeVisible()
})
