/**
 * The reference-number generator: a pattern of tokens, and a sequence.
 *
 * An officer's file number is not arbitrary — it is the office's own scheme,
 * and it looks like `A-11011/5/2026-Estt.` in one section and
 * `No. 12(4)/2026-IFD` in the next. So the pattern is the officer's to write,
 * and this file only substitutes and counts.
 *
 * Six tokens, and no more:
 *
 * | Token       | Becomes                                                   |
 * | ----------- | --------------------------------------------------------- |
 * | `{FILE}`    | the file number the pattern is filed under                 |
 * | `{SEQ}`     | the next number in this pattern's own sequence             |
 * | `{YEAR}`    | the four-digit year                                        |
 * | `{YY}`      | the last two digits of the year                            |
 * | `{SECTION}` | the section's short name                                   |
 * | `{TYPE}`    | the document type's short name                             |
 *
 * Pure: no clock and no database. `issueNumber` in
 * `src/modules/drafting/numbering.ts` is what reads the row, advances it and
 * writes it back in one transaction.
 *
 * **An unknown token is an error, not a literal.** `{SEQNO}` left as text would
 * print `{SEQNO}` on a signed communication, which is the same failure
 * `noPlaceholders` exists to stop one layer up. `expandNumber` reports it and
 * the editor refuses to issue.
 */

export const NUMBER_TOKENS = ['FILE', 'SEQ', 'YEAR', 'YY', 'SECTION', 'TYPE'] as const
export type NumberToken = (typeof NUMBER_TOKENS)[number]

export const RESET_POLICIES = ['yearly', 'never'] as const
export type ResetPolicy = (typeof RESET_POLICIES)[number]

export interface NumberPattern {
  id: string
  /** What the officer calls this scheme — "Establishment O.M.s". */
  name: string
  /** The pattern itself, e.g. `A-11011/{SEQ}/{YEAR}-{SECTION}`. */
  pattern: string
  file: string
  section: string
  resetPolicy: ResetPolicy
  /** How many have been issued in the current period. */
  seq: number
  /** The year `seq` belongs to, for the yearly reset. */
  seqYear: number
  /** How wide `{SEQ}` is zero-padded. 1 means no padding. */
  seqPad: number
  lastIssued: string | null
  lastIssuedAt: string | null
  createdAt: string
  updatedAt: string
}

const TOKEN = /\{([A-Z]+)\}/g

export interface ExpandResult {
  number: string
  /** Tokens in the pattern that are not one of the six. Never substituted. */
  unknownTokens: string[]
}

export interface ExpandInput {
  pattern: string
  file: string
  section: string
  type: string
  seq: number
  seqPad: number
  year: number
}

/**
 * A pattern and a sequence number, as the reference number that will print.
 *
 * The sequence is passed in rather than read from the pattern row, so that a
 * PREVIEW (what the next number will look like) and an ISSUE (what it actually
 * became) run the same code and cannot disagree — the thing an officer checks
 * before pressing the button has to be the thing the button produces.
 */
export function expandNumber(input: ExpandInput): ExpandResult {
  const unknownTokens: string[] = []
  const values: Record<NumberToken, string> = {
    FILE: input.file,
    SEQ: String(input.seq).padStart(Math.max(1, input.seqPad), '0'),
    YEAR: String(input.year),
    YY: String(input.year % 100).padStart(2, '0'),
    SECTION: input.section,
    TYPE: input.type,
  }

  TOKEN.lastIndex = 0
  const number = input.pattern.replace(TOKEN, (match, name: string) => {
    if ((NUMBER_TOKENS as readonly string[]).includes(name)) return values[name as NumberToken]
    if (!unknownTokens.includes(name)) unknownTokens.push(name)
    return match
  })

  return { number, unknownTokens }
}

/**
 * The sequence the next issue should use, given the reset policy.
 *
 * A yearly pattern that last issued in 2025 starts again at 1 in 2026; a
 * `never` pattern keeps counting. The year is an argument because this file
 * has no clock — and because a document dated ahead into next year should be
 * numbered from the year on the DOCUMENT, not from the day the officer
 * happened to press the button.
 */
export function nextSequence(
  pattern: Pick<NumberPattern, 'resetPolicy' | 'seq' | 'seqYear'>,
  year: number,
): number {
  if (pattern.resetPolicy === 'yearly' && year !== pattern.seqYear) return 1
  return pattern.seq + 1
}

/** What the next number will look like, without issuing it. */
export function previewNumber(pattern: NumberPattern, type: string, year: number): ExpandResult {
  return expandNumber({
    pattern: pattern.pattern,
    file: pattern.file,
    section: pattern.section,
    type,
    seq: nextSequence(pattern, year),
    seqPad: pattern.seqPad,
    year,
  })
}

export interface PatternIssue {
  code: 'empty' | 'no-seq' | 'unknown-token'
  token?: string
  message: { en: string; hi: string }
}

/**
 * What is wrong with a pattern, before it is ever used.
 *
 * The `no-seq` case is the one worth having: a pattern with no `{SEQ}` in it
 * produces the same number for every document issued that year, and CSMOP
 * 9.2(vi) is explicit that two communications issued from the same file to the
 * same addressee on the same date are distinguished by a serial. It is a
 * warning rather than a bar, because an office whose numbering genuinely
 * carries no serial exists and this app is not the authority on that.
 */
export function validatePattern(pattern: string): PatternIssue[] {
  const out: PatternIssue[] = []
  if (!pattern.trim()) {
    out.push({
      code: 'empty',
      message: { en: 'The pattern is empty.', hi: 'पैटर्न रिक्त है।' },
    })
    return out
  }
  if (!pattern.includes('{SEQ}')) {
    out.push({
      code: 'no-seq',
      message: {
        en: 'The pattern has no {SEQ}, so every document issued under it gets the same number. CSMOP 9.2(vi) distinguishes two communications from the same file by a serial.',
        hi: 'पैटर्न में {SEQ} नहीं है, अतः इसके अंतर्गत जारी प्रत्येक दस्तावेज़ को एक ही संख्या मिलेगी। सीएसएमओपी 9.2(vi) एक ही फाइल से दो पत्रों को क्रमांक से अलग करता है।',
      },
    })
  }
  TOKEN.lastIndex = 0
  for (const match of pattern.matchAll(TOKEN)) {
    const name = match[1] ?? ''
    if ((NUMBER_TOKENS as readonly string[]).includes(name)) continue
    out.push({
      code: 'unknown-token',
      token: name,
      message: {
        en: `{${name}} is not a token this app knows. Use one of ${NUMBER_TOKENS.map((token) => `{${token}}`).join(', ')}.`,
        hi: `{${name}} इस ऐप का ज्ञात टोकन नहीं है। ${NUMBER_TOKENS.map((token) => `{${token}}`).join(', ')} में से किसी का प्रयोग करें।`,
      },
    })
  }
  return out
}

/** A blank pattern, for the "add a numbering scheme" form. */
export function newPattern(args: { id: string; at: string; year: number }): NumberPattern {
  return {
    id: args.id,
    name: '',
    pattern: 'A-11011/{SEQ}/{YEAR}-{SECTION}',
    file: '',
    section: '',
    resetPolicy: 'yearly',
    seq: 0,
    seqYear: args.year,
    seqPad: 1,
    lastIssued: null,
    lastIssuedAt: null,
    createdAt: args.at,
    updatedAt: args.at,
  }
}
