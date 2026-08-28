import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import SettingsPage from './SettingsPage'

import { useAppStore } from '@/app/store'
import { getSetting, SETTING_KEYS } from '@/db'

async function renderSettings() {
  render(
    <MemoryRouter>
      <SettingsPage />
    </MemoryRouter>,
  )
  // AiSettingsSection is a lazy chunk (Suspense fallback while it resolves).
  await waitFor(() => expect(screen.getByRole('heading', { name: 'AI features' })).toBeInTheDocument())
}

describe('SettingsPage', () => {
  it('renders every new section this session added', async () => {
    await renderSettings()

    for (const name of [
      'Devanagari digits',
      'Daily reminder',
      'Check for data updates',
      'Export all my data',
      'Erase all my data',
      'About',
      'Data sources & versions',
    ]) {
      expect(screen.getByRole('heading', { name })).toBeInTheDocument()
    }
  })

  it('toggling Devanagari digits persists to the store and to IndexedDB', async () => {
    const user = userEvent.setup()
    await renderSettings()

    expect(useAppStore.getState().devanagariDigits).toBe(false)

    await user.click(screen.getByRole('checkbox', { name: 'Devanagari digits' }))

    expect(useAppStore.getState().devanagariDigits).toBe(true)
    await waitFor(async () => {
      expect(await getSetting(SETTING_KEYS.devanagariDigits)).toBe(true)
    })
  })

  it('links to Trainer settings for the reminder\'s time and rule-book scope', async () => {
    await renderSettings()

    await waitFor(() => expect(screen.getByText('Off.')).toBeInTheDocument())
    expect(screen.getByRole('link', { name: /Trainer settings/ })).toHaveAttribute(
      'href',
      '/learn/settings',
    )
  })

  it('shows the About card with the package version and licence', async () => {
    await renderSettings()

    const about = screen.getByRole('heading', { name: 'About' }).closest('section')
    if (!about) throw new Error('About section not found')

    expect(within(about).getByText('0.1.0')).toBeInTheDocument()
    expect(within(about).getByText('MIT')).toBeInTheDocument()
    expect(within(about).getByRole('link', { name: 'Report a data error' })).toHaveAttribute(
      'href',
      expect.stringContaining('mailto:'),
    )
  })
})
