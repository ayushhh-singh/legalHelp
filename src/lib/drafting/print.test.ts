import { describe, expect, it } from 'vitest'

import {
  bilingualMismatch,
  CSMOP_MARGIN_MM,
  defaultPageSetup,
  isPageSize,
  PAGE_DIMENSIONS,
  pageRuleCss,
  textWidthMm,
  twipsOf,
} from './print'

/** Page geometry — the one place the three renderers agree about the paper. */

describe('defaultPageSetup', () => {
  it('is A4 at CSMOP margins', () => {
    const setup = defaultPageSetup()
    expect(setup.size).toBe('A4')
    expect(setup.margin).toEqual({
      top: CSMOP_MARGIN_MM,
      right: CSMOP_MARGIN_MM,
      bottom: CSMOP_MARGIN_MM,
      left: CSMOP_MARGIN_MM,
    })
  })

  it('offers Letter, and it is never the default', () => {
    expect(defaultPageSetup('Letter').size).toBe('Letter')
    expect(PAGE_DIMENSIONS.Letter.widthMm).toBeCloseTo(215.9, 1)
  })
})

describe('twipsOf', () => {
  it('gives A4 the figures `docx` and the existing tests already expect', () => {
    const geometry = twipsOf(defaultPageSetup('A4'))
    expect(geometry.size).toEqual({ width: 11906, height: 16838 })
    expect(geometry.margin.top).toBe(1440)
    expect(geometry.margin.left).toBe(1440)
  })

  it('puts the running header inside the top margin rather than above the text', () => {
    const geometry = twipsOf(defaultPageSetup('A4'))
    expect(geometry.margin.header).toBe(720)
    expect(geometry.margin.header).toBeLessThan(geometry.margin.top)
  })

  it('gives Letter a different page and the same margins', () => {
    const geometry = twipsOf(defaultPageSetup('Letter'))
    expect(geometry.size.width).toBe(12240)
    expect(geometry.size.height).toBe(15840)
    expect(geometry.margin.top).toBe(1440)
  })
})

describe('pageRuleCss', () => {
  it('writes the size and margin as literal millimetres', () => {
    // `@page { size: var(--x) }` is invalid CSS in every browser and falls back
    // to the printer's default, which is Letter in some locales. A paper size
    // the officer CHOSE has to arrive as literal text.
    const css = pageRuleCss(defaultPageSetup('A4'))
    expect(css).toContain('@page draft-print {')
    expect(css).toContain('size: 210mm 297mm;')
    expect(css).toContain('margin: 25.4mm 25.4mm 25.4mm 25.4mm;')
    expect(css).not.toContain('var(')
  })

  it('names the page, so a margin here cannot move the pay slip', () => {
    expect(pageRuleCss(defaultPageSetup('A4'))).toContain(
      '.draft-print-root .a4-print-root { page: draft-print; }',
    )
    expect(pageRuleCss(defaultPageSetup('A4'), 'other')).toContain('@page other {')
  })

  it('follows the paper the officer chose', () => {
    expect(pageRuleCss(defaultPageSetup('Letter'))).toContain('size: 215.9mm 279.4mm;')
  })
})

describe('isPageSize', () => {
  it('accepts only the two, so a query string cannot invent a third', () => {
    expect(isPageSize('A4')).toBe(true)
    expect(isPageSize('Letter')).toBe(true)
    expect(isPageSize('a4')).toBe(false)
    expect(isPageSize('A3')).toBe(false)
    expect(isPageSize(null)).toBe(false)
    expect(isPageSize(undefined)).toBe(false)
  })
})

describe('textWidthMm', () => {
  it('is the page less its two side margins', () => {
    expect(textWidthMm(defaultPageSetup('A4'))).toBeCloseTo(210 - 50.8, 1)
  })
})

describe('bilingualMismatch', () => {
  const doc = (bodyLines: string[]) => ({
    blocks: [
      { role: 'header', lines: ['Government of India'] },
      { role: 'body', lines: bodyLines },
    ],
  })

  it('says nothing when the two halves agree', () => {
    expect(bilingualMismatch(doc(['a', 'b']), doc(['क', 'ख']))).toBeNull()
  })

  it('reports both counts when they do not', () => {
    expect(bilingualMismatch(doc(['a', 'b', 'c']), doc(['क']))).toEqual({ en: 3, hi: 1 })
  })

  it('counts only the body — chrome is generated and always matches', () => {
    expect(
      bilingualMismatch(
        {
          blocks: [
            { role: 'header', lines: ['a', 'b', 'c'] },
            { role: 'body', lines: ['x'] },
          ],
        },
        {
          blocks: [
            { role: 'header', lines: ['क'] },
            { role: 'body', lines: ['य'] },
          ],
        },
      ),
    ).toBeNull()
  })
})
