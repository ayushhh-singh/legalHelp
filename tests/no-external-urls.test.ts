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
 * The one URL this app may ever request, and only after the reader has opted
 * into Tier 1 (see docs/AI.md). It is confined to a single source file, which
 * `only the AI provider names api.anthropic.com` below asserts — so the sweep
 * cannot be used to smuggle a second outbound host in beside it.
 */
const OPT_IN_ENDPOINT = {
  pattern: /^https:\/\/api\.anthropic\.com\//,
  file: 'src/ai/providers/anthropic-direct.ts',
}

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
    pattern: /^https:\/\/github\.com\/ungap\/url-search-params\.?$/,
    why: "React Router's useSearchParams polyfill suggestion, thrown as an error message on a browser with no URLSearchParams; read in context in the built bundle",
  },
  {
    pattern: /^http:\/\/localhost$/,
    why: "React Router's fallback base for new URL() when window.location is absent — parsed, never fetched",
  },
  { pattern: /^https?:\/\/tailwindcss\.com$/, why: 'Tailwind 4 licence banner comment in the built CSS' },
  {
    pattern:
      /^(http:\/\/scripts\.sil\.org\/OFL|https:\/\/github\.com\/(rsms\/inter|itfoundry\/Poppins|notofonts\/devanagari))$/,
    why: 'SIL Open Font License text and copyright lines in public/OFL.txt (pnpm fonts:licenses)',
  },
  { pattern: /^https?:\/\/bit\.ly\/2kdckMn$/, why: 'Dexie PrematureCommit error message text' },
  { pattern: /^https?:\/\/tinyurl\.com\/y2uuvskb$/, why: 'Dexie MissingAPI error message text' },
  {
    pattern: /^https?:\/\/bit\.ly\/wb-precache$/,
    why: 'workbox-precaching console.warn text, bundled into dist/workbox-*.js by vite-plugin-pwa',
  },
  {
    pattern: /^https:\/\/json-schema\.org\/draft\/2020-12\/schema$/,
    why: 'JSON Schema dialect identifier emitted by zod 4 — an identifier, never dereferenced',
  },
  {
    pattern: OPT_IN_ENDPOINT.pattern,
    why: 'Tier 1 BYOK endpoint; reached only after explicit consent, from one lazy-loaded module',
  },
  {
    // The master context requires every data card to show its source URL, so
    // citations necessarily ship. They are rendered as links for the reader to
    // open, never fetched: `loads every HTML and CSS reference from its own
    // origin` above covers the markup, the eslint `no-restricted-globals: fetch`
    // rule covers the code, and tests/e2e/zero-third-party-requests.spec.ts
    // covers the running app. Scoped to the one directory the datasets cite so a
    // second NCRB path still has to be looked at by a human.
    pattern: /^https:\/\/www\.ncrb\.gov\.in\/uploads\/SankalanPortal\//,
    why: 'NCRB Sankalan source citation in data/_meta/versions.json; displayed as a link, never requested',
  },
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

  it('names api.anthropic.com in exactly one module', () => {
    // The allowlist above lets the endpoint through the sweep. This is the
    // check that keeps it confined: one file, which is dynamically imported and
    // only reachable once the reader has consented to Tier 1.
    const naming = walk(fromRoot('src'), SOURCE_EXTENSIONS)
      .map((file) => relative(projectRoot, file))
      .filter((file) => !/\.test\.tsx?$/.test(file))
      .filter((file) =>
        (readFromRoot(file).match(URL_PATTERN) ?? []).some((url) => OPT_IN_ENDPOINT.pattern.test(url)),
      )

    expect(naming).toEqual([OPT_IN_ENDPOINT.file])
  })

  it('constructs a SpeechRecognition in exactly one module', () => {
    // The second network seam. It does not look like one — it is a browser
    // global, not a URL — but Chrome streams the captured audio to Google's
    // servers, so a spoken query leaves the device exactly as a fetch would.
    // `eslint.config.js` restricts both spellings of the global and grants one
    // file-scoped exception; this is the assertion that the exception is still
    // the only place that uses it, and it is deliberately independent of the
    // lint rule so that disabling the rule does not also disable the check.
    const naming = walk(fromRoot('src'), SOURCE_EXTENSIONS)
      .map((file) => relative(projectRoot, file))
      .filter((file) => !/\.test\.tsx?$/.test(file))
      .filter((file) =>
        /new\s+Recognition\b|webkitSpeechRecognition|\bSpeechRecognition\b/.test(readFromRoot(file)),
      )

    // voiceConsent.ts names the global in a `in window` presence check — it
    // decides whether to SHOW the button — and never constructs one.
    expect(naming.sort()).toEqual(['src/lib/voice.ts', 'src/lib/voiceConsent.ts'])
    expect(readFromRoot('src/lib/voiceConsent.ts')).not.toContain('new ')
  })

  it('keeps dataset source citations in data/, out of the source tree', () => {
    // Allowing the NCRB citation through the dist sweep would otherwise let a
    // `fetch('https://www.ncrb.gov.in/...')` in src/ pass unnoticed. It reaches
    // the build only as a string inside data/_meta/versions.json; no module may
    // name it.
    const naming = walk(fromRoot('src'), SOURCE_EXTENSIONS)
      .map((file) => relative(projectRoot, file))
      .filter((file) => !/\.test\.tsx?$/.test(file))
      .filter((file) => /ncrb\.gov\.in/.test(readFromRoot(file)))

    expect(naming).toEqual([])
  })

  it('imports every webfont from a bundled package, never from a CDN', () => {
    // Fonts moved from a hand-fetched public/fonts/ to @fontsource packages
    // (ADR-010). Vite emits the .woff2 files into dist/assets and rewrites the
    // URLs, so nothing is fetched from Google at runtime — but the import list
    // is where a `https://fonts.googleapis.com` line would slip back in.
    const css = readFromRoot('src/styles/fonts.css')
    expect(externalUrlsIn(css, { keepComments: true })).toEqual([])

    const imports = [...css.matchAll(/@import\s+'([^']+)'/g)].map((m) => m[1] ?? '')
    expect(imports.length).toBeGreaterThan(0)
    for (const specifier of imports) {
      expect(specifier.startsWith('@fontsource'), `${specifier} is not an @fontsource package`).toBe(true)
      expect(existsSync(fromRoot('node_modules', specifier)), `${specifier} is not installed`).toBe(true)
    }
  })

  it('ships the OFL text alongside the fonts it bundles', () => {
    // The SIL Open Font License requires the licence to travel with the fonts.
    // public/OFL.txt is generated from the @fontsource LICENSE files and is
    // copied into dist/ verbatim by Vite.
    const ofl = readFromRoot('public/OFL.txt')
    for (const family of ['Inter', 'Poppins', 'Noto Sans Devanagari']) {
      expect(ofl, `${family} is not attributed`).toContain(family)
    }
    expect(ofl).toContain('SIL Open Font License')
  })

  it('leaves nothing behind in public/fonts', () => {
    // The old pipeline committed 10 WOFF2 files plus a generated fonts.css and
    // OFL.txt. If any of that comes back it will be stale, unreferenced weight.
    expect(existsSync(fromRoot('public/fonts'))).toBe(false)
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
