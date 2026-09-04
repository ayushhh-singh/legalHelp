import { extractMeta, findDate, type Confidence, type ExtractedMeta } from './extract'
import { toAsciiDigits } from './format'
import type { Urgency } from './model'

/**
 * Reading a letter that arrived — deterministically, with no model in the room.
 *
 * This is the first pass of the reply flow and it is the one that always runs.
 * An officer with AI switched off — which is every device's default — pastes a
 * letter, gets its reference number, its date, its subject, its urgency, its
 * enclosure count, the provisions it cites and the sentences that ask them for
 * something, and can correct any of them before a reply is drafted. Nothing
 * here reaches the network and nothing here is a guess dressed up as a fact:
 * every field carries the same three-valued `Confidence` `extract.ts` uses, and
 * a field it cannot find comes back empty rather than plausible.
 *
 * ### It is built on `extract.ts`, not beside it
 *
 * Session 30 wrote `extractMeta` for the `.docx`/PDF importers and said in its
 * own header that Session 31 would reuse it, "because two extractors that
 * disagree about what 'the number' is would make a thread that never joins
 * up". That is exactly what would have gone wrong: the register links a reply
 * to the letter it answers by NUMBER, and a second reading of the same page
 * that trimmed a trailing `Estt.` differently would file the two apart. So the
 * number, the date, the subject, the addressee block and the reference line all
 * come from there unchanged, and this file adds only what a REPLY needs.
 *
 * ### The date rule, and why there are two dates
 *
 * A letter has a date on it and a date it was received, and they are different
 * facts about the same paper — the second is what a follow-up is counted from,
 * and it is frequently a week later. `letterDate` is read off the page;
 * `receiptDate` is only ever read from an explicit diary or receipt stamp
 * ("Received on", "प्राप्त दिनांक", "Diary No. … dated …"), never inferred, and
 * is otherwise empty for the officer to fill.
 *
 * ### Provisions are FOUND here and RESOLVED elsewhere
 *
 * `findProvisions` is a pure scan for citations in either script. It does not
 * decide whether BNS 318 exists, nor that IPC 420 maps to it — that needs
 * `data/law` and `data/rules`, which are megabytes and belong behind the
 * caller's lazy import (the rule every module in this app keeps: a pure library
 * takes its datasets as an argument). `resolveProvisions` takes a resolver
 * function and applies the offence-date rule to what it returns.
 */

/* ------------------------------------------------------------------ *
 * Urgency
 * ------------------------------------------------------------------ */

/**
 * The three gradings CSMOP prints, in both languages, including the two Hindi
 * forms an office actually uses.
 *
 * `परम अग्रता` is the Manual's own Hindi for Top Priority and `सर्वोच्च अग्रता`
 * is what everyone expects it to be (CLAUDE.md records the discovery); both are
 * matched, because this is reading somebody else's letter rather than writing
 * our own. Order matters: `topPriority` before `priority`, or "Top Priority"
 * matches as "Priority".
 */
const URGENCY_PATTERNS: ReadonlyArray<{ urgency: Urgency; pattern: RegExp }> = [
  { urgency: 'topPriority', pattern: /\btop\s*priority\b/i },
  { urgency: 'topPriority', pattern: /(परम\s*अग्रता|सर्वोच्च\s*अग्रता)/ },
  { urgency: 'immediate', pattern: /\b(?:most\s+)?immediate\b/i },
  { urgency: 'immediate', pattern: /(तत्काल|अतिआवश्यक)/ },
  { urgency: 'priority', pattern: /\bpriority\b/i },
  { urgency: 'priority', pattern: /प्राथमिकता/ },
]

/** The grading marked on a letter, or `none`. Reads the first page only. */
export function findUrgency(text: string): Urgency {
  const head = text.split(/\r?\n/).slice(0, 12).join('\n')
  for (const { urgency, pattern } of URGENCY_PATTERNS) {
    if (pattern.test(head)) return urgency
  }
  return 'none'
}

/* ------------------------------------------------------------------ *
 * Enclosures
 * ------------------------------------------------------------------ */

/**
 * How many enclosures the letter says it carries.
 *
 * Three shapes, in this order: a stated count ("Encl.: as above (3)",
 * "संलग्न: 2"), a list under an enclosure heading, or nothing. The count is
 * believed over the list when both are present — an office that wrote the
 * number meant it, and a list that looks like two lines may be one enclosure
 * described over two.
 */
export interface EnclosureFinding {
  count: number
  /** The lines listed under the heading, where there were any. */
  items: string[]
  confidence: Confidence
}

const ENCLOSURE_LABEL = /^\s*(?:encl(?:osures?|s?)?\.?|enclosure|संलग्न(?:क)?|अनुलग्नक)\s*[:.\-—]?\s*/i

export function findEnclosures(text: string): EnclosureFinding {
  const lines = text.split(/\r?\n/).map((line) => line.replace(/\s+/g, ' ').trim())
  const at = lines.findIndex((line) => ENCLOSURE_LABEL.test(line) && line.length < 200)
  if (at === -1) return { count: 0, items: [], confidence: 'none' }

  const head = toAsciiDigits((lines[at] ?? '').replace(ENCLOSURE_LABEL, ''))
  const stated = /\((\d{1,3})\)|\b(\d{1,3})\b/.exec(head)
  const items: string[] = []
  for (let index = at + 1; index < lines.length && items.length < 20; index += 1) {
    const line = lines[index] ?? ''
    if (!line) break
    // A numbered or bulleted continuation is another enclosure; anything else
    // has moved on to the next part of the letter.
    if (!/^(?:[(]?\d{1,2}[).]|[-–—•*]|\([ivx]+\))\s+/i.test(line)) break
    items.push(line.replace(/^(?:[(]?\d{1,2}[).]|[-–—•*]|\([ivx]+\))\s+/i, '').trim())
  }

  if (stated) {
    const value = Number(stated[1] ?? stated[2])
    if (Number.isFinite(value) && value > 0 && value < 200) {
      return { count: value, items, confidence: 'high' }
    }
  }
  if (items.length > 0) return { count: items.length, items, confidence: 'low' }
  // "Encl.: as above" with nothing countable. There IS an enclosure line, so
  // the count is at least one, and that is stated as low confidence rather than
  // as zero — zero would be a claim the letter does not make.
  return { count: 1, items: [], confidence: 'low' }
}

/* ------------------------------------------------------------------ *
 * What the letter asks for
 * ------------------------------------------------------------------ */

/**
 * A sentence that asks the officer to do something.
 *
 * `kind` is what makes the chip useful rather than decorative: a deadline is
 * something a follow-up date can be set from, an information request is
 * something a reply has to answer, and a courtesy is neither. `deadline` is the
 * ISO date where the sentence carried one.
 */
export interface Ask {
  text: string
  kind: 'request' | 'deadline' | 'compliance'
  deadline: string
  /** Which sentence of the letter it was, so the chips keep the letter's order. */
  index: number
}

/**
 * The phrases a Government letter asks with, in both languages.
 *
 * Every one is a request FORMULA rather than a verb, and that is the difference
 * between finding three asks and finding thirty. "furnish" alone matches "the
 * information furnished by your office", which is a statement about the past;
 * "may kindly", "it is requested", "you are requested" and "कृपया" are the
 * forms in which an office actually asks.
 */
const ASK_PATTERNS: ReadonlyArray<{ kind: Ask['kind']; pattern: RegExp }> = [
  { kind: 'request', pattern: /\bmay\s+(?:kindly|please)\b/i },
  { kind: 'request', pattern: /\b(?:it|you)\s+(?:is|are)\s+(?:therefore\s+)?requested\b/i },
  { kind: 'request', pattern: /\bare\s+requested\s+to\b/i },
  { kind: 'request', pattern: /\bkindly\s+(?:furnish|provide|intimate|arrange|confirm|forward)\b/i },
  { kind: 'request', pattern: /\bplease\s+(?:furnish|provide|intimate|arrange|confirm|forward)\b/i },
  { kind: 'request', pattern: /\bis\s+requested\s+to\s+furnish\b/i },
  { kind: 'request', pattern: /(कृपया|अनुरोध\s+(?:है|किया\s+जाता\s+है))/ },
  { kind: 'request', pattern: /(प्रेषित\s+कर(?:ें|ने)|उपलब्ध\s+कराने?\s+का\s+कष्ट)/ },
  { kind: 'compliance', pattern: /\b(?:compliance|action\s+taken)\s+report\b/i },
  { kind: 'compliance', pattern: /\bfor\s+(?:necessary|immediate)\s+action\b/i },
  { kind: 'compliance', pattern: /(अनुपालन\s+रिपोर्ट|आवश्यक\s+कार्रवाई)/ },
]

/**
 * A time limit stated in a sentence.
 *
 * Two shapes: a date ("by 30.09.2026") and a period ("within 15 days",
 * "within a fortnight"). The period is NOT turned into a date here — the letter
 * date and the receipt date are different starting points and the officer is
 * the one who knows which their office counts from. `days` is reported so the
 * chip can offer it.
 */
const DEADLINE_LEAD = /\b(?:by|before|on\s+or\s+before|latest\s+by|not\s+later\s+than)\b/i
const DEADLINE_LEAD_HI = /(तक|से\s+पूर्व|के\s+भीतर)/
const WITHIN_DAYS = /\bwithin\s+(\d{1,3})\s+(day|week|month)s?\b/i
const WITHIN_DAYS_HI = /(\d{1,3})\s*(दिन|सप्ताह|माह|मास)\s*(?:के\s+भीतर|में)/

/** Sentences, in either script. The danda ends a sentence as a full stop does. */
export function sentencesOf(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.।?!])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0)
}

export function findAsks(text: string): Ask[] {
  const out: Ask[] = []
  sentencesOf(text).forEach((sentence, index) => {
    const matched = ASK_PATTERNS.find(({ pattern }) => pattern.test(sentence))
    if (!matched) return
    const deadline = deadlineIn(sentence)
    out.push({
      text: sentence,
      kind: deadline ? 'deadline' : matched.kind,
      deadline: deadline ?? '',
      index,
    })
  })
  return out
}

/** The ISO date a sentence sets a limit for, or `null`. */
export function deadlineIn(sentence: string): string | null {
  if (!DEADLINE_LEAD.test(sentence) && !DEADLINE_LEAD_HI.test(sentence)) return null
  const found = findDate(sentence)
  return found ? found.iso : null
}

/** A period a sentence gives, in days, or `null`. Never converted to a date. */
export function periodIn(sentence: string): number | null {
  const ascii = toAsciiDigits(sentence)
  const english = WITHIN_DAYS.exec(ascii)
  if (english) {
    const value = Number(english[1])
    const unit = (english[2] ?? '').toLowerCase()
    return unit === 'week' ? value * 7 : unit === 'month' ? value * 30 : value
  }
  const hindi = WITHIN_DAYS_HI.exec(ascii)
  if (hindi) {
    const value = Number(hindi[1])
    const unit = hindi[2] ?? ''
    return unit === 'सप्ताह' ? value * 7 : unit === 'दिन' ? value : value * 30
  }
  return null
}

/* ------------------------------------------------------------------ *
 * Provisions
 * ------------------------------------------------------------------ */

/**
 * A citation as the letter wrote it.
 *
 * `act` is the words around the number, verbatim, and `number` is the number
 * with its letter suffix and sub-clause intact — `65B`, `318(4)`, `18(2)`.
 * Keeping the suffix is ADR-035's `refKey()` lesson: 124 and 124A are different
 * sections, and a key that throws structure away throws identity away with it.
 */
export interface FoundProvision {
  /** As printed: "Section 420 of the Indian Penal Code". */
  text: string
  /** `section`, `rule`, `regulation`, `article`, `paragraph`, `order`. */
  unit: string
  number: string
  /** The Act's name as the letter gave it, or `''`. */
  act: string
}

/**
 * The unit words, longest first.
 *
 * Order is load-bearing for the reason `src/lib/retrieval.ts` states at its own
 * alternation: `section` must come before `sec` before `s`, or `s` matches the
 * first letter of "section" and the number group is handed "ection".
 *
 * The Devanagari alternatives carry no `\b`. JavaScript defines a word boundary
 * over `[A-Za-z0-9_]`, so `/\bधारा/` matches nothing, ever — the trap ADR-035
 * recorded and ADR-038 hit again. And no `?` quantifier is used on a Devanagari
 * plural: `नियमों?` reads as "नियमो plus an optional anusvara" and never matches
 * the singular at all (ADR-039). The plural forms are written out in full.
 */
const UNIT_WORDS =
  '(?:sections?|section|rules?|regulations?|articles?|paras?|paragraphs?|orders?|clauses?|sub-rules?|धाराओं|धाराएँ|धारा|नियमों|नियमावली|नियम|विनियमों|विनियम|अनुच्छेदों|अनुच्छेद|पैरा|उप-नियम|खंड)'

const UNIT_CANON: ReadonlyArray<{ unit: string; pattern: RegExp }> = [
  { unit: 'section', pattern: /^(?:sections?|धारा)/i },
  { unit: 'rule', pattern: /^(?:sub-rules?|rules?|नियम|उप-नियम)/i },
  { unit: 'regulation', pattern: /^(?:regulations?|विनियम)/i },
  { unit: 'article', pattern: /^(?:articles?|अनुच्छेद)/i },
  { unit: 'paragraph', pattern: /^(?:paras?|paragraphs?|पैरा)/i },
  { unit: 'order', pattern: /^orders?/i },
  { unit: 'clause', pattern: /^(?:clauses?|खंड)/i },
]

/**
 * The number itself: digits, an optional upper-case letter suffix, and any
 * number of bracketed sub-clauses.
 *
 * `318(4)` and `65B` and `18(2)(a)` all have to survive whole. The letter
 * suffix is upper-case only and the sub-clause is not, which is the split
 * `normaliseSectionRef` in the law module already makes for the same reason.
 */
const PROVISION_NUMBER = '(\\d{1,4}[A-Z]{0,2}(?:\\s*\\([0-9a-zA-Z]{1,4}\\))*)'

/**
 * The Act name after a number, where the letter gave one.
 *
 * Capped at eighty characters and stopped at a full stop or a comma-plus-space,
 * because "of the Indian Penal Code, 1860" is an Act name and "of the Indian
 * Penal Code. The matter was examined" is an Act name followed by the next
 * sentence.
 */
const ACT_TAIL =
  /^\s*(?:of|under|,)?\s*(?:the\s+)?([A-Z][^.;\n]{2,80}?(?:Act|Code|Rules|Regulations|Sanhita|Adhiniyam)(?:,\s*\d{4})?)/

export function findProvisions(text: string): FoundProvision[] {
  const source = text.replace(/\s+/g, ' ')
  const pattern = new RegExp(`${UNIT_WORDS}\\s*\\.?\\s*${PROVISION_NUMBER}`, 'gi')
  const out: FoundProvision[] = []
  const seen = new Set<string>()

  for (const match of source.matchAll(pattern)) {
    const whole = match[0]
    const number = (match[1] ?? '').replace(/\s+/g, '')
    if (!number) continue
    const unitWord = whole.slice(0, whole.length - (match[1] ?? '').length)
    const unit = UNIT_CANON.find((entry) => entry.pattern.test(unitWord.trim()))?.unit ?? 'section'
    const after = source.slice((match.index ?? 0) + whole.length)
    const act = ACT_TAIL.exec(after)?.[1]?.trim() ?? ''
    const key = `${unit}:${number}:${act.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ text: `${whole.trim()}${act ? ` of the ${act}` : ''}`, unit, number, act })
  }
  return out
}

/* ------------------------------------------------------------------ *
 * Resolution — the offence-date rule
 * ------------------------------------------------------------------ */

/**
 * The day the three Sanhitas came into force.
 *
 * The same boundary the Law Converter applies, restated here because this
 * module is pure and may not import the converter's engine (which pulls
 * `data/law`). It is a date, not a lookup, and it is the one fact the rule
 * turns on.
 */
export const SANHITA_COMMENCEMENT = '2024-07-01'

/** Which era a date falls in. An empty date answers `unknown`, never a guess. */
export function eraOf(offenceDateIso: string): 'old' | 'new' | 'unknown' {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(offenceDateIso)) return 'unknown'
  return offenceDateIso < SANHITA_COMMENCEMENT ? 'old' : 'new'
}

/**
 * What the caller's resolver is asked for, and what it may answer.
 *
 * The resolver is injected so this file stays pure. `null` means "this app has
 * nothing for that citation", which is a real and common answer — a letter
 * citing the Companies Act is citing something Sahayak does not hold — and it
 * must not be confused with "the citation was wrong".
 */
export interface ProvisionResolution {
  /** How the app cites it: "BNS 318" or "Rule 18, CCS (Conduct) Rules, 1964". */
  citation: string
  /** Where the reader can open it. A route in this app. */
  href: string
  /** Set when the citation named a repealed provision that maps to a new one. */
  replacedBy?: { citation: string; href: string }
  /** The snippet id backing it, when the resolver came from retrieval. */
  snippetId?: string
}

export type ProvisionResolver = (found: FoundProvision) => ProvisionResolution | null

export interface ResolvedProvision extends FoundProvision {
  resolution: ProvisionResolution | null
  /**
   * The bilingual note the officer must see when a repealed provision was
   * cited, or `null`. Composed here because it is a statement of the DATE RULE,
   * which the app knows and a model must never be asked to state — the same
   * decision `dateRuleCaveat()` makes for the law agent (ADR-035).
   */
  note: { en: string; hi: string } | null
}

/**
 * Resolve what was found, and say what the date rule means for it.
 *
 * `offenceDateIso` is the date of the OFFENCE where one is known, not the date
 * of the letter: which code applies turns on when the thing happened. When it
 * is not known — which is the ordinary case for an inbound letter — the note
 * says so rather than choosing an era, because choosing one silently is how an
 * officer ends up citing the wrong Sanhita in a reply they signed.
 */
export function resolveProvisions(
  found: readonly FoundProvision[],
  resolve: ProvisionResolver,
  offenceDateIso = '',
): ResolvedProvision[] {
  const era = eraOf(offenceDateIso)
  return found.map((provision) => {
    const resolution = resolve(provision)
    const replaced = resolution?.replacedBy
    if (!replaced) return { ...provision, resolution, note: null }

    const oldCitation = resolution.citation
    const newCitation = replaced.citation
    const note =
      era === 'old'
        ? {
            en: `${oldCitation} was repealed on 1 July 2024 and ${newCitation} replaced it. The offence date given is before that day, so ${oldCitation} still governs — cite it, and mention ${newCitation} only for reference.`,
            hi: `${oldCitation} 1 जुलाई 2024 को निरसित हुई और ${newCitation} ने उसका स्थान लिया। दिया गया अपराध-दिनांक उससे पहले का है, अतः ${oldCitation} ही लागू रहेगी — उसी का उल्लेख करें और ${newCitation} का उल्लेख केवल संदर्भ के लिए करें।`,
          }
        : era === 'new'
          ? {
              en: `${oldCitation} was repealed on 1 July 2024. The offence date given is on or after that day, so ${newCitation} governs.`,
              hi: `${oldCitation} 1 जुलाई 2024 को निरसित हो गई। दिया गया अपराध-दिनांक उस दिन या उसके बाद का है, अतः ${newCitation} लागू होगी।`,
            }
          : {
              en: `The letter cites ${oldCitation}, which was repealed on 1 July 2024; ${newCitation} replaced it. Which one applies turns on the date of the offence, and this app has not been given one — check the date before citing either.`,
              hi: `पत्र में ${oldCitation} का उल्लेख है, जो 1 जुलाई 2024 को निरसित हो गई; ${newCitation} ने उसका स्थान लिया। कौन-सी लागू होगी यह अपराध-दिनांक पर निर्भर है, और वह इस ऐप को नहीं बताया गया — किसी का भी उल्लेख करने से पहले दिनांक देख लें।`,
            }
    return { ...provision, resolution, note }
  })
}

/* ------------------------------------------------------------------ *
 * The whole reading
 * ------------------------------------------------------------------ */

/** The sender's block, where the letter printed one above the reference. */
export interface IntakeAnalysis {
  /** The four facts `extract.ts` reads: number, date, subject, addressee, reference. */
  meta: ExtractedMeta
  /** The letter's own date, ISO. The same value as `meta.dateIso`, named. */
  letterDate: string
  /** Read only from an explicit receipt or diary stamp; empty otherwise. */
  receiptDate: string
  receiptDateConfidence: Confidence
  /** The diary number the receiving office stamped, where there was one. */
  diaryNumber: string
  urgency: Urgency
  enclosures: EnclosureFinding
  asks: Ask[]
  provisions: FoundProvision[]
  /** Every reference number the letter quotes, including its own, in order. */
  references: string[]
}

const RECEIPT_LABEL =
  /(?:received\s+on|date\s+of\s+receipt|receipt\s+date|diary\s+no\.?|dy\.?\s*no\.?|प्राप्त\s*(?:दिनांक|तिथि)|डायरी\s*(?:सं\.?|संख्या))/i

/**
 * The reference numbers a letter quotes.
 *
 * Its own is `meta.number`; the ones it quotes are on the lines that carry a
 * reference lead ("with reference to your letter no. X"). Both are returned,
 * its own first, because the register's duplicate check and the thread link
 * both need every number on the page rather than the one at the top.
 */
const REFERENCE_LEAD =
  /(?:with\s+reference\s+to|in\s+continuation\s+of|reference\s+is\s+invited\s+to|your\s+(?:letter|o\.?m\.?|d\.?o\.?)|vide|के\s+संदर्भ\s+में|के\s+क्रम\s+में)/i

/** Every file-number-shaped token on a line. Deliberately greedier than `findNumber`. */
const NUMBER_LIKE = /[A-Za-z0-9ऄ-ह०-९][^\s,;:"'<>]*\/[^\s,;:"'<>]+/g

/**
 * The letter with the receiving office's own stamp taken off it.
 *
 * A diary stamp sits ABOVE the letterhead — "Diary No. 4417 dated 27.08.2026",
 * "Received on 27.08.2026" — and it carries a labelled date. `extractMeta`
 * believes a labelled date over an unlabelled one, correctly, so on a stamped
 * letter it was reading the day the paper reached the office as the day the
 * letter was written. The two are different facts and the whole reason this
 * module reports both.
 *
 * The fix is here rather than in `extract.ts` deliberately. That file answers
 * "what does this page say about itself" and is right as it stands — a `.docx`
 * of the office's OWN document has no receipt stamp on it, so changing its date
 * rule would be paying for this case everywhere. Which of two dates is the
 * letter's is a question only inbound paper has, and this is the module that
 * has it.
 *
 * The stamp lines are blanked rather than deleted, so every line index the rest
 * of this function computes still lines up with the text the officer pasted.
 */
export function stripReceiptStamp(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => (RECEIPT_LABEL.test(line) ? '' : line))
    .join('\n')
}

export function analyseIntake(text: string): IntakeAnalysis {
  const meta = extractMeta(stripReceiptStamp(text))
  const lines = text.split(/\r?\n/).map((line) => line.replace(/\s+/g, ' ').trim())

  let receiptDate = ''
  let receiptDateConfidence: Confidence = 'none'
  let diaryNumber = ''
  for (const line of lines.slice(0, 60)) {
    if (!RECEIPT_LABEL.test(line)) continue
    const found = findDate(line)
    if (found && !receiptDate) {
      receiptDate = found.iso
      receiptDateConfidence = 'high'
    }
    if (!diaryNumber) {
      const diary = /(?:diary\s+no\.?|dy\.?\s*no\.?|डायरी\s*(?:सं\.?|संख्या))\s*[:.-]?\s*([^\s,;]+)/i.exec(
        line,
      )
      if (diary?.[1]) diaryNumber = diary[1].replace(/[,;]+$/, '')
    }
  }

  const references: string[] = []
  const pushReference = (value: string) => {
    const trimmed = value.replace(/[,;]+$/, '')
    if (trimmed && !references.includes(trimmed)) references.push(trimmed)
  }
  if (meta.number) pushReference(meta.number)
  for (const line of lines) {
    if (!REFERENCE_LEAD.test(line)) continue
    for (const match of line.matchAll(NUMBER_LIKE)) pushReference(match[0])
  }

  return {
    meta,
    letterDate: meta.dateIso,
    receiptDate,
    receiptDateConfidence,
    diaryNumber,
    urgency: findUrgency(text),
    enclosures: findEnclosures(text),
    asks: findAsks(text),
    provisions: findProvisions(text),
    references,
  }
}
