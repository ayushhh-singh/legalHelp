import Fuse from 'fuse.js'
import type { IFuseOptions } from 'fuse.js'

import type { LibraryCorpus, LibraryUnit } from './types'

import type { LibraryIndexEntry } from '@/schemas/library'

/**
 * Search inside one work, and across the shelf.
 *
 * `fuse.js` used the ordinary way, like the glossary's own search and unlike
 * the Law Converter's banded ranking (`src/lib/search.ts`): a reader searching
 * inside a rule book is looking for a phrase in long prose, which is exactly
 * what fuzzy matching over a weighted index is for, and there is no equivalent
 * of the law module's "a curated keyword attaches to 26 sections" problem to
 * rank around.
 *
 * BOTH LANGUAGES ARE INDEXED, always, regardless of which one the reader is
 * reading in. Fifteen of fifteen works carry English text and no Hindi text at
 * all (no Ministry publishes a readable Hindi text layer — ADR-023), while
 * every heading has authored or curated Hindi. A Hindi reader searching
 * "आचरण" must reach the heading; an English reader searching "integrity" must
 * reach the body. Indexing only the reader's own language would make one of
 * those two searches silently find nothing.
 */

interface IndexedUnit {
  unit: LibraryUnit
  number: string
  headingEn: string
  headingHi: string
  body: string
}

export interface WorkSearchIndex {
  workId: string
  fuse: Fuse<IndexedUnit>
  /** The same records the index holds, for the exact number match below. */
  entries: readonly IndexedUnit[]
  count: number
}

const FUSE_OPTIONS: IFuseOptions<IndexedUnit> = {
  includeScore: true,
  // A statutory paragraph is long and the phrase can be anywhere in it;
  // `ignoreLocation` is what stops fuse discounting a hit near the end.
  ignoreLocation: true,
  threshold: 0.3,
  minMatchCharLength: 3,
  keys: [
    { name: 'number', weight: 4 },
    { name: 'headingEn', weight: 3 },
    { name: 'headingHi', weight: 3 },
    { name: 'body', weight: 1 },
  ],
}

/**
 * `unit.parts` is deliberately NOT indexed: it is a verbatim re-segmentation of
 * the same text the body is built from (see `LibraryUnit.parts`), so including
 * it would double the index and let one rule out-score another purely for
 * having sub-rules.
 */
const bodyOf = (unit: LibraryUnit): string => [...unit.body.en, ...unit.body.hi].filter(Boolean).join(' ')

export function buildWorkSearchIndex(corpus: LibraryCorpus): WorkSearchIndex {
  const indexed: IndexedUnit[] = []
  for (const id of corpus.order) {
    const unit = corpus.units.get(id)
    if (!unit) continue
    indexed.push({
      unit,
      number: unit.number,
      headingEn: unit.heading.en,
      headingHi: unit.heading.hi,
      body: bodyOf(unit),
    })
  }
  return {
    workId: corpus.workId,
    fuse: new Fuse(indexed, FUSE_OPTIONS),
    entries: indexed,
    count: indexed.length,
  }
}

export interface WorkSearchHit {
  unit: LibraryUnit
  /** The first line of body text containing the query, for the result row. */
  snippet: string
}

/** How many characters of context sit either side of a match in a snippet. */
const SNIPPET_PAD = 70

function snippetFor(unit: LibraryUnit, query: string): string {
  const haystack = [...unit.body.en, ...unit.body.hi].filter(Boolean)
  const needle = query.trim().toLowerCase()
  for (const paragraph of haystack) {
    const at = paragraph.toLowerCase().indexOf(needle)
    if (at < 0) continue
    const from = Math.max(0, at - SNIPPET_PAD)
    const to = Math.min(paragraph.length, at + needle.length + SNIPPET_PAD)
    return (from > 0 ? '…' : '') + paragraph.slice(from, to).trim() + (to < paragraph.length ? '…' : '')
  }
  // A fuzzy hit that no literal substring search can locate — the heading
  // matched, or the spelling differed. The opening of the unit is honest
  // context; claiming a match that is not there would not be.
  return (haystack[0] ?? '').slice(0, SNIPPET_PAD * 2)
}

/**
 * A query that is (or starts with) a unit number, matched exactly first.
 *
 * `fuse`'s `minMatchCharLength` is 3, so a two-character query never reaches
 * the index at all — and "11" inside a rule book is the single most obvious
 * thing a reader types. Worse, fuzzy-matching a numeral against 4,000-character
 * paragraphs full of numbers is noise even when it does run. So a numeric query
 * is answered by an exact match, then a prefix match, on the unit's own printed
 * number, and only then handed to fuse for anything else it can find.
 *
 * `11` must not match `110` ahead of `11`, and `F.R. 11` must be reachable by
 * typing `11` — which is why this compares against the numeral part rather
 * than the whole printed number.
 */
const NUMERIC = /^\d+[A-Za-z]{0,2}$/

const numeralOf = (number: string): string => (/\d/.exec(number) ? number.replace(/^\D+/, '') : number)

function numberHits(index: WorkSearchIndex, needle: string): IndexedUnit[] {
  const wanted = needle.toUpperCase()
  const exact: IndexedUnit[] = []
  const prefixed: IndexedUnit[] = []
  for (const entry of index.entries) {
    const numeral = numeralOf(entry.number).toUpperCase()
    if (numeral === wanted) exact.push(entry)
    else if (numeral.startsWith(wanted)) prefixed.push(entry)
  }
  return [...exact, ...prefixed]
}

/**
 * `limit` bounds what is RENDERED, not what is matched. The same decision
 * `GlossaryPage`'s `MAX_RENDERED` records: a 531-section result list ran
 * `axe.run()` past its timeout, and narrowing the query still reaches
 * everything.
 */
/**
 * Whether a query is worth running at all.
 *
 * One character of prose matches most of a rule book and means nothing. One
 * DIGIT is Rule 3, and refusing it would make the most direct thing a reader
 * can type the one thing that does not work.
 *
 * Exported because the page has to make the same decision BEFORE this runs —
 * it is what gates the 1.9 MB corpus load — and two copies of the rule would
 * eventually disagree about which queries reach the index.
 */
export function isSearchable(query: string): boolean {
  const needle = query.trim()
  return needle.length >= 2 || (needle.length === 1 && NUMERIC.test(needle))
}

export function searchWithin(index: WorkSearchIndex, query: string, limit = 50): WorkSearchHit[] {
  const needle = query.trim()
  const numeric = NUMERIC.test(needle)
  if (!isSearchable(needle)) return []

  const seen = new Set<string>()
  const ordered: IndexedUnit[] = []
  const take = (entry: IndexedUnit) => {
    if (seen.has(entry.unit.id)) return
    seen.add(entry.unit.id)
    ordered.push(entry)
  }

  if (numeric) for (const entry of numberHits(index, needle)) take(entry)
  // fuse's own minMatchCharLength refuses anything under three characters, so
  // a short numeric query is answered by the exact pass alone — which is the
  // right answer for it anyway.
  if (needle.length >= 2) for (const hit of index.fuse.search(needle, { limit })) take(hit.item)

  return ordered
    .slice(0, limit)
    .map((entry) => ({ unit: entry.unit, snippet: snippetFor(entry.unit, needle) }))
}

export interface ShelfSearchGroup {
  work: LibraryIndexEntry
  hits: WorkSearchHit[]
}

/**
 * Across works, grouped per work — which is what the brief asks for and also
 * the only presentation that makes sense: "Rule 3" means something different in
 * each of fifteen books, so a flat merged list would be a list of ambiguities.
 *
 * The caller supplies the indexes it has already built. This function does NOT
 * load fifteen corpora: 5.5 MB of statute to answer one search box is not a
 * trade this app makes, and `useLibrarySearch` loads a work's corpus only once
 * the reader has opened that work or asked for the shelf-wide search
 * explicitly.
 */
export function searchAll(
  works: readonly LibraryIndexEntry[],
  indexes: ReadonlyMap<string, WorkSearchIndex>,
  query: string,
  perWork = 5,
): ShelfSearchGroup[] {
  const groups: ShelfSearchGroup[] = []
  for (const work of works) {
    const index = indexes.get(work.id)
    if (!index) continue
    const hits = searchWithin(index, query, perWork)
    if (hits.length > 0) groups.push({ work, hits })
  }
  // Most hits first: a query that matches one book twenty times and another
  // once is telling the reader which book it is about.
  return groups.sort((a, b) => b.hits.length - a.hits.length)
}
