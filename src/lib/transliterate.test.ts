import { describe, expect, it } from 'vitest'

import { foldRoman, hasDevanagari, hasLatin, romanKey, romanise, toDevanagari } from './transliterate'

/**
 * The point of this module is that "hatya", "hatyaa" and "हत्या" end up as the
 * same string. Most of what is asserted below is that identity, on words the
 * Law Converter actually receives — not a transliteration standard, which this
 * deliberately is not.
 */

describe('romanise', () => {
  it.each([
    ['हत्या', 'hatyaa'],
    ['चोरी', 'chorii'],
    ['घर', 'ghara'],
    ['डकैती', 'dakaitii'],
    ['जमानत', 'jamaanata'],
  ])('transcribes %s', (input, expected) => {
    expect(romanise(input)).toBe(expected)
  })

  it('reads the virama as "this consonant has no vowel"', () => {
    // Without it, हत्या would come out "hatayaa" — the conjunct is the whole
    // difficulty of Devanagari romanisation.
    expect(romanise('हत्या')).toBe('hatyaa')
    expect(romanise('हतया')).toBe('hatayaa')
  })

  it('gives a bare consonant its inherent vowel', () => {
    expect(romanise('कल')).toBe('kala')
  })

  it('handles a consonant with a nukta as its own letter', () => {
    // NFC leaves these decomposed (Unicode composition exclusions), so the
    // pair is what has to be matched.
    expect(romanise('ज़मानत')).toBe('zamaanata')
  })

  it('reads anusvara and chandrabindu as a nasal', () => {
    expect(romanise('दंड')).toBe('danda')
    expect(romanise('संहिता')).toBe('sanhitaa')
  })

  it('converts Devanagari digits', () => {
    expect(romanise('३०२')).toBe('302')
  })

  it('passes Latin and punctuation through untouched', () => {
    expect(romanise('धारा 302 IPC')).toBe('dhaaraa 302 IPC')
  })

  it('returns an empty string for an empty input', () => {
    expect(romanise('')).toBe('')
  })

  it('drops the invisible joiners a Devanagari keyboard puts inside conjuncts', () => {
    // U+200D between the virama and the next consonant is how some keyboards
    // request a particular conjunct form. It was landing in the middle of the
    // transcription.
    expect(romanise('क्\u200dष')).toBe('ksha')
    expect(romanise('हत्या\u200d')).toBe('hatyaa')
    expect(romanise('हत्\u200cया')).toBe('hatyaa')
  })
})

describe('toDevanagari', () => {
  it.each([
    ['ghar', 'घर'],
    ['chori', 'चोरि'],
    ['dand', 'दन्द'],
  ])('renders %s approximately', (input, expected) => {
    expect(toDevanagari(input)).toBe(expected)
  })

  it('is approximate, and the approximation is the point', () => {
    // Roman Hindi does not distinguish dental from retroflex, so "dand" cannot
    // reach दंड (retroflex ड, anusvara rather than a conjunct) from the letters
    // alone. The output feeds a FUZZY matcher, where being one letter out costs
    // a little score and not the match; where an exact term is needed, the
    // lexicon's own roman spellings carry it (src/lib/lexicon.ts).
    expect(toDevanagari('chori')).not.toBe('चोरी')
    expect(romanKey(toDevanagari('chori'))).toBe(romanKey('चोरी'))
  })

  it('joins two consonants with a virama', () => {
    // "hatya" -> ह + त् + य: the conjunct is what makes it readable at all.
    expect(toDevanagari('hatya')).toBe('हत्य')
  })

  it('prefers the longest matching cluster', () => {
    // "chh" must beat "ch", and "ch" must beat "c".
    expect(toDevanagari('chhal')).toBe('छल')
    expect(toDevanagari('chal')).toBe('चल')
  })

  it('leaves Devanagari input alone', () => {
    expect(toDevanagari('हत्या')).toBe('हत्या')
  })
})

describe('foldRoman', () => {
  it('collapses vowel length, which roman Hindi does not spell consistently', () => {
    expect(foldRoman('hatyaa')).toBe(foldRoman('hatya'))
    expect(foldRoman('choree')).toBe(foldRoman('chori'))
    expect(foldRoman('lootpat')).toBe(foldRoman('lutpat'))
  })

  it('collapses the consonants roman spells more than one way', () => {
    expect(foldRoman('vasuli')).toBe(foldRoman('wasooli'))
    expect(foldRoman('jamanat')).toBe(foldRoman('zamanat'))
    expect(foldRoman('qatl')).toBe(foldRoman('katl'))
  })

  it('drops the schwa Devanagari writes and speech does not', () => {
    // romanise('घर') is "ghara"; a reader types "ghar".
    expect(foldRoman('ghara')).toBe('ghar')
    expect(foldRoman(romanise('घर'))).toBe(foldRoman('ghar'))
  })

  it('keeps a short token intact rather than folding it away', () => {
    expect(foldRoman('ka')).toBe('ka')
  })

  it('strips punctuation, case and combining marks', () => {
    expect(foldRoman('Chorī!')).toBe(foldRoman('chori'))
  })

  it('returns an empty string for input with no letters', () => {
    expect(foldRoman('।।।')).toBe('')
  })
})

describe('romanKey', () => {
  it('is the same for a word in either script', () => {
    for (const [devanagari, roman] of [
      ['हत्या', 'hatya'],
      ['चोरी', 'chori'],
      ['डकैती', 'dakaiti'],
      ['जमानत', 'jamanat'],
      ['दहेज', 'dahej'],
      ['आत्महत्या', 'atmahatya'],
    ] as const) {
      expect(romanKey(devanagari), `${devanagari} vs ${roman}`).toBe(romanKey(roman))
    }
  })

  it('does not collapse two different words into one key', () => {
    expect(romanKey('चोरी')).not.toBe(romanKey('हत्या'))
    expect(romanKey('जमानत')).not.toBe(romanKey('गिरफ्तारी'))
  })
})

describe('script detection', () => {
  it('separates the two alphabets', () => {
    expect(hasDevanagari('धारा')).toBe(true)
    expect(hasDevanagari('dhara')).toBe(false)
    expect(hasLatin('धारा 302')).toBe(false)
    expect(hasLatin('IPC 302')).toBe(true)
  })
})

describe('malformed input', () => {
  it('transcribes a stray matra rather than dropping the syllable', () => {
    // A vowel sign with no consonant before it is malformed Devanagari — a
    // reader mid-keystroke, or a byte-soup Hindi PDF (DATA-GAPS #42). Search
    // has to keep working through it, so the sign is transcribed on its own
    // rather than silently swallowed.
    expect(romanKey('\u093e')).not.toBe('')
    expect(romanKey('\u093fजमानत')).toContain(romanKey('जमानत'))
  })

  it('reads Devanagari digits as their Latin equivalents', () => {
    expect(romanKey('३०२')).toBe('302')
    expect(romanKey('धारा १०३')).toContain('103')
  })

  it('returns an empty key for an empty string rather than throwing', () => {
    expect(romanKey('')).toBe('')
    expect(hasDevanagari('')).toBe(false)
    expect(hasLatin('')).toBe(false)
  })
})
