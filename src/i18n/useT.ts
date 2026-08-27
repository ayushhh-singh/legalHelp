import { useTranslation } from 'react-i18next'

import { isLanguage, type Language, DEFAULT_LANGUAGE } from './index'

/**
 * Thin wrapper over useTranslation so components import one thing and always
 * get a narrowed `language` rather than i18next's plain string.
 */
export function useT() {
  const { t, i18n } = useTranslation()
  const language: Language = isLanguage(i18n.language) ? i18n.language : DEFAULT_LANGUAGE
  return { t, i18n, language }
}

/** Current language, narrowed. Useful outside of render-heavy components. */
export function useLanguage(): Language {
  return useT().language
}
