import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // `node`, not `jsdom`: the code under test is a Worker, and the two suites
    // here need real Request/Response/ReadableStream rather than jsdom's.
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // The miniflare suite starts workerd, which downloads on first run.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
})
