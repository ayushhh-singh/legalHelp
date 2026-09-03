/**
 * The Library's three routes, built in one place.
 *
 * `/library/:workId/:unitId` puts BOTH ids in the path rather than one in a
 * query string, because a unit is a document in its own right — it is what a
 * reader bookmarks in their browser, shares, and prints. The Law Converter puts
 * its whole view in the query string for the opposite reason (ADR-013: its view
 * is a search plus a selection, not a page).
 *
 * A rules unit id already carries its act (`ccs-conduct-11`); a law unit id is
 * the bare section number (`103`), which is only unique WITHIN its code — which
 * is exactly why the work id is in the path too.
 */
export const toLibraryHref = (): string => '/library'

/** The Library's own screens, beside the shelf. */
export const toMineHref = (): string => '/library/mine'
export const toBookmarksHref = (): string => '/library/bookmarks'
export const toAddWorkHref = (): string => '/library/add'
export const toLibrarySearchHref = (query?: string): string =>
  query ? `/library/search?q=${encodeURIComponent(query)}` : '/library/search'

/**
 * `/library/compare?a=<work>:<unit>&b=…` — two units side by side.
 *
 * A colon-joined pair rather than four parameters, because the two sides are
 * one thing the reader swaps: `a` and `b` trading places must be one edit, and
 * a link with `aWork` but no `aUnit` is a state nobody meant to produce.
 */
export const compareRef = (workId: string, unitId: string): string => `${workId}:${unitId}`

export function parseCompareRef(value: string | null): { workId: string; unitId: string } | null {
  if (!value) return null
  const at = value.indexOf(':')
  if (at <= 0 || at === value.length - 1) return null
  return { workId: value.slice(0, at), unitId: value.slice(at + 1) }
}

export function toCompareHref(
  a: { workId: string; unitId: string } | null,
  b?: { workId: string; unitId: string } | null,
): string {
  const params = new URLSearchParams()
  if (a) params.set('a', compareRef(a.workId, a.unitId))
  if (b) params.set('b', compareRef(b.workId, b.unitId))
  const query = params.toString()
  return query ? `/library/compare?${query}` : '/library/compare'
}

export const toWorkHref = (workId: string): string => `/library/${encodeURIComponent(workId)}`

export const toUnitHref = (workId: string, unitId: string): string =>
  `/library/${encodeURIComponent(workId)}/${encodeURIComponent(unitId)}`

/**
 * A cross-reference into the Law Converter, as a QUERY that names the Act.
 *
 * Never `?section=`/`&code=`: `data/law`'s three codes each restart their
 * numbering, and a bare number re-parses on a fresh visit as the repealed Act's
 * section — "IPC 509", not "BNS 509", is the answer a PoSH cross-reference
 * wants. ADR-029 point 4 has the full mechanism.
 */
export const toLawSearchHref = (query: string): string => `/law?q=${encodeURIComponent(query)}`

/** The Trainer, filtered to the rule book a unit belongs to. */
export const toPractiseHref = (actId: string): string => `/learn/review?act=${encodeURIComponent(actId)}`

/**
 * The unit id in a `/library/<workId>/<unitId>` path, or `null`.
 *
 * The inverse of `toUnitHref`, and it exists for one reason: the reader's
 * keyboard handler needs to know which unit it is on AT THE MOMENT A KEY IS
 * PRESSED, and no per-render value can tell it that.
 *
 * Both shapes were tried and both are wrong in the same way. A mount-only
 * listener reading a "latest ref" updated in an effect, and a listener
 * re-subscribed per unit, are BOTH swapped in a passive effect — so between
 * React Router committing a navigation and that effect running, the attached
 * handler still closes over the previous unit's neighbours. Press `j` then `k`
 * quickly from Rule 2 and you land on Rule 1: forward one, back two. It was
 * deterministic with the ref and merely flaky with the re-subscription, which
 * is worse, not better.
 *
 * `window.location.pathname` is updated synchronously by the navigation itself,
 * before any of that, so it is the one authoritative answer. Under
 * `MemoryRouter` it says nothing about the route, which is why the caller keeps
 * its rendered `unitId` as the fallback — and why the jsdom tests, where
 * effects flush between interactions anyway, still exercise the same code.
 */
export function unitIdFromPath(pathname: string, workId: string): string | null {
  const prefix = `/library/${encodeURIComponent(workId)}/`
  if (!pathname.startsWith(prefix)) return null
  const rest = pathname.slice(prefix.length)
  if (!rest || rest.includes('/')) return null
  try {
    return decodeURIComponent(rest)
  } catch {
    // A malformed percent-escape in the address bar is not a crash.
    return null
  }
}
