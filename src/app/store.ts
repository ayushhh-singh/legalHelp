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
  /** True when a preference could not be written to IndexedDB (see persist). */
  storageBlocked: boolean
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
  if (typeof document === 'undefined') return
  // Both classes are set explicitly. tokens.css applies the dark palette from
  // `prefers-color-scheme` before paint, so `.light` is what lets a reader on a
  // dark system choose light and actually get it.
  const root = document.documentElement
  root.classList.toggle('dark', theme === 'dark')
  root.classList.toggle('light', theme === 'light')
  root.style.colorScheme = theme
}

function detectTheme(): Theme {
  return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/**
 * Tracks whether the reader changed a preference while hydrate() was still in
 * flight. Without this, a toggle pressed on a slow device is silently reverted
 * when the IndexedDB read lands a moment later.
 */
const changedDuringHydrate = { language: false, theme: false }

/** Newest hydrate wins, so an earlier slow read cannot overwrite a later one. */
let hydrateGeneration = 0

export const useAppStore = create<AppState>((set, get) => ({
  language: detectBrowserLanguage(),
  theme: 'light',
  hydrated: false,
  storageBlocked: false,

  /**
   * The in-memory change always applies; only persistence can fail. IndexedDB
   * is unavailable in some private-browsing modes and can be blocked outright
   * by browser settings, and an unhandled rejection there would surface as an
   * uncaught error every time the reader pressed a toggle.
   */
  setLanguage: async (language) => {
    changedDuringHydrate.language = true
    set({ language })
    applyLanguage(language)
    await persist(SETTING_KEYS.language, language, set)
  },

  setTheme: async (theme) => {
    changedDuringHydrate.theme = true
    set({ theme })
    applyTheme(theme)
    await persist(SETTING_KEYS.theme, theme, set)
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
    const generation = ++hydrateGeneration
    changedDuringHydrate.language = false
    changedDuringHydrate.theme = false

    let language = detectBrowserLanguage()
    let theme = detectTheme()
    let blocked = false

    try {
      const [storedLanguage, storedTheme] = await Promise.all([
        getSetting<unknown>(SETTING_KEYS.language),
        getSetting<unknown>(SETTING_KEYS.theme),
      ])
      // Anything unrecognised (a hand-edited row, a value from a future
      // version) is discarded rather than trusted.
      if (isLanguage(storedLanguage)) language = storedLanguage
      if (isTheme(storedTheme)) theme = storedTheme
    } catch (error) {
      blocked = true
      console.warn('[sahayak] could not read settings from IndexedDB', error)
    }

    // A newer hydrate has taken over; this result is stale.
    if (generation !== hydrateGeneration) return

    const next: Partial<AppState> = { hydrated: true, storageBlocked: blocked }

    if (!changedDuringHydrate.language) {
      next.language = language
      applyLanguage(language)
    }
    if (!changedDuringHydrate.theme) {
      next.theme = theme
      applyTheme(theme)
    }

    set(next)
  },
}))

/** Write one preference, downgrading a storage failure to a flag on the store. */
async function persist(
  key: (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS],
  value: unknown,
  set: (partial: Partial<AppState>) => void,
): Promise<void> {
  try {
    await setSetting(key, value)
    set({ storageBlocked: false })
  } catch (error) {
    set({ storageBlocked: true })
    console.warn(`[sahayak] could not save "${key}" — the change applies for this session only`, error)
  }
}

/** Test seam: drop the singleton connection so a fresh one can be opened. */
export function closeDb(): void {
  db.close()
}
