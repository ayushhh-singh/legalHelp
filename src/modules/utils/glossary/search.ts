import Fuse from 'fuse.js'
import type { IFuseOptions } from 'fuse.js'

import type { Glossary, GlossaryCategory, GlossaryTerm } from './schema'

import { romanKey } from '@/lib/transliterate'

/**
 * Instant search over the glossary: English, Hindi, and roman-Hindi ("avar
 * sachiv" finding अवर सचिव), plus an optional category filter.
 *
 * Unlike `src/lib/search.ts` (the law module's banded ranking over 1,059
 * sections of statute, deliberately rejected here — DECISIONS.md notes
 * `fuse.js` is for a corpus that needs FUZZY matching over long text; a flat
 * glossary of short terms does not), this is `fuse.js` used the ordinary way:
 * one index, one set of weighted keys, its own scoring. `roman` is not typed
 * by anyone — it is `romanKey()` applied once at index time to `en`, `hi` and
 * every `alsoHi` rendering, folded exactly the way the query is folded at
 * search time, so a roman-Hindi query and a Devanagari entry meet in the same
 * skeleton (`src/lib/transliterate.ts` — "NOTHING HERE IS PRESENTED AS THE
 * TERM'S OWN WORDS. It is an index aid.").
 */

interface IndexedTerm {
  term: GlossaryTerm
  en: string
  hi: string
  alsoHi: string
  roman: string
}

export interface GlossaryIndex {
  fuse: Fuse<IndexedTerm>
  all: readonly GlossaryTerm[]
}

const FUSE_OPTIONS: IFuseOptions<IndexedTerm> = {
  includeScore: true,
  ignoreLocation: true,
  threshold: 0.32,
  minMatchCharLength: 2,
  keys: [
    { name: 'en', weight: 3 },
    { name: 'hi', weight: 3 },
    { name: 'alsoHi', weight: 2 },
    { name: 'roman', weight: 2 },
  ],
}

function toIndexed(term: GlossaryTerm): IndexedTerm {
  const alsoHi = (term.alsoHi ?? []).join(' ')
  const roman = [term.en, term.hi, ...(term.alsoHi ?? [])].map(romanKey).join(' ')
  return { term, en: term.en, hi: term.hi, alsoHi, roman }
}

export function buildGlossaryIndex(glossary: Glossary): GlossaryIndex {
  const indexed = glossary.terms.map(toIndexed)
  return { fuse: new Fuse(indexed, FUSE_OPTIONS), all: glossary.terms }
}

/**
 * `query` is matched two ways and the results merged, exact-first: an exact or
 * prefix hit on `en`/`hi` (what a reader typing a whole term expects to see
 * first) ranked ahead of Fuse's own fuzzy order, then the remainder of Fuse's
 * hits. An empty query returns every term in the category, in dataset order.
 */
export function searchGlossary(
  index: GlossaryIndex,
  query: string,
  category: GlossaryCategory | 'all' = 'all',
): GlossaryTerm[] {
  const inCategory = (term: GlossaryTerm) => category === 'all' || term.category === category
  const needle = query.trim()

  if (!needle) return index.all.filter(inCategory)

  const lower = needle.toLowerCase()
  const foldedQuery = romanKey(needle)

  const hits = index.fuse.search(needle).concat(index.fuse.search(foldedQuery))
  const seen = new Set<string>()
  const ranked: { term: GlossaryTerm; rank: number }[] = []

  for (const hit of hits) {
    if (seen.has(hit.item.term.id)) continue
    seen.add(hit.item.term.id)
    const en = hit.item.en.toLowerCase()
    const hi = hit.item.hi
    const exact = en === lower || hi === needle
    const prefix = en.startsWith(lower) || hi.startsWith(needle)
    const rank = exact ? 0 : prefix ? 1 : 2 + (hit.score ?? 1)
    ranked.push({ term: hit.item.term, rank })
  }

  return ranked
    .filter((entry) => inCategory(entry.term))
    .sort((a, b) => a.rank - b.rank)
    .map((entry) => entry.term)
}
