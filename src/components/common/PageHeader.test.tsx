import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { PageHeader } from './PageHeader'

import { readFromRoot } from '@/test/paths'

/**
 * The typographic contract:
 *   headings -> --font-heading (Poppins, then Noto Sans Devanagari)
 *   body     -> --font-sans    (Inter Variable, then Noto Sans Devanagari)
 *
 * jsdom does not resolve `var()` in getComputedStyle and never sees Tailwind's
 * generated utilities, so this test rebuilds the chain explicitly from the
 * shipped tokens.css and asserts the resolved stack. Which face a glyph
 * actually renders in can only be answered by a real browser: that is
 * tests/e2e/typography.spec.ts, which reads Chromium's used-font list.
 */

const tokensCss = readFromRoot('src/styles/tokens.css')
const indexCss = readFromRoot('src/styles/index.css')

/** The plain `@theme { … }` block — where Tailwind 4 reads the font scale. */
function themeBlock(): string {
  const block = /@theme\s*\{([^}]*)\}/.exec(tokensCss)?.[1]
  if (!block) throw new Error('no plain `@theme` block found in tokens.css')
  return block
}

function stack(name: string): string {
  const value = new RegExp(`--font-${name}:\\s*([^;]+);`).exec(themeBlock())?.[1]
  if (!value) throw new Error(`--font-${name} is not declared in the @theme block`)
  return value.trim()
}

/** Bind the element rules to the literal stacks, since jsdom cannot use var(). */
function installFonts() {
  const style = document.createElement('style')
  style.textContent = `
    body { font-family: ${stack('sans')}; }
    h1, h2, h3, h4, h5, h6 { font-family: ${stack('heading')}; }
    .font-sans { font-family: ${stack('sans')}; }
  `
  document.head.appendChild(style)
  return () => style.remove()
}

const firstFamily = (el: Element) =>
  getComputedStyle(el).fontFamily.replace(/["']/g, '').split(',')[0]?.trim()

describe('font stacks', () => {
  it('leads the heading stack with Poppins', () => {
    expect(stack('heading')).toMatch(/^'Poppins'/)
  })

  it('leads the body stack with Inter', () => {
    expect(stack('sans')).toMatch(/^'Inter Variable'/)
  })

  it('puts Noto Sans Devanagari behind both, so Hindi never hits a system face', () => {
    // Poppins carries no Devanagari; Noto sitting directly behind it is what
    // makes a Hindi heading fall through glyph-by-glyph rather than to whatever
    // the platform would otherwise choose.
    expect(stack('heading')).toMatch(/'Poppins',\s*'Noto Sans Devanagari'/)
    expect(stack('sans')).toMatch(/'Noto Sans Devanagari'/)
  })

  it('keeps `.font-display` on the body face and unlayered', () => {
    // Poppins has no tabular figures, so scoreboard numerals stay on Inter.
    // Unlayered so it beats the `h1-h6` rule in @layer base.
    const rule = /\.font-display\s*\{([^}]*)\}/.exec(indexCss)?.[1] ?? ''
    expect(rule).toMatch(/font-family:\s*var\(--font-sans\)/)
    expect(rule).toMatch(/font-variant-numeric:\s*tabular-nums/)
    expect(rule).toMatch(/font-weight:\s*800/)
    const beforeRule = indexCss.slice(0, indexCss.indexOf('.font-display'))
    const opened = (beforeRule.match(/@layer[^{]*\{/g) ?? []).length
    const closed = (beforeRule.match(/^\}/gm) ?? []).length
    expect(opened, '.font-display must not sit inside a @layer block').toBeLessThanOrEqual(closed)
  })
})

describe('PageHeader', () => {
  it('renders a Hindi title in the heading stack, led by Poppins then Noto', () => {
    const cleanup = installFonts()
    try {
      render(<PageHeader title="विधि परिवर्तक" subtitle="भादंसं ⇄ भान्यासं" />)

      const heading = screen.getByRole('heading', { level: 1, name: 'विधि परिवर्तक' })
      expect(firstFamily(heading)).toBe('Poppins')
      expect(getComputedStyle(heading).fontFamily).toContain('Noto Sans Devanagari')
    } finally {
      cleanup()
    }
  })

  it('drops the subtitle to the body face', () => {
    const cleanup = installFonts()
    try {
      render(<PageHeader title="Law Converter" subtitle="IPC ⇄ BNS" />)
      expect(firstFamily(screen.getByText('IPC ⇄ BNS'))).toBe('Inter Variable')
    } finally {
      cleanup()
    }
  })
})
