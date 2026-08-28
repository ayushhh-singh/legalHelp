import { create } from 'zustand'

import { DEFAULT_AI_SETTINGS, parseAiSettings, type AiSettings } from '@/ai/flags'
import { db, getSetting, setSetting, SETTING_KEYS } from '@/db'
import i18n, { detectBrowserLanguage, isLanguage, type Language } from '@/i18n'

export type Theme = 'light' | 'dark'

const isTheme = (v: unknown): v is Theme => v === 'light' || v === 'dark'
const isBoolean = (v: unknown): v is boolean => typeof v === 'boolean'

interface AppState {
  language: Language
  theme: Theme
  /**
   * AI feature flags. Lives here rather than in a store of its own so that
   * `enabled` is available to every module without importing anything from
   * src/ai beyond the type-only flags module — the AI layer itself stays
   * behind a dynamic import.
   */
  ai: AiSettings
  /**
   * True once the first-run onboarding (src/modules/onboarding) has been
   * completed or skipped. Read by App.tsx's `/` route to decide whether a
   * fresh device is sent to `/onboarding` — never a deep link, so a shared
   * section or a direct e2e navigation is never interrupted by it.
   */
  onboarded: boolean
  /**
   * Devanagari digits (०-९) in place of Arabic ones, wherever a module reads
   * this flag. NOT applied to the Pay calculator's payslip, deliberately —
   * ADR-018 fixes its numerals at Inter `tabular-nums` for column alignment,
   * a decision this toggle does not reopen.
   */
  devanagariDigits: boolean
  /** False until the first read from IndexedDB settles. */
  hydrated: boolean
  /** True when a preference could not be written to IndexedDB (see persist). */
  storageBlocked: boolean
  setLanguage: (language: Language) => Promise<void>
  setTheme: (theme: Theme) => Promise<void>
  setAi: (patch: Partial<AiSettings>) => Promise<void>
  setOnboarded: (onboarded: boolean) => Promise<void>
  setDevanagariDigits: (value: boolean) => Promise<void>
  toggleLanguage: () => Promise<void>
  toggleTheme: () => Promise<void>
  hydrate: () => Promise<void>
}

/**
 * Side effects that must track state, kept out of the reducer bodies.
 *
 * Each language is its own chunk (ADR-031), so `changeLanguage` resolves only
 * once that chunk has loaded — a caller that awaits `setLanguage` is entitled
 * to a fully applied language, not one still in flight.
 *
 * ## Why the result is checked rather than trusted
 *
 * i18next does NOT reject when a backend read fails. It resolves, sets
 * `i18n.language` to the language it could not load, and — because
 * `fallbackLng` is deliberately `false` (Hindi and English are on equal
 * footing, so a missing string must be a visible defect rather than silent
 * English) — `t()` then returns every key as its own name. A reader whose
 * Hindi chunk failed would get a screen of `pages.law.title` instead of an
 * interface, and the preference persists, so a reload reproduces it.
 *
 * That failure mode did not exist before the catalogues were split: both used
 * to be in the entry chunk, so if the app rendered at all, both languages were
 * there. `hasResourceBundle` is what distinguishes "loaded" from "asked for and
 * failed", and a language that did not load is not applied at all — the reader
 * keeps the working one. `<html lang>` moves only on success, because a `lang`
 * attribute that disagrees with the rendered text is worse for assistive tech
 * than one that lags.
 */
async function applyLanguage(language: Language): Promise<boolean> {
  const previous = i18n.language
  await i18n.changeLanguage(language)

  if (!i18n.hasResourceBundle(language, 'translation')) {
    // Back to whatever was working. Its bundle is already in memory, so this
    // cannot fail for the same reason.
    if (isLanguage(previous) && previous !== language) await i18n.changeLanguage(previous)
    return false
  }

  if (typeof document !== 'undefined') {
    document.documentElement.lang = language
  }
  return true
}

function applyTheme(theme: Theme) {
  if (typeof document === 'undefined') return
  // One class, not two. Light is the default palette on :root and dark applies
  // only from `.dark` — the OS setting is deliberately not consulted anywhere
  // (ADR-010), so there is nothing for a `.light` class to opt out of.
  const root = document.documentElement
  root.classList.toggle('dark', theme === 'dark')
  root.style.colorScheme = theme
}

/**
 * Light, always — never `prefers-color-scheme`. A reader who wants dark asks
 * for it in the app, and that choice is what gets stored (ADR-010).
 */
const DEFAULT_THEME: Theme = 'light'

/**
 * Tracks whether the reader changed a preference while hydrate() was still in
 * flight. Without this, a toggle pressed on a slow device is silently reverted
 * when the IndexedDB read lands a moment later.
 */
const changedDuringHydrate = {
  language: false,
  theme: false,
  ai: false,
  onboarded: false,
  devanagariDigits: false,
}

/** Newest hydrate wins, so an earlier slow read cannot overwrite a later one. */
let hydrateGeneration = 0

export const useAppStore = create<AppState>((set, get) => ({
  language: detectBrowserLanguage(),
  theme: 'light',
  ai: DEFAULT_AI_SETTINGS,
  onboarded: false,
  devanagariDigits: false,
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
    const applied = await applyLanguage(language)
    if (!applied) {
      // The chunk did not load. Nothing is set and nothing is persisted: a
      // preference that cannot be rendered is not a preference the reader
      // should be stuck with on the next visit.
      return
    }
    set({ language })
    await persist(SETTING_KEYS.language, language, set)
  },

  setTheme: async (theme) => {
    changedDuringHydrate.theme = true
    set({ theme })
    applyTheme(theme)
    await persist(SETTING_KEYS.theme, theme, set)
  },

  /**
   * Patch-and-persist. The whole object is written every time so that a row
   * written by an older build is normalised on the next change rather than
   * accumulating fields nobody parses.
   */
  setAi: async (patch) => {
    changedDuringHydrate.ai = true
    const next = parseAiSettings({ ...get().ai, ...patch })
    set({ ai: next })
    await persist(SETTING_KEYS.ai, next, set)
  },

  setOnboarded: async (onboarded) => {
    changedDuringHydrate.onboarded = true
    set({ onboarded })
    await persist(SETTING_KEYS.onboarded, onboarded, set)
  },

  setDevanagariDigits: async (devanagariDigits) => {
    changedDuringHydrate.devanagariDigits = true
    set({ devanagariDigits })
    await persist(SETTING_KEYS.devanagariDigits, devanagariDigits, set)
  },

  toggleLanguage: async () => {
    await get().setLanguage(get().language === 'en' ? 'hi' : 'en')
  },

  toggleTheme: async () => {
    await get().setTheme(get().theme === 'light' ? 'dark' : 'light')
  },

  /**
   * Stored preference wins; otherwise the browser's language and the light
   * theme. Never throws — a blocked or unavailable IndexedDB degrades to the
   * defaults rather than an empty screen.
   */
  hydrate: async () => {
    const generation = ++hydrateGeneration
    changedDuringHydrate.language = false
    changedDuringHydrate.theme = false
    changedDuringHydrate.ai = false
    changedDuringHydrate.onboarded = false
    changedDuringHydrate.devanagariDigits = false

    let language = detectBrowserLanguage()
    let theme: Theme = DEFAULT_THEME
    let ai: AiSettings = DEFAULT_AI_SETTINGS
    let onboarded = false
    let devanagariDigits = false
    let blocked = false

    try {
      const [storedLanguage, storedTheme, storedAi, storedOnboarded, storedDigits] = await Promise.all([
        getSetting<unknown>(SETTING_KEYS.language),
        getSetting<unknown>(SETTING_KEYS.theme),
        getSetting<unknown>(SETTING_KEYS.ai),
        getSetting<unknown>(SETTING_KEYS.onboarded),
        getSetting<unknown>(SETTING_KEYS.devanagariDigits),
      ])
      // Anything unrecognised (a hand-edited row, a value from a future
      // version) is discarded rather than trusted. For AI that rule is what
      // keeps the feature off: parseAiSettings cannot produce a consented
      // state out of a row it does not understand.
      if (isLanguage(storedLanguage)) language = storedLanguage
      if (isTheme(storedTheme)) theme = storedTheme
      if (storedAi !== undefined) ai = parseAiSettings(storedAi)
      if (isBoolean(storedOnboarded)) onboarded = storedOnboarded
      if (isBoolean(storedDigits)) devanagariDigits = storedDigits
    } catch (error) {
      blocked = true
      console.warn('[sahayak] could not read settings from IndexedDB', error)
    }

    // A newer hydrate has taken over; this result is stale.
    if (generation !== hydrateGeneration) return

    const next: Partial<AppState> = { hydrated: true, storageBlocked: blocked }

    if (!changedDuringHydrate.language) {
      next.language = language
      // Not awaited: hydrate() must not hold the first paint behind a resource
      // chunk. The shell is already rendering in the browser-detected language
      // and re-renders when i18next emits `loaded`.
      void applyLanguage(language)
    }
    if (!changedDuringHydrate.theme) {
      next.theme = theme
      applyTheme(theme)
    }
    if (!changedDuringHydrate.ai) {
      next.ai = ai
    }
    if (!changedDuringHydrate.onboarded) {
      next.onboarded = onboarded
    }
    if (!changedDuringHydrate.devanagariDigits) {
      next.devanagariDigits = devanagariDigits
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
