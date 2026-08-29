import { describe, expect, it } from 'vitest'

import { diffCounts, diffWords, hasChanges, tokenise, type DiffPart } from '@/lib/diff'

/** Render a diff back to a readable string, for assertions that read like prose. */
const render = (parts: DiffPart[] | null) =>
  parts
    ?.map((part) => {
      const text = part.tokens.join(' ')
      if (part.op === 'insert') return `+[${text}]`
      if (part.op === 'delete') return `-[${text}]`
      return text
    })
    .join(' ')

describe('diffWords', () => {
  it('reports no change for identical text', () => {
    const parts = diffWords('Punishment for murder.', 'Punishment for murder.')
    expect(hasChanges(parts)).toBe(false)
    expect(diffCounts(parts)).toEqual({ added: 0, removed: 0 })
  })

  it('finds a substituted word', () => {
    expect(render(diffWords('shall be punished', 'may be punished'))).toBe('-[shall] +[may] be punished')
  })

  it('finds an inserted phrase', () => {
    expect(render(diffWords('Punishment for murder', 'Punishment for attempt to murder'))).toBe(
      'Punishment for +[attempt to] murder',
    )
  })

  it('finds a deleted phrase', () => {
    expect(render(diffWords('Punishment for attempt to murder', 'Punishment for murder'))).toBe(
      'Punishment for -[attempt to] murder',
    )
  })

  it('counts the words on each side', () => {
    expect(diffCounts(diffWords('a b c d', 'a x y d'))).toEqual({ added: 2, removed: 2 })
  })

  it('ignores punctuation and case, which are not "what changed"', () => {
    // The dataset's headings carry a trailing full stop inconsistently, and a
    // diff that reported it would bury the words that actually moved.
    expect(hasChanges(diffWords('Punishment for murder.', 'Punishment For Murder'))).toBe(false)
  })

  it('shows the original spelling even though it compared the normalised form', () => {
    const parts = diffWords('Sedition.', 'Acts endangering sovereignty.')
    expect(render(parts)).toContain('Acts endangering sovereignty.')
  })

  it('keeps line breaks, which separate sub-sections in the dataset', () => {
    expect(tokenise('(1) one\n(2) two')).toEqual(['(1)', 'one', '\n', '(2)', 'two'])
    const parts = diffWords('(1) one\n(2) two', '(1) one\n(2) three')
    expect(render(parts)).toContain('\n')
  })

  it('handles an empty side in each direction', () => {
    expect(diffCounts(diffWords('', 'a b'))).toEqual({ added: 2, removed: 0 })
    expect(diffCounts(diffWords('a b', ''))).toEqual({ removed: 2, added: 0 })
    expect(hasChanges(diffWords('', ''))).toBe(false)
  })

  it('treats the danda as punctuation, like the full stop it is', () => {
    // The ingest's Hindi headings end in "।" and the English ones in "."; a
    // diff that reported it flagged a spurious change on every Hindi pair.
    expect(hasChanges(diffWords('हत्या।', 'हत्या'))).toBe(false)
    expect(hasChanges(diffWords('हत्या॥', 'हत्या।'))).toBe(false)
    expect(hasChanges(diffWords('हत्या।', 'चोरी।'))).toBe(true)
  })

  it('diffs Devanagari by word, not by matra', () => {
    const parts = diffWords('हत्या के लिए दण्ड', 'हत्या के लिए आजीवन दण्ड')
    expect(render(parts)).toBe('हत्या के लिए +[आजीवन] दण्ड')
  })

  it('produces a minimal edit script rather than delete-everything-then-insert', () => {
    // The property that makes a word diff worth having: a one-word change in a
    // long sentence must not report the whole sentence as changed.
    const before = 'a b c d e f g h i j'
    const after = 'a b c d X f g h i j'
    expect(diffCounts(diffWords(before, after))).toEqual({ added: 1, removed: 1 })
  })

  it('refuses rather than hangs on input beyond its size limit', () => {
    // null is a distinct answer from "no differences", and the caller has to
    // tell them apart: one means "shown side by side", the other means "same".
    const huge = Array.from({ length: 3000 }, (_, i) => `w${i}`).join(' ')
    expect(diffWords(huge, `${huge} more`)).toBeNull()
    expect(hasChanges(null)).toBe(false)
    expect(diffCounts(null)).toEqual({ added: 0, removed: 0 })
  })
})

describe('the real headings this runs on', () => {
  it('reports a renumbering with unchanged wording as no change', () => {
    // IPC 302 and BNS 103 are both "Punishment for murder." — the honest
    // answer for that pair is "only the number moved".
    expect(hasChanges(diffWords('Punishment for murder.', 'Punishment for murder.'))).toBe(false)
  })

  it('reports the sedition rewrite as a substantial change', () => {
    const parts = diffWords('Sedition.', 'Act endangering sovereignty, unity and integrity of India.')
    const counts = diffCounts(parts)
    expect(counts.removed).toBe(1)
    expect(counts.added).toBeGreaterThan(5)
  })
})

describe('diffWords — exact', () => {
  it('folds case and punctuation by default, and does not with `exact`', () => {
    expect(hasChanges(diffWords('education allowance', 'Education Allowance.'))).toBe(false)
    expect(hasChanges(diffWords('education allowance', 'Education Allowance.', { exact: true }))).toBe(true)
  })

  it('an exact diff re-attaches the AFTER token, so applying it changes the text', () => {
    // The default's `equal` run keeps the BEFORE token, which is why a
    // suggestion whose only change was a capital used to apply as nothing.
    const folded = diffWords('grant of allowance', 'Grant of Allowance')
    expect(folded?.every((part) => part.op === 'equal')).toBe(true)

    const exact = diffWords('grant of allowance', 'Grant of Allowance', { exact: true })
    expect(exact?.some((part) => part.op === 'insert')).toBe(true)
    expect(exact?.flatMap((part) => (part.op === 'insert' ? part.tokens : []))).toContain('Grant')
  })
})
