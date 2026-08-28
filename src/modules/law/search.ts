import { CODE_FOR_OLD_ACT, LAW_CODES, OLD_ACT_FOR } from './data'
import { lookupOldSection, normaliseSectionRef, sectionBase } from './resolve'
import type { LawCode, LawCorpus, LawDataset, LawIndexEntry, LawSection, NewActId, OldActId } from './types'

import {
  buildSearchIndex,
  parseQuery,
  refBase,
  search,
  type Direction,
  type ParsedQuery,
  type SearchDoc,
  type SearchHit,
  type SearchIndex,
} from '@/lib/search'
import { foldRoman, romanKey } from '@/lib/transliterate'

/**
 * The law module's half of the search: it turns `data/law/*.json` into the
 * documents `src/lib/search.ts` ranks, and supplies the resolver that says
 * which section a number means.
 *
 * The engine knows nothing about the BNS. Everything below is what makes a
 * number an answer: which repealed Act a code pairs with, that a query naming
 * the IPC cannot also be asking about the BNS, and that a provision the new Act
 * simply dropped is a real answer rather than a miss.
 */

/** What a search hit points at. */
export interface LawDoc {
  code: LawCode
  act: NewActId
  section: string
  record: LawSection
}

export type LawSearchDoc = SearchDoc<LawDoc>
export type LawHit = SearchHit<LawDoc>

const NEW_ACTS: Readonly<Record<string, LawCode>> = { BNS: 'bns', BNSS: 'bnss', BSA: 'bsa' }
const OLD_ACTS: Readonly<Record<string, OldActId>> = { IPC: 'IPC', CrPC: 'CrPC', IEA: 'IEA' }

/**
 * `103` < `103A` < `104`. Section numbers carry letter suffixes (IPC 376AB,
 * CrPC 144A), and a plain numeric sort puts 376AB nowhere near 376.
 */
export function sortKeyFor(section: string): number {
  const match = /^(\d+)([A-Z]*)$/.exec(normaliseSectionRef(section))
  const number = Number.parseInt(match?.[1] ?? '0', 10)
  const suffix = match?.[2] ?? ''
  let rank = 0
  for (const char of suffix) rank = rank * 27 + (char.charCodeAt(0) - 64)
  return number * 1000 + Math.min(rank, 999)
}

/** Trim to a bounded slice: the excerpt exists to be matched on, not stored. */
const EXCERPT_CHARS = 400

function excerptOf(record: LawSection): string {
  return [record.text.en.slice(0, EXCERPT_CHARS), record.text.hi.slice(0, EXCERPT_CHARS)]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

/**
 * The curated keywords, folded to the common Latin skeleton.
 *
 * Deliberately NOT the heading — `src/lib/search.ts` scores a heading match far
 * above a keyword match, and mixing the two here would throw that distinction
 * away. See `SCORE` there for why it is the difference between BNS 303 and
 * BNS 42 for the query "theft".
 */
function romanTermsFor(record: LawSection): string[] {
  const terms = new Set<string>()
  const add = (value: string) => {
    const folded = romanKey(value.replace(/\s+/g, ''))
    if (folded.length >= 2) terms.add(folded)
  }

  for (const keyword of record.keywords.roman) add(foldRoman(keyword))
  for (const keyword of record.keywords.hi) add(keyword)
  for (const keyword of record.keywords.en) add(keyword)

  return [...terms]
}

/** Words that carry no meaning on their own and would match everything. */
const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'of',
  'to',
  'in',
  'or',
  'by',
  'with',
  'etc',
  'certain',
  'other',
  'का',
  'की',
  'के',
  'को',
  'में',
  'से',
  'पर',
  'तथा',
  'एवं',
  'और',
  'लिए',
  'हेतु',
])

/**
 * Each heading, whole; and each heading, word by word. Both folded.
 *
 * THE REPEALED PROVISION'S HEADING COUNTS AS A HEADING. Someone searching for
 * "cheating and dishonestly inducing delivery of property" is searching the IPC
 * wording of a provision that is now called "Cheating", and those words appear
 * nowhere in the new Act. They are indexed here rather than as Fuse keys
 * because Fuse scores by scanning every field of every document: adding 534
 * repealed headings to the fuzzy corpus took a single search from 120 ms to
 * 785 ms, and the exact-and-prefix term index answers this at map-lookup cost.
 */
interface HeadingTerms {
  keys: string[]
  words: string[]
  oldKeys: string[]
  oldWords: string[]
  size: number
}

function headingTermsFor(record: LawSection): HeadingTerms {
  const keys: string[] = []
  const words = new Set<string>()
  const oldKeys: string[] = []
  const oldWords = new Set<string>()
  let size = Number.POSITIVE_INFINITY

  const collect = (heading: string, intoKeys: string[], intoWords: Set<string>, own: boolean) => {
    if (!heading.trim()) return
    const whole = romanKey(heading.replace(/\s+/g, ''))
    if (whole.length >= 2) intoKeys.push(whole)

    const parts = heading.split(/[\s।,.;:()"'-]+/).filter(Boolean)
    // The size tie-break describes THIS section's heading, so only its own
    // English and Hindi may set it.
    if (own) size = Math.min(size, parts.length)

    for (const part of parts) {
      if (part.length < 3 || STOP_WORDS.has(part.toLowerCase())) continue
      const folded = romanKey(part)
      if (folded.length >= 2) intoWords.add(folded)
    }
  }

  collect(record.heading.en, keys, words, true)
  collect(record.heading.hi, keys, words, true)
  for (const mapping of record.mappings) {
    for (const old of mapping.old) {
      collect(old.heading.en, oldKeys, oldWords, false)
      collect(old.heading.hi, oldKeys, oldWords, false)
    }
  }

  // A word that is in both is the section's own — the stronger of the two.
  for (const word of words) oldWords.delete(word)

  return {
    keys,
    words: [...words],
    oldKeys: oldKeys.filter((key) => !keys.includes(key)),
    oldWords: [...oldWords],
    size: Number.isFinite(size) ? size : 20,
  }
}

/** One searchable document per section of the three new Acts — 1,059 in all. */
export function buildDocs(corpus: LawCorpus): LawSearchDoc[] {
  const docs: LawSearchDoc[] = []

  for (const code of LAW_CODES) {
    const dataset = corpus.datasets[code]
    for (const record of Object.values(dataset.sections)) {
      const oldRefs = new Set<string>()
      for (const mapping of record.mappings) {
        for (const old of mapping.old) {
          oldRefs.add(normaliseSectionRef(old.section))
          oldRefs.add(normaliseSectionRef(old.base))
        }
      }
      for (const repealed of record.repeals) oldRefs.add(normaliseSectionRef(repealed))

      const headingTerms = headingTermsFor(record)

      docs.push({
        id: `${code}:${record.section}`,
        code,
        section: record.section,
        sortKey: sortKeyFor(record.section),
        oldRefs: [...oldRefs],
        headingEn: record.heading.en,
        headingHi: record.heading.hi,
        keywords: [...record.keywords.en, ...record.keywords.hi, ...record.keywords.roman],
        roman: romanTermsFor(record),
        headingKeys: headingTerms.keys,
        headingWords: headingTerms.words,
        oldHeadingKeys: headingTerms.oldKeys,
        oldHeadingWords: headingTerms.oldWords,
        headingSize: headingTerms.size,
        excerpt: excerptOf(record),
        ref: { code, act: record.act, section: record.section, record },
      })
    }
  }

  return docs
}

/* ------------------------------------------------------------------ *
 * Resolving a section reference
 * ------------------------------------------------------------------ */

/**
 * Which code pairs a query is asking about.
 *
 * An Act named in the query pins it to one. A code chip pins it to one. With
 * neither, all three are searched — "154" is a real question with two good
 * answers (CrPC 154 → BNSS 173, and BNSS 154), and hiding one of them is how a
 * reader ends up citing the wrong Sanhita.
 */
function codesFor(parsed: ParsedQuery, restrictTo: LawCode | undefined): LawCode[] {
  if (parsed.code && (!restrictTo || parsed.code === restrictTo)) return [parsed.code as LawCode]
  if (restrictTo) return [restrictTo]
  return [...LAW_CODES]
}

/**
 * True when the query names an Act that rules this direction out.
 *
 * "IPC 302" read as new → old would be a question about BNS 302, which the
 * reader plainly did not ask. Naming an Act is the one signal strong enough to
 * suppress the other reading entirely.
 */
function directionContradicted(parsed: ParsedQuery, direction: Direction): boolean {
  if (!parsed.act) return false
  const namesOldAct = parsed.act in OLD_ACTS
  return direction === (namesOldAct ? 'new-old' : 'old-new')
}

export interface LawResolvers {
  /** Documents a section reference resolves to, in one direction. */
  resolveSection: (parsed: ParsedQuery, direction: Direction) => LawSearchDoc[]
  /**
   * Repealed-Act sections the new Act dropped outright. A real answer, and the
   * one case where an empty result list is the correct output.
   */
  droppedProvisions: (parsed: ParsedQuery, direction: Direction) => DroppedProvision[]
}

/** A repealed-Act provision with no counterpart at all. */
export interface DroppedProvision {
  oldAct: OldActId
  section: string
  entry: LawIndexEntry
}

export function makeResolvers(corpus: LawCorpus, docs: ReadonlyArray<LawSearchDoc>): LawResolvers {
  const byId = new Map(docs.map((doc) => [doc.id, doc]))

  const docFor = (code: LawCode, section: string): LawSearchDoc | undefined =>
    byId.get(`${code}:${normaliseSectionRef(section)}`) ?? byId.get(`${code}:${sectionBase(section)}`)

  return {
    resolveSection(parsed, direction) {
      const ref = parsed.sectionRef
      if (!ref || directionContradicted(parsed, direction)) return []

      const out: LawSearchDoc[] = []
      const seen = new Set<string>()
      const push = (doc: LawSearchDoc | undefined) => {
        if (!doc || seen.has(doc.id)) return
        seen.add(doc.id)
        out.push(doc)
      }

      if (direction === 'old-new') {
        for (const code of codesFor(parsed, undefined)) {
          const entry = lookupOldSection(corpus.index, OLD_ACT_FOR[code], ref)
          if (!entry) continue
          for (const newRef of entry.newSections) push(docFor(code, newRef))
        }
      } else {
        for (const code of codesFor(parsed, undefined)) push(docFor(code, ref))
      }

      return out
    },

    droppedProvisions(parsed, direction) {
      const ref = parsed.sectionRef
      if (!ref || direction !== 'old-new' || directionContradicted(parsed, direction)) return []

      const out: DroppedProvision[] = []
      for (const code of codesFor(parsed, undefined)) {
        const oldAct = OLD_ACT_FOR[code]
        const entry = lookupOldSection(corpus.index, oldAct, ref)
        if (entry && entry.newSections.length === 0) out.push({ oldAct, section: refBase(ref), entry })
      }
      return out
    },
  }
}

/* ------------------------------------------------------------------ *
 * The whole search, in one call
 * ------------------------------------------------------------------ */

/**
 * Documents, the Fuse index and the resolvers, built once per corpus.
 *
 * Fuse builds its own inverted index at construction over all 1,059 records, so
 * this is the expensive step and it must not run per keystroke.
 */
export interface LawSearchEngine {
  docs: LawSearchDoc[]
  index: SearchIndex<LawDoc>
  resolvers: LawResolvers
  corpus: LawCorpus
  /**
   * The 34 repealed provisions with no counterpart at all, kept as their own
   * small list. They have no section record and therefore no document, so
   * without this a search for "adultery" or "sedition" would return a page of
   * loosely-related headings and no mention of the fact that the provision was
   * repealed and nothing replaced it — the worst possible answer here.
   */
  dropped: DroppedProvision[]
}

export function buildEngine(corpus: LawCorpus): LawSearchEngine {
  const docs = buildDocs(corpus)
  const dropped: DroppedProvision[] = []
  for (const [oldAct, act] of Object.entries(corpus.index.acts)) {
    for (const [section, entry] of Object.entries(act.entries)) {
      if (entry.newSections.length === 0) {
        dropped.push({ oldAct: oldAct as OldActId, section, entry })
      }
    }
  }

  return {
    docs,
    index: buildSearchIndex(docs),
    resolvers: makeResolvers(corpus, docs),
    corpus,
    dropped,
  }
}

export interface LawSearchResult {
  parsed: ParsedQuery
  hits: LawHit[]
  dropped: DroppedProvision[]
  /** The direction actually used, after the query's own hint is applied. */
  direction: Direction
}

export interface LawSearchRequest {
  query: string
  code?: LawCode | undefined
  direction: Direction
  /** When false, an Act named in the query cannot flip the direction. */
  followQueryDirection?: boolean
}

/**
 * `"sec 438 crpc"` → the parse, the direction it implies, and the ranked hits.
 *
 * The query's own Act name overrides the toggle unless the caller has pinned
 * it: typing "crpc 438" while the toggle says New → Old is not a mistake the
 * reader wants honoured literally.
 */
export function searchLaw(engine: LawSearchEngine, request: LawSearchRequest): LawSearchResult {
  const parsed = parseQuery(request.query)
  const direction =
    request.followQueryDirection !== false && parsed.direction ? parsed.direction : request.direction

  const hits = search(engine.index, parsed, {
    code: request.code,
    direction,
    resolveSection: (query, dir) => engine.resolvers.resolveSection(query, dir),
  })

  const dropped = engine.resolvers.droppedProvisions(parsed, direction)
  const byNumber = new Set(dropped.map((provision) => `${provision.oldAct}:${provision.section}`))

  // A dropped provision can only be reached by its number above. Match its
  // heading too, so "adultery" and "attempt to commit suicide" find the answer
  // that matters rather than a list of near misses.
  const needle = parsed.text.trim().toLowerCase()
  if (needle.length >= 4) {
    for (const provision of engine.dropped) {
      const key = `${provision.oldAct}:${provision.section}`
      if (byNumber.has(key)) continue
      if (provision.entry.heading.en.toLowerCase().includes(needle)) {
        byNumber.add(key)
        dropped.push(provision)
      }
    }
  }

  return {
    parsed,
    hits,
    dropped: dropped.filter(
      (provision) => !request.code || CODE_FOR_OLD_ACT[provision.oldAct] === request.code,
    ),
    direction,
  }
}

/**
 * Every section of one code, in number order, as ordinary hits.
 *
 * This is what a code chip does when the search box is empty: browsing an Act
 * is a real way to use a law reference, and the chips previously selected a
 * filter over nothing. It is deliberately NOT what happens on a bare `/law` —
 * the reader has to pick a code, because that keeps the 3.9 MB behind an
 * explicit action (ADR-013) rather than downloading it for anyone who opens
 * the page.
 *
 * The reason is `'text'` with the worst possible score so that these never
 * outrank a real match: the list is re-derived the moment anything is typed.
 */
export function browseCode(engine: LawSearchEngine, code: LawCode): LawHit[] {
  return engine.docs
    .filter((doc) => doc.code === code)
    .sort((a, b) => a.sortKey - b.sortKey)
    .map((doc) => ({ doc, reason: 'text' as const, score: 1 }))
}

/** The dataset a hit belongs to — for its Act names, sources and disclaimer. */
export function datasetFor(corpus: LawCorpus, code: LawCode): LawDataset {
  return corpus.datasets[code]
}

/** The new Act a document belongs to, as an Act id. */
export function actOf(code: LawCode): NewActId {
  const entry = Object.entries(NEW_ACTS).find(([, value]) => value === code)
  return (entry?.[0] ?? 'BNS') as NewActId
}
