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

  it('leads the body stack with Inter, behind the one-glyph rupee face', () => {
    // 'Rupee Devanagari' declares `unicode-range: U+20A8, U+20B9` and nothing
    // else, so it claims the rupee sign and no other character — which is the
    // point: U+20B9 lives in Inter's 85 KB latin-ext subset, and resolving it
    // to the Devanagari face the bilingual chrome already fetches takes that
    // file off /pay's critical path entirely (ADR-030). Every other character
    // still falls to Inter, which is what the second assertion holds.
    expect(stack('sans')).toMatch(/^'Rupee Devanagari',\s*'Inter Variable'/)
    expect(stack('sans')).toMatch(/'Inter Variable',\s*'Inter'/)
  })

  it('puts Noto Sans Devanagari behind both, so Hindi never hits a system face', () => {
    // Poppins carries no Devanagari; Noto sitting directly behind it is what
    // makes a Hindi heading fall through glyph-by-glyph rather than to whatever
    // the platform would otherwise choose.
    // 'Noto Sans Devanagari Variable' is the one variable file that replaced
    // four static weights (ADR-030); the static family stays behind it as the
    // fallback for a browser that cannot use a variable font.
    expect(stack('heading')).toMatch(/'Poppins',\s*'Noto Sans Devanagari Variable',\s*'Noto Sans Devanagari'/)
    expect(stack('sans')).toMatch(/'Noto Sans Devanagari Variable',\s*'Noto Sans Devanagari'/)
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
      // The first family in --font-sans is the one-glyph rupee face, which
      // covers U+20B9 and nothing else, so the face that actually renders
      // this subtitle is the next one along.
      const families = getComputedStyle(screen.getByText('IPC ⇄ BNS'))
        .fontFamily.replace(/["']/g, '')
        .split(',')
        .map((family) => family.trim())
      expect(families[0]).toBe('Rupee Devanagari')
      expect(families[1]).toBe('Inter Variable')
    } finally {
      cleanup()
    }
  })
})
