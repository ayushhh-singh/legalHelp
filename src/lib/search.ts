import Fuse, { type IFuseOptions } from 'fuse.js'

import { synonymsFor } from './lexicon'
import { foldRoman, hasDevanagari, hasLatin, romanKey, toDevanagari } from './transliterate'

/**
 * The search engine behind the Law Converter.
 *
 * It is deliberately generic over its documents: nothing here imports a
 * dataset, and the only law-specific knowledge is the vocabulary of Act names
 * in `ACT_TOKENS`, which is data rather than logic. `src/modules/law/search.ts`
 * supplies the documents and the section resolver.
 *
 * Two properties matter more than everything else here:
 *
 *  1. **An exact section number always wins.** Someone who types "302" wants
 *     the section, not the twelve headings that mention murder. Fuzzy matching
 *     runs only underneath the exact ranks, never in front of them.
 *  2. **Script never decides whether a match is possible.** English, Hindi and
 *     roman-Hindi ("hatya") reach the same records, because every term on both
 *     sides is folded to a common Latin skeleton by `romanKey` before it is
 *     compared. See src/lib/transliterate.ts.
 */

export type Direction = 'old-new' | 'new-old'

/* ------------------------------------------------------------------ *
 * Query parsing
 * ------------------------------------------------------------------ */

/**
 * How a query names an Act. `direction` is what a mention implies: naming a
 * repealed Act means "I have an old number, give me the new one".
 *
 * Ordered longest-first within each entry's `match` list, and the list itself
 * is scanned in order, so `bnss` is tested before `bns` — otherwise every
 * "bnss 173" would parse as the BNS.
 */
interface ActToken {
  act: string
  code: string
  direction: Direction | null
  match: readonly string[]
}

export const ACT_TOKENS: readonly ActToken[] = [
  {
    act: 'BNSS',
    code: 'bnss',
    direction: 'new-old',
    match: [
      'bnss',
      'b.n.s.s',
      'bharatiya nagarik suraksha sanhita',
      'nagarik suraksha sanhita',
      'nagarik suraksha',
      'बीएनएसएस',
      'नागरिक सुरक्षा संहिता',
      'नागरिक सुरक्षा',
    ],
  },
  {
    act: 'BNS',
    code: 'bns',
    direction: 'new-old',
    match: [
      'bns',
      'b.n.s',
      'bharatiya nyaya sanhita',
      'nyaya sanhita',
      'nyay sanhita',
      'बीएनएस',
      'न्याय संहिता',
      'भा.न्या.सं.',
    ],
  },
  {
    act: 'BSA',
    code: 'bsa',
    direction: 'new-old',
    match: ['bsa', 'b.s.a', 'bharatiya sakshya adhiniyam', 'sakshya adhiniyam', 'बीएसए', 'भा.सा.अ.'],
  },
  {
    act: 'CrPC',
    code: 'bnss',
    direction: 'old-new',
    match: [
      'crpc',
      'cr.p.c',
      'cr p c',
      'code of criminal procedure',
      'criminal procedure code',
      'criminal procedure',
      'सीआरपीसी',
      'दंड प्रक्रिया संहिता',
      'दण्ड प्रक्रिया संहिता',
      'दंप्रसं',
      'द.प्र.सं.',
    ],
  },
  {
    act: 'IPC',
    code: 'bns',
    direction: 'old-new',
    match: [
      'ipc',
      'i.p.c',
      'indian penal code',
      'penal code',
      'आईपीसी',
      'भारतीय दंड संहिता',
      'भारतीय दण्ड संहिता',
      'दंड संहिता',
      'दण्ड संहिता',
      'भादंसं',
      'भा.दं.सं.',
    ],
  },
  {
    act: 'IEA',
    code: 'bsa',
    direction: 'old-new',
    match: [
      'iea',
      'i.e.a',
      'indian evidence act',
      'evidence act',
      'आईईए',
      'भारतीय साक्ष्य अधिनियम, 1872',
      'साक्ष्य अधिनियम, 1872',
    ],
  },
  {
    // "साक्ष्य अधिनियम" with no year names BOTH the IEA (1872) and the BSA
    // (2023) — the two Acts differ by a year and nothing else. It picks the
    // code, and deliberately implies no direction: guessing one would silently
    // answer a question the reader did not ask.
    //
    // The bare words "साक्ष्य" and "evidence" are NOT here, deliberately. They
    // are the commonest search terms in this area of law, and treating one as
    // an Act name consumed the whole query and returned nothing at all.
    act: '',
    code: 'bsa',
    direction: null,
    match: ['साक्ष्य अधिनियम'],
  },
]

/**
 * "s", "sec.", "u/s", "धारा" — noise in front of a number.
 *
 * The trailing `(?=\d)` is load-bearing. Without it the `s` alternative matches
 * the first letter of any word beginning with one: "suicide" became "uicide"
 * and "sedition" became "edition", silently, and the search still returned
 * plausible-looking fuzzy results for both. These prefixes only ever mean
 * "section" when a number follows, so requiring one is both the fix and the
 * accurate rule.
 */
const SECTION_PREFIX =
  /(?:^|\s)(?:u\s*\/\s*s|under\s+sections?|sections?|secs?\.?|ss?\.?|धाराओं|धाराएँ|धाराएं|धारा|अनुभाग)\s*[.:\-–]?\s*(?=\d)/gi

/** `302`, `103(1)`, `124A`, `2(f)`, `376AB`. */
const SECTION_REF = /^\d{1,4}[A-Za-z]{0,2}(?:\([0-9A-Za-z]{1,4}\))*$/

export type Script = 'latin' | 'devanagari' | 'mixed' | 'none'

export interface ParsedQuery {
  /** Exactly what the reader typed. */
  raw: string
  /** Whitespace-collapsed, NFC. */
  normalised: string
  /** `"103(1)"` — upper-cased, spaces removed — or null. */
  sectionRef: string | null
  /** The section number alone: `"103"`. */
  sectionBase: string | null
  /** `'IPC'`, `'BNS'`, … when the query names an Act. */
  act: string | null
  /** Which of the three code pairs the named Act belongs to. */
  code: string | null
  /** The direction the named Act implies, if it implies one. */
  direction: Direction | null
  /** What is left once the Act name and the section reference are removed. */
  text: string
  script: Script
}

function detectScript(input: string): Script {
  const devanagari = hasDevanagari(input)
  const latin = hasLatin(input)
  if (devanagari && latin) return 'mixed'
  if (devanagari) return 'devanagari'
  if (latin) return 'latin'
  return 'none'
}

/** `"318 (4)"`, `"318( 4 )"` and `"318(4)"` are one reference. */
export function normaliseRef(input: string): string {
  return input.normalize('NFKC').replace(/\s+/g, '').replace(/\.$/, '').toUpperCase()
}

/** `"318(4)"` -> `"318"`. Datasets are keyed by the section number alone. */
export function refBase(ref: string): string {
  return /^(\d{1,4}[A-Z]{0,2})/.exec(normaliseRef(ref))?.[1] ?? normaliseRef(ref)
}

/**
 * Pull the structure out of a free-text query.
 *
 * The order matters: Act names are removed first (they contain digits in
 * "1860" and letters that would otherwise read as a section suffix), then
 * section prefixes, and only then is what remains tested for a section
 * reference. Anything still left over is the text search.
 */
export function parseQuery(input: string): ParsedQuery {
  const normalised = input.normalize('NFC').replace(/\s+/g, ' ').trim()
  let rest = ` ${normalised.toLowerCase()} `

  let act: string | null = null
  let code: string | null = null
  let direction: Direction | null = null

  for (const token of ACT_TOKENS) {
    const hit = token.match.find((needle) => rest.includes(needle.toLowerCase()))
    if (!hit) continue
    // Only the first Act named counts. "IPC 302 BNS" is one reference with a
    // stray word, not two questions.
    act = token.act || null
    code = token.code
    direction = token.direction
    rest = rest.replace(hit.toLowerCase(), ' ')
    break
  }

  // Drop the year an Act name may have carried in with it, so "IPC 1860 302"
  // does not read as section 1860.
  rest = rest.replace(/\b(?:1860|1872|1973|2023)\b/g, ' ')
  rest = rest.replace(SECTION_PREFIX, ' ')
  // "318 (4)" is one reference, and people type it with the space. Closing it
  // up here rather than in the tokeniser keeps the reference in one token.
  rest = rest.replace(/\s*\(\s*/g, '(').replace(/\s*\)/g, ')')

  const tokens = rest.split(/[\s,;]+/).filter(Boolean)
  const refToken = tokens.find((token) => SECTION_REF.test(normaliseRef(token)))
  const sectionRef = refToken ? normaliseRef(refToken) : null

  const text = tokens
    .filter((token) => token !== refToken)
    .join(' ')
    .trim()

  return {
    raw: input,
    normalised,
    sectionRef,
    sectionBase: sectionRef ? refBase(sectionRef) : null,
    act,
    code,
    direction,
    text,
    script: detectScript(normalised),
  }
}

/* ------------------------------------------------------------------ *
 * Documents and the index
 * ------------------------------------------------------------------ */

/**
 * One searchable record. The caller builds these; `buildSearchIndex` only ever
 * reads the fields below, so the law module can hang whatever it likes off
 * `ref` without this file knowing about it.
 */
export interface SearchDoc<T = unknown> {
  id: string
  /** Which of the three code pairs this record belongs to. */
  code: string
  /** The new Act's own section number, e.g. `"103"`. */
  section: string
  /** For stable ordering: `103` sorts before `103A` sorts before `104`. */
  sortKey: number
  /** Normalised references in the repealed Act this record answers to. */
  oldRefs: readonly string[]
  headingEn: string
  headingHi: string
  /** Every keyword, in every script, as written. */
  keywords: readonly string[]
  /** The curated keywords, folded to their Latin skeleton (transliterate.ts). */
  roman: readonly string[]
  /** Each heading, whole, folded. `"Theft."` -> `"theft"`. */
  headingKeys: readonly string[]
  /** Each significant word of each heading, folded. */
  headingWords: readonly string[]
  /** The same, for the headings of the REPEALED provisions this one replaced. */
  oldHeadingKeys: readonly string[]
  oldHeadingWords: readonly string[]
  /** Words in the shorter heading — the tie-break between two heading matches. */
  headingSize: number
  /**
   * A leading slice of the section text, ALREADY LOWER-CASED — the body-text
   * pass is a substring scan over 1,059 of these on every keystroke, and
   * lower-casing them there would allocate a megabyte of strings per search.
   */
  excerpt: string
  ref: T
}

/**
 * Fuzzy matching runs over HEADINGS AND KEYWORDS ONLY.
 *
 * The section text is deliberately not a Fuse key. Fuse scores with a bitap
 * pass per field per document, and 1,059 records carrying 800 characters of
 * statute each made a single keystroke cost 120-570 ms — measured, not
 * guessed. The body text is still searchable, by a plain substring scan in
 * `bodyMatches` below, which is two orders of magnitude cheaper and is the
 * right tool for what it is actually used for: finding "zero FIR" or "sixty
 * days" somewhere inside a provision.
 *
 * `ignoreLocation` is required: without it Fuse only scores matches near the
 * start of a field, and a keyword list is not a sentence.
 */
const FUSE_OPTIONS: IFuseOptions<SearchDoc<unknown>> = {
  includeScore: true,
  ignoreLocation: true,
  threshold: 0.38,
  minMatchCharLength: 2,
  keys: [
    { name: 'headingEn', weight: 3 },
    { name: 'headingHi', weight: 3 },
    // `keywords` is deliberately absent: `roman` is the same list folded, and
    // indexing both doubled Fuse's work for a second copy of the same strings.
    // Exact and prefix matches on the raw keywords are answered by `terms`.
    { name: 'roman', weight: 2.5 },
    { name: 'section', weight: 1 },
  ],
}

/**
 * THE SCORE TABLE. Everything about how results are ordered is in these six
 * numbers, and each one is a claim about the law rather than about search.
 *
 * The claim that matters is that A HEADING IS WORTH MORE THAN A KEYWORD. The
 * lexicon in `scripts/ingest/lexicon.json` attaches a term to a section
 * whenever it appears in that section's heading *or its text*, so 26 sections
 * carry the keyword "theft" — every one of them correctly, and only one of them
 * is the offence of theft. Ranking a curated keyword as highly as a heading put
 * BNS 42 (abetment) above BNS 303 (theft) for the query "theft", which is not a
 * near miss; it is the wrong answer at the top of the page.
 *
 * `HEADING_SIZE_PENALTY` is the tie-break between two heading matches: "Theft."
 * beats "Punishment for theft." for the query "theft", because a shorter
 * heading containing the word is more nearly about it.
 */
const SCORE = {
  /** The heading, whole, is the query. Nothing beats this. */
  headingExact: 0,
  /** A word of the heading is the query. */
  headingWord: 0.05,
  /** Per word in the heading, added to `headingWord`. */
  sizePenalty: 0.001,
  /** The heading of the provision this one REPLACED is the query. */
  oldHeadingExact: 0.02,
  /**
   * A word of a repealed heading is the query. Weaker than the section's own
   * heading, and the reason BNS 103 ("Punishment for murder.") outranks BNS 310
   * ("Dacoity.", which replaced IPC 396, "Dacoity with murder.") for "murder".
   */
  oldHeadingWord: 0.15,
  /**
   * Added when the match came through the lexicon rather than from the query
   * itself. Small enough that a translated hit on a heading still beats an
   * untranslated hit on a keyword, large enough that the literal word wins.
   */
  synonym: 0.02,
  /** A curated keyword is the query. */
  keyword: 0.25,
  /** A heading word or keyword STARTS with the query: "dhokha" in "dhokhadhadi". */
  prefix: 0.3,
  /** Fuse's own 0-1 score, mapped into the band below every exact signal. */
  fuseFloor: 0.35,
  fuseSpan: 0.4,
  /** The query appears verbatim in the section text. The weakest real signal. */
  body: 0.85,
} as const

/**
 * Fuse, plus a precomputed exact-term lookup over the same documents.
 *
 * The term map is what makes "murder" return BNS 103 rather than BNS 109: Fuse
 * scores a fuzzy match on "attempt to murder" and an exact match on "murder"
 * closely enough that document order decides between them, and document order
 * is not a ranking.
 *
 * Each term carries the score it earned AT INDEX TIME, so a search is a map
 * lookup rather than a scan — the whole index is 3,600 terms over 1,059
 * documents and is built once per tab.
 */
export interface SearchIndex<T> {
  fuse: Fuse<SearchDoc<T>>
  docs: ReadonlyArray<SearchDoc<T>>
  /** Folded term -> the documents carrying it, with the score that term earns. */
  terms: Map<string, Array<{ doc: SearchDoc<T>; score: number }>>
  /** The keys of `terms`, for prefix matching. */
  termList: string[]
}

export function buildSearchIndex<T>(docs: ReadonlyArray<SearchDoc<T>>): SearchIndex<T> {
  const terms = new Map<string, Array<{ doc: SearchDoc<T>; score: number }>>()

  const add = (term: string, doc: SearchDoc<T>, score: number) => {
    if (term.length < 2) return
    const bucket = terms.get(term)
    if (!bucket) {
      terms.set(term, [{ doc, score }])
      return
    }
    // A term can reach one document by more than one route — as a heading word
    // and as a curated keyword. The strongest route is the one that counts.
    const existing = bucket.find((entry) => entry.doc === doc)
    if (!existing) bucket.push({ doc, score })
    else if (score < existing.score) existing.score = score
  }

  for (const doc of docs) {
    const wordScore = SCORE.headingWord + SCORE.sizePenalty * doc.headingSize
    for (const term of doc.headingKeys) add(term, doc, SCORE.headingExact)
    for (const term of doc.headingWords) add(term, doc, wordScore)
    for (const term of doc.oldHeadingKeys) add(term, doc, SCORE.oldHeadingExact)
    for (const term of doc.oldHeadingWords) add(term, doc, SCORE.oldHeadingWord)
    for (const term of doc.roman) add(term, doc, SCORE.keyword)
    for (const keyword of doc.keywords) add(foldRoman(keyword), doc, SCORE.keyword)
  }

  return { fuse: new Fuse(docs, FUSE_OPTIONS), docs, terms, termList: [...terms.keys()] }
}

/* ------------------------------------------------------------------ *
 * Ranking
 * ------------------------------------------------------------------ */

/**
 * Why a record is in the results. This is not decoration — the UI labels each
 * band, because "you asked for IPC 302 and here is BNS 302 as well" is exactly
 * the confusion this module exists to prevent.
 */
export type HitReason =
  /** The section the reference resolves to in the chosen direction. */
  | 'section'
  /** The same number read the other way round — the number-swap trap. */
  | 'section-other-direction'
  /** A heading, keyword or body-text match. */
  | 'text'

/**
 * Rank bands. Lower sorts first; the score only breaks ties inside a band.
 *
 * `keyword` is not a `HitReason` of its own — the UI has nothing useful to say
 * about "matched a keyword exactly" that it does not already say with "matches
 * the wording" — so an exact term match lands in the `text` band with a score
 * of 0, ahead of every fuzzy match in it.
 */
const BAND: Record<HitReason, number> = {
  section: 0,
  'section-other-direction': 1,
  text: 2,
}

/** Shorter than this, a prefix match is noise: "ar" prefixes half the lexicon. */
const MIN_PREFIX = 4

export interface SearchHit<T> {
  doc: SearchDoc<T>
  reason: HitReason
  /** 0 is a perfect match. Fuse's own score for text hits. */
  score: number
}

/**
 * Resolves a section reference to the documents that answer it.
 *
 * The law module implements this over `data/law/index.json` (old → new) and the
 * datasets themselves (new → old). Keeping it a parameter is what stops this
 * file needing to know that a "code" is `bns` or that "302" ever meant murder.
 */
export type SectionResolver<T> = (parsed: ParsedQuery, direction: Direction) => ReadonlyArray<SearchDoc<T>>

export interface SearchOptions<T> {
  /** Restrict to one code pair. Undefined means all three. */
  code?: string | undefined
  direction: Direction
  resolveSection: SectionResolver<T>
  /** Hard cap before virtualisation would be doing the work anyway. */
  limit?: number
}

/**
 * The hard cap on a result list. Exported because the UI has to SAY that it
 * capped: a truncated list of sections that looks complete is the same class of
 * error as a missing "no counterpart" notice.
 */
export const SEARCH_RESULT_LIMIT = 200

/**
 * Expand a query into the strings actually worth matching on.
 *
 * A Latin query gets its Devanagari transcription added, so "hatya" can reach a
 * Hindi heading that carries no roman keyword; a Devanagari query gets its
 * Latin skeleton, so "हत्या" reaches the lexicon's "hatya". Each is run as its
 * own Fuse pass rather than as one `$or` expression, because Fuse scores an
 * extended-search expression as a whole and a miss on one alternative would
 * drag down a perfect hit on another.
 */
export function queryVariants(parsed: ParsedQuery): string[] {
  const base = parsed.text.trim()
  if (!base) return []

  const variants = new Set<string>([base])

  // Only for a SINGLE Latin word. Every extra variant is another full Fuse
  // pass over 1,059 records, and for a phrase the word-by-word roman terms in
  // the index already reach the Devanagari side without one.
  if ((parsed.script === 'latin' || parsed.script === 'mixed') && !base.includes(' ')) {
    const devanagari = toDevanagari(base)
    if (devanagari !== base) variants.add(devanagari)
  }
  if (parsed.script === 'devanagari' || parsed.script === 'mixed') {
    const folded = romanKey(base)
    if (folded) variants.add(folded)
  }
  // The folded form of a Latin query matches the folded `roman` field even
  // when the reader's spelling is not the lexicon's ("dhokhaa", "chorii").
  const folded = foldRoman(base)
  if (folded && folded !== base) variants.add(folded)

  return [...variants]
}

/**
 * Run a parsed query against the index and return one ranked, de-duplicated
 * list.
 *
 * Section hits are computed by the caller's resolver and always occupy the
 * first two bands. A document that arrived as a section hit is never repeated
 * as a text hit, so "302" does not show BNS 103 twice.
 */
export function search<T>(
  index: SearchIndex<T>,
  parsed: ParsedQuery,
  options: SearchOptions<T>,
): SearchHit<T>[] {
  const { code, direction, resolveSection, limit = SEARCH_RESULT_LIMIT } = options
  const inScope = (doc: SearchDoc<T>) => !code || doc.code === code

  const hits = new Map<string, SearchHit<T>>()
  const add = (doc: SearchDoc<T>, reason: HitReason, score: number) => {
    if (!inScope(doc)) return
    const existing = hits.get(doc.id)
    if (existing) {
      // A better BAND always wins: a document that is the answer to the section
      // number must not be demoted to "also mentions murder" by a later pass.
      if (BAND[existing.reason] < BAND[reason]) return
      // Within a band, the best score wins — the exact, prefix, fuzzy and body
      // passes below all run, and whichever matched best is the one that counts.
      if (BAND[existing.reason] === BAND[reason] && existing.score <= score) return
    }
    hits.set(doc.id, { doc, reason, score })
  }

  if (parsed.sectionRef) {
    // The tiny score keeps the RESOLVER'S OWN ORDER inside the band. IPC 498A
    // maps to BNS 85 and 86 in that order — the offence and then the definition
    // of cruelty — and re-sorting them by heading length would put the
    // definition above the offence.
    const other: Direction = direction === 'old-new' ? 'new-old' : 'old-new'
    resolveSection(parsed, direction).forEach((doc, i) => add(doc, 'section', i * 1e-3))
    resolveSection(parsed, other).forEach((doc, i) => add(doc, 'section-other-direction', i * 1e-3))
  }

  /** Exact and prefix passes over the term index, at a given handicap. */
  const termPasses = (folded: string, handicap: number) => {
    if (folded.length < 2) return

    for (const entry of index.terms.get(folded) ?? []) add(entry.doc, 'text', entry.score + handicap)

    if (folded.length < MIN_PREFIX) return
    for (const term of index.termList) {
      if (term.length > folded.length && term.startsWith(folded)) {
        for (const entry of index.terms.get(term) ?? []) {
          // A prefix match never scores better than an exact one, however
          // strong the route it arrived by.
          add(entry.doc, 'text', Math.max(entry.score, SCORE.prefix) + handicap)
        }
      }
    }
  }

  for (const variant of queryVariants(parsed)) {
    const folded = foldRoman(variant)

    // The query itself, then its lexicon equivalents, then fuzzy. Each pass can
    // only improve a document's score, because `add` keeps the better of the two.
    termPasses(folded, 0)
    // "jamanat" reaches a heading that says "bail"; "dhokha" reaches one that
    // says "cheating". See src/lib/lexicon.ts for why this is not optional.
    for (const synonym of synonymsFor(folded)) termPasses(synonym, SCORE.synonym)

    for (const result of index.fuse.search(variant, { limit })) {
      add(result.item, 'text', SCORE.fuseFloor + SCORE.fuseSpan * (result.score ?? 1))
    }
  }

  // The section text, by plain substring. Last, cheapest, and worst-scoring:
  // a provision that merely mentions a phrase is a weaker answer than one whose
  // heading is about it, and this is the band that finds "zero FIR".
  const body = parsed.text.trim().toLowerCase()
  if (body.length >= MIN_PREFIX) {
    for (const doc of index.docs) {
      if (doc.excerpt.includes(body)) add(doc, 'text', SCORE.body)
    }
  }

  return [...hits.values()]
    .sort(
      (a, b) =>
        BAND[a.reason] - BAND[b.reason] ||
        a.score - b.score ||
        // A shorter heading containing the term is more nearly ABOUT it:
        // "Cheating." beats "Cohabitation caused by a man deceitfully inducing
        // a belief of lawful marriage" for a query about deception.
        a.doc.headingSize - b.doc.headingSize ||
        a.doc.code.localeCompare(b.doc.code) ||
        a.doc.sortKey - b.doc.sortKey,
    )
    .slice(0, limit)
}
