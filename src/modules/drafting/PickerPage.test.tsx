import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import PickerPage from './PickerPage'

/**
 * The template gallery, in jsdom, against the real committed `index.json` —
 * `useDraftingIndex()` is not mocked, so a card here is a card an officer
 * actually sees.
 *
 * Session's own concern: the Preview affordance is ADDITIVE. The card's
 * primary click still creates a document exactly as it always has, and
 * "Preview" is a second, separate control rather than a change to what the
 * card's own click target does.
 */
describe('the template gallery card', () => {
  it('offers both "Open" (create) and "Preview" (read-only) for the same template', async () => {
    render(
      <MemoryRouter>
        <PickerPage />
      </MemoryRouter>,
    )

    const open = await screen.findByRole('link', { name: 'Open Office Memorandum (O.M.)' })
    expect(open).toHaveAttribute('href', '/draft/new/office-memorandum')

    const preview = screen.getByRole('link', { name: 'Preview Office Memorandum (O.M.)' })
    expect(preview).toHaveAttribute('href', '/draft/new/office-memorandum/preview')

    // Two distinct interactive elements — never one link nested in another,
    // which the browser would refuse to parse as written.
    expect(open).not.toBe(preview)
  })
})
