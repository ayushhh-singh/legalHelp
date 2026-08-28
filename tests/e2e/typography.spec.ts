import type { Page } from '@playwright/test'

import { expect, test } from './fixtures'

/**
 * Which face a glyph ACTUALLY renders in, read from Chromium itself via
 * CSS.getPlatformFontsForNode — not from `font-family`, which reports the whole
 * stack whether or not a font loaded, and not from `document.fonts.check`, which
 * only says a face is available.
 *
 * This closes docs/DATA-GAPS.md #3: the unit test
 * (src/components/common/PageHeader.test.tsx) can only verify the token chain,
 * because jsdom neither loads fonts nor rasterises.
 *
 * Two things the API forces on this test, both real rather than incidental:
 *   - names are PLATFORM names ("Poppins SemiBold"), so families are matched by
 *     prefix, not equality;
 *   - a run of text almost always uses more than one face, because the space
 *     character resolves to the first family in the stack that has one. So the
 *     assertion is about which face carries the MOST glyphs, not the only one.
 */
async function usedFonts(page: Page, selector: string): Promise<{ name: string; glyphs: number }[]> {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('DOM.enable')
  await cdp.send('CSS.enable')
  const { root } = await cdp.send('DOM.getDocument')
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector })
  const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId })
  await cdp.detach()
  return fonts
    .filter((font) => font.glyphCount > 0)
    .map((font) => ({ name: font.familyName, glyphs: font.glyphCount }))
    .sort((a, b) => b.glyphs - a.glyphs)
}

/** The family carrying the most glyphs in that element. */
async function dominantFont(page: Page, selector: string): Promise<string> {
  const fonts = await usedFonts(page, selector)
  expect(fonts.length, `no fonts reported for ${selector}`).toBeGreaterThan(0)
  return fonts[0]?.name ?? ''
}

test('a Latin heading renders in Poppins', async ({ page }) => {
  await page.goto('/law')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Law Converter')
  await page.evaluate(() => document.fonts.ready)

  expect(await dominantFont(page, 'main h1')).toMatch(/^Poppins/)
})

test('a Devanagari heading renders in Noto Sans Devanagari, not a system fallback', async ({ page }) => {
  await page.goto('/law')
  // Poppins carries no Devanagari (tokens.css), so the heading falls through
  // glyph-by-glyph to the next family in --font-heading.
  await page.getByRole('button', { name: 'Switch to Hindi' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('विधि परिवर्तक')
  await page.evaluate(() => document.fonts.ready)

  expect(await dominantFont(page, 'main h1')).toMatch(/^Noto Sans Devanagari/)
})

/**
 * The Law Converter's search hint: body copy, always on screen, and — the part
 * that matters here — SINGLE-SCRIPT in each language.
 *
 * It replaced `main p.max-w-prose`, which was the empty state's body, for two
 * reasons. That paragraph is not rendered until the section tables have parsed,
 * so `CSS.getPlatformFontsForNode` was handed a node id of 0; and its Hindi
 * copy quotes Latin search examples ("sec 438 crpc", "hatya"), which is right
 * for a reader and wrong for a test that asks which face dominates.
 */
const BODY_COPY = '#law-search-hint'

test('body copy renders in Inter', async ({ page }) => {
  await page.goto('/law')
  await expect(page.locator(BODY_COPY)).toBeVisible()
  await page.evaluate(() => document.fonts.ready)

  expect(await dominantFont(page, BODY_COPY)).toMatch(/^Inter/)
})

test('Hindi body copy renders in Noto Sans Devanagari', async ({ page }) => {
  await page.goto('/law')
  await page.getByRole('button', { name: 'Switch to Hindi' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('विधि परिवर्तक')
  await expect(page.locator(BODY_COPY)).toBeVisible()
  await page.evaluate(() => document.fonts.ready)

  expect(await dominantFont(page, BODY_COPY)).toMatch(/^Noto Sans Devanagari/)
})

test('loads every font from its own origin', async ({ page, baseURL }) => {
  const origin = new URL(baseURL ?? 'http://localhost:4173').origin
  const fontRequests: string[] = []

  page.on('request', (request) => {
    if (request.resourceType() === 'font') fontRequests.push(request.url())
  })

  await page.goto('/law')
  await page.getByRole('button', { name: 'Switch to Hindi' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('विधि परिवर्तक')
  await page.evaluate(() => document.fonts.ready)

  expect(fontRequests.length, 'no webfont was requested at all').toBeGreaterThan(0)
  for (const url of fontRequests) expect(new URL(url).origin).toBe(origin)
})
