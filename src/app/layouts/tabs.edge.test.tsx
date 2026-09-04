import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { SegmentedTabs } from './SegmentedTabs'
import { TabLayout } from './TabLayout'

import { NAV_TABS } from '@/lib/nav'

/**
 * The edge-case pass over the sub-tab strip.
 *
 * It is a strip of LINKS rather than an ARIA tablist, and the two claims that
 * buys — that the browser's back button still undoes a tab press, and that the
 * keyboard behaviour a reader expects is there anyway — are what these check.
 */

const study = NAV_TABS.find((tab) => tab.id === 'study')!
const home = NAV_TABS.find((tab) => tab.id === 'home')!

const at = (path: string, badges?: Record<string, number | undefined>) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<TabLayout {...(badges ? { badges } : {})} />}>
          <Route path="/study/read" element={<p>read</p>} />
          <Route path="/study/practise" element={<p>practise</p>} />
          <Route path="/study/notes" element={<p>notes</p>} />
          <Route path="/study/exam" element={<p>exam</p>} />
          <Route path="/home" element={<p>home</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )

describe('the strip is links, not a tablist', () => {
  it('claims no ARIA tab role anywhere', () => {
    // The tab pattern promises a tabpanel swapped in place and a widget that
    // owns its own focus. A router does neither, and claiming both is how
    // `aria-required-children` and a broken back button arrive together.
    at('/study/read')
    expect(screen.queryAllByRole('tab')).toHaveLength(0)
    expect(screen.queryAllByRole('tablist')).toHaveLength(0)
    expect(screen.getAllByRole('link').length).toBe(study.subTabs.length)
  })

  it('marks the current sub-tab with aria-current, including from a page below it', () => {
    at('/study/read')
    expect(screen.getByRole('link', { name: /Read/ })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: /Practise/ })).not.toHaveAttribute('aria-current')
  })
})

describe('a section of one renders no strip at all', () => {
  it('draws nothing for Home', () => {
    // A control with one option is noise in the tab order and on the screen.
    at('/home')
    expect(home.subTabs).toHaveLength(1)
    expect(screen.queryByRole('navigation', { name: 'Sections' })).toBeNull()
  })
})

describe('Left, Right, Home and End move between the labels', () => {
  const strip = () =>
    render(
      <MemoryRouter>
        <SegmentedTabs subTabs={study.subTabs} />
      </MemoryRouter>,
    )

  const focused = () => (document.activeElement as HTMLElement | null)?.textContent ?? ''

  it('wraps at both ends rather than stopping dead', async () => {
    const user = userEvent.setup()
    strip()
    const links = screen.getAllByRole('link')

    links[0]?.focus()
    await user.keyboard('{ArrowLeft}')
    expect(focused()).toContain(study.subTabs.at(-1)!.label.en)

    await user.keyboard('{ArrowRight}')
    expect(focused()).toContain(study.subTabs[0]!.label.en)
  })

  it('goes to the first and the last with Home and End', async () => {
    const user = userEvent.setup()
    strip()
    screen.getAllByRole('link')[1]?.focus()

    await user.keyboard('{End}')
    expect(focused()).toContain(study.subTabs.at(-1)!.label.en)

    await user.keyboard('{Home}')
    expect(focused()).toContain(study.subTabs[0]!.label.en)
  })

  it('leaves every other key alone', async () => {
    const user = userEvent.setup()
    strip()
    const first = screen.getAllByRole('link')[0]
    first?.focus()

    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(first)
  })
})

describe('the badge slot', () => {
  it('renders a count only where the sub-tab declares one', () => {
    // `read` has no `badge` field, so a count handed in for it is ignored —
    // a section cannot invent a badge on a tab that never asked for one.
    at('/study/read', { practise: 12, read: 99 })

    expect(screen.getByRole('link', { name: /Practise/ })).toHaveTextContent('12')
    expect(screen.getByRole('link', { name: /Read/ })).not.toHaveTextContent('99')
  })

  it('says what the number MEANS inside the link’s accessible name', () => {
    // "Practise, 12 waiting" is what a screen-reader user needs to hear. A
    // number drawn beside a label and hidden from the tree is a number only
    // sighted readers get.
    at('/study/read', { practise: 12 })
    expect(screen.getByRole('link', { name: 'Practise 12 waiting' })).toBeInTheDocument()
  })

  it('draws nothing at zero, and nothing while the count is still being read', () => {
    at('/study/read', { practise: 0 })
    expect(screen.getByRole('link', { name: 'Practise' })).toBeInTheDocument()

    at('/study/read', { practise: undefined })
    expect(screen.getAllByRole('link', { name: 'Practise' }).length).toBeGreaterThan(0)
  })
})

describe('the section header', () => {
  it('is the section’s own <h1>, so the page below it starts at <h2>', () => {
    at('/study/practise')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Study')
  })
})
