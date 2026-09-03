import { normaliseText } from './anchor'

/**
 * "Every time limit in the RTI Act", on one sortable page.
 *
 * An officer answering an RTI application needs thirty days, five days for a
 * transfer, forty-eight hours where life or liberty is involved and thirty days
 * for the first appeal — four numbers scattered across four sections of a
 * document they otherwise know well. Same for the GFR's monetary thresholds and
 * for who "the competent authority" is in any given rule. This extracts those
 * three things per act into `data/library/quickref/<act>.json`.
 *
 * IT IS AN INDEX, NOT AN ANSWER. Every row links to the unit that contains it
 * and quotes the words it came from, because a number lifted out of its
 * provision is exactly the kind of fact somebody acts on and gets wrong. Rows
 * the grammar is less sure of carry `verify: true` and the table says so — the
 * session brief asked for that flag and this is where it is decided.
 *
 * Pure, and it runs over a reader's own added work as readily as over a
 * bundled one.
 */

export type QuickRefKind = 'time' | 'money' | 'authority'

export interface QuickRefRow {
  kind: QuickRefKind
  /** The matched words, exactly as the provision writes them. */
  value: string
  /**
   * A comparable form, so a table can sort by it: days for a time limit,
   * rupees for a figure, the lower-cased phrase for an authority.
   */
  sortKey: number | string
  /** ~120 characters around the match, for a row that can be read without leaving. */
  quote: string
  /** Low-confidence rows are shown with a Verify badge rather than hidden. */
  verify: boolean
}

const NUMBER_WORDS: Readonly<Record<string, number>> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  fifteen: 15,
  twenty: 20,
  thirty: 30,
  forty: 40,
  'forty-five': 45,
  'forty-eight': 48,
  sixty: 60,
  ninety: 90,
  hundred: 100,
  'one hundred and eighty': 180,
}

const UNIT_DAYS: Readonly<Record<string, number>> = {
  hour: 1 / 24,
  hours: 1 / 24,
  day: 1,
  days: 1,
  week: 7,
  weeks: 7,
  month: 30,
  months: 30,
  year: 365,
  years: 365,
}

const numberOf = (raw: string): number | null => {
  const cleaned = raw.trim().toLowerCase().replace(/,/g, '')
  if (/^\d+(?:\.\d+)?$/.test(cleaned)) return Number(cleaned)
  return NUMBER_WORDS[cleaned] ?? null
}

const QUANTITY = String.raw`(\d{1,4}(?:,\d{2,3})*|[a-z]+(?:-[a-z]+)?(?: hundred and [a-z]+)?)`

/**
 * A period of time, and whether anything makes it a LIMIT.
 *
 * "within thirty days" is a deadline; "a period of five years" is a term of
 * office; "three months' leave" is an entitlement. All three are periods and
 * only the first is what the table is called. The lead-in decides, and anything
 * without one is kept at low confidence rather than dropped, because "shall be
 * disposed of in thirty days" is a deadline written without the word.
 */
const LEAD_IN =
  /(within|not later than|before the expiry of|within a period of|after the expiry of|not exceeding|no later than)\s*$/i

const TIME = new RegExp(
  String.raw`(?<![\p{L}\p{N}])(?:a period of\s+)?${QUANTITY}\s+(working\s+)?(hours?|days?|weeks?|months?|years?)(?![\p{L}])`,
  'giu',
)

/** `Rs. 1,00,000`, `₹5000`, `rupees ten thousand`, `Rs. 25 lakh`. */
/**
 * The amount is LAZY, so the scale word is left for the scale group.
 *
 * Greedy, `[a-z]+(?:\s+[a-z]+){0,3}` swallows "ten thousand" whole, the amount
 * fails to resolve to a number, and a figure written in words is silently
 * dropped — which is the half of this that most needs a Verify badge, not the
 * half that most deserves to be missing.
 */
const MONEY = new RegExp(
  String.raw`(?:₹|Rs\.?|rupees|रुपये|रु\.?)\s*(\d{1,3}(?:,\d{2,3})*(?:\.\d+)?|[a-z]+(?:\s+[a-z]+){0,3}?)` +
    String.raw`(\s*(?:lakhs?|lacs?|crores?|thousand|hundred|लाख|करोड़))?(?![\p{L}])`,
  'giu',
)

const MULTIPLIER: Readonly<Record<string, number>> = {
  hundred: 100,
  thousand: 1_000,
  lakh: 100_000,
  lakhs: 100_000,
  lac: 100_000,
  lacs: 100_000,
  crore: 10_000_000,
  crores: 10_000_000,
  लाख: 100_000,
  करोड़: 10_000_000,
}

/**
 * The authorities these documents name.
 *
 * A curated list, not a pattern over capitalised words: "the Central
 * Government", "the Ministry of Home Affairs" and "the First Schedule" all look
 * alike to a `[A-Z][a-z]+ [A-Z][a-z]+` rule, and only some of them are an
 * authority somebody has to identify before acting. Every entry here is a role
 * a provision assigns a duty or a power to.
 */
const AUTHORITIES: readonly string[] = [
  'prescribed authority',
  'disciplinary authority',
  'appointing authority',
  'competent authority',
  'appellate authority',
  'appellate authorities',
  'reviewing authority',
  'controlling officer',
  'accounts officer',
  'audit officer',
  'head of department',
  'head of office',
  'central public information officer',
  'state public information officer',
  'central assistant public information officer',
  'public information officer',
  'first appellate authority',
  'central information commission',
  'state information commission',
  'chief information commissioner',
  'information commissioner',
  'internal complaints committee',
  'local committee',
  'presiding officer',
  'inquiring authority',
  'presenting officer',
  'authority competent to grant leave',
  'pension sanctioning authority',
  'head of the office',
  'drawing and disbursing officer',
  'financial adviser',
  'procuring entity',
  'cpio',
  'ddo',
  'apio',
]

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** No `\b`: it does not exist between a space and a Devanagari letter (ADR-035). */
const AUTHORITY = new RegExp(
  String.raw`(?<![\p{L}\p{N}])(?:${[...AUTHORITIES]
    .sort((a, b) => b.length - a.length)
    .map((name) => escapeRegExp(name).replace(/\s+/g, String.raw`\s+`))
    .join('|')})(?![\p{L}\p{N}])`,
  'giu',
)

const QUOTE_PAD = 60

const quoteAround = (text: string, start: number, end: number): string => {
  const from = Math.max(0, start - QUOTE_PAD)
  const to = Math.min(text.length, end + QUOTE_PAD)
  return (from > 0 ? '…' : '') + text.slice(from, to).trim() + (to < text.length ? '…' : '')
}

/** Every quick-reference row in one unit's text. */
export function extractQuickRef(source: string): QuickRefRow[] {
  const text = normaliseText(source)
  if (!text) return []

  const rows: QuickRefRow[] = []
  const seen = new Set<string>()
  const push = (row: QuickRefRow) => {
    const key = `${row.kind}:${row.value.toLowerCase()}:${row.quote.slice(0, 40)}`
    if (seen.has(key)) return
    seen.add(key)
    rows.push(row)
  }

  TIME.lastIndex = 0
  for (const match of text.matchAll(TIME)) {
    const start = match.index ?? 0
    const quantity = numberOf(match[1] ?? '')
    const unit = (match[3] ?? '').toLowerCase()
    if (quantity === null || !(unit in UNIT_DAYS)) continue
    // "one of the" and "three or more" are not periods; the unit word is what
    // saves this from every stray numeral, and the quantity cap from a year
    // number read as a duration.
    if (quantity > 1000) continue
    const before = text.slice(Math.max(0, start - 40), start)
    const bounded = LEAD_IN.test(before)
    push({
      kind: 'time',
      value: match[0].trim(),
      sortKey: quantity * (UNIT_DAYS[unit] ?? 1),
      quote: quoteAround(text, start, start + match[0].length),
      verify: !bounded,
    })
  }

  MONEY.lastIndex = 0
  for (const match of text.matchAll(MONEY)) {
    const start = match.index ?? 0
    const amount = numberOf(match[1] ?? '')
    const scale = (match[2] ?? '').trim().toLowerCase()
    if (amount === null) continue
    const multiplier = scale ? (MULTIPLIER[scale] ?? 1) : 1
    push({
      kind: 'money',
      value: match[0].trim(),
      sortKey: amount * multiplier,
      quote: quoteAround(text, start, start + match[0].length),
      // A figure written in words ("rupees ten thousand") is read by the same
      // table as one written in digits, and is likelier to have been misread.
      verify: !/^\d/.test((match[1] ?? '').trim()),
    })
  }

  AUTHORITY.lastIndex = 0
  for (const match of text.matchAll(AUTHORITY)) {
    const start = match.index ?? 0
    const value = normaliseText(match[0])
    push({
      kind: 'authority',
      value,
      sortKey: value.toLowerCase(),
      quote: quoteAround(text, start, start + match[0].length),
      verify: false,
    })
  }

  return rows
}
