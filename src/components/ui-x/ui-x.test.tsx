import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readdirSync } from 'node:fs'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { Badge } from './Badge'
import { Breadcrumbs } from './Breadcrumbs'
import { Chip } from './Chip'
import { InfoCard } from './InfoCard'
import { ProgressBar } from './ProgressBar'
import { QueryErrorState } from './QueryErrorState'
import { SectionCard } from './SectionCard'
import { SectionNumber } from './SectionNumber'
import { Skeleton } from './Skeleton'
import { StatCard } from './StatCard'

import en from '@/i18n/en.json'
import { fromRoot, readFromRoot } from '@/test/paths'

const ACCENTS = ['marigold', 'tulsi', 'coral', 'violet'] as const

describe('the -foreground pairing rule', () => {
  /**
   * The hard rule from tokens.css: marigold / tulsi / coral / violet are never a
   * raw text or icon colour. Anything that names one as `text-<accent>` has
   * broken it, and the numbers say why — raw --marigold measures 1.6:1 on a
   * light page. This greps the shipped components rather than asserting on one
   * rendered example, so a new component cannot quietly opt out.
   */
  const sources = [
    ...readdirSync(fromRoot('src/components/ui-x')),
    ...readdirSync(fromRoot('src/components/common')),
  ]
    .filter((file) => file.endsWith('.tsx') && !file.endsWith('.test.tsx'))
    .flatMap((file) => {
      const dir = readdirSync(fromRoot('src/components/ui-x')).includes(file) ? 'ui-x' : 'common'
      return [[`${dir}/${file}`, readFromRoot(`src/components/${dir}/${file}`)] as const]
    })

  it.each(sources)('%s never uses a raw accent as a text or icon colour', (_file, source) => {
    for (const accent of ACCENTS) {
      // `text-marigold-foreground` is correct; `text-marigold` is not. The
      // negative lookahead is what separates them.
      //
      // A bare `bg-marigold` IS allowed and is deliberately not checked here:
      // it paints the 3px file-tab and nav rules, which carry no text at all.
      // The rule is about legibility, and nothing has to be legible on a 3px
      // line — its job is done by position, not by contrast with a label.
      expect(source).not.toMatch(new RegExp(`\\btext-${accent}(?!-foreground)\\b`))
    }
  })

  it.each(ACCENTS)('pairs the %s Chip tint with its own foreground', (accent) => {
    render(<Chip tone={accent}>x</Chip>)
    const chip = screen.getByText('x')
    expect(chip.className).toContain(`bg-${accent}/15`)
    expect(chip.className).toContain(`text-${accent}-foreground`)
  })
})

describe('Chip and Badge', () => {
  it('renders a pill chip on the neutral tone by default', () => {
    render(<Chip>Level 7</Chip>)
    const chip = screen.getByText('Level 7')
    expect(chip.className).toContain('rounded-full')
    expect(chip.className).toContain('bg-muted')
  })

  it('fills an action chip with --action, the theme-inverting token', () => {
    render(<Chip tone="action">On</Chip>)
    expect(screen.getByText('On').className).toContain('bg-action')
    expect(screen.getByText('On').className).toContain('text-action-foreground')
  })

  it('gives every Badge tone a foreground', () => {
    for (const tone of ['neutral', 'info', 'success', 'warning', 'danger'] as const) {
      const { unmount } = render(<Badge tone={tone}>{tone}</Badge>)
      expect(screen.getByText(tone).className).toMatch(/text-[a-z-]+(foreground)/)
      unmount()
    }
  })
})

describe('ProgressBar', () => {
  it('exposes a named progressbar with the clamped value', () => {
    render(<ProgressBar value={42} label="Cards reviewed" />)
    const bar = screen.getByRole('progressbar', { name: 'Cards reviewed' })
    expect(bar).toHaveAttribute('aria-valuenow', '42')
    expect(bar).toHaveAttribute('aria-valuemin', '0')
    expect(bar).toHaveAttribute('aria-valuemax', '100')
  })

  it.each([
    [-20, '0'],
    [0, '0'],
    [140, '100'],
    [66.6, '67'],
  ])('clamps %s to %s, so a bad computation cannot overflow the track', (input, expected) => {
    const { container } = render(<ProgressBar value={input} label="p" />)
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', expected)
    // The fill, not the track: querySelector('div > div') would match the
    // progressbar itself, since `container` is a div too.
    expect(container.querySelector('[role="progressbar"] > div')?.getAttribute('style')).toContain(
      `width: ${expected}%`,
    )
  })
})

describe('the file tab', () => {
  it('draws a marigold index tab only on the active card', () => {
    const { container, rerender } = render(<SectionCard>body</SectionCard>)
    expect(container.querySelector('.bg-marigold')).toBeNull()

    rerender(<SectionCard active>body</SectionCard>)
    const tab = container.querySelector('.bg-marigold')
    expect(tab).not.toBeNull()
    // Decorative: it repeats what the surrounding content already says.
    expect(tab).toHaveAttribute('aria-hidden', 'true')
  })
})

describe('SectionNumber', () => {
  it('sets citations in tabular numerals so a column of them aligns', () => {
    render(<SectionNumber>302</SectionNumber>)
    expect(screen.getByText('302').className).toContain('tabular-nums')
  })
})

describe('StatCard', () => {
  it('sets the figure in the display face, not the heading face', () => {
    // Poppins has no tabular figures, so numerals stay on Inter 800.
    render(<StatCard label="Basic pay" value="₹44,900" />)
    expect(screen.getByText('₹44,900').className).toContain('font-display')
  })
})

describe('InfoCard', () => {
  it('titles itself with a real heading', () => {
    render(<InfoCard title="7th CPC matrix" description="Level 7, cell 1" />)
    expect(screen.getByRole('heading', { name: '7th CPC matrix' })).toBeInTheDocument()
    expect(screen.getByText('Level 7, cell 1')).toBeInTheDocument()
  })
})

describe('Skeleton', () => {
  it('is hidden from assistive tech — it is a shape, not content', () => {
    const { container } = render(<Skeleton className="h-4 w-20" />)
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true')
  })
})

describe('Breadcrumbs', () => {
  it('marks the last crumb as the current page and does not link it', () => {
    render(
      <MemoryRouter>
        <Breadcrumbs
          items={[{ label: 'Law', to: '/law' }, { label: 'BNS', to: '/law/bns' }, { label: 'Section 103' }]}
        />
      </MemoryRouter>,
    )

    expect(screen.getByRole('navigation', { name: en.a11y.breadcrumbs })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Law' })).toHaveAttribute('href', '/law')
    expect(screen.queryByRole('link', { name: 'Section 103' })).not.toBeInTheDocument()
    expect(screen.getByText('Section 103')).toHaveAttribute('aria-current', 'page')
  })

  it('does not link a crumb that is last even when given a target', () => {
    render(
      <MemoryRouter>
        <Breadcrumbs
          items={[
            { label: 'Law', to: '/law' },
            { label: 'BNS', to: '/law/bns' },
          ]}
        />
      </MemoryRouter>,
    )
    expect(screen.queryByRole('link', { name: 'BNS' })).not.toBeInTheDocument()
  })
})

describe('QueryErrorState', () => {
  it('announces itself and offers a retry that reports nothing anywhere', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const onRetry = vi.fn()
    const user = userEvent.setup()

    render(<QueryErrorState onRetry={onRetry} />)

    expect(screen.getByRole('alert')).toHaveTextContent(en.errors.title)
    await user.click(screen.getByRole('button', { name: en.common.retry }))

    expect(onRetry).toHaveBeenCalledOnce()
    // Hard rule: nothing leaves the device, error reports included.
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('omits the retry button when there is nothing to retry', () => {
    render(<QueryErrorState />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
