import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'

import en from './en.json'
import hi from './hi.json'

export const LANGUAGES = ['en', 'hi'] as const
export type Language = (typeof LANGUAGES)[number]

export const LANGUAGE_LABELS: Record<Language, string> = {
  en: 'EN',
  hi: 'हिं',
}

/** Endonyms — each language names itself in itself. */
export const LANGUAGE_NAMES: Record<Language, string> = {
  en: 'English',
  hi: 'हिन्दी',
}

export const DEFAULT_LANGUAGE: Language = 'en'

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value)
}

/**
 * Master context: default language follows the browser (hi-* -> hi), else en.
 * A stored preference always wins over this; see src/app/store.ts.
 *
 * Matches the primary subtag exactly rather than by prefix: `hif` is Fiji
 * Hindi, a different language, and `startsWith('hi')` would claim it.
 */
export function detectBrowserLanguage(
  navigatorLanguage: string | undefined = globalThis.navigator?.language,
): Language {
  const primarySubtag = navigatorLanguage?.toLowerCase().split('-')[0]
  return primarySubtag === 'hi' ? 'hi' : DEFAULT_LANGUAGE
}

export const resources = {
  en: { translation: en },
  hi: { translation: hi },
} as const

/**
 * `fallbackLng` is deliberately false. Hindi and English are on equal footing,
 * so a missing Hindi string must surface as a visible defect and fail CI
 * (scripts/i18n-check.mjs + src/i18n/i18n.test.ts) rather than quietly
 * rendering English.
 */
void i18next.use(initReactI18next).init({
  resources,
  // Follow the browser on first load. A stored preference overrides this as
  // soon as hydrate() resolves; starting at DEFAULT_LANGUAGE instead would
  // show a Hindi reader English until that async read landed.
  lng: detectBrowserLanguage(),
  supportedLngs: LANGUAGES,
  fallbackLng: false,
  returnNull: false,
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
})

export default i18next
