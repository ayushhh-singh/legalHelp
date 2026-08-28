import Dexie from 'dexie'
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

describe('the version 2 upgrade', () => {
  /**
   * Session 3A added `secrets`, `aiAnswers` and `aiUsage`. Every device that
   * already has this app installed opens a v1 database and must be carried
   * across without losing the preferences it holds — the one migration path
   * that cannot be tested by opening a fresh database, which every other test
   * here does.
   */
  it('carries a v1 database forward without losing what it held', async () => {
    const name = 'sahayak-upgrade-probe'
    await Dexie.delete(name)

    // Exactly the schema shipped in Session 1.
    const v1 = new Dexie(name)
    v1.version(1).stores({ settings: '&key' })
    await v1.table('settings').put({ key: SETTING_KEYS.theme, value: 'dark' })
    v1.close()

    const v2 = new SahayakDB(name)
    try {
      await v2.open()

      // The class declares up to version 10 now (the command palette's
      // recent-jumps list, Session 14), so opening it upgrades a v1 database
      // straight to the current version rather than stopping at 2.
      expect(v2.verno).toBe(10)
      expect(await v2.settings.get(SETTING_KEYS.theme)).toEqual({
        key: SETTING_KEYS.theme,
        value: 'dark',
      })
      // The new tables exist and are empty: nothing is turned on by an upgrade.
      expect(await v2.secrets.count()).toBe(0)
      expect(await v2.aiAnswers.count()).toBe(0)
      expect(await v2.aiUsage.count()).toBe(0)
      expect(await v2.payScenarios.count()).toBe(0)
      expect(await v2.drafts.count()).toBe(0)
      expect(await v2.draftDefaults.count()).toBe(0)
      expect(await v2.glossaryFavourites.count()).toBe(0)
      expect(await v2.glossaryRecents.count()).toBe(0)
      expect(await v2.srsCards.count()).toBe(0)
      expect(await v2.reviewLog.count()).toBe(0)
      expect(await v2.streaks.count()).toBe(0)
      expect(await v2.trainerSettings.count()).toBe(0)
      expect(await v2.trainerBookmarks.count()).toBe(0)
      expect(await v2.trainerReports.count()).toBe(0)
      expect(await v2.proposedCards.count()).toBe(0)
      expect(await v2.cardOverrides.count()).toBe(0)
      expect(await v2.holidayPicks.count()).toBe(0)
      expect(await v2.commandRecents.count()).toBe(0)
    } finally {
      v2.close()
      await Dexie.delete(name)
    }
  })

  it('declares every table clearAllData will have to clear', () => {
    // clearAllData iterates db.tables, so a table added without being declared
    // on the class would be silently left behind by the kill switch.
    expect(db.tables.map((table) => table.name).sort()).toEqual([
      'aiAnswers',
      'aiUsage',
      'cardOverrides',
      'commandRecents',
      'draftDefaults',
      'drafts',
      'glossaryFavourites',
      'glossaryRecents',
      'holidayPicks',
      'lawFavourites',
      'lawRecents',
      'payScenarios',
      'proposedCards',
      'reviewLog',
      'secrets',
      'settings',
      'srsCards',
      'streaks',
      'trainerBookmarks',
      'trainerReports',
      'trainerSettings',
    ])
  })
})
