import { fileURLToPath, URL } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vitest/config'

import en from './src/i18n/en.json' with { type: 'json' }
import hi from './src/i18n/hi.json' with { type: 'json' }

/**
 * The runtimeCaching `urlPattern` functions below run inside the generated
 * service worker (workbox-build serializes them into dist/sw.js), not in
 * this Node process — `self` there is ServiceWorkerGlobalScope, which
 * tsconfig.node.json's Node-only `lib` has no declaration for.
 */
declare const self: { location: { origin: string } }

export default defineConfig({
  plugins: [
    react(),
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
        theme_color: '#F7F1E3',
        background_color: '#F7F1E3',
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
  build: {
    // Keep asset URLs relative-free and predictable for the
    // "no external URL" acceptance test.
    assetsInlineLimit: 0,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}'],
    exclude: ['tests/e2e/**'],
  },
})
