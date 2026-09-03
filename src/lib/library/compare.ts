import { diffWords } from '@/lib/diff'

/**
 * Two units, side by side, with what differs marked on each side.
 *
 * `src/lib/diff.ts` returns ONE edit script; a side-by-side view needs two
 * sequences — the left with its deletions marked and the right with its
 * insertions — and building them in the component would put a fold over a
 * diff into a render.
 *
 * It uses the diff's DEFAULT folding (case and punctuation ignored), which is
 * right here for the same reason it is right in the Law Converter: the question
 * is what the provision says differently, and a danda or a capital is noise.
 * The `exact` mode exists for a diff the reader ACCEPTS into a document, which
 * this is not.
 */

export interface ComparePart {
  text: string
  /** True for a run that is on this side only. */
  changed: boolean
}

export interface CompareResult {
  left: ComparePart[]
  right: ComparePart[]
  /** True when the two differ by nothing the diff considers a change. */
  identical: boolean
}

/** `null` when either side is too long to diff — the caller shows both plainly. */
export function diffOf(before: string, after: string): CompareResult | null {
  const script = diffWords(before, after)
  if (!script) return null

  const left: ComparePart[] = []
  const right: ComparePart[] = []
  let changed = false

  for (const part of script) {
    // The tokens are words and hard line breaks; joining with a space is what
    // `tokenise` split on, so the text reads as it did.
    const text = part.tokens.join(' ')
    if (part.op === 'equal') {
      left.push({ text, changed: false })
      right.push({ text, changed: false })
    } else if (part.op === 'delete') {
      left.push({ text, changed: true })
      changed = true
    } else {
      right.push({ text, changed: true })
      changed = true
    }
  }

  const space = (parts: ComparePart[]): ComparePart[] =>
    parts.map((part, index) => (index === 0 ? part : { ...part, text: ` ${part.text}` }))

  return { left: space(left), right: space(right), identical: !changed }
}
