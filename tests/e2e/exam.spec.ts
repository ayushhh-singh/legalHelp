import { audit, expect, formatViolations, onPhone, setLanguage, t, test } from './fixtures'

/**
 * Exam mode, in a real browser: the brief's own journey end to end.
 *
 * Pick the Intelligence Bureau profile, generate a weighted mock, answer five
 * questions, read the per-topic results. Everything here runs with AI off —
 * every device's default — and the `network` fixture is armed automatically for
 * every test in this file with no `allowCrossOrigin` declared, so the run is
 * itself the assertion that a departmental examination's syllabus, a reader's
 * examination date and their answers all stay on the device.
 *
 * The date typed in is a `network.sentinel`-shaped value where it can be. It
 * cannot be here — a `<input type="date">` sanitises anything that is not a
 * calendar day — so the privacy claim rests on the automatic gate, which is
 * exactly what that gate exists for.
 */

/** An IST calendar day some weeks out, in the form the date input wants. */
function futureDay(days: number): string {
  return new Date(Date.now() + days * 86_400_000 + 5.5 * 3_600_000).toISOString().slice(0, 10)
}

test('pick a profile, generate a mock, answer five, read the per-topic results', async ({ page }) => {
  await page.goto('/study/exam')

  // The picker is honest about the ratio BEFORE the reader chooses.
  await expect(page.getByRole('heading', { name: t('en', 'trainer.exam.picker.title') })).toBeVisible()
  const card = page.locator('li', { hasText: 'Intelligence Bureau' }).first()
  await expect(card.getByText(/topics this app can teach/)).toBeVisible()
  await expect(card.getByText(/topics you study elsewhere/)).toBeVisible()

  await card.getByRole('button', { name: t('en', 'trainer.exam.picker.choose') }).click()

  // The readiness screen, with the mandatory banner and the caveat on the same
  // card as the figure.
  await expect(page.getByText(t('en', 'trainer.exam.banner'))).toBeVisible()
  await expect(page.getByText(/question bank only/)).toBeVisible()

  // The Intelligence Bureau's own standing orders are on the syllabus and hold
  // nothing — the boundary, on screen. This is the one assertion in this file
  // that is about what the app REFUSES to carry.
  await expect(page.getByText('Intelligence Bureau Standing Orders')).toBeVisible()

  // A date, and therefore a plan.
  await page.getByLabel(t('en', 'trainer.exam.target.label'), { exact: true }).fill(futureDay(45))
  await page.getByRole('button', { name: t('en', 'trainer.exam.target.save') }).click()
  await expect(page.getByText(/days to go/)).toBeVisible()

  await page.getByRole('link', { name: t('en', 'trainer.exam.plan.title') }).click()
  await expect(page.getByText(t('en', 'trainer.exam.plan.notStored'))).toBeVisible()
  // `exact`, because Playwright matches a string name as a case-insensitive
  // SUBSTRING and the card above this one says "today's schedule". CLAUDE.md
  // already records that trap costing half an hour on `{ name: 'Post' }`.
  await expect(page.getByText(t('en', 'trainer.exam.plan.today'), { exact: true })).toBeVisible()

  // The mock.
  await page.goto('/study/exam/mock')
  await expect(page.getByText(t('en', 'trainer.exam.mock.generated'))).toBeVisible()
  await expect(page.getByText(/Not mocked:/)).toBeVisible()
  // The default paper is the one this app can actually fill — Paper II here,
  // which maps eight of its ten topics. Paper I maps one of five and would
  // draw three questions out of fifteen, which is honest and is not a walk
  // through the feature.
  await expect(page.getByRole('button', { name: /Paper II/, pressed: true })).toBeVisible()
  await page.getByRole('button', { name: '15' }).click()
  await page.getByRole('button', { name: t('en', 'trainer.exam.mock.start') }).click()

  // Five questions: three answered, one left blank, one marked for review.
  for (let n = 0; n < 5; n += 1) {
    await expect(page.getByText(new RegExp(`Question ${n + 1} of`))).toBeVisible()
    if (n === 3) {
      // Left blank on purpose — a blank costs nothing, and the answer sheet has
      // to say so in the cell's accessible name rather than in its colour.
      await expect(page.getByRole('button', { name: `${n + 1}, blank`, exact: true })).toBeVisible()
    } else if (n === 4) {
      await page.getByRole('button', { name: t('en', 'trainer.exam.mock.flag') }).click()
      await expect(
        page.getByRole('button', { name: `${n + 1}, marked for review`, exact: true }),
      ).toBeVisible()
    } else {
      await page.getByRole('radio').first().check()
      await expect(page.getByRole('button', { name: `${n + 1}, answered`, exact: true })).toBeVisible()
    }
    // `exact` again: "Go to the next marked question" contains "Next".
    if (n < 4) {
      await page.getByRole('button', { name: t('en', 'trainer.exam.mock.next'), exact: true }).click()
    }
  }

  await page.getByRole('button', { name: t('en', 'trainer.exam.mock.submit') }).click()

  // The results: a score, the penalty as its OWN line, and per-topic accuracy
  // against the syllabus weight.
  await expect(page.getByRole('heading', { name: t('en', 'trainer.exam.mock.resultsTitle') })).toBeVisible()
  await expect(page.getByText(/of 150 marks/)).toBeVisible()
  await expect(page.getByText(t('en', 'trainer.exam.mock.resultsByUnit'))).toBeVisible()
  await expect(page.getByText(/the syllabus weight is/).first()).toBeVisible()
  await expect(page.getByText(t('en', 'trainer.exam.mock.practiceOnly'))).toBeVisible()

  // Ten of the fifteen were never reached, so at least ten are blank and the
  // paper is scored rather than refused.
  await expect(page.getByText(/blank/).first()).toBeVisible()
})

test('the exam-day checklist says only what the notification says', async ({ page }) => {
  await page.goto('/study/exam')
  await page
    .locator('li', { hasText: 'Central Secretariat Service' })
    .first()
    .getByRole('button', { name: t('en', 'trainer.exam.picker.choose') })
    .click()

  /*
    Wait for the app's own confirmation before navigating.

    Choosing a profile is a Dexie write, and a Dexie write does not finish
    before the click that started it returns — fast enough on a desktop, and not
    on the Pixel 7, where this failed with "the checklist wants an examination"
    two screens away from the real cause. CLAUDE.md records the same shape
    costing the Library a session; the confirmation here is the banner, which
    only renders once the row is readable.
  */
  await expect(page.getByText(t('en', 'trainer.exam.banner'))).toBeVisible()

  await page.goto('/study/exam')

  // The three items that would cost a candidate the most to be wrong about,
  // each traceable to a clause of the fetched Rules.
  await expect(page.getByText(/even switched off/)).toBeVisible()
  await expect(page.getByText(/is FINAL/)).toBeVisible()
  await expect(page.getByText(/A question left blank costs nothing/)).toBeVisible()
  // Scoped to the checklist's own source line: the notification is ALSO named
  // by the banner at the top of the same page since ADR-046 folded the
  // checklist into it, so an unscoped match resolves to two elements.
  await expect(page.getByText(/^Read off /)).toContainText(/No\. 6\/1\/2020-CS\.I\(P\)/)

  // It is a checklist, so it has checkboxes, and each one is labelled by the
  // sentence beside it rather than by its position.
  const boxes = page.getByRole('checkbox')
  expect(await boxes.count()).toBeGreaterThan(8)
  await boxes.first().check()
  await expect(boxes.first()).toBeChecked()
})

test('a Hindi reader gets the whole of it in Hindi', async ({ page }) => {
  // `setLanguage` waits on an h1, so it needs a rendered page to work from.
  await page.goto('/study/exam')
  await setLanguage(page, 'hi')

  await expect(page.getByRole('heading', { name: t('hi', 'trainer.exam.picker.title') })).toBeVisible()
  await expect(page.getByText(t('hi', 'trainer.exam.picker.boundary'))).toBeVisible()

  await page
    .locator('li', { hasText: 'आसूचना ब्यूरो' })
    .first()
    .getByRole('button', { name: t('hi', 'trainer.exam.picker.choose') })
    .click()

  // The banner, the weights caveat and the readiness caveat are the three
  // sentences this module must never render in the other language: they are
  // what stop a figure being read as more than it is.
  await expect(page.getByText(t('hi', 'trainer.exam.banner'))).toBeVisible()
  await expect(page.getByText(/यह विभाजन इस ऐप का है/)).toBeVisible()
  await expect(page.getByText(/इस ऐप के अपने प्रश्न-भंडार पर मापा गया/)).toBeVisible()

  // And the syllabus itself, from `data/exams`, is Hindi too.
  await expect(page.getByText('आसूचना ब्यूरो स्थायी आदेश')).toBeVisible()
})

test('axe over the readiness screen and a running mock paper', async ({ page }) => {
  await page.goto('/study/exam')
  await page
    .locator('li', { hasText: 'Intelligence Bureau' })
    .first()
    .getByRole('button', { name: t('en', 'trainer.exam.picker.choose') })
    .click()
  await expect(page.getByText(t('en', 'trainer.exam.banner'))).toBeVisible()

  // The readiness screen with a profile chosen — the per-topic bars, the
  // progress bars and the next-actions list, none of which the route sweep in
  // `a11y.spec.ts` can see, because that sweep runs with nothing chosen.
  expect(formatViolations(await audit(page)), 'the readiness screen').toEqual([])

  await page.goto('/study/exam/mock')
  await page.getByRole('button', { name: t('en', 'trainer.exam.mock.start') }).click()
  // `exact` for the third time in this file: "1, blank" is a substring of
  // "11, blank" and "21, blank", so an inexact match is a strict-mode
  // violation on any paper with eleven or more questions.
  await expect(page.getByRole('button', { name: '1, blank', exact: true })).toBeVisible()

  // A running paper: a radiogroup, a timer, and an answer sheet of forty-odd
  // buttons whose state is in their accessible name.
  expect(formatViolations(await audit(page)), 'a running mock paper').toEqual([])
})

test('exam mode is one sub-tab of Study, offered and never forced', async ({ page }) => {
  /*
    It was a sixth button in a grid on the Trainer's home screen. ADR-046 made
    it a sub-tab of Study — still offered rather than a mode the app switches
    into, and now visible from Read and My notes as well, which is where a
    reader deciding whether to prepare for an examination actually is.

    The claim that matters is unchanged: a reader who is not sitting one sees a
    label and downloads none of `data/exams`.
  */
  await page.goto('/study/practise')
  const tab = page.getByRole('link', { name: 'Exam' })
  await expect(tab).toBeVisible()

  // On a phone the strip scrolls rather than wrapping; the tab is still there,
  // which is the thing that matters.
  if (onPhone(page)) await expect(tab).toBeVisible()

  await tab.click()
  await expect(page).toHaveURL(/\/study\/exam$/)
  await expect(page.getByRole('heading', { name: t('en', 'trainer.exam.picker.title') })).toBeVisible()
})
