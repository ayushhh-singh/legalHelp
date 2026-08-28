import type { Language } from '@/i18n'

/**
 * "in 3 d" — the short interval hint printed on a grade button.
 *
 * Pure and deliberately coarse: a reader deciding between four buttons wants
 * an order-of-magnitude sense of the gap between them, not a precise duration.
 * Minutes are shown while a card is still on a learning step (where the real
 * unit is minutes); everything at or past a day rounds to the nearest whole
 * unit, days first, then weeks past nine days, then months past ~45.
 */
export function intervalLabel(due: string, now: Date, language: Language): string {
  const ms = Date.parse(due) - now.getTime()
  const unit = (value: number, en: string, hi: string): string =>
    language === 'hi' ? `${value} ${hi}` : `${value} ${en}`

  if (ms < 60_000) return language === 'hi' ? '<१ मि' : '<1 m'
  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return unit(minutes, 'm', 'मि')

  const hours = Math.round(minutes / 60)
  if (hours < 24) return unit(hours, 'h', 'घं')

  const days = Math.round(hours / 24)
  if (days < 10) return unit(days, 'd', 'दि')

  const weeks = Math.round(days / 7)
  if (days < 45) return unit(weeks, 'w', 'सप्ता')

  const months = Math.round(days / 30)
  if (days < 365) return unit(months, 'mo', 'मास')

  const years = Math.round(days / 365)
  return unit(years, 'y', 'वर्ष')
}
