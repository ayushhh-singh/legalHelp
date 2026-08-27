import type en from './en.json'

/**
 * Types t() against the English resource, so an unknown or misspelled key is a
 * compile error rather than a string that renders as its own key at runtime.
 */
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation'
    resources: {
      translation: typeof en
    }
    returnNull: false
  }
}
