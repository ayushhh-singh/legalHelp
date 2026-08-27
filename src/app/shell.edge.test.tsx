import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { lazy, Suspense } from 'react'
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { App } from './App'
import { TAB_BAR_ROUTES } from './routes'
import { useAppStore } from './store'

import { ErrorBoundary } from '@/components/common/ErrorBoundary'
import i18n, { detectBrowserLanguage } from '@/i18n'

const ROUTER_FUTURE = { v7_startTransition: true, v7_relativeSplatPath: true } as const

async function renderShell(route = '/law') {
  const result = render(
    <MemoryRouter initialEntries={[route]} future={ROUTER_FUTURE}>
      <App />
    </MemoryRouter>,
  )
  await screen.findByRole('heading', { level: 1 })
  await waitFor(() => expect(useAppStore.getState().hydrated).toBe(true))
  return result
}

describe('skip link', () => {
  // Without tabIndex the browser moves the caret but not focus in Safari and
  // Firefox, so a keyboard user activating the skip link lands back at the top.
  it('targets a focusable main landmark', async () => {
    await renderShell()

    const main = screen.getByRole('main')
    expect(main).toHaveAttribute('id', 'main')
    expect(main).toHaveAttribute('tabindex', '-1')

    const skip = screen.getByRole('link', { name: i18n.t('a11y.skipToContent') })
    expect(skip).toHaveAttribute('href', `#${main.id}`)
  })

  it('does not paint a focus ring when focused programmatically', async () => {
    await renderShell()
    // tabIndex={-1} makes main focusable; it should not then look focused.
    expect(screen.getByRole('main').className).toContain('focus-visible:outline-none')
  })
})

describe('error recovery', () => {
  function Boom(): React.ReactNode {
    throw new Error('module blew up')
  }

  it('catches a failed lazy chunk instead of hanging on the loader', async () => {
    // The realistic cause: a stale tab requests a chunk a redeploy removed.
    const Missing = lazy(() => Promise.reject(new Error('Failed to fetch dynamically imported module')))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    render(
      <ErrorBoundary>
        <Suspense fallback={<p>loading</p>}>
          <Missing />
        </Suspense>
      </ErrorBoundary>,
    )

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.queryByText('loading')).not.toBeInTheDocument()
  })

  it('clears the error when the route changes', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const user = userEvent.setup()

    function Harness() {
      return (
        <MemoryRouter initialEntries={['/bad']} future={ROUTER_FUTURE}>
          <Link to="/good">go good</Link>
          <RoutesWithBoundary />
        </MemoryRouter>
      )
    }

    render(<Harness />)
    expect(screen.getByRole('alert')).toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: 'go good' }))

    // Previously the boundary stayed latched and the app was stuck until reload.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('GOOD PAGE')).toBeInTheDocument()
  })

  it('offers a retry that re-renders in place', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const user = userEvent.setup()

    // The test flips the flag, standing in for the underlying cause clearing
    // (network back, chunk reachable). React re-renders a failed subtree itself,
    // so the component must not decide when to recover.
    let shouldFail = true
    function Flaky(): React.ReactNode {
      if (shouldFail) throw new Error('transient')
      return <p>RECOVERED</p>
    }

    render(
      <ErrorBoundary>
        <Flaky />
      </ErrorBoundary>,
    )

    expect(screen.getByRole('alert')).toBeInTheDocument()

    shouldFail = false
    await user.click(screen.getByRole('button', { name: i18n.t('common.retry') }))

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('RECOVERED')).toBeInTheDocument()
  })

  it('shows the error message but reports it nowhere', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('module blew up')
    // Hard rule: nothing leaves the device, error reports included.
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

function RoutesWithBoundary() {
  return (
    <Routes>
      <Route
        path="/bad"
        element={
          <ErrorBoundary resetKey="/bad">
            <BoomInner />
          </ErrorBoundary>
        }
      />
      <Route
        path="/good"
        element={
          <ErrorBoundary resetKey="/good">
            <p>GOOD PAGE</p>
          </ErrorBoundary>
        }
      />
    </Routes>
  )
}

function BoomInner(): React.ReactNode {
  throw new Error('route blew up')
}

describe('language detection', () => {
  it.each([
    ['hi', 'hi'],
    ['hi-IN', 'hi'],
    ['HI-in', 'hi'],
    ['en-GB', 'en'],
    ['ta-IN', 'en'],
    ['', 'en'],
    [undefined, 'en'],
    // `hif` is Fiji Hindi — a different language a prefix match would claim.
    ['hif', 'en'],
    ['hif-FJ', 'en'],
    ['hindi', 'en'],
  ])('maps %s to %s', (input, expected) => {
    expect(detectBrowserLanguage(input)).toBe(expected)
  })

  it('starts i18next in the browser language rather than always English', () => {
    // Spec: default follows navigator.language. Initialising at 'en' showed a
    // Hindi reader English until the stored preference resolved.
    const source = String(i18n.options.lng ?? '')
    expect(['en', 'hi']).toContain(source)
    expect(source).toBe(detectBrowserLanguage())
  })
})

describe('bottom tab bar', () => {
  it('derives its column count from the route list', async () => {
    await renderShell()

    const tabList = screen.getByRole('navigation', { name: i18n.t('a11y.tabNavigation') }).querySelector('ul')

    expect(tabList).not.toBeNull()
    expect(tabList?.getAttribute('style')).toContain(`repeat(${TAB_BAR_ROUTES.length}, minmax(0, 1fr))`)
    expect(tabList?.children).toHaveLength(TAB_BAR_ROUTES.length)
  })

  it('gives every tab a touch target of at least 44px', async () => {
    await renderShell()

    const links = screen.getByRole('navigation', { name: i18n.t('a11y.tabNavigation') }).querySelectorAll('a')

    for (const link of links) {
      // 3.5rem = 56px, comfortably over the 44px WCAG 2.5.8 minimum.
      expect(link.className).toContain('min-h-[3.5rem]')
    }
  })
})
