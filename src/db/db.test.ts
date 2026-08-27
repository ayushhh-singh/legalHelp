import { describe, expect, it } from 'vitest'

import { clearAllData, db, getSetting, SETTING_KEYS, setSetting, SahayakDB } from './index'

import { useAppStore } from '@/app/store'

describe('settings persistence', () => {
  it('round-trips a value through IndexedDB', async () => {
    await setSetting(SETTING_KEYS.theme, 'dark')
    expect(await getSetting(SETTING_KEYS.theme)).toBe('dark')
  })

  it('keeps one row per key', async () => {
    await setSetting(SETTING_KEYS.language, 'hi')
    await setSetting(SETTING_KEYS.language, 'en')
    expect(await db.settings.where('key').equals('language').count()).toBe(1)
    expect(await getSetting(SETTING_KEYS.language)).toBe('en')
  })

  it('survives a fresh connection to the same database', async () => {
    await setSetting(SETTING_KEYS.theme, 'dark')
    await setSetting(SETTING_KEYS.language, 'hi')

    // Stands in for a page reload: a brand-new Dexie instance, same store.
    const reopened = new SahayakDB()
    try {
      await reopened.open()
      expect((await reopened.settings.get('theme'))?.value).toBe('dark')
      expect((await reopened.settings.get('language'))?.value).toBe('hi')
    } finally {
      reopened.close()
    }
  })

  it('clears everything on request', async () => {
    await setSetting(SETTING_KEYS.theme, 'dark')
    await clearAllData()
    expect(await getSetting(SETTING_KEYS.theme)).toBeUndefined()
  })
})

describe('app store', () => {
  it('writes the theme through to IndexedDB and applies the class', async () => {
    await useAppStore.getState().setTheme('dark')

    expect(useAppStore.getState().theme).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(await getSetting(SETTING_KEYS.theme)).toBe('dark')
  })

  it('rehydrates the stored theme and language after a reset', async () => {
    await useAppStore.getState().setTheme('dark')
    await useAppStore.getState().setLanguage('hi')

    // Simulate a reload: throw away in-memory state, then hydrate from storage.
    useAppStore.setState({ theme: 'light', language: 'en', hydrated: false })
    document.documentElement.classList.remove('dark')

    await useAppStore.getState().hydrate()

    expect(useAppStore.getState().theme).toBe('dark')
    expect(useAppStore.getState().language).toBe('hi')
    expect(useAppStore.getState().hydrated).toBe(true)
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.lang).toBe('hi')
  })

  it('falls back to detected defaults when nothing is stored', async () => {
    await clearAllData()
    useAppStore.setState({ hydrated: false })

    await useAppStore.getState().hydrate()

    expect(useAppStore.getState().hydrated).toBe(true)
    expect(['en', 'hi']).toContain(useAppStore.getState().language)
    expect(['light', 'dark']).toContain(useAppStore.getState().theme)
  })

  it('toggles language both ways', async () => {
    await useAppStore.getState().setLanguage('en')
    await useAppStore.getState().toggleLanguage()
    expect(useAppStore.getState().language).toBe('hi')
    await useAppStore.getState().toggleLanguage()
    expect(useAppStore.getState().language).toBe('en')
  })
})
