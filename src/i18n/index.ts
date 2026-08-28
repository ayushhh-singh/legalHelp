import i18next, { type BackendModule, type ReadCallback } from 'i18next'
import { initReactI18next } from 'react-i18next'

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

/**
 * One language reaches the browser at boot, not two.
 *
 * Both resource files used to be static imports, so every reader downloaded
 * ~40 KB gzip of translations of which they could read half. These loaders are
 * dynamic imports, which means Vite emits `en` and `hi` as their own chunks and
 * i18next fetches exactly the one being rendered — an ~18 KB gzip saving for an
 * English reader and ~22 KB for a Hindi one, on every cold load. Both chunks are
 * still precached by the service worker (vite.config.ts globPatterns covers
 * every emitted .js), so toggling language offline works exactly as before.
 *
 * This is not a fallback: neither language is privileged, whichever one is
 * active is the one that loads. docs/DATA-GAPS.md #55, ADR-031.
 */
const loaders: Record<Language, () => Promise<{ default: object }>> = {
  en: () => import('./en.json'),
  hi: () => import('./hi.json'),
}

/**
 * i18next's own lazy-loading seam. Registering it as a backend rather than
 * hand-rolling a `load-then-changeLanguage` wrapper is what keeps this module's
 * public surface identical for the 29 files that import it: `changeLanguage`
 * still just works, and it awaits the chunk itself.
 */
const chunkBackend: BackendModule = {
  type: 'backend',
  init: () => {},
  read(language: string, _namespace: string, callback: ReadCallback) {
    const load = isLanguage(language) ? loaders[language] : undefined
    if (!load) {
      callback(new Error(`Unsupported language: ${language}`), false)
      return
    }
    void load().then(
      (module) => {
        callback(null, module.default)
      },
      (error: unknown) => {
        callback(error instanceof Error ? error : new Error(String(error)), false)
      },
    )
  },
}

/**
 * `fallbackLng` is deliberately false. Hindi and English are on equal footing,
 * so a missing Hindi string must surface as a visible defect and fail CI
 * (scripts/i18n-check.mjs + src/i18n/i18n.test.ts) rather than quietly
 * rendering English.
 */
const bootLanguage = detectBrowserLanguage()

/** The other one — the only candidate if the boot language's chunk fails. */
const otherLanguage: Language = bootLanguage === 'en' ? 'hi' : 'en'

export const i18nReady: Promise<unknown> = i18next
  .use(chunkBackend)
  .use(initReactI18next)
  .init({
    // Follow the browser on first load. A stored preference overrides this as
    // soon as hydrate() resolves; starting at DEFAULT_LANGUAGE instead would
    // show a Hindi reader English until that async read landed.
    lng: bootLanguage,
    supportedLngs: LANGUAGES,
    fallbackLng: false,
    returnNull: false,
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
    // Only the active language is ever read; `all`/`languageOnly` would ask
    // the backend for regional variants that have no chunk.
    load: 'currentOnly',
  })
  .then(async (t) => {
    /*
      If the boot language's chunk did not arrive, use the other one.

      i18next does not reject on a backend failure: it resolves, keeps
      `language` set to what it could not load, and — with `fallbackLng: false`
      — renders every key as its own name. So a Hindi reader whose chunk was
      evicted from the cache while offline would get a screen of
      `pages.law.title` rather than an interface, with no way to recover from
      inside the app.

      This is NOT the silent English fallback `fallbackLng: false` exists to
      forbid. That rule is about a MISSING KEY inside a catalogue that did
      load — which must stay a visible defect and fail CI (scripts/i18n-check.mjs,
      src/i18n/i18n.test.ts). This is a delivery failure of the whole file, and
      a complete interface in the other language beats an unusable one in the
      intended language. The reader can still switch back once the chunk is
      reachable, and `store.ts#applyLanguage` refuses the switch until it is.
    */
    if (i18next.hasResourceBundle(bootLanguage, 'translation')) return t
    return i18next.changeLanguage(otherLanguage)
  })

export default i18next
