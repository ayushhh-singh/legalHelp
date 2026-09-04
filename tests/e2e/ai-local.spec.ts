import { audit, dismissPwaToasts, expect, formatViolations, test } from './fixtures'

/**
 * Tier 0 in a real browser: what selecting it costs, and where it is allowed
 * to fetch from.
 *
 * The claim the whole tier rests on is that nothing the officer types leaves
 * the device. The one thing that DOES cross the network is the model download,
 * and it is deliberate, one-time, and started by hand. So the two assertions
 * that matter here are:
 *
 *   1. choosing the tier, reading the model list and being told what this
 *      device can run contacts NOTHING. That is the automatic `network`
 *      fixture's doing, not this spec's — the first test declares no
 *      `allowCrossOrigin` at all, so any cross-origin request fails it.
 *   2. when the reader does press Download, the ONLY hosts contacted are the
 *      two the model catalogue names and `public/_headers` permits. The second
 *      test asserts the domains, one by one, from what the browser actually
 *      requested.
 *
 * Headless Chromium has no WebGPU adapter, so the second test stubs
 * `navigator.gpu` and intercepts the CDN. Nothing is downloaded: the point is
 * WHERE the request went, and a test that really fetched a gigabyte of weights
 * would be a test of Hugging Face's uptime.
 */

/** The two hosts src/ai/local/catalogue.test.ts pins every model record to. */
const MODEL_HOSTS = /^https:\/\/(huggingface\.co|raw\.githubusercontent\.com)\//

async function chooseLocalTier(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/settings/ai')
  await dismissPwaToasts(page)
  await page.getByRole('button', { name: 'Read what this sends' }).click()
  await page.getByRole('button', { name: 'I have read this — enable AI' }).click()
  await page
    .getByRole('radiogroup', { name: 'How AI runs' })
    .getByRole('radio', { name: /On this device/ })
    .click()
}

test('choosing the on-device tier lists the models and contacts nothing', async ({ page }) => {
  // No allowCrossOrigin is declared. Any request that leaves this origin —
  // including a model download nobody asked for — fails this test at teardown.
  await chooseLocalTier(page)

  const section = page.getByRole('radiogroup', { name: 'On-device model' })
  await expect(section).toBeVisible({ timeout: 30_000 })

  // Every model states its size and how good its Hindi is, before a byte is
  // fetched. "1.6 GB" is the figure a reader on a metered connection needs and
  // it comes from web-llm's own record (src/ai/local/catalogue.test.ts).
  const rows = section.getByRole('radio')
  await expect(rows).toHaveCount(5)
  await expect(rows.first()).toContainText('0.9 GB')
  await expect(section).toContainText('Hindi: rough')
  await expect(section).toContainText('Hindi: usable')
  await expect(section.getByText('Not downloaded').first()).toBeVisible()

  // The Anthropic model picker is not RENDERED on this tier: it names no model
  // Tier 0 can run, and a control hidden with a class still exists for
  // anything reading the document.
  await expect(page.getByLabel('Model', { exact: true })).toHaveCount(0)

  // Headless Chromium has no WebGPU adapter, which is a real device state and
  // is reported as one rather than as a broken screen.
  await expect(page.getByText(/No WebGPU|WebGPU available/)).toBeVisible()
})

test('the tier reports honestly when this device cannot run any model', async ({ page }) => {
  await chooseLocalTier(page)

  await expect(page.getByRole('radiogroup', { name: 'On-device model' })).toBeVisible({
    timeout: 30_000,
  })
  await expect(page.getByText('No WebGPU')).toBeVisible()
  // Which of the two reasons applies depends on the runner — headless
  // Chromium ships the WebGPU API and then finds no adapter for it, and a
  // browser without the API at all is the other case. Both are real device
  // states, both name what the reader could change, and the spec must not
  // pin the one this machine happens to be in.
  await expect(page.getByText(/This browser has no WebGPU support|found no graphics adapter/)).toBeVisible()

  // And it refuses to start a download it knows will fail, rather than
  // spending a gigabyte to find out.
  await expect(page.getByRole('button', { name: 'Download model' })).toBeDisabled()
})

test('a download reaches only the model hosts, and no other domain', async ({ page, baseURL, network }) => {
  // The one declared exception in this file, and the reason the tier exists at
  // all: an on-device model has to arrive on the device once.
  network.allowCrossOrigin(MODEL_HOSTS)

  // Compared against the SERVER's origin, from the config, not against
  // `page.url()` — which is `about:blank` when the first request goes out, and
  // whose origin is then the string "null". Every request looked cross-origin,
  // every one was refused, and the page never loaded at all.
  const origin = new URL(baseURL ?? 'http://localhost:4173').origin
  const contacted: string[] = []

  await page.route('**/*', async (route) => {
    const url = route.request().url()
    if (url.startsWith(origin) || url.startsWith('data:') || url.startsWith('blob:')) {
      await route.fallback()
      return
    }
    contacted.push(url)
    // Refused rather than fulfilled with weights: the assertion is about WHERE
    // the request went. A real download would be a test of Hugging Face.
    await route.fulfill({ status: 404, contentType: 'text/plain', body: 'not in this test' })
  })

  // A WebGPU adapter that reports the feature the default model needs, so the
  // guard in src/ai/local/webgpu.ts lets the download start. Everything past
  // this point is web-llm's own code path.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'gpu', {
      configurable: true,
      value: {
        requestAdapter: () =>
          Promise.resolve({
            features: { has: () => true },
            limits: { maxBufferSize: 2 * 1024 * 1024 * 1024 },
          }),
      },
    })
  })

  await chooseLocalTier(page)
  const download = page.getByRole('button', { name: 'Download model' })
  await expect(download).toBeEnabled({ timeout: 30_000 })

  // Nothing has been fetched yet. Selecting the tier is free.
  expect(contacted).toEqual([])

  await download.click()

  // Polled on the LIST, not on a status element. The progress region says
  // "0% downloaded" the instant the button is pressed — before the ~6 MB
  // runtime chunk has even loaded, let alone anything cross-origin — so
  // waiting for a status to appear waits for nothing and reads `contacted`
  // while it is still legitimately empty. Which it did, and the failure looked
  // exactly like "no request was ever made".
  await expect
    .poll(() => contacted.length, {
      timeout: 90_000,
      message: 'the download reached no host at all',
    })
    .toBeGreaterThan(0)

  for (const url of contacted) {
    expect(url, `${url} is not one of the two model hosts`).toMatch(MODEL_HOSTS)
  }
  // Named explicitly, so a future library that quietly added a telemetry or a
  // font host would fail here rather than pass a regex that happens to be wide.
  const hosts = [...new Set(contacted.map((url) => new URL(url).host))].sort()
  expect(hosts.every((host) => ['huggingface.co', 'raw.githubusercontent.com'].includes(host))).toBe(true)
})

test('the on-device section passes axe', async ({ page }) => {
  await chooseLocalTier(page)
  await expect(page.getByRole('radiogroup', { name: 'On-device model' })).toBeVisible({
    timeout: 30_000,
  })

  const violations = await audit(page)
  expect(formatViolations(violations), 'axe violations on the on-device model section').toEqual([])
})

test('with AI off, nothing about the on-device model renders at all', async ({ page }) => {
  // Every device's default. The section, the model list and the ~6 MB runtime
  // are all behind this.
  await page.goto('/settings/ai')
  await dismissPwaToasts(page)
  await expect(page.getByRole('heading', { name: 'AI features' })).toBeVisible()
  await expect(page.getByRole('radiogroup', { name: 'On-device model' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Download model' })).toHaveCount(0)
})
