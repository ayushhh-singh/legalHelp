import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath, URL } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { visualizer } from 'rollup-plugin-visualizer'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vitest/config'
import type { Plugin } from 'vite'

import en from './src/i18n/en.json' with { type: 'json' }
import hi from './src/i18n/hi.json' with { type: 'json' }

/**
 * The short commit sha Settings' About card shows next to the package
 * version. `git` is not available in every environment this config loads in
 * (a source tarball with no `.git`, a sandboxed CI step) so a failure here
 * falls back to a literal rather than failing the build over a caption.
 */
const BUILD_SHA = (() => {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch {
    return 'unknown'
  }
})()

/**
 * The absolute origin the built site will be served from. It reaches three
 * places that cannot use a relative URL: the Open Graph tags a social-card
 * scraper reads without executing JavaScript, the canonical link, and
 * sitemap.xml. Override per environment with VITE_SITE_URL (the deploy
 * workflow sets it, from the SITE_URL repository variable); the default is
 * the Cloudflare Pages project's own domain, so a build with no variable set
 * still produces correct absolute URLs. Change it here if the site moves to a
 * custom domain — tests/no-external-urls.test.ts reads this literal rather
 * than restating it, so the allowlist follows automatically.
 */
const __publicDir = fileURLToPath(new URL('./public', import.meta.url))

const SITE_URL = (process.env.VITE_SITE_URL ?? 'https://legalhelp.pages.dev').replace(/\/+$/, '')

/**
 * Tier 2's origin, when this build was given one.
 *
 * `VITE_AI_PROXY_URL` reaches the app through `import.meta.env`, but it also
 * has to reach the Content-Security-Policy — and `public/_headers` is a static
 * file that cannot know it. So the policy ships with the two fixed AI
 * destinations and this appends the third, at build time, only when there is
 * one. A build with no proxy emits `public/_headers` byte-identical, which is
 * what `tests/e2e/csp.spec.ts` parses.
 *
 * Only the ORIGIN goes into the directive: connect-src matches on scheme,
 * host and port, and a path in it is silently ignored by some browsers and
 * rejected by others. A malformed value fails the build rather than producing
 * a policy that quietly refuses the tier it was set up for.
 */
const AI_PROXY_ORIGIN = (() => {
  const raw = process.env.VITE_AI_PROXY_URL
  if (!raw) return undefined
  try {
    return new URL(raw).origin
  } catch {
    throw new Error(`VITE_AI_PROXY_URL is not a URL: ${raw}`)
  }
})()

/** Appends the proxy origin to the policy's connect-src, or returns it as-is. */
function withProxyConnectSrc(headers: string): string {
  if (!AI_PROXY_ORIGIN) return headers
  const pattern = /(Content-Security-Policy:[^\n]*?connect-src[^;\n]*)/
  if (!pattern.test(headers)) {
    throw new Error(
      'withProxyConnectSrc: public/_headers has no connect-src to extend. ' +
        'The policy moved — see ADR-037 before shipping a build with VITE_AI_PROXY_URL set.',
    )
  }
  return headers.replace(pattern, `$1 ${AI_PROXY_ORIGIN}`)
}

/**
 * Every route worth handing a crawler: the entry point plus the six
 * destinations in src/lib/nav.ts. That file is the one nav config and cannot
 * be imported here (it pulls lucide-react, and this config runs in Node), so
 * the list is repeated — and `tests/seo.test.ts` reads the BUILT sitemap back
 * and compares it against NAV_ITEMS, which is what stops the two drifting.
 */
const SITEMAP_ROUTES = ['/', '/law', '/pay', '/draft', '/learn', '/library', '/utils', '/settings']

/**
 * robots.txt and sitemap.xml, emitted at build time rather than committed to
 * public/, because both have to carry SITE_URL and a committed copy would go
 * stale the first time the site moves.
 *
 * Disallow is empty on purpose: this app holds nothing private — every route
 * renders public reference material and all reader state lives in IndexedDB,
 * so there is nothing a crawler could reach that a reader could not.
 */
function seoFiles(): Plugin {
  const lastmod = new Date().toISOString().slice(0, 10)

  return {
    name: 'sahayak-seo-files',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'robots.txt',
        source: ['User-agent: *', 'Allow: /', '', `Sitemap: ${SITE_URL}/sitemap.xml`, ''].join('\n'),
      })

      const urls = SITEMAP_ROUTES.map(
        (route) =>
          `  <url>\n    <loc>${SITE_URL}${route === '/' ? '/' : route}</loc>\n` +
          `    <lastmod>${lastmod}</lastmod>\n` +
          `    <changefreq>weekly</changefreq>\n` +
          `    <priority>${route === '/' ? '1.0' : '0.8'}</priority>\n  </url>`,
      ).join('\n')

      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
      })
    },
  }
}

/**
 * Which lazy chunks each route actually needs before it can paint.
 *
 * Every module is behind a lazy route import, and most are lazy TWICE — `/law`
 * loads LawPage, which then loads ConverterPage; `/utils` loads UtilsPage,
 * which loads UtilsHubPage. On a fast connection that is invisible. On a
 * throttled mobile one it is three sequential round trips before the first
 * meaningful paint (document, entry chunk, module chunk, view chunk), each
 * paying the full latency, because the browser cannot know a chunk exists
 * until the chunk before it has been parsed.
 *
 * The fix is to tell it up front. Cloudflare Pages honours a `Link:` response
 * header per path in _headers, so `/law` can ship preload hints for the two
 * chunks it is certain to need while the entry chunk is still downloading. It
 * is per-PATH, so a reader who opens `/pay` is never handed the law module.
 *
 * Keyed by source file rather than by chunk name because the names are
 * content-hashed; routePreloadHeaders() resolves each one against the actual
 * bundle and fails the build if a path stops matching a chunk.
 */
const ROUTE_CRITICAL_MODULES: Record<string, string[]> = {
  // A bare `/` decides between onboarding and the law module once IndexedDB
  // answers, and cannot know which until then — so both, and they are the two
  // smallest module chunks in the app.
  '/': ['src/modules/onboarding/OnboardingPage.tsx', 'src/modules/law/LawPage.tsx'],
  '/law': ['src/modules/law/LawPage.tsx', 'src/modules/law/ConverterPage.tsx'],
  '/pay': ['src/modules/pay/PayPage.tsx'],
  '/draft': ['src/modules/drafting/DraftPage.tsx', 'src/modules/drafting/PickerPage.tsx'],
  '/learn': ['src/modules/trainer/LearnPage.tsx', 'src/modules/trainer/pages/HomePage.tsx'],
  '/library': ['src/modules/library/LibraryPage.tsx', 'src/modules/library/pages/LibraryHubPage.tsx'],
  '/utils': ['src/modules/utils/UtilsPage.tsx', 'src/modules/utils/UtilsHubPage.tsx'],
  '/settings': ['src/modules/settings/SettingsPage.tsx'],
}

/**
 * Emits dist/_headers: public/_headers verbatim, plus one block per route
 * carrying the preload hints above.
 *
 * public/_headers is copied into dist/ by Vite's own publicDir handling before
 * this runs, so the file is REWRITTEN rather than created — the policy in that
 * file stays the one source of truth for everything security-related, and
 * this only appends.
 */
function routePreloadHeaders(): Plugin {
  return {
    name: 'sahayak-route-preload-headers',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      /** A chunk's own file plus every chunk it statically imports, transitively. */
      const withStaticImports = (fileName: string, seen = new Set<string>()): string[] => {
        if (seen.has(fileName)) return []
        seen.add(fileName)
        const chunk = bundle[fileName]
        if (!chunk || chunk.type !== 'chunk') return [fileName]
        return [fileName, ...chunk.imports.flatMap((imported) => withStaticImports(imported, seen))]
      }

      const chunkFor = (source: string) => {
        const found = Object.values(bundle).find(
          (chunk) => chunk.type === 'chunk' && chunk.facadeModuleId?.replace(/\\/g, '/').endsWith(source),
        )
        if (!found) {
          throw new Error(
            `routePreloadHeaders: no chunk has "${source}" as its entry. ` +
              'A route module was renamed or stopped being lazy — update ROUTE_CRITICAL_MODULES.',
          )
        }
        return found.fileName
      }

      // Everything index.html already loads; preloading it twice would be a
      // duplicate request on a cold cache.
      const entry = Object.values(bundle).find((chunk) => chunk.type === 'chunk' && chunk.isEntry)
      const alreadyLoaded = new Set(entry ? withStaticImports(entry.fileName) : [])

      const blocks: string[] = []
      for (const [route, sources] of Object.entries(ROUTE_CRITICAL_MODULES)) {
        // The route's own page chunks, and deliberately NOT their transitive
        // static imports. Preloading the full graph was measured twice and
        // was worse both times (/law 90 -> 87, /pay 86 -> 83 on Lighthouse
        // mobile): two dozen small preloads compete with the stylesheet and
        // the entry chunk for the same throttled bandwidth, and buy about
        // 0.1s of LCP for 0.7s of FCP. Two hints per route is the whole win.
        const files = [...new Set(sources.map((source) => chunkFor(source)))]
          .filter((file) => !alreadyLoaded.has(file))
          .sort()
        if (files.length === 0) continue

        // `as=script` rather than `rel=modulepreload`: a Link HEADER carrying
        // modulepreload is not honoured as widely, and `as=script` with
        // crossorigin populates the same cache entry the module graph reads.
        const links = files.map((file) => `</${file}>; rel=preload; as=script; crossorigin`).join(', ')
        blocks.push(`${route}\n  Link: ${links}`)
      }

      const base = existsSync(resolve(__publicDir, '_headers'))
        ? withProxyConnectSrc(readFileSync(resolve(__publicDir, '_headers'), 'utf8').trimEnd())
        : ''

      this.emitFile({
        type: 'asset',
        fileName: '_headers',
        source: `${base}\n\n${[
          '# ---- generated by vite.config.ts routePreloadHeaders() ----',
          '# One block per route: the module chunks that route is certain to',
          '# need, sent as preload hints with the document so the browser can',
          '# fetch them in parallel with the entry chunk instead of after it.',
          '# Content-hashed filenames, so this section is rewritten every build',
          '# — edit ROUTE_CRITICAL_MODULES in vite.config.ts, never this file.',
          '',
          ...blocks,
        ].join('\n')}\n`,
      })
    },
  }
}

/**
 * `<link rel="preload">` for the two faces the first paint always needs.
 *
 * Every @font-face lives inside the stylesheet (src/styles/fonts.css), so the
 * browser cannot discover a font file until it has downloaded and parsed the
 * CSS — two round trips before the first glyph. Preloading moves the request
 * to the head, alongside the stylesheet.
 *
 * Deliberately only two: Inter's Latin variable file (all body text and every
 * tabular numeral) and Poppins 600 (headings). The Devanagari faces are NOT
 * preloaded — they are needed only when the reader is in Hindi, which this
 * build cannot know, and preloading ~250 KB of Devanagari for an English
 * reader would cost more than the round trip it saves. The Cyrillic, Greek
 * and Vietnamese Inter subsets are never requested at all (unicode-range) and
 * are excluded from the precache too.
 *
 * The filenames are content-hashed, so they are read out of the bundle rather
 * than written down; a face that stops being emitted fails the build here
 * instead of silently preloading a 404.
 */
function preloadFonts(): Plugin {
  const CRITICAL = ['inter-latin-wght-normal', 'poppins-latin-600-normal']

  return {
    name: 'sahayak-preload-fonts',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        if (!ctx.bundle) return html

        const links = CRITICAL.map((face) => {
          const fileName = Object.keys(ctx.bundle ?? {}).find(
            (name) => name.includes(face) && name.endsWith('.woff2'),
          )
          if (!fileName) {
            throw new Error(
              `preloadFonts: no built .woff2 matches "${face}". Did src/styles/fonts.css stop importing it?`,
            )
          }
          return `<link rel="preload" as="font" type="font/woff2" href="/${fileName}" crossorigin />`
        })

        return html.replace('</title>', `</title>\n    ${links.join('\n    ')}`)
      },
    },
  }
}

/**
 * The social-card and canonical tags.
 *
 * They are injected here rather than written into index.html so that the one
 * absolute origin in the build lives at SITE_URL above, and so the bilingual
 * description comes from the SAME i18n catalogues the app renders — a scraper
 * that never runs JavaScript still gets both languages, and a change to
 * app.shortDescription cannot leave the meta description behind.
 */
function socialTags(): Plugin {
  return {
    name: 'sahayak-social-tags',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        // These values come from the i18n catalogues and land inside double-
        // quoted HTML attributes. Today none of them contains a quote or an
        // ampersand; the day one does, an unescaped value would end the
        // attribute early and produce silently malformed <head> markup that
        // still renders. Escaping here is cheaper than a rule saying "never
        // put an apostrophe in app.tagline".
        const attr = (value: string) =>
          value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

        const description = attr(`${en.app.shortDescription} · ${hi.app.shortDescription}`)
        const title = attr(`${en.app.name} · ${hi.app.tagline}`)
        const siteName = attr(`${en.app.name} · ${hi.app.name}`)
        const imageAlt = attr(`${en.app.name} — ${hi.app.tagline}`)

        const tags = [
          `<link rel="canonical" href="${SITE_URL}/" />`,
          `<meta property="og:type" content="website" />`,
          `<meta property="og:site_name" content="${siteName}" />`,
          `<meta property="og:title" content="${title}" />`,
          `<meta property="og:description" content="${description}" />`,
          `<meta property="og:url" content="${SITE_URL}/" />`,
          `<meta property="og:image" content="${SITE_URL}/og.png" />`,
          `<meta property="og:image:type" content="image/png" />`,
          `<meta property="og:image:width" content="1200" />`,
          `<meta property="og:image:height" content="630" />`,
          `<meta property="og:image:alt" content="${imageAlt}" />`,
          `<meta property="og:locale" content="en_IN" />`,
          `<meta property="og:locale:alternate" content="hi_IN" />`,
          `<meta name="twitter:card" content="summary_large_image" />`,
          `<meta name="twitter:title" content="${title}" />`,
          `<meta name="twitter:description" content="${description}" />`,
          `<meta name="twitter:image" content="${SITE_URL}/og.png" />`,
        ]

        return html.replace('<!--%SOCIAL_TAGS%-->', tags.join('\n    '))
      },
    },
  }
}

/**
 * The runtimeCaching `urlPattern` functions below run inside the generated
 * service worker (workbox-build serializes them into dist/sw.js), not in
 * this Node process — `self` there is ServiceWorkerGlobalScope, which
 * tsconfig.node.json's Node-only `lib` has no declaration for.
 */
declare const self: { location: { origin: string } }

/**
 * The treemap behind `pnpm analyze`, and only behind it.
 *
 * rollup-plugin-visualizer writes a ~2 MB self-contained HTML report into
 * dist/, which would otherwise be precached by the service worker and shipped
 * to every reader. ANALYZE=1 keeps it a deliberate, local act; `pnpm size` is
 * the number CI actually gates on.
 */
const analyzePlugins = (): Plugin[] =>
  process.env.ANALYZE
    ? [
        visualizer({
          filename: 'dist/stats.html',
          template: 'treemap',
          gzipSize: true,
          brotliSize: false,
        }) as Plugin,
      ]
    : []

export default defineConfig({
  plugins: [
    react(),
    seoFiles(),
    socialTags(),
    preloadFonts(),
    routePreloadHeaders(),
    ...analyzePlugins(),
    // Tailwind 4 has no PostCSS step and no JS config; the plugin reads
    // src/styles/tokens.css for the theme (@theme) and the source globs.
    tailwindcss(),
    VitePWA({
      // Manual registration (src/app/pwa.tsx) drives the update prompt, so
      // the plugin must not also inject its own register script.
      injectRegister: false,
      registerType: 'prompt',
      manifest: {
        name: 'Sahayak · सरकारी सहायक',
        short_name: 'Sahayak',
        description: `${en.app.shortDescription} · ${hi.app.shortDescription}`,
        // Both must equal index.html's <meta name="theme-color">, or the
        // installed app paints its splash screen in one colour and its first
        // frame in another — a visible flash on every cold start. #F7F9FC is
        // --background in src/styles/tokens.css :root; the cream these two
        // used to carry came from the icon artwork, not from the palette.
        // tests/seo.test.ts asserts the three agree.
        theme_color: '#F7F9FC',
        background_color: '#F7F9FC',
        display: 'standalone',
        start_url: '/',
        lang: 'hi',
        dir: 'ltr',
        categories: ['productivity', 'reference'],
        // One render per size, not two: src/assets/pwa-icon.svg already keeps
        // its shapes inside the maskable safe zone, so the same PNG is valid
        // for both purposes — see scripts/generate-icons.mjs.
        icons: [
          { src: '/icons/pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: '/icons/pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        // Everything Vite builds, plus the self-hosted fonts and icons that
        // live in public/ and are copied into the same output directory.
        globPatterns: ['**/*.{js,css,html,woff2,png,svg,ico,webmanifest}'],
        // @fontsource-variable/inter ships one variable file per Unicode
        // subset. Sahayak is English and Hindi only, so Cyrillic, Greek and
        // Vietnamese are never requested — unicode-range sees to that — but
        // they would still be downloaded by the precache on install. 92 KiB
        // off every offline install. The .woff legacy fallbacks alongside each
        // .woff2 are excluded already, by globPatterns naming only woff2.
        globIgnores: [
          // `pnpm analyze` writes a ~1.2 MB treemap into dist/. It must never
          // reach a reader's precache on a build that happened to have
          // ANALYZE set.
          '**/stats.html',
          // The Open Graph card. 47 KB downloaded onto every device that
          // installs the app, for an image only a social-media crawler ever
          // requests — it is referenced from a <meta> tag, never rendered by
          // the app. The icons stay precached; those are the installed app's
          // own launcher artwork.
          'og.png',
          // @mlc-ai/web-llm, Tier 0's runtime — ~6 MB of JavaScript, given its
          // own named chunk below precisely so it can be named here. Precaching
          // it would charge every installed device, including every device that
          // will never turn AI on, for a library only a Tier 0 reader loads.
          // It is the same rule as og.png one line up, at more than a hundred
          // times the size. The `NetworkFirst` runtime rule below still caches
          // it once it has actually been fetched, so a reader who HAS chosen
          // Tier 0 keeps working offline (ADR-037).
          '**/web-llm-*.js',
          '**/inter-cyrillic-*',
          '**/inter-cyrillic-ext-*',
          '**/inter-greek-*',
          '**/inter-greek-ext-*',
          '**/inter-vietnamese-*',
        ],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        // Client-routed pages (e.g. /pay) aren't individually precached;
        // serve the cached shell for any navigation the cache can't match.
        navigateFallback: '/index.html',
        runtimeCaching: [
          {
            urlPattern: ({ url }) =>
              url.origin === self.location.origin &&
              url.pathname.startsWith('/data/') &&
              url.pathname.endsWith('.json'),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'data-v1',
              expiration: { maxAgeSeconds: 30 * 24 * 60 * 60 },
            },
          },
          {
            // Same-origin only: the master context's zero-network-request
            // rule means nothing cross-origin should ever be fetched, but if
            // one ever were, an opaque cross-origin response can't be
            // inspected and browsers reserve outsized quota for it — scope
            // this now rather than debug quota eviction later.
            urlPattern: ({ url, request }) =>
              url.origin === self.location.origin && request.mode !== 'navigate',
            handler: 'NetworkFirst',
            options: { cacheName: 'runtime-v1' },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  define: {
    __BUILD_SHA__: JSON.stringify(BUILD_SHA),
  },
  build: {
    // Keep asset URLs relative-free and predictable for the
    // "no external URL" acceptance test.
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        /**
         * One named chunk, and only one.
         *
         * `@mlc-ai/web-llm` is ~6 MB and carries several hundred URLs of its
         * own — the Hugging Face record for every one of its ~165 prebuilt
         * models. Two checks need to be able to NAME the file that holds them:
         * `globIgnores` above, so it never reaches a precache, and
         * `tests/no-external-urls.test.ts`, which permits those hosts in this
         * chunk and refuses them anywhere else in the build. A content-hashed
         * name chosen by the chunker cannot be named by either.
         *
         * This is the same arrangement the `docx` exporter already relies on,
         * one step more explicit. Everything else keeps the default chunking:
         * returning undefined leaves the decision to Rollup.
         */
        manualChunks(id: string) {
          if (id.includes('@mlc-ai/web-llm')) return 'web-llm'
          return undefined
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}'],
    exclude: ['tests/e2e/**'],
    // The default 5s is a budget, not a correctness bound, and several files
    // here legitimately exceed it under a fully parallel run: the duplicate-
    // front check in tests/rules-data.test.ts is an O(n^2) sweep over 571
    // cards, and each axe pass in src/app/App.a11y.test.tsx renders a whole
    // route into jsdom. Both passed in isolation and failed in the full suite,
    // which is the signature of contention rather than a defect. See
    // docs/TESTING.md.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      // src/lib is the pure layer — every calculation, every schedule, every
      // search ranking — and it is the only part of the app a number can be
      // wrong in without anyone noticing. Components are covered by the axe,
      // shell and e2e suites instead, where rendering is the thing under test.
      // `.tsx` is included even though src/lib holds no component today: with a
      // `.ts`-only glob, the first `.tsx` file added here would drop out of the
      // report AND out of the threshold, silently — a gate with a hole is worse
      // than no gate. The test files are excluded by the same pair of extensions
      // for the same reason.
      include: ['src/lib/**/*.{ts,tsx}'],
      exclude: ['src/lib/**/*.test.{ts,tsx}', 'src/lib/**/types.ts', 'src/lib/srs/index.ts'],
      reporter: ['text-summary', 'json-summary', 'lcov'],
      // Without this the report is thrown away whenever a single test fails,
      // which is exactly the run where the numbers are most worth reading.
      reportOnFailure: true,
      reportsDirectory: './coverage',
      thresholds: { lines: 90, functions: 90, statements: 90 },
    },
  },
})
