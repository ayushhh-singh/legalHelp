import { describe, expect, it } from 'vitest'

import { mergeWithPrevious, splitDocument, splitUnitAt } from './split'

/**
 * The splitter, over the five document shapes the session brief names.
 *
 * None of these is a fixture invented to suit the code: each is how one of the
 * documents this app already holds is actually laid out once its text layer is
 * extracted, which is what an officer pasting their own manual will produce.
 */

const RULE_BOOK = `CHAPTER I
PRELIMINARY

1. Short title and commencement.—(1) These rules may be called the Model Rules, 2026.
(2) They shall come into force at once.

2. Definitions.—In these rules, unless the context otherwise requires, (a) "Government" means the Central Government;

CHAPTER II
CONDUCT

3. General.—Every Government servant shall maintain absolute integrity.
Provided that nothing in this rule shall apply to a casual worker.
Explanation.—A Government servant who habitually fails is deemed to lack devotion to duty.`

const WORDED = `Section 12. Power to make rules
The Central Government may make rules.

Section 13. Repeal and saving
The earlier Act is repealed.`

const NUMBERED_ONLY = `1. The competent authority may relax any rule.
2. No relaxation shall be made retrospectively.
3. Every relaxation shall be recorded in writing.`

const SUB_RULE_OPENING = `11(1) No Government servant shall accept a gift.
(2) Sub-rule (1) shall not apply to a gift from a near relative.

12(1) Every Government servant shall report a transaction.`

const ONE_LINE =
  'PRELIMINARY 1. Short title.—These rules may be called the Model Rules. 2. Definitions.—In these rules, "Government" means the Central Government. 3. General.—Every servant shall maintain integrity.'

describe('splitDocument — a rule book with chapters', () => {
  const result = splitDocument(RULE_BOOK)

  it('finds the chapters', () => {
    expect(result.divisions.map((division) => division.label)).toEqual(['CHAPTER I', 'CHAPTER II'])
    expect(result.divisions[0]?.title).toBe('PRELIMINARY')
  })

  it('finds the rules and reads their headings', () => {
    expect(result.units.map((unit) => unit.number)).toEqual(['1', '2', '3'])
    expect(result.units.map((unit) => unit.heading)).toEqual([
      'Short title and commencement',
      'Definitions',
      'General',
    ])
  })

  it('keeps a proviso and an explanation with their parent rule', () => {
    const third = result.units[2]!
    expect(third.text).toContain('Provided that')
    expect(third.text).toContain('Explanation')
  })

  it('does not read a sub-rule as a unit of its own', () => {
    expect(result.units[0]?.text).toContain('(2) They shall come into force')
  })

  it('files each unit under the chapter it fell in', () => {
    expect(result.units.map((unit) => unit.division)).toEqual(['CHAPTER I', 'CHAPTER I', 'CHAPTER II'])
  })

  it('is confident about a numbered rule with a title', () => {
    expect(result.units.every((unit) => unit.confidence === 'high')).toBe(true)
  })
})

describe('splitDocument — sections named by their unit word', () => {
  const result = splitDocument(WORDED)

  it('reads the number and the heading', () => {
    expect(result.units.map((unit) => [unit.number, unit.heading])).toEqual([
      ['12', 'Power to make rules'],
      ['13', 'Repeal and saving'],
    ])
  })
})

describe('splitDocument — numbers with no headings', () => {
  const result = splitDocument(NUMBERED_ONLY)

  it('still splits, and says it is unsure', () => {
    expect(result.units).toHaveLength(3)
    expect(result.units.every((unit) => unit.confidence === 'low')).toBe(true)
    expect(result.notes).toContain('low-confidence')
  })

  it('keeps the whole sentence as the body rather than inventing a heading', () => {
    expect(result.units[0]?.heading).toBe('')
    expect(result.units[0]?.text).toBe('The competent authority may relax any rule.')
  })
})

describe('splitDocument — a rule that opens straight into its first sub-rule', () => {
  const result = splitDocument(SUB_RULE_OPENING)

  it('starts a unit at 11(1) and not at (2)', () => {
    expect(result.units.map((unit) => unit.number)).toEqual(['11', '12'])
  })

  it('keeps (1) in the body, because the document numbered it', () => {
    expect(result.units[0]?.text.startsWith('(1) No Government servant')).toBe(true)
    expect(result.units[0]?.text).toContain('(2) Sub-rule (1) shall not apply')
  })
})

describe('splitDocument — a document pasted as one line', () => {
  const result = splitDocument(ONE_LINE)

  it('falls back to an inline split and says so', () => {
    expect(result.notes).toContain('inline')
    expect(result.units.length).toBeGreaterThan(1)
  })

  it('never claims confidence it does not have', () => {
    expect(result.units.every((unit) => unit.confidence === 'low')).toBe(true)
  })
})

describe('splitDocument — text with no structure at all', () => {
  const result = splitDocument('This is a memorandum. It has no numbering of any kind whatsoever.')

  it('returns one unit and says the document was unstructured', () => {
    expect(result.units).toHaveLength(1)
    expect(result.notes).toContain('unstructured')
  })

  it('loses none of the text', () => {
    expect(result.units[0]?.text).toBe('This is a memorandum. It has no numbering of any kind whatsoever.')
  })
})

describe('splitDocument — text before the first numbered unit', () => {
  const result = splitDocument('MINISTRY OF PERSONNEL\nNOTIFICATION\n\n1. Short title.—These rules.')

  it('keeps the preamble as unit 0 rather than dropping it', () => {
    expect(result.units[0]?.number).toBe('0')
    expect(result.units[0]?.text).toContain('MINISTRY OF PERSONNEL')
    expect(result.notes).toContain('preamble')
  })
})

describe('splitDocument — Devanagari', () => {
  it('reads a chapter and a rule written in Hindi', () => {
    const result = splitDocument(
      'अध्याय 1\nप्रारंभिक\n\nनियम 3 आचरण\nप्रत्येक सरकारी सेवक सत्यनिष्ठा बनाए रखेगा।',
    )
    expect(result.divisions[0]?.label).toBe('अध्याय 1')
    expect(result.units[0]?.number).toBe('3')
  })
})

describe('mergeWithPrevious', () => {
  const units = splitDocument(NUMBERED_ONLY).units

  it('joins a unit into the one above it', () => {
    const merged = mergeWithPrevious(units, 1)
    expect(merged).toHaveLength(2)
    expect(merged[0]?.text).toContain('No relaxation shall be made')
  })

  it('makes the result certain, because a person decided it', () => {
    expect(mergeWithPrevious(units, 1)[0]?.confidence).toBe('high')
  })

  it('does nothing at the first unit, where there is nothing above', () => {
    expect(mergeWithPrevious(units, 0)).toEqual(units)
  })

  it('does nothing for an index that is not there', () => {
    expect(mergeWithPrevious(units, 99)).toEqual(units)
  })
})

describe('splitUnitAt', () => {
  const units = splitDocument('1. One.—First sentence. Second sentence.').units

  it('divides one unit into two', () => {
    const at = units[0]!.text.indexOf('Second')
    const divided = splitUnitAt(units, 0, at)
    expect(divided).toHaveLength(2)
    expect(divided[0]?.text).toBe('First sentence.')
    expect(divided[1]?.text).toBe('Second sentence.')
  })

  it('numbers the new unit after its parent when the tail carries no number', () => {
    const divided = splitUnitAt(units, 0, units[0]!.text.indexOf('Second'))
    expect(divided[1]?.number).toBe('1A')
  })

  it('takes the number the tail carries where it has one', () => {
    const [unit] = splitDocument('1. One.—First. 2. Two.—Second.').units
    const divided = splitUnitAt([unit!], 0, unit!.text.indexOf('2.'))
    expect(divided[1]?.number).toBe('2')
  })

  it('does nothing at either end of the text', () => {
    expect(splitUnitAt(units, 0, 0)).toEqual(units)
    expect(splitUnitAt(units, 0, units[0]!.text.length)).toEqual(units)
  })

  it('does nothing for an index that is not there', () => {
    expect(splitUnitAt(units, 5, 3)).toEqual(units)
  })

  it('loses no text', () => {
    const at = units[0]!.text.indexOf('Second')
    const divided = splitUnitAt(units, 0, at)
    expect(`${divided[0]!.text} ${divided[1]!.text}`).toBe(units[0]!.text)
  })
})
