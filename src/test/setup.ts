import '@testing-library/jest-dom/vitest'
// jsdom has no IndexedDB; Dexie needs one before any module imports it.
import 'fake-indexeddb/auto'

import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach } from 'vitest'

import { db } from '@/db'
import i18n from '@/i18n'

beforeEach(async () => {
  // Each test starts from an empty device and the default language.
  await db.settings.clear()
  await i18n.changeLanguage('en')
  document.documentElement.className = ''
  document.documentElement.lang = 'en'
})

afterEach(() => {
  cleanup()
})
