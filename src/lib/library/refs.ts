import { normaliseText } from './anchor'

/**
 * "Rule 12", "sub-rule (2) of rule 18", "section 8(1)(j)", "धारा 24" — turning
 * a citation a document writes into a link a reader can follow.
 *
 * The hard part is not finding the words; it is deciding WHAT a citation points
 * at. Three rules do that work, and each of them exists because the obvious
 * alternative is wrong:
 *
 * 1. **A chain is read to its bare number.** "clause (a) of sub-section (1) of
 *    section 4" is ONE reference to section 4, not three references to a
 *    clause, a sub-section and a section. The parenthesised parts become a
 *    `path` — kept, because it is what the popover shows and what a future
 *    sub-unit anchor would need — and the bare number is the unit to open.
 *    Hindi writes the same citation in the opposite order ("नियम 18 के उप-नियम
 *    (2)"), which costs nothing here precisely because the target is chosen by
 *    being the bare number rather than by being last.
 *
 * 2. **An Act is recognised, never guessed.** A capitalised run after "of the"
 *    is not an Act name — it is a Ministry, a Schedule, a Commission and an
 *    officer's designation about as often as it is an Act. So the Act must
 *    match a pattern the caller supplied, and a citation naming an Act nobody
 *    knows resolves to nothing rather than to this document's own rule 12.
 *
 * 3. **An unnamed citation means THIS document.** That is the drafting
 *    convention every one of these fifteen works follows, and it is also why
 *    `src/lib/library/crossRefs.ts` was written narrowly: "section 4" inside
 *    the CCS (Leave) Rules means Rule 4 of those rules, and offering it as a
 *    link to BNS 4 would be worse than offering nothing. That file now
 *    delegates here rather than carrying a second grammar.
 *
 * Pure. Resolution against a real corpus is `resolveReference`, which takes a
 * lookup function rather than a corpus so this file stays free of the 5.5 MB
 * of statute the module loads.
 */

export type ReferenceKind = 'rule' | 'section' | 'paragraph' | 'clause' | 'regulation' | 'article'

/** Longest alternative first — `sub-section` must win over `section`. */
const UNIT_WORDS: ReadonlyArray<{ pattern: string; kind: ReferenceKind; sub: boolean }> = [
  { pattern: String.raw`sub-?\s?sections?`, kind: 'section', sub: true },
  { pattern: String.raw`sub-?\s?rules?`, kind: 'rule', sub: true },
  { pattern: String.raw`sub-?\s?clauses?`, kind: 'clause', sub: true },
  { pattern: String.raw`sub-?\s?paragraphs?`, kind: 'paragraph', sub: true },
  { pattern: String.raw`regulations?`, kind: 'regulation', sub: false },
  { pattern: String.raw`paragraphs?`, kind: 'paragraph', sub: false },
  { pattern: String.raw`articles?`, kind: 'article', sub: false },
  { pattern: String.raw`sections?`, kind: 'section', sub: false },
  { pattern: String.raw`clauses?`, kind: 'clause', sub: false },
  { pattern: String.raw`rules?`, kind: 'rule', sub: false },
  { pattern: String.raw`paras?`, kind: 'paragraph', sub: false },
  // FR/SR print their own unit word into the number — `data/rules/text/fr-sr.json`
  // numbers a rule "F.R. 9" — so the citation "F.R. 9" carries no separate word.
  { pattern: String.raw`F\.\s?R\.`, kind: 'rule', sub: false },
  { pattern: String.raw`S\.\s?R\.`, kind: 'rule', sub: false },
  /**
   * THE PLURAL SUFFIX IS A GROUP, NEVER A BARE `?`.
   *
   * `नियमों?` does not mean "नियम, optionally plural". `?` quantifies ONE code
   * point, and the Devanagari plural is two — so that pattern reads as "नियमो
   * followed by an optional anusvara" and matches the singular नियम not at all.
   * The first version of this list had it, every Hindi sub-rule fixture came
   * back with an empty path, and `उप-नियम` matched nothing whatsoever because
   * its only alternative carried the same mistake.
   *
   * This is the ADR-035 word-boundary trap in a different costume: a quantifier
   * that is correct for Latin and silently wrong for Devanagari, in a list that
   * looks symmetric. Anything added here owes itself a Hindi fixture in
   * `refs.test.ts`; the English half passing is not evidence.
   */
  { pattern: String.raw`उप-?\s?धारा(?:ओं|एँ|एं)?`, kind: 'section', sub: true },
  { pattern: String.raw`उप-?\s?नियम(?:ों)?`, kind: 'rule', sub: true },
  { pattern: String.raw`उप-?\s?खंड(?:ों)?`, kind: 'clause', sub: true },
  { pattern: String.raw`विनियम(?:ों)?`, kind: 'regulation', sub: false },
  { pattern: String.raw`अनुच्छेद(?:ों)?`, kind: 'article', sub: false },
  { pattern: String.raw`धारा(?:ओं|एँ|एं)?`, kind: 'section', sub: false },
  { pattern: String.raw`नियम(?:ों)?`, kind: 'rule', sub: false },
  { pattern: String.raw`खंड(?:ों)?`, kind: 'clause', sub: false },
  { pattern: String.raw`पैरा(?:ओं)?`, kind: 'paragraph', sub: false },
]

/** `12`, `12A`, `4.7`, `65B` — never a bare `(1)`, which is a sub-reference. */
const BARE_NUMBER = String.raw`\d+(?:\.\d+)*[A-Z]{0,2}`
const PAREN = String.raw`\(\s*[^()\s]{1,6}\s*\)`

const COMPONENT = new RegExp(
  String.raw`(?<![\p{L}\p{N}])(${UNIT_WORDS.map((word) => word.pattern).join('|')})` +
    String.raw`\s*(?:(${BARE_NUMBER})|(${PAREN}))((?:\s*${PAREN})*)`,
  'giu',
)

/**
 * "of the <Something> Act, 2013" — an Act this Library does not hold.
 *
 * Matched only to be REFUSED. Without it a citation into an Act nobody here
 * knows falls through to "this document", which is the one wrong answer that
 * looks exactly like a right one.
 */
const NAMED_ACT =
  /^\s*(?:of|under)\s+the\s+((?:[A-Z][\w'.-]*|\(|\)|of|for|and|at|in|the|to|\d{4}|,|-)+?\s(?:Act|Rules|Code|Regulations|Order|Sanhita|Adhiniyam|Constitution))\b/

/** A citation that says "this document" in so many words is not an unknown Act. */
const SELF_REFERENCE = /^\s*(?:of|under)\s+(?:these|this|the\s+said|the\s+present)\s/i

/** What joins two components of one citation. */
const CONNECTOR = /^\s*(?:of|under|in)\s+(?:the\s+)?$|^\s*(?:का|के|की|में)\s+$/u

export interface ActPattern {
  /** A library work id (`rti`), or a criminal-code id the Law Converter knows (`IPC`). */
  id: string
  /** Whether `id` names a work in this Library or a code in the Law Converter. */
  target: 'work' | 'law'
  pattern: RegExp
}

/**
 * The Acts a citation in this corpus can name.
 *
 * The six criminal codes are the same list `crossRefs.ts` carried, kept here
 * because that file now delegates. The twelve rule books are named the way
 * these documents actually cite each other, which is not always their title —
 * "the Fundamental Rules", "the Leave Rules", "the said rules".
 */
export const DEFAULT_ACTS: readonly ActPattern[] = [
  { id: 'IPC', target: 'law', pattern: /Indian Penal Code/i },
  { id: 'CrPC', target: 'law', pattern: /Code of Criminal Procedure/i },
  { id: 'IEA', target: 'law', pattern: /Indian Evidence Act/i },
  { id: 'BNS', target: 'law', pattern: /Bharatiya Nyaya Sanhita/i },
  { id: 'BNSS', target: 'law', pattern: /Bharatiya Nagarik Suraksha Sanhita/i },
  { id: 'BSA', target: 'law', pattern: /Bharatiya Sakshya Adhiniyam/i },
  { id: 'rti', target: 'work', pattern: /Right to Information Act/i },
  { id: 'osa', target: 'work', pattern: /Official Secrets Act/i },
  { id: 'posh', target: 'work', pattern: /Sexual Harassment of Women at Workplace/i },
  { id: 'ol-act', target: 'work', pattern: /Official Languages? Act/i },
  {
    id: 'ol-rules',
    target: 'work',
    pattern: /Official Languages? \(Use for Official Purposes of the Union\) Rules/i,
  },
  { id: 'gfr', target: 'work', pattern: /General Financial Rules/i },
  { id: 'fr-sr', target: 'work', pattern: /Fundamental Rules|Supplementary Rules/i },
  { id: 'ccs-conduct', target: 'work', pattern: /\(Conduct\) Rules/i },
  { id: 'ccs-cca', target: 'work', pattern: /\(Classification, Control and Appeal\) Rules|\(CCA\) Rules/i },
  { id: 'ccs-leave', target: 'work', pattern: /\(Leave\) Rules/i },
  { id: 'ccs-pension', target: 'work', pattern: /\(Pension\) Rules/i },
  { id: 'csmop', target: 'work', pattern: /Manual of Office Procedure/i },
]

export interface UnitReference {
  kind: ReferenceKind
  /** The unit number as printed — "12", "8", "4.7", "F.R. 9" without its word. */
  number: string
  /** Sub-references, outermost first: `["(1)", "(j)"]` for "section 8(1)(j)". */
  path: string[]
  /** The Act the citation names, or `null` for "this document". */
  act: ActPattern | null
  /**
   * An Act was named and is not one this Library holds — "the Companies Act,
   * 2013".
   *
   * Kept distinct from `act: null`, which means "this document", because
   * collapsing the two is how "section 4 of the Companies Act" becomes a link
   * to rule 4 of whatever the reader happens to have open. A citation with this
   * set resolves to nothing and renders as plain text.
   */
  unknownAct: string | null
  /** Character offsets into the text that was scanned. */
  start: number
  end: number
  /** Exactly what the document wrote, for rendering the link over it. */
  raw: string
}

interface Component {
  kind: ReferenceKind
  sub: boolean
  number: string | null
  parens: string[]
  start: number
  end: number
}

const kindFor = (word: string): { kind: ReferenceKind; sub: boolean } => {
  const cleaned = word.trim()
  for (const entry of UNIT_WORDS) {
    if (new RegExp(`^(?:${entry.pattern})$`, 'iu').test(cleaned)) return { kind: entry.kind, sub: entry.sub }
  }
  return { kind: 'section', sub: false }
}

const parensIn = (value: string): string[] =>
  [...value.matchAll(/\(\s*([^()\s]{1,6})\s*\)/g)].map((match) => `(${match[1] ?? ''})`)

/**
 * Every citation in one passage.
 *
 * Offsets are into the string that was passed in, so the caller must pass the
 * SAME normalised paragraph it renders — the reader does, which is what lets a
 * link be drawn over exactly the words the document wrote.
 */
export function findReferences(text: string, acts: readonly ActPattern[] = DEFAULT_ACTS): UnitReference[] {
  const components: Component[] = []
  COMPONENT.lastIndex = 0
  for (const match of text.matchAll(COMPONENT)) {
    const { kind, sub } = kindFor(match[1] ?? '')
    components.push({
      kind,
      sub,
      number: match[2] ?? null,
      parens: [...(match[3] ? parensIn(match[3]) : []), ...parensIn(match[4] ?? '')],
      start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
    })
  }

  // Chain components that are joined by "of the" / "के" and nothing else.
  const chains: Component[][] = []
  for (const component of components) {
    const chain = chains.at(-1)
    const previous = chain?.at(-1)
    if (chain && previous && CONNECTOR.test(text.slice(previous.end, component.start))) chain.push(component)
    else chains.push([component])
  }

  const out: UnitReference[] = []
  for (const chain of chains) {
    // The bare number is the unit to open. A chain of nothing but
    // parenthesised parts — "sub-rule (2)" on its own — is a reference INSIDE
    // the unit being read, which is already on screen: nothing to link to.
    let targetAt = -1
    for (let index = chain.length - 1; index >= 0; index -= 1) {
      if (chain[index]?.number) {
        targetAt = index
        break
      }
    }
    if (targetAt < 0) continue

    const target = chain[targetAt]
    if (!target?.number) continue

    const before = chain.slice(0, targetAt).reverse()
    const after = chain.slice(targetAt + 1)
    const path = [
      ...before.flatMap((component) => component.parens),
      ...target.parens,
      ...after.flatMap((component) => component.parens),
    ]

    const first = chain[0]
    const last = chain.at(-1)
    if (!first || !last) continue

    // "… of the Indian Penal Code" sits AFTER the chain, and only a pattern the
    // caller declared counts. 60 characters is enough for the longest Act name
    // in this corpus and short enough that the next sentence cannot be read as
    // one.
    const trailing = text.slice(last.end, last.end + 90)
    const named = /^\s*(?:of|under)\s+(?:the\s+)?/i.exec(trailing)
    let act: ActPattern | null = null
    let unknownAct: string | null = null
    let end = last.end
    if (named) {
      const rest = trailing.slice(named[0].length)
      for (const candidate of acts) {
        const found = candidate.pattern.exec(rest)
        // Not anchored at 0: a rule book is cited as "the CCS (Conduct) Rules,
        // 1964", and the half that identifies it is the tail. What bounds the
        // search instead is that everything before the match must still be part
        // of one name — short, and with no sentence punctuation in it.
        if (found && found.index <= 45 && !/[.;,]/.test(rest.slice(0, found.index))) {
          act = candidate
          end = last.end + named[0].length + found.index + found[0].length
          break
        }
      }
      if (!act && !SELF_REFERENCE.test(trailing)) {
        const foreign = NAMED_ACT.exec(trailing)
        if (foreign?.[1]) {
          unknownAct = foreign[1].trim()
          end = last.end + foreign[0].length
        }
      }
    }

    out.push({
      kind: target.kind,
      number: target.number,
      path,
      act,
      unknownAct,
      start: first.start,
      end,
      raw: text.slice(first.start, end),
    })
  }

  return out
}

export interface ReferenceTarget {
  /** A unit of a Library work. */
  workId: string
  unitId: string
}

/**
 * Where one citation goes.
 *
 * `resolveUnitId` is the caller's corpus, reduced to the only question this
 * needs to ask: does this work print a unit with this number? It answers for a
 * work id, so a citation naming another rule book resolves without this file
 * ever seeing a corpus.
 *
 * A citation into a criminal code resolves to a Law Converter QUERY rather than
 * a document id, for the reason ADR-029 point 4 records: `data/law`'s three
 * codes each restart their numbering, and a bare number re-parses on a fresh
 * visit as the repealed Act's section.
 */
export function resolveReference(
  reference: UnitReference,
  currentWorkId: string,
  resolveUnitId: (workId: string, number: string) => string | null,
): { kind: 'unit'; workId: string; unitId: string } | { kind: 'law'; query: string } | null {
  // An Act this Library does not hold is not this document. Resolving it to the
  // current work is the failure mode this field exists to prevent.
  if (reference.unknownAct) return null
  if (reference.act?.target === 'law') {
    return { kind: 'law', query: `${reference.act.id} ${reference.number}` }
  }
  const workId = reference.act?.id ?? currentWorkId
  const unitId = resolveUnitId(workId, reference.number)
  return unitId ? { kind: 'unit', workId, unitId } : null
}

/** How a resolved citation reads on a chip: "Rule 18(2)". */
export function referenceLabel(reference: UnitReference): string {
  return `${reference.number}${reference.path.join('')}`
}

/** Normalise a passage before scanning it, so offsets match what is rendered. */
export const scannableText = (text: string): string => normaliseText(text)
