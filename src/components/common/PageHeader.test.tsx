import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { PageHeader } from './PageHeader'

import { readFromRoot } from '@/test/paths'

/**
 * Devanagari must render in Tiro Devanagari Hindi.
 *
 * jsdom does not resolve `var()` in getComputedStyle and never sees Tailwind's
 * JIT output, so this test rebuilds the chain explicitly:
 *   tokens.css --font-display  ->  Tailwind `font-display`  ->  the <h1>
 * and then asserts the resolved stack. Actual glyph rendering can only be
 * confirmed in a real browser; that check belongs to the Playwright session.
 */

const tokensCss = readFromRoot('src/styles/tokens.css')
const tailwindConfig = readFromRoot('tailwind.config.ts')

function displayStack(): string {
  const value = /--font-display:\s*([^;]+);/.exec(tokensCss)?.[1]
  if (!value) throw new Error('--font-display is not declared in tokens.css')
  return value.trim()
}

/** Bind the utility class to the literal stack, since jsdom cannot use var(). */
function installDisplayFont() {
  const style = document.createElement('style')
  style.textContent = `.font-display { font-family: ${displayStack()}; }`
  document.head.appendChild(style)
  return () => style.remove()
}

describe('Devanagari typography', () => {
  it('puts Tiro Devanagari Hindi first in the display stack', () => {
    expect(displayStack()).toMatch(/^'Tiro Devanagari Hindi'/)
  })

  it('maps the Tailwind display family to the same token', () => {
    expect(tailwindConfig).toMatch(/display:\s*'var\(--font-display\)'/)
  })

  it('renders a Hindi heading in Tiro Devanagari Hindi', () => {
    const cleanup = installDisplayFont()
    try {
      render(<PageHeader title="विधि परिवर्तक" subtitle="भादंसं ⇄ भान्यासं" />)

      const heading = screen.getByRole('heading', { level: 1, name: 'विधि परिवर्तक' })
      expect(heading).toHaveClass('font-display')

      const resolved = getComputedStyle(heading).fontFamily
      expect(resolved).toContain('Tiro Devanagari Hindi')
      // It must be the FIRST family, not a late fallback.
      expect(resolved.replace(/["']/g, '').split(',')[0]?.trim()).toBe('Tiro Devanagari Hindi')
    } finally {
      cleanup()
    }
  })

  it('declares a Devanagari-capable fallback after Tiro', () => {
    expect(displayStack()).toMatch(/Noto Serif Devanagari/)
  })
})
