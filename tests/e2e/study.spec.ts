import type { Page } from '@playwright/test'

import { dismissPwaToasts, expect, onPhone, serviceWorkerReady, setLanguage, t, test } from './fixtures'

/**
 * Session 28's study layer, in a real browser.
 *
 * Two claims only a browser can settle, and they are the two the brief names:
 *
 *  1. **With AI off — every device's default — the precomputed aid is on the
 *     page and NOTHING is sent.** The `network` fixture is armed automatically
 *     for every test in this file and no test declares `allowCrossOrigin`, so
 *     the run is itself the privacy assertion; a sentinel typed into the
 *     own-words box makes it a stronger one than "no cross-origin request",
 *     because that value must appear in no URL, query string or body.
 *  2. **Read a chapter, rate your confidence, and the chapter is in the revise
 *     list when its due date arrives.** The clock is moved forward in the PAGE
 *     rather than by waiting, because the FSRS interval for a first rating is
 *     days and no test can wait that long.
 */

const WORK = 'ccs-conduct'
const UNIT = 'ccs-conduct-3'

/**
 * Open one of the reader rail's four tabs (Session 35).
 *
 * The rail was a column of six cards and is four tabs now, so a test that wants
 * the own-words box or the chapter card has to say which panel it means. On a
 * phone the rail is a sheet, and the floating button is what opens it — so the
 * helper asks the page which presentation it is looking at rather than assuming
 * the desktop one, which is the whole reason the mobile project exists.
 */
async function rail(
  page: Page,
  tab: 'understand' | 'practise' | 'related' | 'ask',
  language: 'en' | 'hi' = 'en',
) {
  if (onPhone(page)) {
    const open = page.getByRole('button', { name: t(language, 'library.railTabs.open') })
    if (await open.isVisible()) await open.click()
  }
  const control = page.getByRole('tab', { name: t(language, `library.railTabs.${tab}`) })
  await control.click()
  await expect(control).toHaveAttribute('aria-selected', 'true')
}

test('the study aid is there with AI off, and nothing leaves the device', async ({ page, network }) => {
  const typed = network.sentinel('feynman')

  await page.goto(`/study/read/${WORK}/${UNIT}`)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

  /*
    The aid is the rail's FIRST tab, badged as this project's own writing —
    never as the provision, which is the card beside it.

    On a phone the rail is a sheet, so "first" means one tap on a floating
    button rather than on screen already: a rail under a 4,000-character
    provision is a rail nobody scrolls to, and one tap is nearer than that.
    `docs/AI.md` §13's ordering is about which of the four comes first, and it
    still does.
  */
  await rail(page, 'understand')
  await expect(page.getByText(t('en', 'library.study.aid.badge'))).toBeVisible()
  await expect(page.getByText(t('en', 'library.study.aid.disclaimer'))).toBeVisible()

  // And the AI surface is not merely disabled — it is not in the DOM, because
  // `ReaderPage` mounts it behind `React.lazy` AND `studyAiAvailable`.
  await expect(page.getByText(t('en', 'library.study.ask.title'))).toHaveCount(0)

  // The own-words box is the one place a reader types prose on this screen.
  await rail(page, 'practise')
  await page.getByRole('button', { name: t('en', 'library.study.feynman.start') }).click()
  await page.getByRole('textbox', { name: /own words/i }).fill(typed)
  await page.getByRole('button', { name: t('en', 'library.study.feynman.submit') }).click()
  await expect(page.getByText(t('en', 'library.study.feynman.gradeHeading'))).toBeVisible()
  await page.getByRole('button', { name: t('en', 'library.study.feynman.save') }).click()
  await expect(page.getByText(t('en', 'library.study.feynman.saved'))).toBeVisible()

  // Teardown fails the test if `typed` reached any request at all.
})

test('rating a chapter puts it in the revise list when it falls due', async ({ page }) => {
  await page.goto(`/study/read/${WORK}/${UNIT}`)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

  // "I would have to look it up" — a Hard grade, so the interval is short but
  // still measured in days, which is exactly why the clock has to move.
  await rail(page, 'practise')
  await page.getByRole('button', { name: t('en', 'library.study.revise.level.2') }).click()
  await expect(page.getByText(/^Rated\./)).toBeVisible()

  // Nothing is due yet — the rating just moved it into the future.
  await page.goto('/study/read')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByText(t('en', 'library.study.revise.heading'))).toHaveCount(0)

  /*
    Move the due date back rather than the clock forward.

    Faking `Date` in the page is possible, but the app has already booted by
    then and Dexie, i18next and the service worker have all read the real one.
    Rewriting the stored row is the same assertion with none of that risk: the
    question is whether the hub finds a card whose `due` has passed, and this
    produces exactly that state.
  */
  await page.evaluate(async () => {
    const open = indexedDB.open('sahayak')
    const database: IDBDatabase = await new Promise((resolve, reject) => {
      open.onsuccess = () => resolve(open.result)
      open.onerror = () => reject(open.error ?? new Error('indexedDB.open failed'))
    })
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction('chapterCards', 'readwrite')
      const store = tx.objectStore('chapterCards')
      const all = store.getAll()
      all.onsuccess = () => {
        for (const row of all.result as { due: string }[]) {
          store.put({ ...row, due: '2020-01-01T00:00:00.000Z' })
        }
      }
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('chapterCards transaction failed'))
    })
    database.close()
  })

  await page.reload()
  await expect(page.getByText(t('en', 'library.study.revise.heading'))).toBeVisible()
  // The row names the chapter and links back into it.
  await expect(page.getByRole('link', { name: /^Revise:/ })).toBeVisible()
})

test('the chapter quiz draws approved trainer cards and says nothing is generated', async ({ page }) => {
  await page.goto(`/study/read/${WORK}`)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

  await page
    .getByRole('link', { name: t('en', 'library.study.quiz.title') })
    .first()
    .click()
  await expect(page).toHaveURL(/\/study\/read\/ccs-conduct\/quiz\//)
  await expect(page.getByText(t('en', 'library.study.quiz.onlyApproved'))).toBeVisible()
})

test('the weekly review and the revision sheet work offline', async ({ page, context }) => {
  await page.goto('/settings/ai')
  await expect(page.getByRole('main')).toBeVisible()
  await serviceWorkerReady(page)
  await dismissPwaToasts(page)

  await context.setOffline(true)

  await page.goto('/study/progress')
  await expect(
    page.getByRole('heading', { level: 1, name: t('en', 'library.study.review.title') }),
  ).toBeVisible()
  await expect(page.getByText(t('en', 'library.study.review.localOnly'))).toBeVisible()

  await page.goto(`/study/read/${WORK}/sheet/group-n-ccs-conduct-1`)
  await expect(page.getByRole('heading', { level: 1, name: /Revision sheet/ })).toBeVisible()
})

test('the study layer is bilingual', async ({ page }) => {
  // `setLanguage` asserts an <h1> is on screen before it toggles, so the page
  // has to be somewhere first — it is idempotent and the preference persists,
  // so arriving on the reader afterwards is already Hindi.
  await page.goto(`/study/read/${WORK}/${UNIT}`)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await setLanguage(page, 'hi')
  await rail(page, 'understand', 'hi')
  await expect(page.getByText(t('hi', 'library.study.aid.badge'))).toBeVisible()
  await rail(page, 'practise', 'hi')
  await expect(page.getByRole('button', { name: t('hi', 'library.study.feynman.start') })).toBeVisible()
})
