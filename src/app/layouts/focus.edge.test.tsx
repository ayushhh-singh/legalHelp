import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { FocusLayout } from './FocusLayout'

/**
 * The edge-case pass over level 3.
 *
 * A focus screen hides the sidebar, the tab bar and the app's own top bar, so
 * ONE bar is the whole way out — and Escape is the other. Everything here is
 * about the press that is ambiguous: something else on screen may own it.
 */

function Where() {
  const { pathname } = useLocation()
  return <p data-testid="where">{pathname}</p>
}

function at(path: string, page: React.ReactNode = <Where />) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<FocusLayout />}>
          <Route path="/study/practise/review" element={page} />
        </Route>
        <Route path="/study/practise" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('Escape leaves the screen', () => {
  it('goes to the declared parent when nothing else owns the press', async () => {
    const user = userEvent.setup()
    at('/study/practise/review')

    await user.keyboard('{Escape}')
    expect(screen.getByTestId('where')).toHaveTextContent('/study/practise')
  })

  it('does nothing while the reader is typing', async () => {
    const user = userEvent.setup()
    at(
      '/study/practise/review',
      <>
        <Where />
        <input aria-label="answer" />
      </>,
    )

    await user.click(screen.getByLabelText('answer'))
    await user.keyboard('{Escape}')
    expect(screen.getByTestId('where')).toHaveTextContent('/study/practise/review')
  })

  it('does nothing while a dialog is open', async () => {
    const user = userEvent.setup()
    at(
      '/study/practise/review',
      <>
        <Where />
        <div role="dialog" aria-label="report this card" />
      </>,
    )

    await user.keyboard('{Escape}')
    expect(screen.getByTestId('where')).toHaveTextContent('/study/practise/review')
  })
})

describe('the ⋯ menu owns Escape while it is open', () => {
  /*
    The menu carries the language toggle, the theme toggle and the way to
    Settings, because the top bar that normally holds them is hidden here. It is
    a plain popover rather than a Radix dialog — it needs no focus trap — which
    means `document.querySelector('[role="dialog"]')` cannot see it, and the
    press that a reader expects to shut it was instead throwing them out of the
    document they were writing.

    ADR-029's addendum recorded the same shape for the command palette and the
    AI consent modal: two handlers, one press, and the nearest one has to win.
  */
  it('closes the menu instead of leaving the screen', async () => {
    const user = userEvent.setup()
    at('/study/practise/review')

    await user.click(screen.getByRole('button', { name: 'More actions' }))
    expect(screen.getByRole('button', { name: 'More actions' })).toHaveAttribute('aria-expanded', 'true')

    await user.keyboard('{Escape}')

    expect(screen.getByRole('button', { name: 'More actions' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByTestId('where')).toHaveTextContent('/study/practise/review')
  })

  it('and a second Escape then leaves, because nothing owns it any more', async () => {
    const user = userEvent.setup()
    at('/study/practise/review')

    await user.click(screen.getByRole('button', { name: 'More actions' }))
    await user.keyboard('{Escape}')
    await user.keyboard('{Escape}')

    expect(screen.getByTestId('where')).toHaveTextContent('/study/practise')
  })
})
