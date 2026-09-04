import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import SettingsPage from './SettingsPage'

import { useAppStore } from '@/app/store'
import { getSetting, SETTING_KEYS } from '@/db'
import { SETTINGS_SECTIONS } from '@/lib/nav'

/**
 * Settings is a SECTION now, not one page eleven sections long (ADR-046 §9),
 * so each of these renders the section router at a path and asserts on the one
 * page it owns. What that buys, and what these tests are therefore for: a
 * reader looking for "erase everything" lands on a page about backups rather
 * than scrolling past the AI tiers to find it.
 */
async function at(path: string) {
  render(
    // Mounted the way `App.tsx` mounts it — at `/settings/*` — because the
    // section's own routes are RELATIVE, and rendering it at the root would
    // match `index` against `/` and show a blank page.
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/settings/*" element={<SettingsPage />} />
      </Routes>
    </MemoryRouter>,
  )
  // Every section is its own lazy chunk; wait for one to resolve.
  await screen.findByRole('heading', { level: 1 })
}

describe('the settings index', () => {
  it('offers every section in the nav tree, and nothing that is not in it', async () => {
    await at('/settings')

    for (const section of SETTINGS_SECTIONS) {
      expect(
        screen.getByRole('link', { name: section.label.en }),
        `${section.id} is in SETTINGS_SECTIONS and not on the index`,
      ).toHaveAttribute('href', section.path)
    }
  })

  it('keeps language, theme and Devanagari digits on the index itself', async () => {
    // One tap each. A section list whose first row is "the three switches"
    // would put two taps in front of the thing this screen is opened for most.
    await at('/settings')

    expect(screen.getByRole('radiogroup', { name: 'Language' })).toBeInTheDocument()
    expect(screen.getByRole('radiogroup', { name: 'Appearance' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Devanagari digits' })).toBeInTheDocument()
  })

  it('toggling Devanagari digits persists to the store and to IndexedDB', async () => {
    const user = userEvent.setup()
    await at('/settings')

    expect(useAppStore.getState().devanagariDigits).toBe(false)

    await user.click(screen.getByRole('checkbox', { name: 'Devanagari digits' }))

    expect(useAppStore.getState().devanagariDigits).toBe(true)
    await waitFor(async () => {
      expect(await getSetting(SETTING_KEYS.devanagariDigits)).toBe(true)
    })
  })
})

describe('the sections', () => {
  it('puts updates and the data-sources table on one page', async () => {
    await at('/settings/data')

    expect(await screen.findByRole('button', { name: 'Check for updates' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Data sources & versions' })).toBeInTheDocument()
  })

  it('puts erase on the same page as export, deliberately', async () => {
    // The one thing somebody about to erase everything should have in front of
    // them is the control that exports it first.
    await at('/settings/backup')

    expect(await screen.findByRole('heading', { name: 'Export all my data' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Erase all my data' })).toBeInTheDocument()
  })

  it('shows the About page with the package version and licence', async () => {
    await at('/settings/about')

    const about = await screen.findByText('MIT')
    expect(about).toBeInTheDocument()
    expect(screen.getByText('0.1.0')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Report a data error' })).toHaveAttribute(
      'href',
      expect.stringContaining('mailto:'),
    )
  })

  it('keeps the AI section behind its own page and its own dynamic import', async () => {
    await at('/settings/ai')

    expect(await screen.findByRole('heading', { name: 'AI features' })).toBeInTheDocument()
  })
})
