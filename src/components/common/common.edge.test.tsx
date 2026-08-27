import { act, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { DataVersion } from './DataVersion'
import { Disclaimer } from './Disclaimer'
import { OfflineBadge } from './OfflineBadge'
import { SourceChip } from './SourceChip'

import { App } from '@/app/App'
import { useAppStore } from '@/app/store'
import i18n from '@/i18n'
import en from '@/i18n/en.json'
import hi from '@/i18n/hi.json'

const ROUTER_FUTURE = { v7_startTransition: true, v7_relativeSplatPath: true } as const

async function renderShell(route: string) {
  const result = render(
    <MemoryRouter initialEntries={[route]} future={ROUTER_FUTURE}>
      <App />
    </MemoryRouter>,
  )
  await screen.findByRole('heading', { level: 1 })
  await waitFor(() => expect(useAppStore.getState().hydrated).toBe(true))
  return result
}

describe('routing edge cases', () => {
  it.each([
    ['an unknown path', '/does-not-exist'],
    ['a deep unknown path', '/law/section/302/extra'],
    ['the root', '/'],
    ['a path with a trailing slash', '/law/'],
  ])('recovers from %s by landing on the law page', async (_label, route) => {
    await renderShell(route)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(en.pages.law.title)
  })

  it('opens a deep-linked route directly', async () => {
    await renderShell('/settings')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(en.pages.settings.title)
  })

  it('keeps a case-sensitive path from silently 404ing into a blank screen', async () => {
    await renderShell('/LAW')
    // Whatever the match, the reader must land on a real page, never nothing.
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
  })
})

describe('SourceChip', () => {
  it('opens outbound links safely', () => {
    render(<SourceChip name="NCRB Sankalan" url="https://www.ncrb.gov.in/" />)

    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('target', '_blank')
    // Without noopener the opened tab can navigate this one via window.opener.
    expect(link.getAttribute('rel')).toContain('noopener')
    expect(link.getAttribute('rel')).toContain('noreferrer')
  })

  it('announces the source and the new tab to screen readers', () => {
    render(<SourceChip name="DoPT O.M." url="https://dopt.gov.in/" />)
    const link = screen.getByRole('link')
    expect(link).toHaveTextContent(en.common.source)
    expect(link).toHaveTextContent(en.common.opensInNewTab)
  })
})

describe('DataVersion', () => {
  it('renders the bundled dataset version', () => {
    render(<DataVersion />)
    expect(screen.getByText(new RegExp(en.common.dataVersion))).toBeInTheDocument()
  })

  it('renders nothing for a dataset that is not bundled yet', () => {
    const { container } = render(<DataVersion dataset="not-ingested-yet" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('follows the active language', async () => {
    await act(async () => {
      await i18n.changeLanguage('hi')
    })
    render(<DataVersion />)
    expect(screen.getByText(new RegExp(hi.common.dataVersion))).toBeInTheDocument()
  })
})

describe('Disclaimer', () => {
  it('states the master-context wording verbatim in both languages', async () => {
    const { unmount } = render(<Disclaimer />)
    expect(screen.getByText(en.common.disclaimer)).toBeInTheDocument()
    unmount()

    await act(async () => {
      await i18n.changeLanguage('hi')
    })
    render(<Disclaimer />)
    expect(screen.getByText(hi.common.disclaimer)).toBeInTheDocument()
  })
})

describe('OfflineBadge', () => {
  it('stays out of the way while online', () => {
    const { container } = render(<OfflineBadge />)
    expect(container).toBeEmptyDOMElement()
  })

  it('appears when the browser goes offline and leaves when it returns, in both languages at once', () => {
    render(<OfflineBadge />)

    act(() => {
      Object.defineProperty(globalThis.navigator, 'onLine', { value: false, configurable: true })
      window.dispatchEvent(new Event('offline'))
    })
    const badge = screen.getByTestId('offline-badge')
    expect(badge).toHaveTextContent(en.common.offline)
    expect(badge).toHaveTextContent(hi.common.offline)

    act(() => {
      Object.defineProperty(globalThis.navigator, 'onLine', { value: true, configurable: true })
      window.dispatchEvent(new Event('online'))
    })
    expect(screen.queryByTestId('offline-badge')).not.toBeInTheDocument()
  })

  it('removes its listeners on unmount', () => {
    const { unmount } = render(<OfflineBadge />)
    unmount()
    // A leaked listener would throw on setState after unmount.
    expect(() => {
      window.dispatchEvent(new Event('offline'))
    }).not.toThrow()
  })
})
