import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { lazy, Suspense } from 'react'
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { App } from './App'
import { useAppStore } from './store'

import { ErrorBoundary } from '@/components/common/ErrorBoundary'
import i18n, { detectBrowserLanguage } from '@/i18n'
import { NAV_TABS } from '@/lib/nav'

async function renderShell(route = '/home') {
  const result = render(
    <MemoryRouter initialEntries={[route]}>
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
        <MemoryRouter initialEntries={['/bad']}>
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
  it('renders all five tabs, with no "More" sheet', async () => {
    await renderShell()

    const tabList = screen.getByRole('navigation', { name: i18n.t('a11y.tabNavigation') }).querySelector('ul')

    expect(tabList).not.toBeNull()
    expect(tabList?.children).toHaveLength(NAV_TABS.length)
    expect(tabList?.querySelectorAll('a')).toHaveLength(NAV_TABS.length)
    // The sheet is gone, not hidden: ADR-046 removed the overflow entirely
    // because five tabs fit the bar at every width this app supports. A
    // trigger left behind would be a control opening an empty sheet.
    expect(tabList?.querySelectorAll('button')).toHaveLength(0)
  })

  it('gives every target in the bar at least the 44px WCAG 2.5.8 minimum', async () => {
    await renderShell()

    const bar = screen.getByRole('navigation', { name: i18n.t('a11y.tabNavigation') })
    const targets = bar.querySelectorAll('a, button')
    expect(targets.length).toBe(NAV_TABS.length)

    for (const target of targets) {
      // The rule is 44px, not one particular class. min-h-11 is exactly 44px,
      // min-h-14 is 56px (tab bar); asserting the literal class would fail on
      // a legal size and pass on an illegal one.
      const size = /\bmin-h-(\d+)\b/.exec(target.className)?.[1]
      expect(size, `no min-h-* on ${target.textContent}`).toBeDefined()
      expect(Number(size) * 4, target.textContent ?? '').toBeGreaterThanOrEqual(44)
    }
  })

  it('hides both chromes on a focus route', async () => {
    // Level 3 is a page an officer is INSIDE — the reader, a review session,
    // the document editor — and `App.tsx` drops the top bar, the sidebar and
    // the tab bar synchronously from the route registry rather than being told
    // by the layout that rendered, so there is no frame with them still on it.
    await renderShell('/study/practise/review')

    expect(screen.queryByRole('navigation', { name: i18n.t('a11y.tabNavigation') })).toBeNull()
    expect(screen.queryByRole('navigation', { name: i18n.t('a11y.mainNavigation') })).toBeNull()
    expect(screen.queryByRole('banner')).toBeNull()
  })
})

describe('the nav config is the single source of truth', () => {
  it('is five tabs, and they are these five', () => {
    // Asserted BY NAME, not by count: a swap keeps the count at five, and a
    // reader who loses a tab they use every day would find out from the phone
    // in their hand rather than from this suite.
    expect(NAV_TABS.map((tab) => tab.id)).toEqual(['home', 'study', 'draft', 'law', 'tools'])
  })

  it('gives every tab a default sub-tab that is one of its own', () => {
    for (const tab of NAV_TABS) {
      expect(
        tab.subTabs.map((subTab) => subTab.id),
        `${tab.id}.defaultSubTab`,
      ).toContain(tab.defaultSubTab)
    }
  })

  it('labels every tab and every sub-tab in both languages', () => {
    for (const item of NAV_TABS) {
      for (const language of ['en', 'hi'] as const) {
        expect(item.label[language], `${item.id}.label.${language}`).toBeTruthy()
        expect(item.short[language], `${item.id}.short.${language}`).toBeTruthy()
        for (const subTab of item.subTabs) {
          expect(subTab.label[language], `${item.id}.${subTab.id}.label.${language}`).toBeTruthy()
        }
      }
    }
  })
})
