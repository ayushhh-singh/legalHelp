import { normaliseText } from './anchor'

/**
 * Cutting a pasted or uploaded document into readable units.
 *
 * An officer who has a departmental manual as a PDF, or a rule the app does not
 * ship, should be able to read it here with the same annotations, definitions
 * and cross-references as everything else. That means turning a wall of
 * extracted text into numbered units — and doing it in a way the officer can
 * correct, because no heuristic over an arbitrary PDF is going to be right
 * every time.
 *
 * So this returns CONFIDENCE per unit and nothing is saved until it has been
 * reviewed. `src/modules/library/pages/AddWorkPage.tsx` shows the raw text
 * beside the proposed split and lets every unit be merged, divided, retitled,
 * renumbered or deleted first. A splitter that is confidently wrong is worse
 * than one that says "I am not sure about this one".
 *
 * PURE, and it never reaches the network: extraction from PDF and DOCX is the
 * caller's job (`src/modules/library/personal/extract.ts`), and it is done on
 * the device with no OCR — a scanned page with no text layer is refused with a
 * sentence saying why rather than guessed at.
 */

export type SplitConfidence = 'high' | 'medium' | 'low'

export interface SplitUnit {
  /** As the document prints it: "12", "12A", "4.7", "IV". */
  number: string
  /** The title on the same line as the number, where there is one. */
  heading: string
  text: string
  confidence: SplitConfidence
  /** The CHAPTER or PART this unit fell under, for the table of contents. */
  division: string | null
}

export interface SplitDivision {
  /** "CHAPTER IV", "PART II", "अध्याय 3". */
  label: string
  title: string
  /** Index into `units` of the first unit under this division. */
  from: number
}

export interface SplitResult {
  units: SplitUnit[]
  divisions: SplitDivision[]
  /** What the splitter could not do, in plain words, for the review screen. */
  notes: string[]
}

/** `CHAPTER IV — Preliminary`, `PART II`, `अध्याय 3`. */
const DIVISION =
  /^\s*(CHAPTER|Chapter|PART|Part|SCHEDULE|Schedule|अध्याय|भाग|अनुसूची)\s+([IVXLCivxlc]+|\d+[A-Z]?)\s*[.:—–-]?\s*(.*)$/

/** `Section 12.`, `Rule 12(1)`, `नियम 12` — a unit word and its number. */
const WORDED =
  /^\s*(?:Sections?|Rules?|Regulations?|Articles?|Paras?|Paragraphs?|धारा|नियम|विनियम|अनुच्छेद|पैरा)\s+(\d+[A-Z]{0,2}(?:\.\d+)*)\s*(?:\([^)]{1,4}\))?\s*[.:—–-]*\s*(.*)$/

/** `12. Definitions.—` / `12) …` — a number in the left margin. */
const NUMBERED = /^\s*(\d+[A-Z]{0,2}(?:\.\d+)*)\s*[.)]\s*[—–-]?\s*(.*)$/

/** `12(1) …` — a rule that opens straight into its first sub-rule. */
const NUMBER_SUB = /^\s*(\d+[A-Z]{0,2})\s*\(\s*1\s*\)\s*(.*)$/

/** `IV. Preliminary` — a roman-numbered division used as a unit number. */
const ROMAN = /^\s*([IVXLC]{1,6})\s*[.)]\s+(\S.*)$/

/**
 * Lines that continue the unit above, whatever else they look like.
 *
 * `(a)`, `(1)` and `(i)` are the reason this list exists: `NUMBERED` would
 * happily read "(1) The Central Government may" as unit 1 of the document, and
 * every rule with sub-rules would be shredded into its own sub-rules. Provisos,
 * explanations and illustrations are the session brief's own requirement and
 * the same four places `paragraphs()` in `corpus.ts` breaks.
 */
const CONTINUATION =
  /^\s*(?:\(\s*[a-z0-9ivxl]{1,4}\s*\)|Provided|PROVIDED|Explanation|EXPLANATION|Illustrations?|Note|NOTE|परन्तु|परंतु|स्पष्टीकरण|दृष्टांत|टिप्पणी)/

/** A heading, or the first sentence of a body — the two look alike and are not. */
const HEADING_MAX = 120

function splitHeadingFromBody(rest: string): { heading: string; body: string } {
  const trimmed = rest.trim()
  if (!trimmed) return { heading: '', body: '' }

  // The whole remainder of the start line is the heading, and the body begins
  // on the line below — `Section 12. Power to make rules` with the provision
  // under it. Recognised by what it lacks: a sentence ending, and any internal
  // full stop. Without this the heading is lost and the title reads as the
  // first words of the provision.
  if (trimmed.length <= HEADING_MAX && !/[.;:।]$/.test(trimmed) && !/[.;]\s/.test(trimmed)) {
    return { heading: trimmed, body: '' }
  }

  // A statute writes `Definitions.—In these rules…`; the em-dash pair is the
  // most reliable heading terminator there is, and it is unambiguous.
  const dash = /^(.{1,120}?)\s*[.:]?\s*[—–]\s*(.*)$/s.exec(trimmed)
  if (dash?.[1] && !/[.;]\s/.test(dash[1])) {
    return { heading: dash[1].trim(), body: (dash[2] ?? '').trim() }
  }

  // Otherwise a short opening sentence with no internal full stop reads as a
  // title. Anything longer is prose and the unit simply has no heading, which
  // is a state four of the twelve bundled rule books are already in.
  const stop = /^(.{1,120}?)\.\s+(\S.*)$/s.exec(trimmed)
  if (stop?.[1] && stop[1].length <= HEADING_MAX && !/[.;]/.test(stop[1])) {
    return { heading: stop[1].trim(), body: (stop[2] ?? '').trim() }
  }

  return { heading: '', body: trimmed }
}

interface Start {
  number: string
  heading: string
  rest: string
  confidence: SplitConfidence
}

function startOf(line: string): Start | null {
  if (CONTINUATION.test(line)) return null

  const worded = WORDED.exec(line)
  if (worded?.[1]) {
    const { heading, body } = splitHeadingFromBody(worded[2] ?? '')
    return { number: worded[1], heading, rest: body, confidence: 'high' }
  }

  const sub = NUMBER_SUB.exec(line)
  if (sub?.[1])
    return { number: sub[1], heading: '', rest: `(1) ${sub[2] ?? ''}`.trim(), confidence: 'medium' }

  const numbered = NUMBERED.exec(line)
  if (numbered?.[1]) {
    const { heading, body } = splitHeadingFromBody(numbered[2] ?? '')
    return {
      number: numbered[1],
      heading,
      rest: body,
      // A bare number with a title is what a printed rule book looks like; a
      // bare number with prose after it might equally be a numbered list item
      // inside somebody's paragraph.
      confidence: heading ? 'high' : 'low',
    }
  }

  const roman = ROMAN.exec(line)
  if (roman?.[1]) {
    const { heading, body } = splitHeadingFromBody(roman[2] ?? '')
    return { number: roman[1], heading, rest: body, confidence: 'medium' }
  }

  return null
}

/**
 * A document pasted as ONE line, which is what copying from a PDF viewer
 * usually produces.
 *
 * Only tried when the line-based pass found nothing, and only at a boundary
 * that looks like a printed rule number: a full stop, then a number, then a
 * capital letter. It is deliberately stricter than the line-based rules
 * because there is no left margin here to lean on.
 */
const INLINE_BOUNDARY = /(?<=[.;])\s+(?=\d{1,3}[A-Z]?\.\s*[—–]?\s*(?:\p{Lu}|\p{Script=Devanagari}))/u

export function splitDocument(source: string): SplitResult {
  const text = source.replace(/\r\n?/g, '\n').replace(/\u00A0/g, ' ')
  const notes: string[] = []
  const units: SplitUnit[] = []
  const divisions: SplitDivision[] = []

  let division: string | null = null
  let current: SplitUnit | null = null
  /**
   * A printed rule book puts the chapter's name on the line BELOW its number.
   *
   * Without this the title becomes a nameless preamble unit sitting between the
   * chapter heading and rule 1 — which is what the first version did to every
   * chapter of every document that lays itself out this way, which is most of
   * them.
   */
  let awaitingDivisionTitle: SplitDivision | null = null
  const push = () => {
    if (!current) return
    current.text = normaliseText(current.text)
    if (current.text || current.heading) units.push(current)
    current = null
  }

  for (const line of text.split('\n')) {
    if (!line.trim()) {
      if (current) current.text += '\n'
      continue
    }

    const divided = DIVISION.exec(line)
    if (divided?.[1]) {
      push()
      const label = `${divided[1]} ${divided[2] ?? ''}`.trim()
      division = label
      const node: SplitDivision = { label, title: (divided[3] ?? '').trim(), from: units.length }
      divisions.push(node)
      awaitingDivisionTitle = node.title ? null : node
      continue
    }

    const start = startOf(line)

    if (awaitingDivisionTitle && !start) {
      const candidate = line.trim()
      if (candidate.length <= 80 && !/[.;:।]$/.test(candidate)) {
        awaitingDivisionTitle.title = candidate
        awaitingDivisionTitle = null
        continue
      }
    }
    awaitingDivisionTitle = null

    if (start) {
      push()
      current = {
        number: start.number,
        heading: start.heading,
        text: start.rest,
        confidence: start.confidence,
        division,
      }
      continue
    }

    if (current) current.text += `\n${line}`
    else {
      // Text before the first numbered unit — a preamble, a title page, a
      // notification. Kept rather than dropped, because losing the first
      // paragraph of somebody's document silently is not a trade to make.
      current = { number: '0', heading: '', text: line, confidence: 'low', division }
    }
  }
  push()

  const numbered = units.filter((unit) => unit.number !== '0')
  if (numbered.length === 0) {
    const inline = text
      .split(INLINE_BOUNDARY)
      .map((part) => part.trim())
      .filter(Boolean)
    if (inline.length > 1) {
      notes.push('inline')
      return {
        units: inline.map((part) => {
          const start = startOf(part)
          return start
            ? {
                number: start.number,
                heading: start.heading,
                text: normaliseText(start.rest),
                confidence: 'low' as const,
                division: null,
              }
            : {
                number: '',
                heading: '',
                text: normaliseText(part),
                confidence: 'low' as const,
                division: null,
              }
        }),
        divisions: [],
        notes,
      }
    }
    notes.push('unstructured')
    return {
      units: [{ number: '1', heading: '', text: normaliseText(text), confidence: 'low', division: null }],
      divisions: [],
      notes,
    }
  }

  // A preamble kept as unit "0" is honest but is not a rule; the review screen
  // shows it as such so it can be deleted or retitled in one press.
  if (units[0]?.number === '0') notes.push('preamble')
  if (units.some((unit) => unit.confidence === 'low')) notes.push('low-confidence')

  return { units, divisions, notes }
}

/** Join a unit into the one above it — the review screen's "merge up". */
export function mergeWithPrevious(units: readonly SplitUnit[], index: number): SplitUnit[] {
  const previous = units[index - 1]
  const unit = units[index]
  if (!previous || !unit) return [...units]
  const merged: SplitUnit = {
    ...previous,
    text: normaliseText(
      `${previous.text} ${unit.heading ? `${unit.number}. ${unit.heading}.` : unit.number ? `${unit.number}.` : ''} ${unit.text}`,
    ),
    // Merging is a decision a person made, so the result is no longer a guess.
    confidence: 'high',
  }
  return [...units.slice(0, index - 1), merged, ...units.slice(index + 1)]
}

/** Divide one unit at a character offset — the review screen's "split here". */
export function splitUnitAt(units: readonly SplitUnit[], index: number, offset: number): SplitUnit[] {
  const unit = units[index]
  if (!unit) return [...units]
  const at = Math.max(0, Math.min(unit.text.length, Math.round(offset)))
  if (at === 0 || at === unit.text.length) return [...units]

  const head: SplitUnit = { ...unit, text: normaliseText(unit.text.slice(0, at)), confidence: 'high' }
  const tailText = unit.text.slice(at)
  const start = startOf(tailText.trimStart())
  const tail: SplitUnit = {
    number: start?.number ?? `${unit.number}A`,
    heading: start?.heading ?? '',
    text: normaliseText(start ? start.rest : tailText),
    confidence: 'high',
    division: unit.division,
  }
  return [...units.slice(0, index), head, tail, ...units.slice(index + 1)]
}
