import type { Language } from '@/i18n'

/**
 * Money, on the Indian grouping, in whichever language the reader is in.
 *
 * `Intl` does the lakh/crore grouping for both `en-IN` and `hi-IN`, so
 * ₹1,00,050 comes out right without a hand-rolled grouper. Digits stay Latin in
 * both languages: `hi-IN` uses the `latn` numbering system by default, a pay
 * slip is read as a column of figures, and Devanagari digits would break the
 * `tabular-nums` alignment the design system requires of every number.
 *
 * Fractions are always dropped. Every figure this module produces has already
 * been rounded to the rupee (see `rounding.ts`), so a decimal point on screen
 * would mean a bug upstream rather than a paisa.
 */

const cache = new Map<string, Intl.NumberFormat>()

function formatter(language: Language, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${language}:${JSON.stringify(options)}`
  const existing = cache.get(key)
  if (existing) return existing
  const made = new Intl.NumberFormat(language === 'hi' ? 'hi-IN' : 'en-IN', options)
  cache.set(key, made)
  return made
}

export function formatRupees(value: number, language: Language = 'en'): string {
  if (!Number.isFinite(value)) return '—'
  return formatter(language, {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(value)
}

/** Without the symbol, for a column that carries its own ₹ in the header. */
export function formatNumber(value: number, language: Language = 'en'): string {
  if (!Number.isFinite(value)) return '—'
  return formatter(language, { maximumFractionDigits: 0 }).format(value)
}

/**
 * A difference, with its sign always shown. A comparison column in which +₹300
 * and ₹300 look the same is a comparison column that has to be read twice.
 */
export function formatDelta(value: number, language: Language = 'en'): string {
  if (!Number.isFinite(value)) return '—'
  if (value === 0) return '—'
  return `${value > 0 ? '+' : '−'}${formatRupees(Math.abs(value), language)}`
}

export function formatPercent(value: number, language: Language = 'en'): string {
  if (!Number.isFinite(value)) return '—'
  return formatter(language, { maximumFractionDigits: 2 }).format(value) + '%'
}

/**
 * `44900` → `"₹44,900 (Level 7, cell 1)"`-style cell label. One-based, because
 * the printed matrix is one-based and a reader counting down a column would
 * otherwise be one out.
 */
export function formatCell(cellIndex: number, language: Language = 'en'): string {
  return formatNumber(cellIndex + 1, language)
}
