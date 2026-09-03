import Fuse, { type IFuseOptions } from 'fuse.js'

import { foldRoman, hasDevanagari, romanKey } from './transliterate'

/**
 * Retrieval across everything on this device: rule text, law sections, the
 * glossary, the study aids, defined terms and the reader's own notes.
 *
 * ### It is used with AI OFF, which is the point
 *
 * This is the plain search box first and the study agent's `retrieve` tool
 * second. That order is deliberate and it is what `docs/AI.md`'s new §13 states:
 * precomputed first, retrieval always, the model last. A retrieval layer whose
 * only consumer is an agent is a retrieval layer nobody can check, because with
 * AI off — every device's default — nothing would exercise it. Here the reader
 * sees exactly what the agent would be handed.
 *
 * ### PURE, and it takes its documents as an argument
 *
 * Nothing here imports a dataset. `data/rules` is ~4 MB, `data/law` 5 MB and
 * `data/glossary.json` almost a megabyte; the rule `src/lib/pay`, `src/lib/srs`
 * and `src/lib/library` all follow — every function is handed what it works
 * over — holds for the same reason. The caller decides which corpora are worth
 * loading for a given scope.
 *
 * ### A personal snippet is flagged, always
 *
 * `personal: true` marks a snippet that came from the reader's own notes or
 * their own documents. Everything downstream — the search results list, the
 * agent's context builder, the citation chips — has to be able to tell that
 * apart from a published source, because a note is the reader's opinion of the
 * law and a section is the law. Nothing in this file ever drops the flag.
 */

/** What kind of thing a snippet came from. Governs how it is labelled and weighed. */
export const SNIPPET_KINDS = ['rule', 'section', 'glossary', 'aid', 'definition', 'note'] as const
export type SnippetKind = (typeof SNIPPET_KINDS)[number]

/** Which corpora a query may reach. `all` is every kind above. */
export const RETRIEVAL_SCOPES = ['all', 'law', 'rules', 'library', 'glossary', 'personal'] as const
export type RetrievalScope = (typeof RETRIEVAL_SCOPES)[number]

const SCOPE_KINDS: Readonly<Record<RetrievalScope, readonly SnippetKind[]>> = {
  all: SNIPPET_KINDS,
  law: ['section'],
  rules: ['rule'],
  // "library" is what a reader means by the reading module: the rule books and
  // the codes, plus the writing this app layers over them.
  library: ['rule', 'section', 'aid', 'definition'],
  glossary: ['glossary'],
  personal: ['note'],
}

/**
 * One retrievable document, as the caller builds it.
 *
 * `citation` is the load-bearing field. It is what a snippet is cited AS, and
 * it is the caller's — `src/lib/library/corpus.ts` already writes one for every
 * unit, `data/rules/cards` carries one per card, and the law module composes
 * one. Nothing here invents a citation, because a citation composed by a search
 * index is a citation nobody checked.
 */
export interface RetrievalDoc {
  id: string
  kind: SnippetKind
  /** "Rule 11, CCS (Conduct) Rules, 1964" — never composed here. */
  citation: string
  /** The unit's own heading, or the term, or the aid's subject. May be empty. */
  heading: string
  /** The body the query is matched against. */
  text: string
  /** Where the reader can open it. A route in this app, not an external URL. */
  href: string
  /** The published source, where there is one. `null` for anything personal. */
  sourceUrl: string | null
  /** The reader's own writing. Never dropped, never inferred downstream. */
  personal: boolean
  /**
   * The unit number as printed — "11", "3A", "65B", "4.7". Used by the
   * number-aware pass below, which is what makes "Rule 18(2)" work.
   */
  number?: string
  /** Which work or act it belongs to, for grouping and for the scope filter. */
  workId?: string
  language?: 'en' | 'hi'
  /**
   * Indexed but NEVER SHOWN — the other language's citation and heading, an
   * `alsoHi` list, anything a reader might type that is not in the fields above.
   *
   * It exists because "both languages are indexed, always" (the rule
   * `src/lib/library/search.ts` states) is otherwise not true of a document
   * built in one language: `citation` and `heading` are one language's, and a
   * reader searching `आचरण` over an English-built index would find nothing —
   * which is exactly what the acceptance set caught. Keeping it out of `text`
   * is what stops a Hindi citation appearing inside an English snippet.
   */
  alsoSearch?: string
}

/** A retrieved snippet. The shape the study agent turns into context. */
export interface RetrievedSnippet {
  id: string
  kind: SnippetKind
  citation: string
  heading: string
  /** A window of the text around the match, not the whole document. */
  text: string
  href: string
  sourceUrl: string | null
  personal: boolean
  /** 0-1, higher is better. Comparable only within one `retrieve` call. */
  score: number
  /** Why it matched. Shown in the results list so a ranking is explainable. */
  reason: 'number' | 'citation' | 'heading' | 'text'
}

/* ------------------------------------------------------------------ *
 * Number-aware matching
 * ------------------------------------------------------------------ */

/**
 * Every way this app's two languages name a numbered provision, reduced to the
 * number itself.
 *
 * `\b` is DELIBERATELY ABSENT from the Devanagari alternative. JavaScript
 * defines a word boundary over `[A-Za-z0-9_]`, so `/\bधारा/` matches nothing,
 * ever — the trap `src/ai/agents/law.ts#SECTION_MENTION` records (ADR-035) and
 * `src/lib/library/corpus.ts` hit again with `/परन्तु\b/` (ADR-038). The
 * English half is anchored; the Devanagari half is not, and cannot be.
 */
/**
 * The unit words, in the order the alternation must try them.
 *
 * Order is load-bearing twice. `section` before `sec` before `s` — otherwise
 * `s` matches the first letter of "section" and the number group is handed
 * "ection". And `f.r.`/`s.r.` before the bare `s`, or `S.` matches on its own
 * and the number group is handed "R.".
 *
 * `s` without a full stop is one of the four forms the session brief names
 * verbatim ("s 65B"), and it is safe unanchored because the group carries a
 * leading `\b`: the `s` of "items" is preceded by a word character, so there is
 * no boundary in front of it and "items 65B" is not a reference to s.65B.
 *
 * `f.r.`/`s.r.` are here because they are what this repository's own
 * `citation()` prints for every FR & SR provision — the shape a reader gets
 * when they copy a citation off a Trainer card and paste it back into a search
 * box.
 *
 * The plurals are here because the Devanagari half always had them
 * (`नियमों|नियम`) and the English half did not, so "Rules 18" matched nothing
 * while "नियमों 18" matched. An asymmetry between two language halves is the
 * ADR-035/ADR-039 trap in its mildest form and it is still worth closing.
 */
const UNIT_WORDS = String.raw`sections?|secs?\.?|f\.?\s?r\.?|s\.?\s?r\.?|s\.?|rules?|paras?(?:graphs?)?|regulations?|articles?|clauses?`

const PROVISION = new RegExp(
  String.raw`(?:\b(?:${UNIT_WORDS})\s*(?:no\.?\s*)?|(?:धाराओं|धारा|नियमों|नियम|उपनियम|अनुच्छेद|पैरा|खंड)\s*(?:सं\.?\s*)?)([0-9०-९]+(?:\s*\([0-9a-zA-Z०-९]+\))*[A-Za-z]{0,2})`,
  'giu',
)

/** A bare number a reader typed on its own: "18", "65B", "4.7". */
const BARE_NUMBER = /^[0-9०-९]+(?:\.[0-9०-९]+)*[A-Za-z]{0,2}(?:\([0-9a-zA-Z०-९]+\))*$/u

const DEVANAGARI_DIGITS = '०१२३४५६७८९'

/** Devanagari digits fold to ASCII; case and punctuation go. `65B` keeps its `B`. */
export function numberKey(reference: string): string {
  return (
    reference
      .replace(/[०-९]/g, (digit) => String(DEVANAGARI_DIGITS.indexOf(digit)))
      .toUpperCase()
      // The PARENTHESES ARE KEPT, and that is the whole point of this line.
      //
      // Stripping them folded `18(2)` to `182`, and `182` is a real rule
      // number: GFR has 307 rules and 256 of its numbers are reachable that
      // way, and `1(1)` collides with Rule 11 in every one of the nine books
      // that has eleven rules. Because the exact-number pass scores at 1.0,
      // that did not merely rank a stranger highly — it put a provision the
      // reader never asked for level with the one they did.
      //
      // This is ADR-035's `refKey()` lesson in a second file: there a digits-
      // only key could not tell 124 from 124A, here it could not tell 18(2)
      // from 182. A key that throws away structure throws away identity.
      .replace(/[^0-9A-Z.()]/g, '')
  )
}

/**
 * The provision numbers a query names, as keys.
 *
 * Both the "Rule 18(2)" form and a bare "18" are recognised, and the full
 * sub-section is kept ALONGSIDE the bare section rather than instead of it:
 * `18(2)` and `18` are the same provision at two resolutions, and which one a
 * document records is a property of the dataset, not of the question. Matching
 * on both is what stops "Rule 18(2)" finding nothing in a corpus that stores
 * the rule whole.
 */
export function numbersIn(query: string): string[] {
  const found = new Set<string>()
  const trimmed = query.trim()

  if (BARE_NUMBER.test(trimmed)) {
    const key = numberKey(trimmed)
    if (key) found.add(key)
  }

  for (const match of trimmed.matchAll(PROVISION)) {
    const written = match[1] ?? ''
    const full = numberKey(written)
    if (!full) continue
    found.add(full)
    const base = numberKey(written.split('(')[0] ?? written)
    if (base) found.add(base)
  }

  return [...found]
}

/* ------------------------------------------------------------------ *
 * The index
 * ------------------------------------------------------------------ */

interface Indexed {
  doc: RetrievalDoc
  citation: string
  heading: string
  text: string
  /** The heading and the citation, folded to a Latin skeleton (transliterate.ts). */
  roman: string
  /** `RetrievalDoc.alsoSearch` — indexed, never rendered. */
  also: string
  numberKey: string
  /** The WHOLE heading, folded, for the exact pass. `"Gifts."` → `"gifts"`. */
  headingKey: string
}

/**
 * FIELD WEIGHTS: citation > heading > text.
 *
 * The brief asks for exactly this order and it is right for this corpus. A
 * citation is the only field that names the provision unambiguously — "Rule 18,
 * CCS (Conduct) Rules, 1964" can mean one thing — while the text of that rule
 * mentions a dozen other provisions and the heading is often a single word four
 * rule books share ("Definitions"). Weighting text as highly as a citation is
 * how "Rule 18" comes to return the twelve rules that cite Rule 18 above Rule 18.
 *
 * `ignoreLocation` is required: a statutory paragraph is long and the phrase can
 * be anywhere in it — the same setting `src/lib/library/search.ts` gives its own
 * index and for the same reason.
 */
const FUSE_OPTIONS: IFuseOptions<Indexed> = {
  includeScore: true,
  ignoreLocation: true,
  threshold: 0.34,
  minMatchCharLength: 3,
  keys: [
    { name: 'citation', weight: 4 },
    { name: 'heading', weight: 3 },
    { name: 'roman', weight: 2 },
    { name: 'also', weight: 2 },
    { name: 'text', weight: 1 },
  ],
}

export interface RetrievalIndex {
  fuse: Fuse<Indexed>
  entries: readonly Indexed[]
  /** Number key → the documents carrying it. Answers the exact pass. */
  byNumber: ReadonlyMap<string, Indexed[]>
  /** Folded heading → the documents whose whole heading is that string. */
  byHeading: ReadonlyMap<string, Indexed[]>
  count: number
}

/**
 * A heading, whole, folded for comparison.
 *
 * Trailing punctuation goes — `data/law`'s headings print a full stop and
 * `data/rules`' do not — and the two scripts are folded to one skeleton so a
 * Devanagari heading and its roman transcription meet. Empty for a unit with no
 * heading at all, which is 221 of them (`docs/DATA-GAPS.md` #71) and which the
 * exact pass therefore skips rather than matching them all to each other.
 */
export function headingKey(heading: string): string {
  const trimmed = heading.trim().replace(/[.।:;,\s]+$/u, '')
  if (!trimmed) return ''
  return hasDevanagari(trimmed) ? trimmed.toLowerCase() : foldRoman(trimmed)
}

export function buildRetrievalIndex(docs: readonly RetrievalDoc[]): RetrievalIndex {
  const entries: Indexed[] = []
  const byNumber = new Map<string, Indexed[]>()
  const byHeading = new Map<string, Indexed[]>()

  const push = (map: Map<string, Indexed[]>, key: string, entry: Indexed) => {
    if (!key) return
    const bucket = map.get(key)
    if (bucket) bucket.push(entry)
    else map.set(key, [entry])
  }

  for (const doc of docs) {
    const entry: Indexed = {
      doc,
      citation: doc.citation,
      heading: doc.heading,
      text: doc.text,
      roman: `${romanKey(doc.heading)} ${romanKey(doc.citation)}`.trim(),
      also: doc.alsoSearch ?? '',
      numberKey: doc.number ? numberKey(doc.number) : '',
      headingKey: headingKey(doc.heading),
    }
    entries.push(entry)
    push(byNumber, entry.numberKey, entry)
    push(byHeading, entry.headingKey, entry)
  }

  return {
    fuse: new Fuse(entries, FUSE_OPTIONS),
    entries,
    byNumber,
    byHeading,
    count: entries.length,
  }
}

/* ------------------------------------------------------------------ *
 * Retrieval
 * ------------------------------------------------------------------ */

export interface RetrieveOptions {
  scope?: RetrievalScope
  k?: number
  /** Characters of context either side of a match in the returned snippet. */
  pad?: number
  /** Drop the reader's own notes. The study agent sets this for a shared answer. */
  excludePersonal?: boolean
}

export const DEFAULT_K = 8
const DEFAULT_PAD = 90

/**
 * Whether a query is worth running.
 *
 * One character of prose matches most of a rule book and means nothing. One
 * DIGIT is Rule 3, and refusing it would make the most direct thing a reader
 * can type the one thing that does not work — the same rule
 * `src/lib/library/search.ts#isSearchable` states, and exported for the same
 * reason: the caller has to make the same decision BEFORE this runs, because it
 * is what gates loading a 1.9 MB corpus, and two copies of the rule would drift.
 */
export function isRetrievable(query: string): boolean {
  const needle = query.trim()
  if (needle.length >= 2) return true
  return needle.length === 1 && /[0-9०-९]/u.test(needle)
}

/** A window of `text` around the first occurrence of `needle`, with ellipses. */
export function snippetAround(text: string, needle: string, pad = DEFAULT_PAD): string {
  const source = text.trim()
  if (!source) return ''
  const at = needle ? source.toLowerCase().indexOf(needle.trim().toLowerCase()) : -1
  if (at < 0) return source.length <= pad * 2 ? source : `${source.slice(0, pad * 2).trim()}…`
  const from = Math.max(0, at - pad)
  const to = Math.min(source.length, at + needle.length + pad)
  return `${from > 0 ? '…' : ''}${source.slice(from, to).trim()}${to < source.length ? '…' : ''}`
}

/**
 * The main entry point.
 *
 * An EXACT NUMBER MATCH RANKS FIRST, always, and above everything fuse can
 * find. That is the same claim `src/lib/search.ts` makes for the Law Converter
 * ("someone who types 302 wants the section") and it matters more here, because
 * this index mixes six kinds of document and a fuzzy pass over 1,891 glossary
 * terms will always find something for a two-digit query.
 */
export function retrieve(
  index: RetrievalIndex,
  query: string,
  options: RetrieveOptions = {},
): RetrievedSnippet[] {
  const needle = query.trim()
  if (!isRetrievable(needle)) return []

  const k = Math.max(1, options.k ?? DEFAULT_K)
  const pad = options.pad ?? DEFAULT_PAD
  const kinds = new Set(SCOPE_KINDS[options.scope ?? 'all'])

  const allowed = (entry: Indexed): boolean =>
    kinds.has(entry.doc.kind) && !(options.excludePersonal === true && entry.doc.personal)

  const seen = new Set<string>()
  const out: RetrievedSnippet[] = []

  const take = (entry: Indexed, score: number, reason: RetrievedSnippet['reason']) => {
    if (seen.has(entry.doc.id) || !allowed(entry)) return
    seen.add(entry.doc.id)
    out.push({
      id: entry.doc.id,
      kind: entry.doc.kind,
      citation: entry.doc.citation,
      heading: entry.doc.heading,
      text: snippetAround(entry.doc.text, reason === 'text' ? needle : '', pad),
      href: entry.doc.href,
      sourceUrl: entry.doc.sourceUrl,
      personal: entry.doc.personal,
      score,
      reason,
    })
  }

  // 1. Exact provision numbers, in the order the query named them.
  for (const key of numbersIn(needle)) {
    for (const entry of index.byNumber.get(key) ?? []) take(entry, 1, 'number')
  }

  /*
    2. The WHOLE heading, exactly.

    This pass exists because the field weights alone get it wrong, and the
    acceptance set is what proved it: for "Suspension" the highest-weighted
    field of a glossary entry is its citation, `"Suspension / निलंबन"`, which
    fuse scores as near-perfect — while CCA Rule 10, whose heading IS the word,
    scores worse because its citation is "Rule 10, Central Civil Services
    (Classification, Control and Appeal) Rules, 1965" and does not contain it at
    all. Five of the forty cases failed that way. Weighting `heading` above
    `citation` is not the fix either: a citation is still the only field that
    names a provision unambiguously, and "Definitions" is a heading four of
    these rule books share.

    So a heading that IS the query wins outright, and the ordinary weighted
    search decides everything below it. Same shape as the number pass, and the
    same reason `src/lib/search.ts#SCORE` ranks `headingExact` above everything
    but a section number.
  */
  for (const entry of index.byHeading.get(headingKey(needle)) ?? []) take(entry, 0.98, 'heading')

  /*
    2. Fuse over citation, heading, the folded roman skeleton and the text.

    NO `limit` IS PASSED, and that is deliberate rather than careless. The scope
    filter and the personal filter both run AFTER the search — `take` is what
    applies them — so a `limit`-sized fuse result can be entirely out-of-scope
    documents and return NOTHING for a query that has perfectly good in-scope
    answers further down. A multiplier does not fix it either: `k * 4` was the
    first version of this line and `src/lib/retrieval.test.ts`'s "applies the
    scope filter AFTER the search" case failed against it, because a narrow
    scope over a mixed index can push the only match past any fixed multiple
    of `k`.

    It costs nothing to leave it off. `limit` in fuse.js truncates the result
    array; it does not stop fuse scoring every document, which it does either
    way. The loop below stops at `k` in-scope hits regardless.
  */
  if (needle.length >= 2) {
    for (const hit of index.fuse.search(needle)) {
      if (out.length >= k) break
      const score = 1 - Math.min(1, hit.score ?? 1)
      take(hit.item, score * 0.9, reasonFor(hit.item, needle))
    }
  }

  return out.sort(rank).slice(0, k)
}

/**
 * How two equally-scoring hits are ordered.
 *
 * KIND IS A TIE-BREAK, NEVER A WEIGHT. A rule and the study aid that explains
 * it carry the same citation and the same heading, so for "Gifts" they tie
 * exactly — and the reader wants the RULE, because the aid is commentary on it
 * and is one tap away from it anyway. Making this a weight instead would be a
 * different and wrong claim: it would say a glossary term can never beat a rule,
 * and "avar sachiv" is a query where it should.
 *
 * The order is source-before-commentary-before-vocabulary-before-the-reader's-own.
 */
const KIND_ORDER: Readonly<Record<SnippetKind, number>> = {
  rule: 0,
  section: 0,
  aid: 1,
  definition: 2,
  glossary: 3,
  note: 4,
}

const rank = (a: RetrievedSnippet, b: RetrievedSnippet): number =>
  b.score - a.score || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/**
 * Why a fuse hit matched, from the fields themselves.
 *
 * Derived rather than taken from `hit.matches`, because `includeMatches` roughly
 * doubles what fuse allocates per search and the answer here only has to be
 * good enough to label a row. The order mirrors the field weights.
 */
function reasonFor(entry: Indexed, needle: string): RetrievedSnippet['reason'] {
  const folded = hasDevanagari(needle) ? needle : foldRoman(needle)
  const lower = needle.toLowerCase()
  if (entry.citation.toLowerCase().includes(lower)) return 'citation'
  if (entry.heading.toLowerCase().includes(lower)) return 'heading'
  if (entry.roman.includes(folded)) return 'heading'
  return 'text'
}

/**
 * Retrieval across several indexes, merged and re-ranked.
 *
 * Separate indexes rather than one, because the caller loads them at different
 * moments — the glossary is a megabyte and the law corpora are five, and a
 * reader searching inside one rule book should not pay for either.
 */
export function retrieveAcross(
  indexes: readonly RetrievalIndex[],
  query: string,
  options: RetrieveOptions = {},
): RetrievedSnippet[] {
  const k = Math.max(1, options.k ?? DEFAULT_K)
  const merged = indexes.flatMap((index) => retrieve(index, query, { ...options, k }))
  return merged.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).slice(0, k)
}
