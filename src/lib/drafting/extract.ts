import { toAsciiDigits } from './format'

/**
 * What the first page of an official document says about itself.
 *
 * A Government letter, O.M., circular or notification carries the same four
 * facts in the same four places, in both languages: a file number at the top
 * left, a date at the top right, an addressee block under `To` / `सेवा में`,
 * and a subject after `Subject:` / `विषय:`. This file reads those four out of
 * plain text and says how confident it is about each.
 *
 * **It is written here, now, because Session 31 reuses it** — the register of
 * inbound paper has to read the same four facts off a scanned-in letter, and
 * two extractors that disagree about what "the number" is would make a thread
 * that never joins up. One grammar, one implementation (ADR-039 §4's rule,
 * applied a third time).
 *
 * ### What it does not do
 *
 * It never invents. Every field it cannot find comes back empty with
 * `confidence: 'none'`, and the import screen shows an empty box rather than a
 * plausible guess — an officer correcting a wrong file number they did not
 * type is worse off than one typing it. `confidence` is `high` only where the
 * text carried an explicit label; a bare `12.05.2026` floating at the top of a
 * page is `low`, because it may be the date of the letter being replied to.
 */

export type Confidence = 'high' | 'low' | 'none'

export interface ExtractedMeta {
  number: string
  /** As written. `dateIso` is the same date normalised, when it could be. */
  date: string
  dateIso: string
  subject: string
  /** The addressee block, one line per line of the address. */
  to: string[]
  /** A reference line the document quotes — "your letter no. X dated Y". */
  reference: string
  confidence: Record<'number' | 'date' | 'subject' | 'to' | 'reference', Confidence>
}

export const emptyExtractedMeta = (): ExtractedMeta => ({
  number: '',
  date: '',
  dateIso: '',
  subject: '',
  to: [],
  reference: '',
  confidence: { number: 'none', date: 'none', subject: 'none', to: 'none', reference: 'none' },
})

/**
 * How much of a document this reads.
 *
 * The chrome is on the first page and nowhere else, and reading further finds
 * false positives: a paragraph quoting "vide O.M. No. …" is a reference, not
 * this document's own number, and the sixteenth page of an annexure is full of
 * dates. Forty lines is a first page with room to spare.
 */
export const FIRST_PAGE_LINES = 40

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
  // The Hindi month names an office actually prints. Both the Sanskritised and
  // the everyday spelling of the four that differ, because both are in use.
  जनवरी: 1,
  फरवरी: 2,
  मार्च: 3,
  अप्रैल: 4,
  मई: 5,
  जून: 6,
  जुलाई: 7,
  अगस्त: 8,
  सितंबर: 9,
  सितम्बर: 9,
  अक्टूबर: 10,
  अक्तूबर: 10,
  नवंबर: 11,
  नवम्बर: 11,
  दिसंबर: 12,
  दिसम्बर: 12,
}

const pad = (value: number): string => String(value).padStart(2, '0')

const isRealDay = (day: number, month: number, year: number): boolean => {
  if (month < 1 || month > 12 || day < 1 || year < 1900 || year > 2200) return false
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/**
 * A date anywhere in a line, in any of the five shapes this corpus contains.
 *
 * `dd.mm.yyyy` is assumed day-first and never month-first, deliberately: every
 * Government of India order prints day-first, and a rule that tried to guess
 * would read 01.02.2026 as 2 January on some documents and 1 February on
 * others with nothing on the page to say which. `format.ts#parseDate` makes the
 * same assumption for the same reason.
 */
export function findDate(line: string): { raw: string; iso: string } | null {
  const text = toAsciiDigits(line)

  const numeric = /\b(\d{1,2})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{2,4})\b/.exec(text)
  if (numeric) {
    const day = Number(numeric[1])
    const month = Number(numeric[2])
    const rawYear = Number(numeric[3])
    const year = rawYear < 100 ? 2000 + rawYear : rawYear
    if (isRealDay(day, month, year)) {
      return { raw: numeric[0].trim(), iso: `${year}-${pad(month)}-${pad(day)}` }
    }
  }

  /*
    The month is matched as "a word that is not a number", not as a class of
    letters, and that is deliberate rather than lazy. A class covering
    Devanagari has to include the matras, which are combining marks — and a
    character class containing one is what `no-misleading-character-class`
    exists to reject, correctly: inside a class a matra matches on its own,
    which splits a grapheme. Matching a run of non-space, non-digit characters
    and then looking it up in `MONTHS` needs no class at all, and a lookup that
    fails is a word that was not a month.
  */
  const worded =
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+([^\s\d.,;:()]{2,20}),?\s+(\d{4})\b/.exec(text) ??
    /\b([^\s\d.,;:()]{2,20})\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/.exec(text)
  if (worded) {
    const first = worded[1] ?? ''
    const monthWord = /^\d/.test(first) ? (worded[2] ?? '') : first
    const dayWord = /^\d/.test(first) ? first : (worded[2] ?? '')
    const month = MONTHS[monthWord.toLowerCase()]
    const day = Number(dayWord)
    const year = Number(worded[3])
    if (month && isRealDay(day, month, year)) {
      return { raw: worded[0].trim(), iso: `${year}-${pad(month)}-${pad(day)}` }
    }
  }
  return null
}

/**
 * A file number: something with at least one slash, after a label or standing
 * alone at the top of the page.
 *
 * The slash is the whole test and it is a good one. Every central-government
 * file number has one — `A-11011/2/2026-Estt.(Allowances)`, `F.No. 12/2/2023-JCA`,
 * `1(3)/2026-E.II(B)` — and almost nothing else on the first page of a letter
 * does. A date has dots or slashes too, which is why a candidate that parses as
 * a date is rejected.
 */
const NUMBER_LABEL = /(?:F\.?\s*No\.?|File\s*No\.?|No\.?|संख्या|सं\.|फा\.?\s*सं\.?)\s*[:.-]?\s*/i
/*
  A negated class, for the reason `worded` above uses one: a positive class
  covering Devanagari must contain matras, and a class containing a combining
  mark is misleading. What a file number is NOT is easy to say — it has no
  spaces and none of the punctuation that ends a sentence — and it must start
  with an alphanumeric, which is what stops a bare `/` matching.
*/
const NUMBER_BODY =
  /[A-Za-z0-9\u0904-\u0939\u0958-\u0961\u0966-\u096F\u0972-\u097F][^\s,;:"'<>]*\/[^\s,;:"'<>]+/

/**
 * A comma or a semicolon after a file number is punctuation. A FULL STOP is
 * not, and that is the whole point of this function existing.
 *
 * `A-11011/2/2026-Estt.` ends in a period because `Estt.` is an abbreviation,
 * and every second file number in this corpus ends the same way — `E.II(B)`,
 * `JCA-2`, `Coord.` Trimming it would quietly shorten the one field an officer
 * files a document under. A number genuinely at the end of a sentence keeps one
 * character too many, which is visible in the review box and correctable there;
 * the other error is invisible.
 */
const trimTail = (value: string): string => value.replace(/[,;]+$/, '')

/**
 * Whether a candidate is a date and nothing else.
 *
 * `12/05/2026` is a date. `12/2/2023-JCA` CONTAINS one and is a file number —
 * and the second is not a rare shape, it is how half the orders this app cites
 * are numbered. The first version of this guard asked "does a date appear in
 * here" and threw away every file number whose first three groups happened to
 * read as a day, a month and a year.
 */
const isOnlyADate = (candidate: string): boolean => findDate(candidate)?.raw === candidate.trim()

export function findNumber(line: string): { value: string; confidence: Confidence } | null {
  const labelled = new RegExp(NUMBER_LABEL.source + `(${NUMBER_BODY.source})`, 'i').exec(line)
  if (labelled?.[1] && !isOnlyADate(labelled[1])) {
    return { value: trimTail(labelled[1]), confidence: 'high' }
  }
  const bare = NUMBER_BODY.exec(line)
  if (bare && !isOnlyADate(bare[0])) return { value: trimTail(bare[0]), confidence: 'low' }
  return null
}

const SUBJECT_LABEL = /^\s*(?:sub(?:ject)?|विषय)\s*[:.—-]\s*/i
const TO_LABEL = /^\s*(?:to|सेवा\s*में)\s*[,:]?\s*$/i
const SALUTATION = /^\s*(?:sir|madam|dear\s|महोदय|महोदया|प्रिय)/i
const REFERENCE_LABEL =
  /(?:with\s+reference\s+to|in\s+continuation\s+of|reference\s+is\s+invited\s+to|your\s+(?:letter|O\.?M\.?|d\.?o\.?)|के\s+संदर्भ\s+में|के\s+क्रम\s+में)/i

const SUBJECT_STOPS = [SALUTATION, TO_LABEL, /^\s*$/]

/**
 * The four facts, from the first page.
 *
 * Takes TEXT rather than a body or a `File`, so the same function serves the
 * `.docx` importer, the PDF importer, a paste and — in Session 31 — an inbound
 * letter typed straight into a box.
 */
export function extractMeta(text: string, options: { maxLines?: number } = {}): ExtractedMeta {
  const limit = options.maxLines ?? FIRST_PAGE_LINES
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .slice(0, limit)

  const out = emptyExtractedMeta()

  // --- the number. A labelled one anywhere on the first page beats a bare one,
  // and a bare one is only believed in the top third — below that it is a
  // paragraph quoting somebody else's file.
  for (const [index, line] of lines.entries()) {
    if (REFERENCE_LABEL.test(line)) continue
    const found = findNumber(line)
    if (!found) continue
    if (found.confidence === 'high') {
      out.number = found.value
      out.confidence.number = 'high'
      break
    }
    if (!out.number && index < Math.max(6, Math.floor(limit / 4))) {
      out.number = found.value
      out.confidence.number = 'low'
    }
  }

  // --- the date. A labelled one wins; otherwise the first one on the page that
  // is not on a line quoting another communication.
  for (const line of lines) {
    const labelled = /(?:dated|date|दिनांक|दिनाँक|तारीख)\s*[:.-]?\s*/i.test(line)
    if (!labelled && REFERENCE_LABEL.test(line)) continue
    const found = findDate(line)
    if (!found) continue
    if (labelled && !REFERENCE_LABEL.test(line)) {
      out.date = found.raw
      out.dateIso = found.iso
      out.confidence.date = 'high'
      break
    }
    if (!out.date) {
      out.date = found.raw
      out.dateIso = found.iso
      out.confidence.date = 'low'
    }
  }

  // --- the subject, and its continuation lines. A subject regularly runs to
  // three lines on a Government letter and taking only the first loses the
  // half that says what it is about.
  const subjectAt = lines.findIndex((line) => SUBJECT_LABEL.test(line))
  if (subjectAt !== -1) {
    const parts = [(lines[subjectAt] ?? '').replace(SUBJECT_LABEL, '')]
    for (let index = subjectAt + 1; index < lines.length && parts.length < 4; index += 1) {
      const line = lines[index] ?? ''
      if (SUBJECT_STOPS.some((stop) => stop.test(line))) break
      if (SUBJECT_LABEL.test(line)) break
      parts.push(line)
      if (/[.—-]\s*$/.test(line)) break
    }
    out.subject = parts
      .join(' ')
      .replace(/\s+/g, ' ')
      .replace(/[.।॥—\s-]+$/, '')
      .trim()
    out.confidence.subject = 'high'
  }

  // --- the addressee block: everything between `To` and the next blank line,
  // subject or salutation.
  const toAt = lines.findIndex((line) => TO_LABEL.test(line))
  if (toAt !== -1) {
    const block: string[] = []
    for (let index = toAt + 1; index < lines.length && block.length < 6; index += 1) {
      const line = lines[index] ?? ''
      if (!line || SUBJECT_LABEL.test(line) || SALUTATION.test(line)) break
      block.push(line.replace(/,$/, ''))
    }
    out.to = block
    out.confidence.to = block.length > 0 ? 'high' : 'none'
  }

  // --- a reference to the communication being answered.
  const referenceLine = lines.find((line) => REFERENCE_LABEL.test(line))
  if (referenceLine) {
    out.reference = referenceLine
    out.confidence.reference = 'high'
  }

  return out
}
