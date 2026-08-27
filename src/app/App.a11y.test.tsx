import { act, render, screen, waitFor } from '@testing-library/react'
import axe from 'axe-core'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { App } from './App'
import { NAV_ROUTES } from './routes'
import { useAppStore } from './store'

import i18n, { type Language } from '@/i18n'

/**
 * axe over the whole shell, in both languages.
 *
 * Caveat recorded in docs/DATA-GAPS.md: jsdom has no layout or paint, so
 * axe's `color-contrast` rule cannot run here and reports as incomplete rather
 * than passing. Contrast is covered instead by src/styles/tokens.test.ts, with
 * in-browser verification deferred to the Playwright session.
 */

async function renderShell(language: Language, route = '/law') {
  await i18n.changeLanguage(language)
  await useAppStore.getState().setLanguage(language)

  const result = render(
    <MemoryRouter initialEntries={[route]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <App />
    </MemoryRouter>,
  )

  // Routes are lazy and the store hydrates from IndexedDB in an effect; wait for
  // both to settle so no state update lands outside act().
  await screen.findByRole('heading', { level: 1 })
  await waitFor(() => {
    expect(useAppStore.getState().hydrated).toBe(true)
  })
  return result
}

async function auditFor(container: HTMLElement) {
  const results = await axe.run(container, {
    resultTypes: ['violations'],
    rules: {
      // Needs layout metrics jsdom does not provide.
      'color-contrast': { enabled: false },
    },
  })
  return results.violations
}

describe.each(['en', 'hi'] as const)('shell accessibility (%s)', (language) => {
  it('has no axe violations', async () => {
    const { container } = await renderShell(language)
    const violations = await auditFor(container)

    expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
  })

  it('exposes landmarks and a skip link in the active language', async () => {
    await renderShell(language)

    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(screen.getByRole('main')).toBeInTheDocument()
    expect(screen.getAllByRole('navigation').length).toBeGreaterThan(0)

    const skip = screen.getByRole('link', { name: i18n.t('a11y.skipToContent') })
    expect(skip).toHaveAttribute('href', '#main')
    expect(document.documentElement.lang).toBe(language)
  })

  it('labels the language and theme controls in the active language', async () => {
    await renderShell(language)

    expect(screen.getByRole('button', { name: i18n.t('a11y.toggleLanguage') })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: i18n.t('a11y.toggleTheme') })).toBeInTheDocument()
  })
})

describe('shell routing', () => {
  it.each(NAV_ROUTES.map((r) => [r.path, r.longLabelKey] as const))(
    'renders %s without axe violations',
    async (path) => {
      const { container } = await renderShell('hi', path)
      expect(await auditFor(container)).toEqual([])
    },
  )

  it('translates every visible page string when the language changes', async () => {
    await renderShell('en')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Law Converter')

    // Changing language re-renders every subscriber, so it must run in act().
    await act(async () => {
      await useAppStore.getState().setLanguage('hi')
    })

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('विधि परिवर्तक')
    })
    // No English leaks through: fallbackLng is off by design.
    expect(screen.queryByText('Law Converter')).not.toBeInTheDocument()
  })
})
