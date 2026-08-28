import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, relative, extname, sep } from 'node:path'

import { describe, expect, it } from 'vitest'

import { fromRoot, readFromRoot, projectRoot } from '@/test/paths'

/**
 * Hard rule (CLAUDE.md): the app makes zero third-party requests at runtime and
 * carries no user data off the device. This is the static half of that
 * guarantee; the live network assertion lands with the Playwright suite.
 *
 * Two complementary checks run over the build:
 *   1. Structural — every fetchable reference (href/src/url()/@import) in the
 *      built HTML and CSS must be same-origin. This is the assertion that
 *      actually maps to "no third-party request".
 *   2. Sweep — every URL-shaped string anywhere in the build must be on the
 *      allowlist below. Vendor code carries inert URLs in error messages, so
 *      each one is listed explicitly rather than skipped, and anything new
 *      fails until a human has looked at it.
 */

const URL_PATTERN = /https?:\/\/[^\s'"`)>\\]+/g

/**
 * URLs that may appear as inert strings. None is ever requested: they are XML
 * namespaces, exception-message documentation links, or licence attribution.
 */
const ALLOWED_INERT: ReadonlyArray<{ pattern: RegExp; why: string }> = [
  { pattern: /^https?:\/\/(www\.)?w3\.org\//, why: 'XML/SVG namespace identifiers, never fetched' },
  { pattern: /^https?:\/\/ui\.shadcn\.com\/schema\.json$/, why: 'components.json $schema, tooling only' },
  { pattern: /^https?:\/\/react\.dev\/errors\//, why: 'React 19 minified-error message text' },
  {
    pattern: /^https?:\/\/reactrouter\.com\/en\/main\/routers\/picking-a-router/,
    why: 'React Router warning message text',
  },
  {
    pattern: /^https?:\/\/react\.i18next\.com\/latest\/usetranslation-hook$/,
    why: 'react-i18next warning message text',
  },
  {
    pattern: /^http:\/\/localhost$/,
    why: "React Router's fallback base for new URL() when window.location is absent — parsed, never fetched",
  },
  { pattern: /^https?:\/\/tailwindcss\.com$/, why: 'Tailwind 4 licence banner comment in the built CSS' },
  { pattern: /^https?:\/\/bit\.ly\/2kdckMn$/, why: 'Dexie PrematureCommit error message text' },
  { pattern: /^https?:\/\/tinyurl\.com\/y2uuvskb$/, why: 'Dexie MissingAPI error message text' },
  {
    pattern: /^https?:\/\/bit\.ly\/wb-precache$/,
    why: 'workbox-precaching console.warn text, bundled into dist/workbox-*.js by vite-plugin-pwa',
  },
  { pattern: /^https?:\/\/fonts\.google\.com\/specimen\//, why: 'font attribution in public/fonts/OFL.txt' },
  { pattern: /^https?:\/\/openfontlicense\.org\//, why: 'OFL licence text link in public/fonts/OFL.txt' },
]

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.css', '.html'])
const BUILD_EXTENSIONS = new Set(['.js', '.css', '.html', '.txt', '.svg', '.json'])
const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', '.git'])

function walk(dir: string, extensions: Set<string>, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, extensions, out)
    else if (extensions.has(extname(entry))) out.push(full)
  }
  return out
}

/** Strip comments so source citations do not read as runtime references. */
function stripComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/<!--[\s\S]*?-->/g, '')
}

const isAllowed = (url: string) => ALLOWED_INERT.some(({ pattern }) => pattern.test(url))

function externalUrlsIn(code: string, { keepComments = false } = {}): string[] {
  const body = keepComments ? code : stripComments(code)
  return (body.match(URL_PATTERN) ?? []).filter((url) => !isAllowed(url))
}

/** Collect everything the browser would actually try to load. */
function fetchableReferences(markup: string): string[] {
  const refs: string[] = []
  for (const re of [
    /(?:href|src)\s*=\s*["']([^"']+)["']/g,
    /url\(\s*["']?([^"')]+)["']?\s*\)/g,
    /@import\s+["']([^"']+)["']/g,
  ]) {
    for (const match of markup.matchAll(re)) if (match[1]) refs.push(match[1])
  }
  return refs
}

const isSameOrigin = (ref: string) =>
  ref.startsWith('/') ||
  ref.startsWith('./') ||
  ref.startsWith('../') ||
  ref.startsWith('#') ||
  ref.startsWith('data:') ||
  !/^[a-z][a-z0-9+.-]*:|^\/\//i.test(ref)

describe('no external URLs', () => {
  it('finds none in shipped source', () => {
    const offenders: Record<string, string[]> = {}
    const files = [...walk(fromRoot('src'), SOURCE_EXTENSIONS), fromRoot('index.html')]

    for (const file of files) {
      if (!existsSync(file)) continue
      // Tests and test helpers are never bundled — only what main.tsx reaches
      // ships — and their fixtures legitimately name real source URLs. What
      // actually ships is covered by the dist sweep below.
      if (/\.test\.tsx?$/.test(file) || file.includes(`${sep}test${sep}`)) continue
      const urls = externalUrlsIn(readFromRoot(relative(projectRoot, file)))
      if (urls.length > 0) offenders[relative(projectRoot, file)] = urls
    }

    expect(offenders).toEqual({})
  })

  it('finds none in the generated font CSS', () => {
    expect(existsSync(fromRoot('public/fonts/fonts.css')), 'run `pnpm fonts:fetch` first').toBe(true)
    // Comments included: a leaked gstatic URL in a comment still means a stale file.
    expect(externalUrlsIn(readFromRoot('public/fonts/fonts.css'), { keepComments: true })).toEqual([])
  })

  it('bundles every font referenced by the font CSS', () => {
    const css = readFromRoot('public/fonts/fonts.css')
    const referenced = [...css.matchAll(/url\('([^']+)'\)/g)].map((m) => m[1] ?? '')

    expect(referenced.length).toBeGreaterThan(0)
    for (const url of referenced) {
      expect(url.startsWith('/fonts/'), `${url} is not a local /fonts/ path`).toBe(true)
      expect(existsSync(fromRoot('public', url.replace(/^\//, ''))), `${url} is missing`).toBe(true)
    }
  })

  describe('production build', () => {
    const dist = fromRoot('dist')
    // `pnpm check` does not build. Run `pnpm build` then `pnpm test` for these.
    const whenBuilt = existsSync(dist) ? it : it.skip

    whenBuilt('loads every HTML and CSS reference from its own origin', () => {
      const offenders: Record<string, string[]> = {}

      for (const file of walk(dist, new Set(['.html', '.css']))) {
        const external = fetchableReferences(readFromRoot(relative(projectRoot, file))).filter(
          (ref) => !isSameOrigin(ref),
        )
        if (external.length > 0) offenders[relative(projectRoot, file)] = external
      }

      expect(offenders).toEqual({})
    })

    whenBuilt('contains no unreviewed URL anywhere, JavaScript included', () => {
      const offenders: Record<string, string[]> = {}

      for (const file of walk(dist, BUILD_EXTENSIONS)) {
        const urls = [
          ...new Set(externalUrlsIn(readFromRoot(relative(projectRoot, file)), { keepComments: true })),
        ]
        if (urls.length > 0) offenders[relative(projectRoot, file)] = urls
      }

      expect(offenders).toEqual({})
    })
  })
})
