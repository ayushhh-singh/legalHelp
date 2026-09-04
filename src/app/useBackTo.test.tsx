import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { AppLink } from './AppLink'
import { useBackTo } from './useBackTo'

/**
 * The two branches, and why the difference is not cosmetic.
 *
 * A reader who reached the document editor by pressing a row in the register
 * wants the register AS THEY LEFT IT — the same filters, the same scroll
 * position. `navigate(-1)` gives them that; a pushed parent route does not. A
 * reader who reached the same editor from a shared link, a bookmark or a cold
 * start has no history to pop, and popping would take them out of the app —
 * the classic broken back chevron.
 *
 * `AppLink` is what makes the two distinguishable, by stamping the section into
 * `location.state` on the way in.
 */

function Probe() {
  const back = useBackTo()
  const location = useLocation()
  return (
    <div>
      <p data-testid="where">{location.pathname}</p>
      <p data-testid="label">{back?.label ?? '—'}</p>
      <p data-testid="to">{back?.to ?? '—'}</p>
      <p data-testid="mode">{back ? (back.usesHistory ? 'history' : 'parent') : '—'}</p>
      {back ? (
        <button type="button" onClick={back.goBack}>
          back
        </button>
      ) : null}
    </div>
  )
}

function App({ start }: { start: string }) {
  return (
    <MemoryRouter initialEntries={[start]}>
      <Routes>
        <Route
          path="/draft/register"
          element={
            <div>
              <p data-testid="where">/draft/register</p>
              <AppLink to="/draft/d/abc">open the document</AppLink>
            </div>
          }
        />
        <Route
          path="/law"
          element={
            <div>
              <p data-testid="where">/law</p>
              {/* A link from ANOTHER section: the reader did not come from
                  inside Draft, so history must not be popped. */}
              <AppLink to="/draft/d/abc">open the document</AppLink>
            </div>
          }
        />
        <Route path="/draft/d/:id" element={<Probe />} />
        <Route path="/draft/documents" element={<p data-testid="where">/draft/documents</p>} />
        <Route path="/study/read/:workId/:unitId" element={<Probe />} />
        <Route path="/study/read/:workId" element={<Probe />} />
        <Route path="/study/read" element={<Probe />} />
        <Route path="/settings/backup" element={<Probe />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('the parent branch', () => {
  it('goes to the declared parent when the page was opened cold', async () => {
    const user = userEvent.setup()
    render(<App start="/draft/d/abc" />)

    expect(screen.getByTestId('mode')).toHaveTextContent('parent')
    expect(screen.getByTestId('to')).toHaveTextContent('/draft/documents')
    // Named by the sub-tab's own bilingual label, not by the URL.
    expect(screen.getByTestId('label')).toHaveTextContent('Documents')

    await user.click(screen.getByRole('button', { name: 'back' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/draft/documents')
  })

  it('takes the parent branch when the link came from another section', async () => {
    const user = userEvent.setup()
    render(<App start="/law" />)

    await user.click(screen.getByRole('link', { name: 'open the document' }))
    expect(screen.getByTestId('mode')).toHaveTextContent('parent')

    await user.click(screen.getByRole('button', { name: 'back' }))
    // Not back to /law — the reader is inside the Drafting Studio now, and the
    // page above this one is the document list.
    expect(screen.getByTestId('where')).toHaveTextContent('/draft/documents')
  })

  it('substitutes the page’s own parameters into the parent', () => {
    render(<App start="/study/read/ccs-conduct/ccs-conduct-3" />)
    expect(screen.getByTestId('to')).toHaveTextContent('/study/read/ccs-conduct')
  })
})

describe('the history branch', () => {
  it('pops history when the reader came from inside the same section', async () => {
    const user = userEvent.setup()
    render(<App start="/draft/register" />)

    await user.click(screen.getByRole('link', { name: 'open the document' }))
    expect(screen.getByTestId('mode')).toHaveTextContent('history')

    await user.click(screen.getByRole('button', { name: 'back' }))
    // The register, as they left it — not the document list, which is what the
    // declared parent would have given them.
    expect(screen.getByTestId('where')).toHaveTextContent('/draft/register')
  })
})

describe('a tab route', () => {
  it('offers no back control at all', () => {
    // A section root has no parent inside the app, and a chevron there is a
    // control that leaves it.
    render(<App start="/study/read" />)
    expect(screen.queryByRole('button', { name: 'back' })).not.toBeInTheDocument()
    expect(screen.getByTestId('mode')).toHaveTextContent('—')
  })
})

describe('Settings', () => {
  it('goes back to the settings list, which is not a tab', () => {
    render(<App start="/settings/backup" />)
    expect(screen.getByTestId('to')).toHaveTextContent('/settings')
    expect(screen.getByTestId('label')).toHaveTextContent('Settings')
  })
})
