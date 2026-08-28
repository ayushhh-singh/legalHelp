import { describe, expect, it } from 'vitest'

import { synonymsFor } from './lexicon'
import { normaliseRef, parseQuery, queryVariants, refBase } from './search'
import { romanKey } from './transliterate'

/**
 * Query parsing, in isolation from any dataset.
 *
 * `tests/law-search.test.ts` is where ranking is checked against the real
 * sections; this file is about the one job before that — turning what somebody
 * typed into "which Act, which section, which words".
 */

describe('parseQuery — section references', () => {
  it.each([
    ['302', '302'],
    ['103(1)', '103(1)'],
    ['s 154', '154'],
    ['s. 154', '154'],
    ['sec 438', '438'],
    ['sec. 438', '438'],
    ['section 173', '173'],
    ['sections 173', '173'],
    ['u/s 302', '302'],
    ['u / s 302', '302'],
    ['under section 41', '41'],
    ['धारा 173', '173'],
    ['धारा-173', '173'],
    ['376AB', '376AB'],
    ['2(f)', '2(F)'],
    ['318 (4)', '318(4)'],
  ])('reads %s as section %s', (input, expected) => {
    expect(parseQuery(input).sectionRef).toBe(expected)
  })

  it('finds no section reference in a query that has none', () => {
    expect(parseQuery('anticipatory bail').sectionRef).toBeNull()
    expect(parseQuery('हत्या').sectionRef).toBeNull()
  })

  it('does not read a section prefix out of an ordinary word', () => {
    // The regression that made this rule explicit: an unanchored `s` prefix
    // turned "suicide" into "uicide" and "sedition" into "edition", and the
    // fuzzy matcher covered for it by returning plausible results anyway.
    expect(parseQuery('suicide').text).toBe('suicide')
    expect(parseQuery('sedition').text).toBe('sedition')
    expect(parseQuery('snatching').text).toBe('snatching')
    expect(parseQuery('secession').text).toBe('secession')
  })
})

describe('parseQuery — Act names', () => {
  it.each([
    ['ipc 302', 'IPC', 'bns', 'old-new'],
    ['IPC 302', 'IPC', 'bns', 'old-new'],
    ['crpc 154', 'CrPC', 'bnss', 'old-new'],
    ['cr.p.c 154', 'CrPC', 'bnss', 'old-new'],
    ['code of criminal procedure 154', 'CrPC', 'bnss', 'old-new'],
    ['indian evidence act 65b', 'IEA', 'bsa', 'old-new'],
    ['bns 103', 'BNS', 'bns', 'new-old'],
    ['bnss 187', 'BNSS', 'bnss', 'new-old'],
    ['bsa 63', 'BSA', 'bsa', 'new-old'],
    ['आईपीसी 302', 'IPC', 'bns', 'old-new'],
    ['भारतीय दंड संहिता 302', 'IPC', 'bns', 'old-new'],
    ['बीएनएसएस 173', 'BNSS', 'bnss', 'new-old'],
  ])('reads %s as %s', (input, act, code, direction) => {
    const parsed = parseQuery(input)
    expect(parsed.act).toBe(act)
    expect(parsed.code).toBe(code)
    expect(parsed.direction).toBe(direction)
  })

  it('tries BNSS before BNS, or every BNSS query would be a BNS query', () => {
    expect(parseQuery('bnss 173').act).toBe('BNSS')
    expect(parseQuery('bns 173').act).toBe('BNS')
  })

  it('picks the code but not a direction for an Act name that names two Acts', () => {
    // "साक्ष्य अधिनियम" is the Indian Evidence Act, 1872 AND the Bharatiya
    // Sakshya Adhiniyam, 2023. Guessing would answer a question nobody asked.
    const parsed = parseQuery('साक्ष्य अधिनियम 63')
    expect(parsed.code).toBe('bsa')
    expect(parsed.direction).toBeNull()
    expect(parsed.act).toBeNull()
  })

  it('does not treat the bare word "evidence" as an Act name', () => {
    // It is one of the commonest search terms in this area of law; consuming it
    // as an Act name left the query with no words at all.
    expect(parseQuery('electronic evidence').act).toBeNull()
    expect(parseQuery('electronic evidence').text).toBe('electronic evidence')
    expect(parseQuery('साक्ष्य').text).toBe('साक्ष्य')
  })

  it('does not read the year in an Act name as a section number', () => {
    expect(parseQuery('indian penal code 1860 s 302').sectionRef).toBe('302')
    expect(parseQuery('bharatiya nyaya sanhita 2023').sectionRef).toBeNull()
  })

  it('leaves the remaining words as the text search', () => {
    const parsed = parseQuery('bnss 187 detention')
    expect(parsed.sectionRef).toBe('187')
    expect(parsed.text).toBe('detention')
  })
})

describe('parseQuery — script', () => {
  it.each([
    ['302', 'none'],
    ['murder', 'latin'],
    ['हत्या', 'devanagari'],
    ['धारा 302 IPC', 'mixed'],
  ])('classifies %s as %s', (input, script) => {
    expect(parseQuery(input).script).toBe(script)
  })
})

describe('queryVariants', () => {
  it('adds a Devanagari form for a single Latin word', () => {
    const variants = queryVariants(parseQuery('hatya'))
    expect(variants).toContain('hatya')
    expect(variants.some((variant) => /[ऀ-ॿ]/.test(variant))).toBe(true)
  })

  it('does not transliterate a Latin PHRASE', () => {
    // Every extra variant is another full pass over 1,059 records, and the
    // word-by-word roman terms in the index already reach the Devanagari side.
    const variants = queryVariants(parseQuery('criminal breach of trust'))
    expect(variants.some((variant) => /[ऀ-ॿ]/.test(variant))).toBe(false)
  })

  it('adds a Latin skeleton for a Devanagari query', () => {
    // The requirement is that the two scripts arrive at the SAME key, not that
    // the key spells anything in particular — `foldRoman` drops a trailing
    // vowel, so it is "haty" rather than "hatya".
    expect(queryVariants(parseQuery('हत्या'))).toContain(romanKey('hatya'))
  })

  it('is empty when the query is only a section number', () => {
    expect(queryVariants(parseQuery('302'))).toEqual([])
  })
})

describe('synonymsFor', () => {
  it('links the two languages for a term the headings do not share', () => {
    // No BNSS bail heading contains "jamanat" in any script. This is the only
    // thing that connects them.
    expect(synonymsFor('jamanat')).toContain('bail')
    expect(synonymsFor('hatya')).toContain('murder')
    expect(synonymsFor('chori')).toContain('theft')
  })

  it('is symmetric', () => {
    expect(synonymsFor('bail')).toContain('jamanat')
    expect(synonymsFor('theft')).toContain('chori')
  })

  it('does not list a term as its own synonym', () => {
    expect(synonymsFor('bail')).not.toContain('bail')
  })

  it('returns nothing for a term that is not in the lexicon', () => {
    expect(synonymsFor('zzzznotaword')).toEqual([])
  })
})

describe('reference normalisation', () => {
  it('treats spacing inside a reference as insignificant', () => {
    expect(normaliseRef('318 (4)')).toBe('318(4)')
    expect(normaliseRef(' 376ab ')).toBe('376AB')
    expect(normaliseRef('302.')).toBe('302')
  })

  it('reduces a reference to the section the dataset is keyed by', () => {
    expect(refBase('318(4)')).toBe('318')
    expect(refBase('103(1)')).toBe('103')
    expect(refBase('376AB')).toBe('376AB')
  })
})
