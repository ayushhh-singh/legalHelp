import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Glossary } from './schema'

/**
 * The window between "favourites/recents settled" and "the glossary dataset
 * settled" — the two are independent, IndexedDB usually resolving first,
 * `data/glossary.json` (~700 KB) usually second. `GlossaryPage.tsx` used to
 * turn a saved `termId` into a displayable term by looking it up in the
 * dataset alone, so opening "Favourites" inside that window showed "No term
 * matches that." to a reader who really does have saved terms — indistin-
 * guishable from having none. Two independent review passes found this the
 * same way `pay-restore.test.tsx` found its race: by holding a promise open
 * on purpose rather than trusting a real timing window to land the same way
 * twice.
 */

let resolveGlossary: (value: Glossary) => void = () => undefined

vi.mock('./data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./data')>()
  return {
    ...actual,
    loadGlossary: () =>
      new Promise<Glossary>((resolve) => {
        resolveGlossary = resolve
      }),
  }
})

vi.mock('./favourites', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./favourites')>()
  return {
    ...actual,
    listFavourites: () =>
      Promise.resolve([
        {
          id: 'cabinet-secretary',
          termId: 'cabinet-secretary',
          en: 'Cabinet Secretary',
          hi: 'मंत्रिमंडल सचिव',
          createdAt: '2026-08-28T00:00:00.000Z',
        },
      ]),
    listRecents: () => Promise.resolve([]),
  }
})

const GLOSSARY: Glossary = {
  version: '1.0.0',
  generatedAt: '2026-08-28T00:00:00Z',
  disclaimer: { en: 'Reference only.', hi: 'केवल संदर्भ के लिए।' },
  terms: [
    {
      id: 'cabinet-secretary',
      category: 'designation',
      en: 'Cabinet Secretary',
      hi: 'मंत्रिमंडल सचिव',
      source: { name: 'Test source', url: 'https://rajbhasha.gov.in/x' },
      fetchedAt: '2026-08-28T00:00:00Z',
      verify: true,
    },
  ],
}

beforeEach(() => {
  resolveGlossary = () => undefined
})

afterEach(() => {
  vi.resetModules()
})

describe('GlossaryPage — favourites/recents before the dataset has loaded', () => {
  it('shows a loading state, not "No term matches", while favourites exist but the dataset is still loading', async () => {
    const { default: GlossaryPage } = await import('./GlossaryPage')
    const user = userEvent.setup()

    render(
      <MemoryRouter>
        <GlossaryPage />
      </MemoryRouter>,
    )

    // The favourites tab's own count settles from IndexedDB, independently
    // of the dataset — this is what makes the bug possible: the tab itself
    // already knows there is one favourite before the dataset is ready.
    await screen.findByRole('tab', { name: /Favourites \(1\)/ })
    await user.click(screen.getByRole('tab', { name: /Favourites/ }))

    // The dataset has NOT resolved yet. This must not read as "no results".
    expect(screen.queryByText('No term matches that.')).not.toBeInTheDocument()
    expect(screen.queryByText('मंत्रिमंडल सचिव')).not.toBeInTheDocument()

    // `screen.findByText` below is itself `act`-aware (it polls, wrapped in
    // `waitFor`), so resolving here needs no explicit `act()` of its own.
    resolveGlossary(GLOSSARY)

    // Once the dataset settles, the saved term renders for real.
    expect(await screen.findByText('मंत्रिमंडल सचिव')).toBeInTheDocument()
    expect(screen.queryByText('No term matches that.')).not.toBeInTheDocument()
  })
})
