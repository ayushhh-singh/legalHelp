import { describe, expect, it } from 'vitest'

import {
  anchorParagraphs,
  anchorText,
  normaliseText,
  paragraphRanges,
  quoteAt,
  resolveAnchor,
  segmentParagraph,
} from './anchor'
import { paragraphs } from './corpus'

/**
 * The anchoring rules a highlight's survival rests on.
 *
 * Two of these are the whole reason the module exists rather than the reader
 * storing a pair of numbers: the round trip through `paragraphs()` (so a
 * whole-unit offset can be split back into a paragraph without a second source
 * of truth), and re-anchoring by quote (so a dataset refresh moves a highlight
 * rather than losing or misplacing it).
 */

describe('normaliseText', () => {
  it('collapses every kind of whitespace to one space', () => {
    expect(normaliseText('  a\n\nb\t c  ')).toBe('a b c')
  })

  it('composes to NFC, so two spellings of one grapheme index alike', () => {
    // Written as escapes on purpose: the two literals are the SAME grapheme and
    // different bytes, and a source file that gets normalised in transit would
    // otherwise quietly turn this into a test of nothing.
    const decomposed = '\u0915\u093C\u093E' // KA + NUKTA + AA
    const precomposed = '\u0958\u093E' // KA WITH NUKTA + AA
    expect(decomposed).not.toBe(precomposed)
    expect(normaliseText(decomposed)).toBe(normaliseText(precomposed))
  })

  it('leaves an empty string empty rather than producing a space', () => {
    expect(normaliseText('   \n  ')).toBe('')
  })
})

describe('anchorParagraphs', () => {
  it('drops a paragraph that is only whitespace', () => {
    expect(anchorParagraphs(['one', '   ', 'two'])).toEqual(['one', 'two'])
  })

  it('joins back to the whole-unit text with single spaces', () => {
    expect(anchorText(['one two', 'three'])).toBe('one two three')
  })
})

describe('paragraphRanges', () => {
  it('places each paragraph where it actually sits in the joined text', () => {
    const parts = ['Provided that x.', 'Explanation.—y.']
    const text = anchorText(parts)
    for (const range of paragraphRanges(parts)) {
      expect(text.slice(range.start, range.end)).toBe(range.text)
    }
  })

  it('leaves exactly one character between two paragraphs — the joining space', () => {
    const ranges = paragraphRanges(['ab', 'cd'])
    expect(ranges[1]!.start - ranges[0]!.end).toBe(1)
  })
})

describe('the round trip with paragraphs()', () => {
  /**
   * This is the property that makes a whole-unit offset safe. `paragraphs()`
   * promises that joining its output reproduces the text with whitespace
   * collapsed (ADR-038 §5); `anchorText` is what depends on that promise, so
   * the dependency is asserted here rather than assumed from the other file.
   */
  it('anchorText over paragraphs() is the normalised source', () => {
    const source =
      'No Government servant shall act otherwise. (2) Every Government servant shall at all times ' +
      'maintain absolute integrity. Provided that nothing in this rule shall apply. Explanation.—A ' +
      'Government servant who habitually fails is deemed to lack devotion to duty.'
    expect(anchorText(paragraphs(source))).toBe(normaliseText(source))
  })
})

describe('resolveAnchor', () => {
  const text = 'maintain absolute integrity and devotion to duty'

  it('takes the stored offsets when they still hold', () => {
    expect(resolveAnchor(text, { start: 9, end: 27, quote: 'absolute integrity' })).toEqual({
      status: 'exact',
      start: 9,
      end: 27,
    })
  })

  it('re-anchors by quote when the text has shifted', () => {
    const shifted = `A rule says: ${text}`
    const found = resolveAnchor(shifted, { start: 9, end: 27, quote: 'absolute integrity' })
    expect(found.status).toBe('reanchored')
    expect(shifted.slice(found.start!, found.end!)).toBe('absolute integrity')
  })

  it('picks the occurrence nearest where the highlight used to be', () => {
    const repeated = 'shall be deemed to be A. Later, it shall be deemed to be B.'
    const at = repeated.lastIndexOf('shall be deemed to be')
    const found = resolveAnchor(repeated, { start: at + 3, end: at + 24, quote: 'shall be deemed to be' })
    expect(found.start).toBe(at)
  })

  it('reports lost rather than guessing when the quote has gone', () => {
    expect(resolveAnchor(text, { start: 0, end: 5, quote: 'a phrase that was deleted' })).toEqual({
      status: 'lost',
      start: null,
      end: null,
    })
  })

  it('is lost for an empty quote whose offsets no longer hold', () => {
    // An empty string is found at every position, which is the same as nowhere.
    expect(resolveAnchor(text, { start: 900, end: 901, quote: '' }).status).toBe('lost')
  })

  it.each([
    ['a negative start', { start: -1, end: 3, quote: 'mai' }],
    ['an end past the text', { start: 0, end: 9_000, quote: 'maintain' }],
    ['a reversed pair', { start: 10, end: 2, quote: 'maintain' }],
    ['a fractional offset', { start: 0.5, end: 8, quote: 'maintain' }],
  ])('does not trust %s, and re-anchors instead', (_label, span) => {
    // Every one of these still finds the text — the point is that none of them
    // is reported as `exact`, because a row written by an older build (or by a
    // restored backup) is untrusted input like any other.
    expect(resolveAnchor(text, span).status).toBe('reanchored')
  })
})

describe('quoteAt', () => {
  it('is what resolveAnchor then reads back as exact', () => {
    const text = 'devotion to duty'
    const quote = quoteAt(text, 12, 16)
    expect(quote).toBe('duty')
    expect(resolveAnchor(text, { start: 12, end: 16, quote }).status).toBe('exact')
  })

  it('clamps rather than returning undefined for a silly range', () => {
    expect(quoteAt('abc', -5, 2)).toBe('ab')
  })
})

describe('segmentParagraph', () => {
  it('returns the paragraph whole when nothing covers it', () => {
    expect(segmentParagraph('abcdef', 0, [])).toEqual([{ text: 'abcdef', ids: [] }])
  })

  it('cuts at the highlight boundaries and marks only the covered run', () => {
    expect(segmentParagraph('abcdef', 0, [{ id: 'h1', start: 2, end: 4 }])).toEqual([
      { text: 'ab', ids: [] },
      { text: 'cd', ids: ['h1'] },
      { text: 'ef', ids: [] },
    ])
  })

  it('gives an overlap to both highlights', () => {
    const segments = segmentParagraph('abcdef', 0, [
      { id: 'h1', start: 1, end: 4 },
      { id: 'h2', start: 3, end: 6 },
    ])
    expect(segments.map((segment) => segment.ids)).toEqual([[], ['h1'], ['h1', 'h2'], ['h2']])
  })

  it('clips a highlight that runs across a paragraph break to each side', () => {
    // The reader dragged from the middle of paragraph one into paragraph two.
    const first = segmentParagraph('abcd', 0, [{ id: 'h1', start: 2, end: 8 }])
    const second = segmentParagraph('efgh', 5, [{ id: 'h1', start: 2, end: 8 }])
    expect(first).toEqual([
      { text: 'ab', ids: [] },
      { text: 'cd', ids: ['h1'] },
    ])
    expect(second).toEqual([
      { text: 'efg', ids: ['h1'] },
      { text: 'h', ids: [] },
    ])
  })

  it('ignores a highlight that lies entirely in another paragraph', () => {
    expect(segmentParagraph('abcd', 0, [{ id: 'h1', start: 40, end: 44 }])).toEqual([
      { text: 'abcd', ids: [] },
    ])
  })

  it('reassembles to exactly the paragraph it was given', () => {
    const text = 'The competent authority may, for reasons to be recorded, relax this rule.'
    const segments = segmentParagraph(text, 0, [
      { id: 'a', start: 4, end: 23 },
      { id: 'b', start: 20, end: 40 },
      { id: 'c', start: 60, end: 72 },
    ])
    expect(segments.map((segment) => segment.text).join('')).toBe(text)
  })
})
