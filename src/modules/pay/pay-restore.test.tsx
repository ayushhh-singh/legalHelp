import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BrowserRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { StrictMode, Suspense, lazy } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { defaultScenario, type PayScenario } from '@/lib/pay/scenario'
import { loadPayTables } from './data'

/**
 * The restore on a bare `/tools/salary`, and the two ways it can go wrong.
 *
 * `readLastScenario` is mocked so the race is a decision rather than a
 * millisecond window: the test holds the promise open, moves the reader, and
 * only then resolves it. Without that the window is one Dexie read and the
 * assertion would be a coin toss.
 *
 * `BrowserRouter`, not `MemoryRouter`, because that is what `src/main.tsx`
 * mounts — and because the whole question is what the router does with a
 * navigation from a route that no longer matches.
 *
 * The two tests guard different things, and neither is redundant:
 *
 *  - the first fails against the code BEFORE the fix, landing the reader on
 *    `/tools/salary?level=8&cell=3&da=60` after they had left;
 *  - the second passes against that code and fails against the obvious WRONG
 *    fix — an `alive` flag with no latch reset — which never restores the
 *    scenario under StrictMode at all.
 *
 * A fix has to satisfy both, which is the whole reason the second one exists.
 */

let resolveRead: (value: PayScenario | null) => void = () => undefined

vi.mock('./scenarios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./scenarios')>()
  return {
    ...actual,
    readLastScenario: () =>
      new Promise<PayScenario | null>((resolve) => {
        resolveRead = resolve
      }),
    writeLastScenario: () => Promise.resolve(),
  }
})

const PayPage = lazy(() => import('./PayPage'))

function Where() {
  const location = useLocation()
  return <div data-testid="where">{location.pathname + location.search}</div>
}

function LawLike() {
  const navigate = useNavigate()
  return (
    <div data-testid="law-marker">
      law
      <button type="button" onClick={() => void navigate('/tools/salary')}>
        back to pay
      </button>
    </div>
  )
}

function Harness() {
  return (
    <BrowserRouter>
      <Where />
      <Suspense fallback={<p>loading</p>}>
        <Routes>
          <Route path="/tools/salary" element={<PayPage />} />
          <Route path="/law" element={<LawLike />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}

/**
 * A scenario that actually differs from the defaults.
 *
 * Built from the real tables rather than hand-written: `paramsFromView` omits
 * every value that equals its default, so a stub restores to a BARE `/tools/salary` and
 * the StrictMode assertion below would fail for a reason that has nothing to
 * do with the latch it is testing.
 */
async function savedScenario(): Promise<PayScenario> {
  const tables = await loadPayTables()
  return { ...defaultScenario(tables), level: '8', cellIndex: 2 }
}

beforeEach(() => {
  window.history.replaceState({}, '', '/tools/salary')
})

describe('restoring the last scenario on a bare /tools/salary', () => {
  it('does not pull back a reader who has already left', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    // Wait for the calculator itself, which mounts only after the tables parse.
    await screen.findByRole('combobox', { name: 'Post' }, { timeout: 30_000 })

    // Leave through the nav, while the read is still in flight.
    await act(async () => {
      window.history.pushState({}, '', '/law')
      window.dispatchEvent(new PopStateEvent('popstate'))
      await Promise.resolve()
    })
    expect(screen.getByTestId('where')).toHaveTextContent('/law')

    // The read lands from a component that is gone.
    await act(async () => {
      resolveRead(await savedScenario())
      await Promise.resolve()
    })

    // Without the `alive` guard this reads /tools/salary?level=8&cell=3: setSearchParams
    // navigates to its OWN route, so the reader is yanked back onto the page
    // they left rather than merely gaining a stray query string.
    expect(screen.getByTestId('where')).toHaveTextContent('/law')
    expect(screen.queryByTestId('law-marker')).not.toBeNull()

    await user.click(screen.getByRole('button', { name: 'back to pay' }))
  }, 40_000)

  it('still restores under StrictMode, which double-invokes the effect', async () => {
    render(
      <StrictMode>
        <Harness />
      </StrictMode>,
    )
    await screen.findByRole('combobox', { name: 'Post' }, { timeout: 30_000 })

    await act(async () => {
      resolveRead(await savedScenario())
      await Promise.resolve()
    })

    // The latch must be reset by the cleanup of the attempt StrictMode
    // cancelled, or the second mount returns early and nothing is restored —
    // the defect 089ce8e fixed in the Drafting Studio.
    await vi.waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/level=8/), {
      timeout: 10_000,
    })
  }, 40_000)
})
