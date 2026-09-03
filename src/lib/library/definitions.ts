import { normaliseText } from './anchor'

/**
 * "X means …" — reading a statute's own definitions clause.
 *
 * Every one of these documents opens with a definitions provision, and an
 * officer reading Rule 14 who meets "competent authority" for the third time
 * should not have to navigate back to Rule 2 to be reminded what it says. This
 * parses that clause once, at build time for the fifteen bundled works
 * (`scripts/library-extracts.mjs` writes `data/library/definitions/<act>.json`)
 * and at read time for a work the reader added themselves.
 *
 * PURE, AND HONEST ABOUT ITS CONFIDENCE. It reads a legal drafting convention,
 * not a machine-readable field, and the convention is not kept perfectly: the
 * CCS (Leave) Rules lost their quotation marks somewhere in the PDF (`(a)
 * Administrator means an Administrator of a Union Territory;`), the PoSH Act
 * has a footnote sitting in the middle of clause (b), and the Official
 * Languages Act's extraction runs section 3 into the end of section 2. So every
 * term carries a `confidence`, anything below `high` carries `verify: true`,
 * and the popover says so. Guessing silently is the one thing this must not do.
 */

/** Quotation marks a Ministry PDF has actually produced, including the broken ones. */
const OPEN_QUOTE = '["“”‘’‖‟]'
const CLOSE_QUOTE = '["“”‘’‖‟]'

/** `(a)`, `(iv)`, `(12)` — the clause letter a definition is filed under. */
const MARKER = String.raw`\(([a-z]{1,2}|[ivxl]{1,5}|\d{1,2})\)`

/** What a definitions clause says instead of "=". */
const CONNECTIVE = String.raw`(?:shall mean and include|means and includes|shall mean|shall include|means|mean|includes|include|denotes)`

/**
 * A quoted term, optionally a second one joined by "and", then the connective.
 *
 * The second term is real and not a nicety: the RTI Act defines "Chief
 * Information Commissioner" and "Information Commissioner" in one clause with
 * one body, and dropping the pair would leave one of the two undefined.
 */
/**
 * What a clause may put between the term and its connective.
 *
 * A comma-led aside ("\"appointed day\", in relation to section 3, means …") and
 * a bare qualifier with no comma at all ("\"Members of family\" in relation to a
 * Government servant includes …") are both ordinary drafting, and the second is
 * what the CCS (Conduct) Rules use. It is a CURATED list of openers rather than
 * "any short run of text": free text there lets one clause's term bind to the
 * next clause's connective, which reads two definitions as one.
 */
const QUALIFIER = String.raw`(?:\s*(?:,\s*)?(?:in relation to|with reference to|in relation with|for the purposes? of|in the case of|used in)[^;]{0,90}?)?`

const QUOTED = new RegExp(
  String.raw`(?:${MARKER}\s*)?` +
    `${OPEN_QUOTE}\\s*([^"“”‘’‖‟]{1,90}?)\\s*${CLOSE_QUOTE}` +
    String.raw`(?:\s*(?:and|or)\s*${OPEN_QUOTE}\s*([^"“”‘’‖‟]{1,90}?)\s*${CLOSE_QUOTE})?` +
    QUALIFIER +
    String.raw`\s*${CONNECTIVE}\b`,
  'gi',
)

/**
 * The same clause with its quotation marks lost in extraction.
 *
 * A marker is REQUIRED here and the term must start with a capital and stay
 * short. Without both, "the authority means" anywhere in a rule's prose reads
 * as a definition — and this pass runs only over a unit already identified as
 * the definitions clause, which is the other half of what keeps it honest.
 */
const UNQUOTED = new RegExp(String.raw`${MARKER}\s+([A-Z][^;:()“”"]{1,70}?)\s+${CONNECTIVE}\b`, 'g')

/** Hindi drafting: `"शब्द" से अभिप्रेत है` / `का अर्थ है` / `के अंतर्गत है`. */
const HINDI = new RegExp(
  String.raw`(?:${MARKER}\s*)?` +
    `${OPEN_QUOTE}\\s*([^"“”‘’‖‟]{1,90}?)\\s*${CLOSE_QUOTE}` +
    String.raw`\s*(?:से\s+अभिप्रेत\s+है|का\s+अर्थ\s+है|के\s+अंतर्गत\s+है|से\s+तात्पर्य\s+है)`,
  'g',
)

export type DefinitionConfidence = 'high' | 'medium' | 'low'

export interface DefinedTerm {
  /** As the provision writes it, whitespace collapsed. */
  term: string
  /** The clause body, up to where the next defined term begins. */
  definition: string
  /** `(a)`, `(iv)` — null where the clause carries none. */
  marker: string | null
  confidence: DefinitionConfidence
  /** True for anything below `high`, the way every other dataset in this repo marks doubt. */
  verify: boolean
}

/**
 * Is this unit the document's definitions clause?
 *
 * Heading first, because eleven of the fifteen works have one that says so.
 * The opening formula is the fallback for the four that print no heading the
 * extractor could read — and it is the formula the session brief named, which
 * every one of these documents uses almost word for word.
 */
export function isDefinitionsUnit(heading: string, text: string): boolean {
  const head = heading.trim().toLowerCase()
  if (/^(definitions?|definitions? and interpretation|interpretation)\b/.test(head)) return true
  // NO `\b`. It is defined over `[A-Za-z0-9_]`, so anchoring a Devanagari
  // alternative with it matches nothing, ever — the same trap ADR-035 recorded
  // in the law agent and ADR-038 hit again in `corpus.ts`. A Unicode letter
  // lookahead says what `\b` was meant to say, in both scripts.
  if (/^(?:परिभाषा(?:एँ|एं|ओं)?|निर्वचन)(?![\p{L}])/u.test(heading.trim())) return true

  const opening = normaliseText(text).slice(0, 320).toLowerCase()
  if (/unless the context otherwise requires/.test(opening)) return true
  if (/जब तक (कि )?(संदर्भ|प्रसंग) से अन्यथा/.test(normaliseText(text).slice(0, 320))) return true
  return false
}

/** Trailing punctuation and connectors a clause ends with, none of which is content. */
/**
 * `\band\b`, not `and`.
 *
 * A clause ends "…; and" and that connector is not content. Written without the
 * boundary, the same pattern also eats the last three letters of "the wife or
 * husband" — which it did, and which a fixture caught. The English half of this
 * needs the boundary as much as any Devanagari half does.
 */
const trimBody = (body: string): string =>
  normaliseText(body)
    .replace(/^[\s,:—–-]+/, '')
    .replace(/[\s;,.]*(?:;\s*and|\s+and)?[\s;,.]*$/, '')
    .trim()

interface Hit {
  index: number
  end: number
  terms: string[]
  marker: string | null
  confidence: DefinitionConfidence
}

/**
 * Every term the clause defines, with the body each one carries.
 *
 * A body runs from the end of its own connective to the START of the next
 * term — which is why the three passes are merged and sorted by position
 * before any body is cut, rather than each pass slicing independently. A
 * nested sub-clause `(i)` inside a definition is not a term, and does not
 * become one, because it has no connective after it.
 */
export function parseDefinitions(source: string): DefinedTerm[] {
  const text = normaliseText(source)
  if (!text) return []

  const hits: Hit[] = []
  const claimed: Array<[number, number]> = []
  const overlaps = (from: number, to: number) => claimed.some(([start, end]) => from < end && to > start)

  const collect = (pattern: RegExp, confidence: DefinitionConfidence, hindi = false) => {
    pattern.lastIndex = 0
    for (const match of text.matchAll(pattern)) {
      const index = match.index ?? 0
      const end = index + match[0].length
      if (overlaps(index, end)) continue
      const terms = [match[2], hindi ? undefined : match[3]]
        .map((term) => (term ? normaliseText(term) : ''))
        .filter(Boolean)
      if (terms.length === 0) continue
      claimed.push([index, end])
      hits.push({ index, end, terms, marker: match[1] ? `(${match[1]})` : null, confidence })
    }
  }

  // Quoted first, so an unquoted pass can never re-claim a span a quoted match
  // already owns — the two grammars genuinely overlap on `(a) "X" means`.
  collect(QUOTED, 'high')
  collect(HINDI, 'high', true)
  collect(UNQUOTED, 'low')

  hits.sort((a, b) => a.index - b.index)

  const out: DefinedTerm[] = []
  hits.forEach((hit, position) => {
    const next = hits[position + 1]
    const body = trimBody(text.slice(hit.end, next ? next.index : text.length))
    if (!body) return
    const confidence: DefinitionConfidence =
      hit.confidence === 'high' && hit.marker === null ? 'medium' : hit.confidence
    for (const term of hit.terms) {
      out.push({
        term,
        definition: body,
        marker: hit.marker,
        confidence,
        verify: confidence !== 'high',
      })
    }
  })

  // One term defined twice in one clause is a parse artefact, not a statute:
  // keep the first, which is the one the clause letter actually files it under.
  const seen = new Set<string>()
  return out.filter((entry) => {
    const key = entry.term.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * One pattern matching any of the defined terms in running text.
 *
 * NO `\b`. JavaScript defines a word boundary over `[A-Za-z0-9_]`, so anchoring
 * a Devanagari term with it matches nothing, ever — the trap ADR-035 recorded
 * for `src/ai/agents/law.ts#SECTION_MENTION` and ADR-038 hit again in
 * `corpus.ts`. Unicode letter/number lookarounds say what `\b` was meant to say
 * and say it in both scripts.
 *
 * Longest first, so "Central Public Information Officer" wins over
 * "Information Officer" at the same position.
 */
export function buildTermMatcher(terms: readonly string[]): RegExp | null {
  const cleaned = [...new Set(terms.map((term) => term.trim()).filter((term) => term.length >= 3))].sort(
    (a, b) => b.length - a.length,
  )
  if (cleaned.length === 0) return null

  const alternatives = cleaned.map((term) => escapeRegExp(term).replace(/\\?\s+/g, String.raw`\s+`))
  return new RegExp(String.raw`(?<![\p{L}\p{N}])(?:${alternatives.join('|')})(?![\p{L}\p{N}])`, 'giu')
}

export interface TermOccurrence {
  start: number
  end: number
  /** The matched text as it appears, which is what the popover is anchored to. */
  text: string
  /** The defined term's canonical spelling — the key into the definitions map. */
  term: string
}

/**
 * Where the defined terms occur in one paragraph.
 *
 * Overlaps cannot happen: the matcher is one alternation, so the regex engine
 * takes the longest alternative at each position and continues after it.
 */
export function findTermOccurrences(
  text: string,
  matcher: RegExp | null,
  byLowerCase: ReadonlyMap<string, string>,
): TermOccurrence[] {
  if (!matcher) return []
  const out: TermOccurrence[] = []
  // `lastIndex` is shared state on a `g` regex, and this is called once per
  // paragraph per render — resetting it is what stops the second paragraph
  // starting where the first one left off.
  matcher.lastIndex = 0
  for (const match of text.matchAll(matcher)) {
    const found = match[0]
    const canonical = byLowerCase.get(normaliseText(found).toLowerCase())
    if (!canonical) continue
    out.push({
      start: match.index ?? 0,
      end: (match.index ?? 0) + found.length,
      text: found,
      term: canonical,
    })
  }
  return out
}
