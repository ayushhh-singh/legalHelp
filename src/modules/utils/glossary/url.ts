/**
 * A shareable link to one glossary term.
 *
 * `/utils/glossary?term=<id>` — the same shape the Law Converter and the Pay
 * calculator use for a share link (`toLawHref`, `toPayHref`): the id is
 * enough to find the term again once `data/glossary.json` has loaded,
 * `GlossaryPage.tsx` reads it on mount and puts the term's own English text
 * into the search box, which is what actually surfaces it — there is no
 * separate "focused term" state to keep in sync with the search the reader
 * might type next.
 */
export function toGlossaryHref(termId: string): string {
  return `/utils/glossary?term=${encodeURIComponent(termId)}`
}

export function parseGlossaryTermParam(params: URLSearchParams): string | null {
  const term = params.get('term')
  return term && term.trim() ? term.trim() : null
}
