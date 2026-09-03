import { readdirSync, existsSync, readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'

import { describe, expect, it } from 'vitest'

import { fromRoot, readFromRoot } from '@/test/paths'

/**
 * The initial route's weight, and the proof that the AI layer is not in it.
 *
 * The number comes from scripts/size-budget.json — the SAME file
 * scripts/size-check.mjs gates CI on, so the test and the gate cannot
 * disagree. It is 250 KB gzip of JavaScript, set by this session's brief;
 * ADR-030 records why that replaced Session 3A's "pre-AI baseline + 30 KB"
 * rule, which three sessions of eagerly-loaded i18n growth had put out of
 * reach with no route back (docs/DATA-GAPS.md #55).
 *
 * The budget is the floor, not the goal. What this file adds on top of the
 * script is the part that is about privacy rather than speed: the AI layer's
 * network-capable code must not be in the initial route at all, at any size
 * (ADR-011).
 *
 * `pnpm check` does not build. Run `pnpm build && pnpm test` for these; CI does.
 */

const BUDGET = JSON.parse(readFromRoot('scripts/size-budget.json')) as {
  initialJs: number
  initialCss: number
}

/**
 * Everything index.html itself pulls in — the true initial route. Scoped to
 * .js and .css to match scripts/size-check.mjs exactly: the preloaded font
 * files are also referenced from the head, and a font is not script.
 */
function initialRouteAssets(): string[] {
  const html = readFromRoot('dist/index.html')
  const refs = [...html.matchAll(/(?:src|href)="\/(assets\/[^"]+)"/g)].map((match) => match[1] ?? '')
  return [...new Set(refs)].filter((asset) => asset.endsWith('.js') || asset.endsWith('.css'))
}

const gzipBytes = (asset: string) => gzipSync(readFileSync(fromRoot('dist', asset)), { level: 9 }).length

describe('bundle budget', () => {
  const built = existsSync(fromRoot('dist', 'index.html')) ? it : it.skip

  built('keeps the initial route inside the shared size budget', () => {
    const assets = initialRouteAssets()
    expect(assets.length).toBeGreaterThan(0)

    const js = assets.filter((asset) => asset.endsWith('.js')).reduce((sum, a) => sum + gzipBytes(a), 0)
    const css = assets.filter((asset) => asset.endsWith('.css')).reduce((sum, a) => sum + gzipBytes(a), 0)

    expect(js, `initial JS is ${js} bytes gzip; budget ${BUDGET.initialJs}`).toBeLessThanOrEqual(
      BUDGET.initialJs,
    )
    expect(css, `initial CSS is ${css} bytes gzip; budget ${BUDGET.initialCss}`).toBeLessThanOrEqual(
      BUDGET.initialCss,
    )
  })

  built('keeps every part of the AI layer that can reach the network out of it', () => {
    const initial = initialRouteAssets()
      .filter((asset) => asset.endsWith('.js'))
      .map((asset) => readFromRoot('dist', asset))
      .join('\n')

    // The endpoint, the direct-browser-access opt-in and the key-derivation
    // parameters all live behind a dynamic import. If any of them appears here,
    // the AI layer is being downloaded by readers who never turned it on.
    for (const marker of [
      'api.anthropic.com',
      'anthropic-dangerous-direct-browser-access',
      'PBKDF2',
      'anthropic-version',
    ]) {
      expect(initial, `"${marker}" reached the initial route`).not.toContain(marker)
    }
  })

  /**
   * The three chunks behind "add a document", absent from the PRECACHE.
   *
   * ~630 KB gzip of pdf.js, its worker and mammoth, for a feature most readers
   * never use. `globIgnores` in `vite.config.ts` keeps them out — and two of
   * the three patterns match a name the CHUNKER chose rather than one
   * `manualChunks` fixed, because naming pdf.js there put 125 KB of it on the
   * initial route (the budget above caught that, which is what it is for).
   *
   * This is the test that makes depending on a chunker-chosen name safe: a
   * rename fails here, loudly, instead of silently re-adding 630 KB to every
   * install. The `NetworkFirst` runtime rule still caches all three once
   * fetched, so a reader who HAS added a document keeps working offline.
   */
  built('keeps the two file readers and the PDF worker out of the precache', () => {
    const manifest = readFromRoot('dist/sw.js')
    const assets = readdirSync(fromRoot('dist/assets'))

    const excluded = assets.filter(
      (asset) => /^pdf[-.]/.test(asset) || asset.startsWith('docx-reader-') || asset.startsWith('web-llm-'),
    )
    // If this is empty the assertion below proves nothing — the chunks were
    // renamed and the globIgnores stopped matching, which is the failure.
    expect(excluded.length, 'no pdf/mammoth/web-llm chunk found in dist/assets').toBeGreaterThanOrEqual(3)

    for (const asset of excluded) {
      expect(manifest, `${asset} is precached and should not be`).not.toContain(asset)
    }
  })

  built('loads the AI settings and the Tier 1 provider as separate chunks', () => {
    // index.html preloads the entry graph. Neither of these may be in it.
    const html = readFromRoot('dist/index.html')
    expect(html).not.toContain('AiSettingsSection')
    expect(html).not.toContain('anthropic-direct')
  })
})
