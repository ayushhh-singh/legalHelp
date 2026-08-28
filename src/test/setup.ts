import '@testing-library/jest-dom/vitest'
// jsdom has no IndexedDB; Dexie needs one before any module imports it.
import 'fake-indexeddb/auto'

import { webcrypto } from 'node:crypto'

import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach } from 'vitest'

import { lockVault } from '@/ai/secrets'
import { clearAllData } from '@/db'
import i18n from '@/i18n'

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
  await i18n.changeLanguage('en')
  document.documentElement.className = ''
  document.documentElement.lang = 'en'
})

afterEach(() => {
  cleanup()
})
