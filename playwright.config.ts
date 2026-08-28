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
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
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
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      // The WebKit spec below is about a browser DIFFERENCE; running it here
      // would assert Chromium's behaviour and prove nothing.
      testIgnore: '**/voice-unsupported.spec.ts',
    },
    {
      /*
        One spec, in a real WebKit.

        Voice search is offered only where speech can be recognised ON THE
        DEVICE (ADR-017), which today means Chrome. That decision is invisible
        in Chromium — the only place it can be checked is a browser that cannot
        do it, so this project exists to check exactly that and nothing else.
      */
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      testMatch: '**/voice-unsupported.spec.ts',
    },
  ],
})
