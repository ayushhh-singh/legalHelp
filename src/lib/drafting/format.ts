import type { Lang } from './types'

/**
 * Dates and numerals, the two things a bilingual official document formats
 * differently in each language.
 *
 * The date an officer types may be an ISO date (what a date input produces) or
 * the dd.mm.yyyy an officer types by hand. Both are accepted and normalised;
 * anything else is reported rather than guessed at, because "01.02.2026" read
 * as the wrong one of 1 February and 2 January is the kind of error a document
 * carries silently for years.
 */

const DEVANAGARI_DIGITS = ['०', '१', '२', '३', '४', '५', '६', '७', '८', '९'] as const

/** ASCII digits to Devanagari. Everything else is left alone. */
export function toDevanagariDigits(text: string): string {
  return text.replace(/[0-9]/g, (digit) => DEVANAGARI_DIGITS[Number(digit)] ?? digit)
}

/** Devanagari digits to ASCII, so a Hindi-typed date still parses. */
export function toAsciiDigits(text: string): string {
  return text.replace(/[०-९]/g, (digit) => String(digit.charCodeAt(0) - 0x0966))
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/
const DOTTED = /^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})$/

export interface ParsedDate {
  day: number
  month: number
  year: number
}

/**
 * `2026-08-28` or `28.08.2026` (also `28-08-2026`, `28/08/2026`, and either in
 * Devanagari digits) → its parts. `null` when it is neither, or when the parts
 * do not name a real day — 31.02.2026 is a typo, not a date.
 */
export function parseDate(value: string): ParsedDate | null {
  const text = toAsciiDigits(value.trim())

  const iso = ISO.exec(text)
  const dotted = DOTTED.exec(text)
  let parts: ParsedDate | null = null

  if (iso) parts = { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) }
  else if (dotted) parts = { day: Number(dotted[1]), month: Number(dotted[2]), year: Number(dotted[3]) }
  if (!parts) return null

  const { day, month, year } = parts
  if (month < 1 || month > 12 || day < 1) return null
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return day > daysInMonth ? null : parts
}

const pad = (value: number) => String(value).padStart(2, '0')

/**
 * dd.mm.yyyy in both languages — that is what the Appendix 8.1 specimens and
 * every DoPT order print. The word दिनांक belongs to the template's line, not
 * to the value, so a Hindi signature block can carry a bare date.
 */
export function formatDate(value: string, lang: Lang, devanagariDigits = false): string {
  const parsed = parseDate(value)
  if (!parsed) return value
  const text = `${pad(parsed.day)}.${pad(parsed.month)}.${parsed.year}`
  return lang === 'hi' && devanagariDigits ? toDevanagariDigits(text) : text
}

const ROMAN = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'xi', 'xii']

/** `1.`, `(i)`, `•` or nothing — the marker in front of a list item. */
export function itemMarker(
  prefix: 'none' | 'ordinal' | 'roman' | 'bullet',
  index: number,
  lang: Lang,
  devanagariDigits = false,
): string {
  if (prefix === 'none') return ''
  if (prefix === 'bullet') return '• '
  if (prefix === 'roman') return `(${ROMAN[index] ?? String(index + 1)}) `
  const number = String(index + 1)
  return `${lang === 'hi' && devanagariDigits ? toDevanagariDigits(number) : number}. `
}

/** `2. ` in front of a paragraph, or '' for one that carries no number. */
export function paraMarker(number: number | null, lang: Lang, devanagariDigits = false): string {
  if (number === null) return ''
  const text = String(number)
  return `${lang === 'hi' && devanagariDigits ? toDevanagariDigits(text) : text}. `
}

/** Words, for the length rules — 'one page' and 'concise' are word counts here. */
export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

/**
 * A stored date as an `<input type="date">` value, or `''`.
 *
 * An HTML date input accepts only `yyyy-mm-dd`, and the app stores whatever the
 * officer or the migration produced — every document migrated from the Session
 * 8 editor carries `dd.mm.yyyy`, because that is what CSMOP's specimens print.
 * Handing the input a dotted date makes it render EMPTY, which tells the
 * officer their document has no date when it has one, and invites them to type
 * it again. `parseDate` already reads both shapes in either script; this is the
 * one line that was missing between it and the control.
 */
export function isoDateValue(raw: string): string {
  const parsed = parseDate(raw)
  if (!parsed) return ''
  return `${parsed.year}-${pad(parsed.month)}-${pad(parsed.day)}`
}
