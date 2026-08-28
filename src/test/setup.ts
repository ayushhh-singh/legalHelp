import '@testing-library/jest-dom/vitest'
// jsdom has no IndexedDB; Dexie needs one before any module imports it.
import 'fake-indexeddb/auto'

import { webcrypto } from 'node:crypto'

import { cleanup, configure } from '@testing-library/react'
import { afterEach, beforeEach } from 'vitest'

import { lockVault } from '@/ai/secrets'
import { clearAllData } from '@/db'
import i18n, { i18nReady } from '@/i18n'

// jsdom ships getRandomValues but no SubtleCrypto, which the AI key vault
// needs. Node's own WebCrypto is the same specified API, so the vault under
// test is the vault that ships.
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })
}

beforeEach(async () => {
  // Each test starts from an empty device and the default language. Every
  // table is cleared, not only `settings`, so an AI test cannot leak a key or
  // a cached answer into the next one.
  await clearAllData()
  lockVault()
  // Each language is its own chunk (ADR-031); i18next resolves this once the
  // boot language has loaded, and changeLanguage awaits any other one itself.
  await i18nReady
  await i18n.changeLanguage('en')
  document.documentElement.className = ''
  document.documentElement.lang = 'en'
})

afterEach(() => {
  cleanup()
})

/**
 * `waitFor`'s 1s default is a race against CPU contention, not against the
 * code under test. Four of this suite's heaviest files — the Settings page
 * (which waits on a real lazy chunk), the shell edge cases and both axe runs —
 * failed intermittently in a full parallel run and passed every time in
 * isolation, which is the signature of a budget rather than a defect. The
 * assertions are unchanged; only the patience is. A genuinely stuck await
 * still fails, just eight seconds later.
 */
configure({ asyncUtilTimeout: 8_000 })
