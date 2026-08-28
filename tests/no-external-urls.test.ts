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
  /*
    The Office Open XML namespace identifiers, from the `docx` library (Session
    8, the Drafting Studio's .docx export).

    Every one of these is an `xmlns` VALUE written into the exported file — it
    is how Word and LibreOffice identify a schema, in exactly the way the
    `w3.org` entry at the top of this list already covers for SVG and XML. None
    is ever dereferenced, by this app or by a word processor: ECMA-376 defines
    the namespaces as opaque identifiers, and a .docx opens on a machine with no
    network at all.

    They are matched by HOST rather than one line per URI because there are
    upwards of sixty of them and an exhaustive list would be a list nobody
    re-reads. The narrowing that keeps this a review rather than a hole is the
    `only the .docx exporter carries an OOXML namespace` assertion below: these
    are permitted in the `docx` vendor chunk and nowhere else in the build, so
    they cannot be used to smuggle a fetchable URL into application code.
  */
  {
    pattern: /^https?:\/\/schemas\.(openxmlformats\.org|microsoft\.com)\//,
    why: 'OOXML namespace identifiers written into the exported .docx; opaque per ECMA-376, never fetched',
  },
  {
    pattern: /^https?:\/\/purl\.org\/dc\//,
    why: 'Dublin Core namespace identifiers in the .docx core-properties part, never fetched',
  },
  {
    pattern: /^https:\/\/answers\.microsoft\.com\/en-us\/msoffice\/forum\//,
    why: 'docx library source comment about Word’s nine-level list limit, minified into the chunk',
  },
  {
    pattern: /^https:\/\/rolldown\.rs\//,
    why: 'Rolldown CommonJS-interop warning text in the docx vendor chunk',
  },
  {
    pattern: /^https:\/\/stuk\.github\.io\/jszip\//,
    why: 'JSZip homepage in its own banner comment; JSZip is how `docx` packs the archive',
  },
]

/**
 * Every host a dataset under `data/` is allowed to cite.
 *
 * The master context requires every data card to show its source URL, so
 * citations necessarily ship — `data/law/*.json` and `data/pay/*.json` reach
 * `dist/` as `?raw` chunks (ADR-013, ADR-018). They are rendered as links for
 * the reader to open and are NEVER fetched: the structural check above covers
 * the markup, the `no-restricted-globals: fetch` rule in eslint.config.js
 * covers the code, and tests/e2e/zero-third-party-requests.spec.ts covers the
 * running app.
 *
 * The list is written out rather than derived, and `every host the datasets
 * cite is on this list` below asserts the two agree in BOTH directions. So a
 * dataset that starts citing a new host fails this suite until a human has
 * looked at it — which is the property the whole file exists for — while the
 * pay datasets' several hundred order URLs do not each need a line here.
 *
 * ADR-016 kept these hosts out of `data/_meta/versions.json` for exactly this
 * reason; the Pay module's `?raw` imports brought them into the build anyway,
 * so the rule moved from "no pay URLs ship" to "only reviewed hosts ship, only
 * from data/, and never from src/".
 */
const CITATION_HOSTS: readonly string[] = [
  'cbi.gov.in',
  'cghs.gov.in',
  'ddpmod.gov.in',
  'doe.gov.in',
  'dopt.gov.in',
  'indianrailways.gov.in',
  'kvsangathan.nic.in',
  'labourbureau.gov.in',
  'navodaya.gov.in',
  'rajbhasha.gov.in',
  'ssc.gov.in',
  'thc.nic.in',
  'upsc.gov.in',
  'www.darpg.gov.in',
  'www.delhipolice.gov.in',
  'www.drdo.gov.in',
  'www.incometax.gov.in',
  'www.isro.gov.in',
  'www.mha.gov.in',
  'www.ncrb.gov.in',
  'www.pfrda.org.in',
]

/** The host of a URL as the sweep's own regex captured it, or '' if unparseable. */
function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

/**
 * Every URL that appears in a committed dataset, extracted with the SAME regex
 * the sweep uses — so a URL the regex truncates (the Revised Pay Rules link
 * contains a bracket) truncates identically on both sides and still matches.
 */
function datasetUrls(): Set<string> {
  const urls = new Set<string>()
  for (const file of walk(fromRoot('data'), new Set(['.json']))) {
    for (const url of readFromRoot(relative(projectRoot, file)).match(URL_PATTERN) ?? []) {
      urls.add(url)
    }
  }
  return urls
}

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

let citations: Set<string> | null = null

const isAllowed = (url: string) => {
  if (ALLOWED_INERT.some(({ pattern }) => pattern.test(url))) return true
  // A citation from a committed dataset, on a host that has been reviewed.
  // Both halves are required: a reviewed host cannot smuggle in a URL that is
  // not in the data, and a URL in the data cannot smuggle in a new host.
  citations ??= datasetUrls()
  return citations.has(url) && CITATION_HOSTS.includes(hostOf(url))
}

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

  it('cites only hosts that have been reviewed, and every one on the list', () => {
    // Both directions. A dataset that starts citing a new host fails here until
    // someone writes it down; a host left on the list after the last citation
    // using it was removed fails too, so the list cannot silently widen.
    const hosts = [...new Set([...datasetUrls()].map(hostOf))].filter(Boolean).sort()
    expect(hosts).toEqual([...CITATION_HOSTS].sort())
  })

  it('keeps dataset source citations in data/, out of the source tree', () => {
    // This is what stops the dataset rule above being a way in. A citation may
    // ship as a string inside data/; no module under src/ may name one of those
    // hosts, so `fetch('https://doe.gov.in/...')` in a component would fail here
    // even though the same URL is allowed through the dist sweep.
    const offenders: Record<string, string[]> = {}
    for (const file of walk(fromRoot('src'), SOURCE_EXTENSIONS)) {
      const name = relative(projectRoot, file)
      if (/\.test\.tsx?$/.test(name) || name.includes(`${sep}test${sep}`)) continue
      const body = readFromRoot(name)
      const found = CITATION_HOSTS.filter((host) => body.includes(host))
      if (found.length > 0) offenders[name] = found
    }
    expect(offenders).toEqual({})
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

    /**
     * The OOXML namespaces are allowed in ONE chunk, and this is what makes
     * that a review rather than a hole.
     *
     * `ALLOWED_INERT` matches by host, so without this the entry would let any
     * module in the app carry a `schemas.microsoft.com` string. Confining them
     * to the lazily-imported `docx` vendor chunk means an OOXML namespace
     * appearing in application code — or on the initial route — fails here,
     * exactly as `names api.anthropic.com in exactly one module` does for the
     * one endpoint this app may ever reach.
     */
    whenBuilt('confines the OOXML namespaces to the .docx exporter’s own chunk', () => {
      const ooxml = /https?:\/\/(schemas\.(openxmlformats\.org|microsoft\.com)|purl\.org\/dc)\//
      const carriers = walk(dist, BUILD_EXTENSIONS)
        .filter((file) => ooxml.test(readFromRoot(relative(projectRoot, file))))
        .map((file) => relative(projectRoot, file))

      expect(carriers).toHaveLength(1)
      expect(carriers[0]).toMatch(/^dist[\\/]assets[\\/]docx-[\w-]+\.js$/)
    })

    /**
     * And that chunk is not on the initial route.
     *
     * `docx` is ~100 KB gzip. It is imported inside the export handler
     * (`ExportBar.tsx`), so a reader who never presses Export never downloads
     * it — the same laziness `tests/bundle-budget.test.ts` enforces for the AI
     * layer, and for a stronger reason there than here: this one is only
     * weight, that one is reach.
     */
    whenBuilt('keeps the .docx exporter out of the initial route', () => {
      const html = readFromRoot('dist/index.html')
      expect(html).not.toMatch(/docx-[\w-]+\.js/)
    })
  })
})
