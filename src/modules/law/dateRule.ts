/**
 * Which code applies, and it is decided by the date of the OFFENCE.
 *
 * This is the single most consequential rule in the module. An offence
 * committed on 30 June 2024 is investigated, tried and punished under the IPC,
 * the CrPC and the Evidence Act; one committed on 1 July 2024 is not. BNSS
 * section 531(2)(a) is the saving provision that says so, and it is why the
 * whole converter carries a date field rather than assuming "now".
 *
 * Everything here works on `YYYY-MM-DD` strings and never constructs a `Date`.
 * A `Date` built from a date-only string is UTC midnight, so a reader in
 * Asia/Kolkata comparing local dates is five and a half hours out — which on
 * exactly the boundary this function exists to test is the difference between
 * the right answer and the wrong one.
 */

/** All three Sanhitas were brought into force on this date. */
export const COMMENCEMENT_DATE = '2024-07-01'

/** Which body of law governs an offence. */
export type LawEra =
  /** IPC / CrPC / Indian Evidence Act — the offence predates commencement. */
  | 'old'
  /** BNS / BNSS / BSA. */
  | 'new'

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * True for a real calendar date in `YYYY-MM-DD` form.
 *
 * The round-trip through `Date.UTC` is what rejects 31 February: the regex
 * alone accepts any two digits, and `<input type="date">` is not the only way a
 * value reaches this — a deep link can carry anything.
 */
export function isValidDate(value: string): boolean {
  const match = ISO_DATE.exec(value)
  if (!match) return false
  const [, year = '', month = '', day = ''] = match
  const timestamp = Date.UTC(Number(year), Number(month) - 1, Number(day))
  const date = new Date(timestamp)
  return (
    date.getUTCFullYear() === Number(year) &&
    date.getUTCMonth() === Number(month) - 1 &&
    date.getUTCDate() === Number(day)
  )
}

/**
 * The era an offence date falls in, or `null` when no usable date was given.
 *
 * `null` is a distinct answer from either era and the UI must treat it as one:
 * with no date, the app does not know which code applies and must not imply
 * that it does.
 *
 * ISO dates compare correctly as strings — fixed width, most significant field
 * first — so no parsing and no time zone enters into it.
 */
export function eraForOffenceDate(value: string | null | undefined): LawEra | null {
  if (!value || !isValidDate(value)) return null
  return value < COMMENCEMENT_DATE ? 'old' : 'new'
}

/** Today in Asia/Kolkata as `YYYY-MM-DD` — the app's only clock. */
export function todayInIndia(now: Date = new Date()): string {
  // `en-CA` is used purely because it formats as YYYY-MM-DD; the time zone is
  // pinned rather than taken from the device, which may be anywhere.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}
