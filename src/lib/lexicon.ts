import lexicon from '../../scripts/ingest/lexicon.json'

import { foldRoman, romanKey } from './transliterate'

/**
 * The bilingual offence-and-procedure lexicon, read as a SYNONYM MAP.
 *
 * `scripts/ingest/lexicon.json` is hand-authored (86 terms, not scraped and not
 * machine-translated) and the Python ingest already uses it to attach keywords
 * to sections. The same file does a second job here, and it is the one that
 * makes bilingual search actually work rather than merely appear to.
 *
 * The problem it solves: a reader types "jamanat". The BNSS sections about bail
 * are headed "In what cases bail to be taken" and "Direction for grant of bail
 * to person apprehending arrest" — not one of them contains the string
 * "jamanat" in any script. Transliteration cannot bridge that, because the two
 * words are not the same word. A translation can, and the lexicon is a
 * translation table this repo already maintains.
 *
 * So each entry's `en`, `hi` and `roman` lists become one equivalence class:
 * "jamanat" ≡ "जमानत" ≡ "bail". The search expands a query through that class
 * and scores the expansion slightly worse than a direct hit, so a section
 * literally headed with the word the reader typed still comes first.
 *
 * NOTHING HERE IS SHOWN TO A READER. It is an index aid, exactly as the file's
 * own `$comment` says.
 */

interface LexiconTerm {
  id: string
  match: string[]
  en: string[]
  hi: string[]
  roman: string[]
}

interface Lexicon {
  version: string
  updated: string
  terms: LexiconTerm[]
}

const data = lexicon as Lexicon

/**
 * Folded term -> every other folded term in the same entry.
 *
 * A term can belong to more than one entry ("hatya" is in both `murder` and
 * `culpable-homicide`), and both sets are merged rather than one winning: the
 * reader who types it means either, and the ranking decides which is closer.
 */
function buildSynonyms(): Map<string, string[]> {
  const groups = new Map<string, Set<string>>()

  for (const term of data.terms) {
    const folded = new Set<string>()
    for (const value of [...term.en, ...term.hi, ...term.roman]) {
      const key = romanKey(value.replace(/\s+/g, ''))
      if (key.length >= 2) folded.add(key)
    }

    for (const key of folded) {
      const bucket = groups.get(key) ?? new Set<string>()
      for (const other of folded) if (other !== key) bucket.add(other)
      groups.set(key, bucket)
    }
  }

  return new Map([...groups].map(([key, values]) => [key, [...values]]))
}

export const SYNONYMS: ReadonlyMap<string, readonly string[]> = buildSynonyms()

/** The equivalence class of a folded query term, excluding the term itself. */
export function synonymsFor(folded: string): readonly string[] {
  return SYNONYMS.get(foldRoman(folded)) ?? []
}

export const LEXICON_VERSION = data.version
export const LEXICON_TERM_COUNT = data.terms.length
