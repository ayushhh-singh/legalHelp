import { create } from 'zustand'

import { db, getSetting, setSetting, SETTING_KEYS } from '@/db'
import i18n, { detectBrowserLanguage, isLanguage, type Language } from '@/i18n'

export type Theme = 'light' | 'dark'

const isTheme = (v: unknown): v is Theme => v === 'light' || v === 'dark'

interface AppState {
  language: Language
  theme: Theme
  /** False until the first read from IndexedDB settles. */
  hydrated: boolean
  setLanguage: (language: Language) => Promise<void>
  setTheme: (theme: Theme) => Promise<void>
  toggleLanguage: () => Promise<void>
  toggleTheme: () => Promise<void>
  hydrate: () => Promise<void>
}

/** Side effects that must track state, kept out of the reducer bodies. */
function applyLanguage(language: Language) {
  void i18n.changeLanguage(language)
  if (typeof document !== 'undefined') {
    document.documentElement.lang = language
  }
}

function applyTheme(theme: Theme) {
  if (typeof document !== 'undefined') {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    document.documentElement.style.colorScheme = theme
  }
}

function detectTheme(): Theme {
  return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export const useAppStore = create<AppState>((set, get) => ({
  language: detectBrowserLanguage(),
  theme: 'light',
  hydrated: false,

  setLanguage: async (language) => {
    set({ language })
    applyLanguage(language)
    await setSetting(SETTING_KEYS.language, language)
  },

  setTheme: async (theme) => {
    set({ theme })
    applyTheme(theme)
    await setSetting(SETTING_KEYS.theme, theme)
  },

  toggleLanguage: async () => {
    await get().setLanguage(get().language === 'en' ? 'hi' : 'en')
  },

  toggleTheme: async () => {
    await get().setTheme(get().theme === 'light' ? 'dark' : 'light')
  },

  /**
   * Stored preference wins; otherwise fall back to the browser's language and
   * colour-scheme hints. Never throws — a blocked or unavailable IndexedDB
   * degrades to detected defaults rather than an empty screen.
   */
  hydrate: async () => {
    let language = detectBrowserLanguage()
    let theme = detectTheme()

    try {
      const [storedLanguage, storedTheme] = await Promise.all([
        getSetting<unknown>(SETTING_KEYS.language),
        getSetting<unknown>(SETTING_KEYS.theme),
      ])
      if (isLanguage(storedLanguage)) language = storedLanguage
      if (isTheme(storedTheme)) theme = storedTheme
    } catch (error) {
      console.warn('[sahayak] could not read settings from IndexedDB', error)
    }

    set({ language, theme, hydrated: true })
    applyLanguage(language)
    applyTheme(theme)
  },
}))

/** Test seam: drop the singleton connection so a fresh one can be opened. */
export function closeDb(): void {
  db.close()
}
