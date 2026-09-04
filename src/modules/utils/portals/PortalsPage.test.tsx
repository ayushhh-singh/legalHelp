import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import PortalsPage from './PortalsPage'

/**
 * The copy button's announcement.
 *
 * This page has ONE live region shared by every row, unlike `TermRow.tsx` where
 * each row owns its own. That difference is the whole subject of this file:
 * writing the same sentence to the same region twice announces nothing the
 * second time, because assistive tech reacts to a live region CHANGING, not to
 * a component re-rendering. Copying portal A and then portal B is the ordinary
 * case, not an exotic one, and it produced identical text both times.
 *
 * The icon swap is `aria-hidden` in both states, so without the announcement a
 * screen reader gets nothing at all from a successful copy.
 */

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/tools/portals']}>
      <PortalsPage />
    </MemoryRouter>,
  )
}

/** The page-level live region — `role="status"` implies `aria-live="polite"`. */
const liveRegion = () => screen.getByRole('status')

/** Held by reference: reading it back off `navigator` hands eslint an unbound method. */
let writeText: ReturnType<typeof vi.fn>

beforeEach(() => {
  writeText = vi.fn(() => Promise.resolve())
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
})

describe('the copy confirmation', () => {
  it('says nothing before anything has been copied', async () => {
    renderPage()
    await waitFor(
      () => expect(screen.getAllByRole('button', { name: 'Copy URL' }).length).toBeGreaterThan(0),
      {
        timeout: 30_000,
      },
    )

    // An empty region on load, not a stale sentence from a previous visit.
    expect(liveRegion()).toHaveTextContent('')
  })

  it('announces a successful copy rather than only swapping an aria-hidden icon', async () => {
    renderPage()
    const buttons = await screen.findAllByRole('button', { name: 'Copy URL' }, { timeout: 30_000 })

    await userEvent.click(buttons[0]!)

    await waitFor(() => expect(liveRegion()).toHaveTextContent('Copied to the clipboard.'))
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('http'))
  })

  it('makes a SECOND copy a real DOM insertion, so it is announced too', async () => {
    renderPage()
    const buttons = await screen.findAllByRole('button', { name: 'Copy URL' }, { timeout: 30_000 })

    await userEvent.click(buttons[0]!)
    await waitFor(() => expect(liveRegion()).toHaveTextContent('Copied to the clipboard.'))
    const first = within(liveRegion()).getByText('Copied to the clipboard.')

    await userEvent.click(buttons[1]!)
    await waitFor(() => expect(liveRegion()).toHaveTextContent('Copied to the clipboard.'))
    const second = within(liveRegion()).getByText('Copied to the clipboard.')

    /*
      The text is identical, which is exactly the problem: a screen reader
      re-reads a live region when its CONTENT changes, and "the same sentence
      again" is not a change. The node has to be a new one — keyed on a counter
      — so the second copy is an insertion into the region rather than a
      re-render of what was already there.

      Asserting on the text alone would pass against the broken version, since
      the text was already correct. Node identity is the assertion that fails.
    */
    expect(second).not.toBe(first)
  })

  it('announces a clipboard refusal instead of failing silently', async () => {
    writeText = vi.fn(() => Promise.reject(new Error('denied')))
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    renderPage()
    const buttons = await screen.findAllByRole('button', { name: 'Copy URL' }, { timeout: 30_000 })
    await userEvent.click(buttons[0]!)

    // A browser can refuse clipboard access outright. Telling the reader to
    // copy the URL from the address bar is a worse outcome than copying for
    // them, and a much better one than a button that appears to do nothing.
    await waitFor(() =>
      expect(liveRegion()).toHaveTextContent('Could not copy — copy the URL from the address bar instead.'),
    )
  })
})
