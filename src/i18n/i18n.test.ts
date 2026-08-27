import { describe, expect, it } from 'vitest'

import en from './en.json'
import hi from './hi.json'
import { detectBrowserLanguage, isLanguage, LANGUAGES } from './index'

/** Mirrors scripts/i18n-check.mjs so `pnpm test` alone also catches drift. */
function flatten(value: unknown, prefix = '', out: string[] = []): string[] {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      flatten(child, prefix ? `${prefix}.${key}` : key, out)
    }
  } else {
    out.push(prefix)
  }
  return out
}

describe('i18n resources', () => {
  it('has identical key sets in English and Hindi', () => {
    const enKeys = flatten(en).sort()
    const hiKeys = flatten(hi).sort()
    // Report the difference rather than a bare boolean, so failures are useful.
    expect(hiKeys.filter((k) => !enKeys.includes(k))).toEqual([])
    expect(enKeys.filter((k) => !hiKeys.includes(k))).toEqual([])
    expect(hiKeys).toEqual(enKeys)
  })

  it('has no empty strings in either locale', () => {
    for (const [name, resource] of Object.entries({ en, hi })) {
      const walk = (value: unknown, path: string): void => {
        if (typeof value === 'string') {
          expect(value.trim(), `${name}.json ${path} is empty`).not.toBe('')
        } else if (value && typeof value === 'object') {
          for (const [k, v] of Object.entries(value)) walk(v, path ? `${path}.${k}` : k)
        }
      }
      walk(resource, '')
    }
  })

  it('actually translates the Hindi strings', () => {
    // Devanagari must appear; identical ASCII in both locales means untranslated.
    const enFlat = new Map(flatten(en).map((k) => [k, get(en, k)]))
    const untranslated = flatten(hi).filter((key) => {
      const hiValue = get(hi, key)
      const enValue = enFlat.get(key)
      return typeof hiValue === 'string' && hiValue === enValue && /^[\x20-\x7E]+$/.test(hiValue)
    })
    expect(untranslated).toEqual([])
  })

  it('detects Hindi from the browser locale, English otherwise', () => {
    expect(detectBrowserLanguage('hi')).toBe('hi')
    expect(detectBrowserLanguage('hi-IN')).toBe('hi')
    expect(detectBrowserLanguage('HI-in')).toBe('hi')
    expect(detectBrowserLanguage('en-GB')).toBe('en')
    expect(detectBrowserLanguage('ta-IN')).toBe('en')
    expect(detectBrowserLanguage(undefined)).toBe('en')
  })

  it('narrows language codes', () => {
    expect(LANGUAGES).toEqual(['en', 'hi'])
    expect(isLanguage('hi')).toBe(true)
    expect(isLanguage('fr')).toBe(false)
    expect(isLanguage(undefined)).toBe(false)
  })
})

function get(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[key]
    return undefined
  }, obj)
}
