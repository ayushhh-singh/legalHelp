import { existsSync, readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'

import { describe, expect, it } from 'vitest'

import { fromRoot, readFromRoot } from '@/test/paths'

/**
 * The initial route's weight, and the proof that the AI layer is not in it.
 *
 * Session 3A's acceptance condition was "no bundle-size regression greater than
 * 30 KB gzip on the initial route (AI code lazy-loaded)". BASELINE_GZIP is the
 * measured figure from the build immediately before the AI layer landed; the
 * assertion is against that fixed number rather than a re-measured one, so the
 * budget cannot drift upwards one commit at a time.
 *
 * `pnpm check` does not build. Run `pnpm build && pnpm test` for these; CI does.
 */

/** Entry JS + stylesheet, gzip -9, measured on the pre-AI build of 2026-08-28. */
const BASELINE_GZIP = 146_038
const BUDGET_GZIP = 30 * 1024

/** Everything index.html itself pulls in — the true initial route. */
function initialRouteAssets(): string[] {
  const html = readFromRoot('dist/index.html')
  const refs = [...html.matchAll(/(?:src|href)="\/(assets\/[^"]+)"/g)].map((match) => match[1] ?? '')
  return [...new Set(refs)].filter(Boolean)
}

const gzipBytes = (asset: string) => gzipSync(readFileSync(fromRoot('dist', asset)), { level: 9 }).length

describe('bundle budget', () => {
  const built = existsSync(fromRoot('dist', 'index.html')) ? it : it.skip

  built('keeps the initial route within 30 KB gzip of the pre-AI baseline', () => {
    const assets = initialRouteAssets()
    expect(assets.length).toBeGreaterThan(0)

    const total = assets.reduce((sum, asset) => sum + gzipBytes(asset), 0)
    expect(total, `initial route is ${total} bytes gzip; baseline ${BASELINE_GZIP}`).toBeLessThanOrEqual(
      BASELINE_GZIP + BUDGET_GZIP,
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

  built('loads the AI settings and the Tier 1 provider as separate chunks', () => {
    // index.html preloads the entry graph. Neither of these may be in it.
    const html = readFromRoot('dist/index.html')
    expect(html).not.toContain('AiSettingsSection')
    expect(html).not.toContain('anthropic-direct')
  })
})
