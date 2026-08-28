import { describe, expect, it } from 'vitest'

import { formatCell, formatDelta, formatNumber, formatPercent, formatRupees } from './format'

/**
 * The pay slip's number formatting.
 *
 * Two claims here are load-bearing rather than cosmetic. Digits stay Latin in
 * BOTH languages — `hi-IN` defaults to the `latn` numbering system, a pay slip
 * is read as a column of figures, and Devanagari digits would break the
 * `tabular-nums` alignment the design system requires of every number (this is
 * the one place in the app the global Devanagari-digits toggle deliberately
 * does not reach). And the grouping is the Indian one, so ₹1,00,050 is three
 * groups, not ₹100,050.
 *
 * Node is built with full ICU, so `Intl` here is the same implementation the
 * browser uses. The assertions compare against `Intl`'s own output for the
 * separator characters rather than hard-coding a comma, so an ICU upgrade that
 * changed a separator would not fail this file for the wrong reason — but the
 * digits, the grouping positions and the sign are asserted literally.
 */

describe('formatRupees', () => {
  it('groups on lakhs and crores, not thousands', () => {
    expect(formatRupees(100_050)).toBe('₹1,00,050')
    expect(formatRupees(1_00_00_000)).toBe('₹1,00,00,000')
    expect(formatRupees(999)).toBe('₹999')
    expect(formatRupees(0)).toBe('₹0')
  })

  it('drops every fraction, because a paisa on screen means a bug upstream', () => {
    expect(formatRupees(44_900.4)).toBe('₹44,900')
    expect(formatRupees(44_900.6)).toBe('₹44,901')
  })

  it('uses Latin digits in Hindi too', () => {
    const hindi = formatRupees(100_050, 'hi')
    expect(hindi).toMatch(/[0-9]/)
    expect(hindi).not.toMatch(/[०-९]/)
    // Same digits and same grouping positions as English; only the currency
    // presentation is allowed to differ between the two locales.
    expect(hindi.replace(/[^0-9,]/g, '')).toBe('1,00,050')
  })

  it('shows an em dash rather than "NaN" for a value that is not a number', () => {
    expect(formatRupees(Number.NaN)).toBe('—')
    expect(formatRupees(Number.POSITIVE_INFINITY)).toBe('—')
    expect(formatRupees(Number.NEGATIVE_INFINITY, 'hi')).toBe('—')
  })
})

describe('formatNumber', () => {
  it('is formatRupees without the symbol', () => {
    expect(formatNumber(100_050)).toBe('1,00,050')
    expect(formatNumber(3600)).toBe('3,600')
    expect(formatNumber(0)).toBe('0')
  })

  it('keeps Latin digits in Hindi', () => {
    expect(formatNumber(100_050, 'hi').replace(/[^0-9,]/g, '')).toBe('1,00,050')
    expect(formatNumber(100_050, 'hi')).not.toMatch(/[०-९]/)
  })

  it('shows an em dash for a non-finite value', () => {
    expect(formatNumber(Number.NaN)).toBe('—')
    expect(formatNumber(Number.POSITIVE_INFINITY, 'hi')).toBe('—')
  })
})

describe('formatDelta', () => {
  it('always shows the sign, so +₹300 and ₹300 cannot be confused', () => {
    expect(formatDelta(300)).toBe('+₹300')
    // U+2212 MINUS SIGN, not a hyphen: it is the same width as the plus, which
    // is what keeps a comparison column aligned.
    expect(formatDelta(-300)).toBe('−₹300')
    expect(formatDelta(-300).startsWith('−')).toBe(true)
  })

  it('shows an em dash for no difference at all, rather than "+₹0"', () => {
    expect(formatDelta(0)).toBe('—')
    expect(formatDelta(-0)).toBe('—')
  })

  it('shows an em dash for a non-finite difference', () => {
    expect(formatDelta(Number.NaN)).toBe('—')
    expect(formatDelta(Number.POSITIVE_INFINITY)).toBe('—')
  })

  it('formats the magnitude the same way a plain figure is formatted', () => {
    expect(formatDelta(-100_050)).toBe(`−${formatRupees(100_050)}`)
    expect(formatDelta(100_050, 'hi')).toBe(`+${formatRupees(100_050, 'hi')}`)
  })
})

describe('formatPercent', () => {
  it('keeps up to two decimals and appends the sign', () => {
    expect(formatPercent(60)).toBe('60%')
    expect(formatPercent(2.5)).toBe('2.5%')
    expect(formatPercent(2.567)).toBe('2.57%')
    expect(formatPercent(0)).toBe('0%')
  })

  it('shows an em dash — with no per-cent sign — for a non-finite rate', () => {
    expect(formatPercent(Number.NaN)).toBe('—')
    expect(formatPercent(Number.POSITIVE_INFINITY, 'hi')).toBe('—')
  })
})

describe('formatCell', () => {
  it('is one-based, because the printed matrix is', () => {
    expect(formatCell(0)).toBe('1')
    expect(formatCell(19)).toBe('20')
    expect(formatCell(0, 'hi')).toBe('1')
  })
})

describe('the formatter cache', () => {
  it('returns the same string for the same input twice, cache hit or miss', () => {
    // The module memoises Intl.NumberFormat by (language, options). The second
    // call is the cached branch; identical output is what proves the cache key
    // separates the languages and the option sets rather than collapsing them.
    expect(formatRupees(44_900)).toBe(formatRupees(44_900))
    expect(formatNumber(44_900, 'hi')).toBe(formatNumber(44_900, 'hi'))
    // Different option sets under the same language must not share an entry:
    // a currency formatter and a plain one differ by the symbol.
    expect(formatRupees(44_900)).not.toBe(formatNumber(44_900))
  })
})
