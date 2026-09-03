import { describe, expect, it } from 'vitest'

import { diffOf } from './compare'

describe('diffOf', () => {
  it('reports two identical passages as identical', () => {
    const result = diffOf('shall maintain absolute integrity', 'shall maintain absolute integrity')
    expect(result?.identical).toBe(true)
    expect(result?.left.every((part) => !part.changed)).toBe(true)
  })

  it('marks a deletion on the left and an insertion on the right', () => {
    const result = diffOf('punishable with seven years', 'punishable with ten years')
    expect(result?.identical).toBe(false)
    expect(result?.left.filter((part) => part.changed).map((part) => part.text.trim())).toEqual(['seven'])
    expect(result?.right.filter((part) => part.changed).map((part) => part.text.trim())).toEqual(['ten'])
  })

  /**
   * The default folding, not `exact`. A Hindi heading ends in a danda and its
   * English pair does not; reporting that as a change would mark every
   * bilingual comparison as different in its last token.
   */
  it('does not report punctuation or case as a change', () => {
    expect(diffOf('Murder.', 'murder')?.identical).toBe(true)
  })

  it('reassembles each side into readable text', () => {
    const result = diffOf('a b c d', 'a x c d')
    expect(result?.left.map((part) => part.text).join('')).toBe('a b c d')
    expect(result?.right.map((part) => part.text).join('')).toBe('a x c d')
  })

  it('returns null when a side is too long to diff word by word', () => {
    const huge = Array.from({ length: 3000 }, (_, index) => `word${index}`).join(' ')
    expect(diffOf(huge, 'short')).toBeNull()
  })

  it('handles one side being empty', () => {
    const result = diffOf('', 'something new')
    expect(result?.left).toEqual([])
    expect(result?.right.every((part) => part.changed)).toBe(true)
  })
})
