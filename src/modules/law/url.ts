import { isLawCode } from './data'
import { isValidDate } from './dateRule'
import type { LawCode } from './types'

import type { Direction } from '@/lib/search'

/**
 * The whole converter view, in the URL.
 *
 * `/law?code=bns&q=302&dir=old-new&date=2024-08-01` restores the exact screen,
 * and that is what "Share as text" links to. It matters more here than in most
 * modules: a section citation sent to a colleague is worthless if the link
 * lands them on an empty search box, and the offence date is part of the
 * answer, not a preference.
 *
 * Every value is validated on the way in. A deep link is untrusted input —
 * `dir=drop-tables` must produce the default view, not a broken one.
 */

export interface LawViewState {
  query: string
  /** null means "all three codes". */
  code: LawCode | null
  direction: Direction
  /** `YYYY-MM-DD`, or null when the reader has not given an offence date. */
  date: string | null
}

export const DEFAULT_VIEW: LawViewState = {
  query: '',
  code: null,
  direction: 'old-new',
  date: null,
}

const isDirection = (value: unknown): value is Direction => value === 'old-new' || value === 'new-old'

export function parseLawParams(params: URLSearchParams): LawViewState {
  const code = params.get('code')
  const direction = params.get('dir')
  const date = params.get('date')

  return {
    query: params.get('q') ?? '',
    code: isLawCode(code) ? code : null,
    direction: isDirection(direction) ? direction : DEFAULT_VIEW.direction,
    date: date && isValidDate(date) ? date : null,
  }
}

/**
 * Only what differs from the default is written, so the common case stays
 * `/law` and a shared link carries no noise for the recipient to read past.
 */
export function toLawParams(state: LawViewState): URLSearchParams {
  const params = new URLSearchParams()
  if (state.query.trim()) params.set('q', state.query.trim())
  if (state.code) params.set('code', state.code)
  if (state.direction !== DEFAULT_VIEW.direction) params.set('dir', state.direction)
  if (state.date) params.set('date', state.date)
  return params
}

/** `"/law?q=302"`. Used for share links and for the recent-lookup list. */
export function toLawHref(state: LawViewState, pathname = '/law'): string {
  const params = toLawParams(state).toString()
  return params ? `${pathname}?${params}` : pathname
}

/**
 * The offence date, remembered for this browsing session and no longer.
 *
 * The brief asks for the last date to persist "in session state only", and this
 * is that in the literal sense: a module-scoped value, in memory, gone when the
 * tab closes. It is deliberately NOT in IndexedDB and NOT in `sessionStorage` —
 * an offence date is the most identifying thing a reader can type into this
 * module, and there is no version of "remember it" that is worth writing it to
 * disk for. Navigating between the converter, the saved list and back keeps it;
 * closing the tab does not.
 */
let sessionOffenceDate: string | null = null

export function rememberOffenceDate(date: string | null): void {
  sessionOffenceDate = date && isValidDate(date) ? date : null
}

export function recallOffenceDate(): string | null {
  return sessionOffenceDate
}

/** Test seam, and what the settings "clear data" path calls. */
export function forgetOffenceDate(): void {
  sessionOffenceDate = null
}
