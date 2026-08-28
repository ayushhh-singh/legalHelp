import { defineConfig, devices } from '@playwright/test'

/**
 * Runs against a production build: the service worker only exists there
 * (registerType "prompt" in vite.config.ts, registered from src/app/pwa.tsx
 * only when import.meta.env.PROD), so `pnpm dev` cannot exercise it.
 */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // `list` for a human reading the log; `html` so a failing CI run has a report
  // to upload alongside the traces (.github/workflows/ci.yml), and `blob` is
  // deliberately absent — the suite runs as one job, not sharded.
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    // CI retries twice, so a genuinely failing test always leaves a trace
    // behind; a flake that passes on retry leaves one too, which is what makes
    // it diagnosable rather than merely annoying.
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: process.env.CI ? 'retain-on-failure' : 'off',
  },
  webServer: {
    // CI already runs `pnpm build` as its own step before this; rebuilding
    // here too would mean testing a second, separately-built dist/ instead
    // of the one the prior CI step just verified. Locally, build inline so
    // `pnpm test:e2e` works standalone.
    command: process.env.CI ? 'pnpm preview' : 'pnpm build && pnpm preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      /*
        The same suite at a phone viewport.

        This is not a duplicate run for its own sake. The shell swaps its whole
        navigation below 1024px (sidebar -> bottom tab bar, 4 tabs + a "More"
        sheet under 768px, src/lib/nav.ts), the Law Converter stacks the result
        list under the open section instead of beside it, and every tap target
        has a 44px floor the desktop layout never exercises. A control that is
        reachable on a desktop and unreachable on a phone is the defect this
        project exists to find.

        Pixel 7 is 412x915 with a 2.625x device pixel ratio and touch enabled,
        which puts it under both breakpoints and makes `hasTouch` true — so a
        hover-only affordance fails here.
      */
      name: 'mobile-chromium',
      use: { ...devices['Pixel 7'] },
      // Three specs run once, on desktop, because nothing in them is
      // viewport-sensitive and each waits on the service worker taking control
      // with a 30s ceiling — running them twice doubles that for no signal.
      // csp.spec.ts replays the production CSP from public/_headers onto the
      // document; pwa-install.spec.ts checks the manifest, the icon sizes and
      // the SPA fallback; typography.spec.ts measures the font faces.
      testIgnore: ['**/csp.spec.ts', '**/typography.spec.ts', '**/pwa-install.spec.ts'],
    },
  ],
})
