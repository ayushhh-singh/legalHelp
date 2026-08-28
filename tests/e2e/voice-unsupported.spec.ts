import { expect, test } from '@playwright/test'

/**
 * The Safari and Firefox story, run in a REAL WebKit.
 *
 * Both have (or lack) the speech API in ways that matter: WebKit exposes
 * `webkitSpeechRecognition` but none of `processLocally`, `available()` or
 * `install()`, so it can only recognise speech on a server. ADR-017 says this
 * app does not offer that path, so the microphone must not appear — and a
 * reader who goes looking for it must be able to find out why.
 *
 * This is the only spec that runs outside Chromium. It is here because the
 * decision it guards is about a browser difference, and asserting it in
 * Chromium would prove nothing at all.
 */
test('WebKit cannot recognise speech on the device', async ({ page }) => {
  await page.goto('/law')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

  const surface = await page.evaluate(() => {
    const scope = window as unknown as Record<string, unknown>
    const Ctor = (scope.SpeechRecognition ?? scope.webkitSpeechRecognition) as
      { prototype?: object } | undefined
    return {
      hasApi: Boolean(Ctor),
      hasProcessLocally: Ctor?.prototype ? 'processLocally' in Ctor.prototype : false,
    }
  })

  // If this ever changes, the assertions below are the ones to revisit — not
  // to delete. WebKit gaining `processLocally` would be good news.
  expect(surface.hasApi, 'WebKit dropped webkitSpeechRecognition').toBe(true)
  expect(surface.hasProcessLocally, 'WebKit gained processLocally — revisit ADR-017').toBe(false)
})

test('no microphone is offered, and Settings says why', async ({ page }) => {
  await page.goto('/law')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

  // Not hidden behind a disabled state: absent. A button that quietly uploads
  // what you say is worse than no button.
  await expect(page.getByRole('button', { name: 'Search by voice' })).toHaveCount(0)

  // But the reason is findable rather than something to read the source for.
  await page.goto('/settings')
  await expect(page.getByRole('heading', { name: 'Voice search' })).toBeVisible()
  await expect(page.getByText(/Not available in this browser/)).toBeVisible()
  await expect(page.getByText(/recognised on the device itself/)).toBeVisible()
})
