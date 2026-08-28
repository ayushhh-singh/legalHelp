import { describe, expect, it, vi, afterEach } from 'vitest'

import { useAppStore } from './store'

import { db, getSetting, setSetting, SETTING_KEYS, clearAllData } from '@/db'
import i18n from '@/i18n'

/** Edge cases in preference handling. Each one maps to a bug found in review. */

afterEach(() => {
  vi.restoreAllMocks()
})

describe('storage failures', () => {
  // IndexedDB is unavailable in some private-browsing modes and can be blocked
  // by browser settings. The toggles are fired as `void toggle()`, so a
  // rejection here surfaced as an uncaught error on every press.
  it('does not reject when the theme cannot be written', async () => {
    vi.spyOn(db.settings, 'put').mockRejectedValue(new DOMException('blocked', 'InvalidStateError'))

    await expect(useAppStore.getState().setTheme('dark')).resolves.toBeUndefined()

    // The change still applies for this session.
    expect(useAppStore.getState().theme).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(useAppStore.getState().storageBlocked).toBe(true)
  })

  it('does not reject when the language cannot be written', async () => {
    vi.spyOn(db.settings, 'put').mockRejectedValue(new Error('QuotaExceededError'))

    await expect(useAppStore.getState().setLanguage('hi')).resolves.toBeUndefined()

    expect(useAppStore.getState().language).toBe('hi')
    expect(i18n.language).toBe('hi')
    expect(useAppStore.getState().storageBlocked).toBe(true)
  })

  it('clears the blocked flag once a write succeeds again', async () => {
    const spy = vi.spyOn(db.settings, 'put').mockRejectedValue(new Error('nope'))
    await useAppStore.getState().setTheme('dark')
    expect(useAppStore.getState().storageBlocked).toBe(true)

    spy.mockRestore()
    await useAppStore.getState().setTheme('light')
    expect(useAppStore.getState().storageBlocked).toBe(false)
  })

  it('falls back to the defaults when the read fails', async () => {
    vi.spyOn(db.settings, 'get').mockRejectedValue(new Error('unavailable'))
    useAppStore.setState({ hydrated: false })

    await expect(useAppStore.getState().hydrate()).resolves.toBeUndefined()

    expect(useAppStore.getState().hydrated).toBe(true)
    expect(useAppStore.getState().storageBlocked).toBe(true)
    expect(['en', 'hi']).toContain(useAppStore.getState().language)
  })
})

describe('hydrate races', () => {
  // On a slow device the toggles are interactive before the IndexedDB read
  // lands. Hydration used to overwrite whatever the reader had just chosen.
  it('does not overwrite a language chosen while hydrating', async () => {
    await setSetting(SETTING_KEYS.language, 'en')
    useAppStore.setState({ hydrated: false, language: 'en' })

    const hydrating = useAppStore.getState().hydrate()
    await useAppStore.getState().setLanguage('hi')
    await hydrating

    expect(useAppStore.getState().language).toBe('hi')
    expect(i18n.language).toBe('hi')
    expect(await getSetting(SETTING_KEYS.language)).toBe('hi')
  })

  it('does not overwrite a theme chosen while hydrating', async () => {
    await setSetting(SETTING_KEYS.theme, 'light')
    useAppStore.setState({ hydrated: false, theme: 'light' })

    const hydrating = useAppStore.getState().hydrate()
    await useAppStore.getState().setTheme('dark')
    await hydrating

    expect(useAppStore.getState().theme).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('lets the newest hydrate win when two overlap', async () => {
    await setSetting(SETTING_KEYS.theme, 'dark')
    useAppStore.setState({ hydrated: false, theme: 'light' })

    await Promise.all([useAppStore.getState().hydrate(), useAppStore.getState().hydrate()])

    expect(useAppStore.getState().theme).toBe('dark')
    expect(useAppStore.getState().hydrated).toBe(true)
  })
})

describe('the AI settings slice', () => {
  it('does not reject when they cannot be written', async () => {
    vi.spyOn(db.settings, 'put').mockRejectedValue(new DOMException('blocked', 'InvalidStateError'))

    await expect(useAppStore.getState().setAi({ tier: 'byok' })).resolves.toBeUndefined()

    expect(useAppStore.getState().ai.tier).toBe('byok')
    expect(useAppStore.getState().storageBlocked).toBe(true)
  })

  it('normalises the whole object on every patch, not just the field that changed', async () => {
    // A row written by an older or a newer build must not accumulate fields
    // nobody parses, and a patch must not be able to smuggle one in.
    await setSetting(SETTING_KEYS.ai, { tier: 'byok', consentVersion: 1, junk: true })
    await useAppStore.getState().hydrate()
    await useAppStore.getState().setAi({ model: 'claude-opus-5' })

    const stored = await getSetting<Record<string, unknown>>(SETTING_KEYS.ai)
    expect(stored).not.toHaveProperty('junk')
    expect(stored).toMatchObject({ tier: 'byok', consentVersion: 1, model: 'claude-opus-5' })
  })

  it('does not overwrite a consent given while hydrating', async () => {
    // The same race the language and theme toggles have: a slow read landing
    // after the reader has already acted must not revert them.
    const hydrating = useAppStore.getState().hydrate()
    await useAppStore.getState().setAi({ consentVersion: 1, tier: 'byok' })
    await hydrating

    expect(useAppStore.getState().ai).toMatchObject({ consentVersion: 1, tier: 'byok' })
  })

  it('hydrates back to off when the stored row cannot be parsed', async () => {
    await setSetting(SETTING_KEYS.ai, 'byok, obviously')
    await useAppStore.getState().hydrate()

    expect(useAppStore.getState().ai.tier).toBe('off')
    expect(useAppStore.getState().ai.consentVersion).toBe(0)
  })
})

describe('untrusted stored values', () => {
  it.each([
    ['a colour that is not a theme', 'purple'],
    ['an unsupported language code', 'fr'],
    ['a number', 42],
    ['null', null],
    ['an object', { evil: true }],
  ])('discards %s and uses a detected default', async (_label, value) => {
    await setSetting(SETTING_KEYS.theme, value)
    await setSetting(SETTING_KEYS.language, value)
    useAppStore.setState({ hydrated: false })

    await useAppStore.getState().hydrate()

    expect(['light', 'dark']).toContain(useAppStore.getState().theme)
    expect(['en', 'hi']).toContain(useAppStore.getState().language)
  })
})

describe('theme classes', () => {
  it('adds and removes exactly one class', async () => {
    await useAppStore.getState().setTheme('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    await useAppStore.getState().setTheme('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    // There is no `.light` class any more: light IS :root (ADR-010).
    expect(document.documentElement.classList.contains('light')).toBe(false)
  })

  it('mirrors the theme onto color-scheme so form controls follow', async () => {
    await useAppStore.getState().setTheme('dark')
    expect(document.documentElement.style.colorScheme).toBe('dark')
  })
})

describe('clearing stored data', () => {
  it('clears every table, not just settings', async () => {
    await setSetting(SETTING_KEYS.theme, 'dark')
    await clearAllData()

    for (const table of db.tables) {
      expect(await table.count(), `${table.name} was left behind`).toBe(0)
    }
  })
})

describe('the OS colour scheme is never consulted', () => {
  // ADR-010 reverses ADR-006: light is the default and dark is an explicit
  // choice only, so a reader on a dark system still opens the app in light.
  it('hydrates to light on a system that prefers dark', async () => {
    const matchMedia = vi.fn().mockReturnValue({ matches: true, media: '(prefers-color-scheme: dark)' })
    vi.stubGlobal('matchMedia', matchMedia)
    useAppStore.setState({ hydrated: false, theme: 'dark' })

    await useAppStore.getState().hydrate()

    expect(useAppStore.getState().theme).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(matchMedia).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('still honours a stored dark preference', async () => {
    await setSetting(SETTING_KEYS.theme, 'dark')
    useAppStore.setState({ hydrated: false, theme: 'light' })

    await useAppStore.getState().hydrate()

    expect(useAppStore.getState().theme).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })
})
