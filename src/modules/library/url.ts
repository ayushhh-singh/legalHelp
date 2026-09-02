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
