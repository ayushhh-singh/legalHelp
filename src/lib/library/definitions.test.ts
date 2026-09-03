import { describe, expect, it } from 'vitest'

import { buildTermMatcher, findTermOccurrences, isDefinitionsUnit, parseDefinitions } from './definitions'

import { readFromRoot } from '@/test/paths'

/**
 * The definitions parser, over the REAL definitions clause of six acts.
 *
 * A fixture would prove the grammar reads what I wrote; these six prove it
 * reads what six Ministries wrote, including the two that do not follow the
 * convention — the CCS (Leave) Rules lost their quotation marks in extraction,
 * and the PoSH Act has a footnote sitting inside clause (b). Both are the
 * reason `confidence` exists.
 */

interface Rule {
  number: string
  heading: { en: string; hi: string }
  text: { en: string; hi: string }
}

const rulesOf = (act: string): Rule[] =>
  (JSON.parse(readFromRoot(`data/rules/text/${act}.json`)) as { rules: Rule[] }).rules

const definitionsUnitOf = (act: string): Rule => {
  const found = rulesOf(act).find((rule) => isDefinitionsUnit(rule.heading.en, rule.text.en))
  expect(found, `${act} has no definitions unit`).toBeDefined()
  return found!
}

const ACTS = ['rti', 'ccs-conduct', 'posh', 'gfr', 'ol-act', 'ccs-leave'] as const

describe('isDefinitionsUnit', () => {
  it.each(ACTS)('finds the definitions clause of %s', (act) => {
    const unit = definitionsUnitOf(act)
    // Every one of these six numbers its definitions clause 2 or 3; a parser
    // that "found" one at rule 17 has found something else.
    expect(['2', '3']).toContain(unit.number)
  })

  it('accepts the opening formula where the heading is missing', () => {
    expect(
      isDefinitionsUnit('', 'In these rules, unless the context otherwise requires, — (a) "X" means Y;'),
    ).toBe(true)
  })

  it('accepts a Hindi heading', () => {
    expect(isDefinitionsUnit('परिभाषाएँ', 'कुछ पाठ')).toBe(true)
  })

  it.each([
    ['a rule about conduct', 'General', 'Every Government servant shall maintain absolute integrity.'],
    ['a rule that merely uses the word', 'Penalties', 'The definitions in rule 2 shall apply to this rule.'],
  ])('does not mistake %s for one', (_label, heading, text) => {
    expect(isDefinitionsUnit(heading, text)).toBe(false)
  })
})

describe('parseDefinitions over the committed corpora', () => {
  it.each(ACTS)('reads at least two terms out of %s', (act) => {
    const terms = parseDefinitions(definitionsUnitOf(act).text.en)
    expect(terms.length).toBeGreaterThanOrEqual(2)
    for (const term of terms) {
      expect(term.term.length).toBeGreaterThan(0)
      expect(term.definition.length).toBeGreaterThan(0)
      // Nothing may claim a definition that is really the NEXT clause. Not
      // "does not start with a quote": CCS (Leave) rule 3(fa) genuinely defines
      // "disability" as three other quoted terms, and the cheap assertion
      // failed on a passage the parser had read correctly. What must not happen
      // is a body that opens with a whole term-and-connective of its own.
      expect(/^["\u201C][^"\u201D]{1,90}["\u201D]\s+(?:means|includes)\b/.test(term.definition)).toBe(false)
    }
  })

  it('reads the RTI Act the way the Act reads', () => {
    const terms = parseDefinitions(definitionsUnitOf('rti').text.en)
    const byTerm = new Map(terms.map((term) => [term.term.toLowerCase(), term]))

    expect(byTerm.get('appropriate government')?.marker).toBe('(a)')
    expect(byTerm.get('central information commission')?.definition).toContain('constituted under')
    // One clause, two terms, one body — the Act defines "Chief Information
    // Commissioner" and "Information Commissioner" together, and dropping the
    // pair would leave one of the two with no definition at all.
    expect(byTerm.has('chief information commissioner')).toBe(true)
    expect(byTerm.has('information commissioner')).toBe(true)
  })

  it('marks an unquoted clause as low confidence rather than dropping it', () => {
    // The CCS (Leave) Rules print `(a) Administrator means …` with no quotation
    // marks — the marks are in the gazette and not in the text layer.
    const terms = parseDefinitions(definitionsUnitOf('ccs-leave').text.en)
    const administrator = terms.find((term) => /^administrator$/i.test(term.term))
    expect(administrator).toBeDefined()
    expect(administrator!.confidence).toBe('low')
    expect(administrator!.verify).toBe(true)
  })

  it('gives a quoted clause with a marker full confidence and no verify flag', () => {
    const terms = parseDefinitions(definitionsUnitOf('ccs-conduct').text.en)
    const servant = terms.find((term) => /^government servant$/i.test(term.term))
    expect(servant?.confidence).toBe('high')
    expect(servant?.verify).toBe(false)
  })

  it('does not read a nested sub-clause as a term', () => {
    const terms = parseDefinitions(definitionsUnitOf('posh').text.en)
    // "(i) in relation to a workplace, a woman…" is part of the definition of
    // "aggrieved woman", not a term of its own.
    expect(terms.some((term) => /^in relation to/i.test(term.term))).toBe(false)
  })
})

describe('parseDefinitions on written fixtures', () => {
  it('reads "means and includes" as one connective', () => {
    const [term] = parseDefinitions('(a) "record" means and includes any document, manuscript and file;')
    expect(term?.term).toBe('record')
    expect(term?.definition).toBe('any document, manuscript and file')
  })

  it('reads "includes"', () => {
    const [term] = parseDefinitions('(c) "Members of family" includes the wife or husband;')
    expect(term?.definition).toBe('the wife or husband')
  })

  it('carries an interposed qualifier into the body rather than the term', () => {
    const [term] = parseDefinitions(
      '(a) "appointed day", in relation to section 3, means the 26th day of January, 1965;',
    )
    expect(term?.term).toBe('appointed day')
    expect(term?.definition).toContain('26th day of January')
  })

  it('reads a Hindi definitions clause', () => {
    const [term] = parseDefinitions('(क) "लोक प्राधिकारी" से अभिप्रेत है कोई प्राधिकारी या निकाय;')
    expect(term?.term).toBe('लोक प्राधिकारी')
    expect(term?.definition).toContain('प्राधिकारी')
  })

  it('returns nothing for a clause with no connective', () => {
    expect(parseDefinitions('(a) "record"; (b) "file";')).toEqual([])
  })

  it('returns nothing for empty text', () => {
    expect(parseDefinitions('   ')).toEqual([])
  })

  it('keeps the first of two clauses defining the same term', () => {
    const terms = parseDefinitions('(a) "X" means one; (b) "X" means two;')
    expect(terms).toHaveLength(1)
    expect(terms[0]?.definition).toBe('one')
  })
})

describe('buildTermMatcher', () => {
  const matcher = (terms: string[]) => buildTermMatcher(terms)

  it('is null when there is nothing worth matching', () => {
    expect(matcher([])).toBeNull()
    // Two characters is a preposition, not a defined term.
    expect(matcher(['of'])).toBeNull()
  })

  it('prefers the longest term at a position', () => {
    const pattern = matcher(['Information Officer', 'Central Public Information Officer'])!
    const found = 'the Central Public Information Officer shall'.match(pattern)
    expect(found?.[0]).toBe('Central Public Information Officer')
  })

  it('does not match inside a longer word', () => {
    const pattern = matcher(['record'])!
    expect(pattern.test('recorded')).toBe(false)
  })

  /**
   * The Devanagari half is asserted separately and on purpose. `\b` does not
   * exist between a space and a Devanagari letter, so a matcher anchored with
   * it covers English and silently nothing else — the trap ADR-035 recorded and
   * ADR-038 hit again. The English case passing is not evidence for this one.
   */
  it('matches a Devanagari term, which \\b could not have done', () => {
    const pattern = matcher(['लोक प्राधिकारी'])!
    expect('कोई लोक प्राधिकारी ऐसा करेगा'.match(pattern)?.[0]).toBe('लोक प्राधिकारी')
  })

  it('tolerates a different amount of whitespace inside a term', () => {
    const pattern = matcher(['competent authority'])!
    expect(pattern.test('the competent  authority may')).toBe(true)
  })
})

describe('findTermOccurrences', () => {
  const terms = ['competent authority', 'record']
  const byLowerCase = new Map(terms.map((term) => [term.toLowerCase(), term]))
  const matcher = buildTermMatcher(terms)

  it('reports offsets that cover exactly the matched words', () => {
    const text = 'The competent authority shall keep a record of it.'
    const found = findTermOccurrences(text, matcher, byLowerCase)
    expect(found).toHaveLength(2)
    for (const occurrence of found) expect(text.slice(occurrence.start, occurrence.end)).toBe(occurrence.text)
    expect(found[0]?.term).toBe('competent authority')
  })

  it('starts from the beginning of every paragraph it is given', () => {
    // A `g` regex carries `lastIndex` between calls; without a reset the second
    // paragraph is scanned from where the first one stopped and loses its hits.
    const first = 'A record is kept by the competent authority here.'
    const second = 'A record is kept.'
    findTermOccurrences(first, matcher, byLowerCase)
    expect(findTermOccurrences(second, matcher, byLowerCase)).toHaveLength(1)
  })

  it('is empty when there is no matcher', () => {
    expect(findTermOccurrences('anything', null, byLowerCase)).toEqual([])
  })

  it('ignores a match whose canonical term is not in the map', () => {
    const stray = buildTermMatcher(['ghost term'])
    expect(findTermOccurrences('a ghost term appears', stray, byLowerCase)).toEqual([])
  })
})
