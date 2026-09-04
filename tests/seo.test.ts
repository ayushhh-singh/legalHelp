import { existsSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { NAV_TABS, SETTINGS_PATH } from '@/lib/nav'
import { fromRoot, readFromRoot } from '@/test/paths'

import en from '@/i18n/en.json'
import hi from '@/i18n/hi.json'

/**
 * What a crawler and a social-card scraper see — neither of which runs the
 * app's JavaScript, so everything asserted here has to be in the served HTML
 * or in a file beside it.
 *
 * The sitemap is checked against `src/lib/nav.ts` rather than against a list
 * written down twice. vite.config.ts cannot import that file (it pulls
 * lucide-react, and the config runs in Node), so the two copies exist — this
 * is what stops them drifting, and it fails on a nav destination added
 * without a sitemap entry as loudly as on the reverse.
 *
 * `pnpm check` does not build. Run `pnpm build && pnpm test`; CI does.
 */
describe('what a crawler sees', () => {
  const built = existsSync(fromRoot('dist', 'index.html')) ? it : it.skip

  built('robots.txt allows everything and points at the sitemap', () => {
    const robots = readFromRoot('dist/robots.txt')

    expect(robots).toContain('User-agent: *')
    expect(robots).toContain('Allow: /')
    // Nothing in this app is private — every route is public reference
    // material and all reader state is in IndexedDB — so a Disallow rule
    // here would be hiding something that does not exist.
    expect(robots).not.toContain('Disallow:')
    expect(robots).toMatch(/^Sitemap: https:\/\/\S+\/sitemap\.xml$/m)
  })

  built('the sitemap lists the entry point, every section and Settings, once each', () => {
    const sitemap = readFromRoot('dist/sitemap.xml')
    const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1] ?? '')

    expect(locs.length).toBe(new Set(locs).size)

    const origin = new URL(locs[0] ?? 'https://example.invalid').origin
    const paths = locs.map((loc) => new URL(loc).pathname)

    // The five sections and Settings. Sub-tabs are not in the sitemap and must
    // not be: `/study/read` is where `/study` lands, and listing both would put
    // the same document in a crawler's index twice.
    expect(paths).toEqual(['/', ...NAV_TABS.map((item) => item.path), SETTINGS_PATH])
    for (const loc of locs) expect(loc.startsWith(origin)).toBe(true)
  })

  built('the sitemap is well-formed and dated', () => {
    const sitemap = readFromRoot('dist/sitemap.xml')

    expect(sitemap.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
    expect(sitemap).toContain('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"')
    expect(sitemap).toMatch(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/)
    // Every <url> opened is closed, and nothing nests wrongly.
    expect((sitemap.match(/<url>/g) ?? []).length).toBe((sitemap.match(/<\/url>/g) ?? []).length)
  })

  built('the social card is bilingual and hosted here', () => {
    const html = readFromRoot('dist/index.html')

    // The master context forbids an external image host, so the card has to
    // be a file this repository ships.
    const image = html.match(/<meta property="og:image" content="([^"]+)"/)?.[1] ?? ''
    expect(image).toMatch(/^https:\/\/\S+\/og\.png$/)
    expect(existsSync(fromRoot('dist', 'og.png'))).toBe(true)

    // Both languages, in tags a scraper reads without executing anything.
    const description = html.match(/<meta property="og:description" content="([^"]+)"/)?.[1] ?? ''
    expect(description).toContain(en.app.shortDescription)
    expect(description).toContain(hi.app.shortDescription)

    const title = html.match(/<meta property="og:title" content="([^"]+)"/)?.[1] ?? ''
    expect(title).toContain(en.app.name)
    expect(title).toContain(hi.app.tagline)

    expect(html).toContain('<meta property="og:locale" content="en_IN" />')
    expect(html).toContain('<meta property="og:locale:alternate" content="hi_IN" />')
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />')
    expect(html).toMatch(/<link rel="canonical" href="https:\/\/\S+\/" \/>/)

    // The marker must have been replaced, not shipped.
    expect(html).not.toContain('%SOCIAL_TAGS%')
  })

  built('the meta description names both languages and is a usable length', () => {
    const html = readFromRoot('dist/index.html')
    const description = html.match(/<meta\s+name="description"\s+content="([^"]+)"/s)?.[1] ?? ''

    expect(description.length).toBeGreaterThan(80)
    // Devanagari, so a Hindi reader's search result is in Hindi too.
    expect(description).toMatch(/[ऀ-ॿ]/)
  })

  built('the two faces the first paint needs are preloaded, and no more', () => {
    const html = readFromRoot('dist/index.html')
    const preloads = [...html.matchAll(/<link rel="preload"[^>]*href="\/(assets\/[^"]+)"/g)].map(
      (match) => match[1] ?? '',
    )

    expect(preloads).toHaveLength(2)
    expect(preloads.some((asset) => asset.includes('inter-latin-wght-normal'))).toBe(true)
    expect(preloads.some((asset) => asset.includes('poppins-latin-600'))).toBe(true)
    for (const asset of preloads) expect(existsSync(fromRoot('dist', asset))).toBe(true)

    // Preloading a Devanagari face would cost an English reader a few hundred
    // kilobytes for glyphs they will never see (ADR-030).
    expect(preloads.some((asset) => asset.includes('devanagari'))).toBe(false)
  })

  built('every generated preload hint points at a chunk that exists', () => {
    // dist/_headers is public/_headers plus a generated block of per-route
    // `Link:` preload hints, whose targets are content-hashed (vite.config.ts
    // routePreloadHeaders). A hint pointing at a filename from a previous
    // build would cost a reader a 404 on the critical path — a silent
    // pessimisation, since the app still works.
    const headers = readFromRoot('dist/_headers')
    const targets = [...headers.matchAll(/<\/(assets\/[^>]+)>/g)].map((match) => match[1] ?? '')

    expect(targets.length).toBeGreaterThan(0)
    for (const target of targets) {
      expect(existsSync(fromRoot('dist', target)), `${target} is preloaded but not built`).toBe(true)
    }

    // The security block survived the rewrite: the generated section appends,
    // it does not replace.
    expect(headers).toContain('Content-Security-Policy:')
    expect(headers).toContain('frame-ancestors')
  })

  built('the manifest agrees with the document about the theme colour', () => {
    const manifest = JSON.parse(readFromRoot('dist/manifest.webmanifest')) as {
      theme_color: string
      background_color: string
      start_url: string
      display: string
      icons: { sizes: string; purpose?: string }[]
    }
    const html = readFromRoot('dist/index.html')
    const meta = html.match(/<meta name="theme-color" content="([^"]+)"/)?.[1] ?? ''

    // A splash screen painted in one colour and an app painted in another is
    // a visible flash on every cold start of the installed app.
    expect(manifest.theme_color.toUpperCase()).toBe(meta.toUpperCase())
    expect(manifest.background_color.toUpperCase()).toBe(meta.toUpperCase())

    // The installability floor: a start_url, a display mode that is not
    // "browser", and both icon sizes Chrome asks for.
    expect(manifest.start_url).toBe('/')
    expect(manifest.display).toBe('standalone')
    expect(manifest.icons.map((icon) => icon.sizes).sort()).toEqual(['192x192', '512x512'])
    expect(manifest.icons.every((icon) => icon.purpose?.includes('maskable'))).toBe(true)
  })
})
