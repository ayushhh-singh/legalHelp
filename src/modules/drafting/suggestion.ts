import type { DiffPart } from '@/lib/diff'

/**
 * Turning a word-level diff into a set of accept/reject decisions, and back
 * into text.
 *
 * Separated from `components/SuggestionDiff.tsx` because it is the part that
 * can be wrong without looking wrong. The rendering either shows the change or
 * it does not; this decides what an officer actually ends up having written,
 * and one inverted condition here silently produces a sentence neither the
 * author nor the suggester proposed.
 */

export interface Change {
  /** Index into `parts` where this change begins. */
  start: number
  /** One past the last part in the change. */
  end: number
}

/** Runs of non-`equal` parts, with a replacement counted as one change. */
export function changesOf(parts: readonly DiffPart[]): Change[] {
  const changes: Change[] = []
  let index = 0
  while (index < parts.length) {
    if (parts[index]?.op === 'equal') {
      index += 1
      continue
    }
    const start = index
    while (index < parts.length && parts[index]?.op !== 'equal') index += 1
    changes.push({ start, end: index })
  }
  return changes
}

/**
 * The text that results from accepting exactly the changes in `accepted`.
 *
 * `accepted` is indexed by position in `changesOf(parts)`.
 */
export function applyChanges(
  parts: readonly DiffPart[],
  changes: readonly Change[],
  accepted: readonly boolean[],
): string {
  const isAccepted = (partIndex: number): boolean => {
    const at = changes.findIndex((change) => partIndex >= change.start && partIndex < change.end)
    return at === -1 ? false : (accepted[at] ?? false)
  }

  const out: string[] = []
  parts.forEach((part, partIndex) => {
    if (part.op === 'equal') {
      out.push(...part.tokens)
      return
    }
    const take = isAccepted(partIndex)
    // An insertion survives being accepted; a deletion survives being refused.
    if ((part.op === 'insert' && take) || (part.op === 'delete' && !take)) {
      out.push(...part.tokens)
    }
  })

  // `tokenise` keeps hard line breaks as their own tokens, so they must not be
  // re-joined with a space or every sub-section runs together.
  return out
    .reduce<string>((text, token) => {
      if (token === '\n') return `${text}\n`
      return text === '' || text.endsWith('\n') ? `${text}${token}` : `${text} ${token}`
    }, '')
    .trim()
}
