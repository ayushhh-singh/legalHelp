import { describe, expect, it } from 'vitest'

import { DEFAULT_ACTS, findReferences, referenceLabel, resolveReference } from './refs'

/**
 * The citation grammar, over thirty fixtures in both scripts.
 *
 * Every one of these is a form that actually occurs in `data/rules/text` or
 * `data/law`, or the Hindi equivalent a Rajbhasha issue would print. The table
 * is the specification: a change to the grammar is a change to this table, and
 * a form that is not in it is a form nobody promised.
 */

interface Fixture {
  text: string
  kind?: string
  number?: string
  path?: string[]
  act?: string | null
  unknownAct?: string | null
  /** Some passages must yield NO reference at all; that is the assertion. */
  none?: true
}

const FIXTURES: ReadonlyArray<[string, Fixture]> = [
  ['a bare rule', { text: 'as provided in rule 12 hereof', kind: 'rule', number: '12', path: [] }],
  [
    'a rule with a sub-rule attached',
    { text: 'see rule 12(1) above', kind: 'rule', number: '12', path: ['(1)'] },
  ],
  [
    'a sub-rule of a rule',
    { text: 'nothing in sub-rule (2) of rule 18 shall apply', kind: 'rule', number: '18', path: ['(2)'] },
  ],
  [
    'a sub-rule of a capitalised Rule',
    { text: 'under sub-rule (2) of Rule 18', kind: 'rule', number: '18', path: ['(2)'] },
  ],
  [
    'a section with two sub-parts',
    { text: 'section 8(1)(j) of this Act', kind: 'section', number: '8', path: ['(1)', '(j)'] },
  ],
  ['a bare section', { text: 'as required by section 4', kind: 'section', number: '4', path: [] }],
  [
    'a clause of a sub-section of a section',
    {
      text: 'clause (a) of sub-section (1) of section 4',
      kind: 'section',
      number: '4',
      path: ['(1)', '(a)'],
    },
  ],
  [
    'a sub-section of a section',
    { text: 'appointed under sub-section (1) of section 12', kind: 'section', number: '12', path: ['(1)'] },
  ],
  [
    'a section of a named criminal code',
    {
      text: 'punishable under section 509 of the Indian Penal Code',
      kind: 'section',
      number: '509',
      act: 'IPC',
    },
  ],
  [
    'a section of a code named with a year',
    {
      text: 'section 337 of the Code of Criminal Procedure, 1973',
      kind: 'section',
      number: '337',
      act: 'CrPC',
    },
  ],
  ['a decimal paragraph', { text: 'as set out in paragraph 4.7', kind: 'paragraph', number: '4.7' }],
  ['the short form of paragraph', { text: 'see para 3 of the note', kind: 'paragraph', number: '3' }],
  [
    'a Fundamental Rule, whose number carries its own word',
    { text: 'under F.R. 9', kind: 'rule', number: '9' },
  ],
  ['a Supplementary Rule', { text: 'S.R. 17 applies', kind: 'rule', number: '17' }],
  ['a regulation', { text: 'regulation 5 provides', kind: 'regulation', number: '5' }],
  ['a constitutional article', { text: 'article 311 of the Constitution', kind: 'article', number: '311' }],
  ['a section with a letter suffix', { text: 'inserted as section 12A', kind: 'section', number: '12A' }],
  [
    'a rule of a named rule book',
    { text: 'rule 3 of the CCS (Conduct) Rules, 1964', kind: 'rule', number: '3', act: 'ccs-conduct' },
  ],
  [
    'a section of a named Act this Library holds',
    {
      text: 'section 8 of the Right to Information Act, 2005',
      kind: 'section',
      number: '8',
      act: 'rti',
    },
  ],
  [
    'a plural citation, of which only the first carries a unit word',
    { text: 'sections 12 and 13 shall apply', kind: 'section', number: '12' },
  ],
  ['Hindi: a section', { text: 'धारा 24 के अधीन', kind: 'section', number: '24' }],
  ['Hindi: a rule', { text: 'नियम 12 में विहित', kind: 'rule', number: '12' }],
  [
    'Hindi: a sub-rule, which is written after its rule',
    { text: 'नियम 18 के उप-नियम (2)', kind: 'rule', number: '18', path: ['(2)'] },
  ],
  [
    'Hindi: a sub-section, written after its section',
    { text: 'धारा 8 की उप-धारा (1)', kind: 'section', number: '8', path: ['(1)'] },
  ],
  ['Hindi: an article', { text: 'संविधान का अनुच्छेद 343', kind: 'article', number: '343' }],
  [
    'Hindi: a clause of a section',
    { text: 'धारा 2 के खंड (ट)', kind: 'section', number: '2', path: ['(ट)'] },
  ],
  ['Hindi: a paragraph', { text: 'पैरा 4.7 देखें', kind: 'paragraph', number: '4.7' }],
  ['Hindi: a regulation', { text: 'विनियम 5 के अनुसार', kind: 'regulation', number: '5' }],
  [
    'an Act this Library does not hold is refused, not read as this document',
    { text: 'section 4 of the Companies Act, 2013', number: '4', act: null, unknownAct: 'Companies Act' },
  ],
  [
    'a self-reference is this document, not an unknown Act',
    { text: 'section 4 of these rules', number: '4', act: null, unknownAct: null },
  ],
  ['a sub-rule with no rule names nothing to open', { text: 'as stated in sub-rule (2)', none: true }],
  ['prose with no citation in it', { text: 'The Government servant shall maintain integrity.', none: true }],
]

describe('findReferences', () => {
  it.each(FIXTURES)('reads %s', (_label, fixture) => {
    const found = findReferences(fixture.text)

    if (fixture.none) {
      expect(found).toEqual([])
      return
    }

    expect(found.length).toBeGreaterThan(0)
    const first = found[0]!
    if (fixture.kind) expect(first.kind).toBe(fixture.kind)
    if (fixture.number) expect(first.number).toBe(fixture.number)
    if (fixture.path) expect(first.path).toEqual(fixture.path)
    if (fixture.act !== undefined) expect(first.act?.id ?? null).toBe(fixture.act)
    if (fixture.unknownAct !== undefined) expect(first.unknownAct).toBe(fixture.unknownAct)
  })

  it('reports offsets that cover exactly the words the document wrote', () => {
    const text = 'Nothing in sub-rule (2) of rule 18 shall apply to a probationer.'
    const [reference] = findReferences(text)
    expect(text.slice(reference!.start, reference!.end)).toBe('sub-rule (2) of rule 18')
    expect(reference!.raw).toBe('sub-rule (2) of rule 18')
  })

  it('includes the Act name in the span, so the link covers the whole citation', () => {
    const text = 'punishable under section 509 of the Indian Penal Code and otherwise'
    const [reference] = findReferences(text)
    expect(reference!.raw).toBe('section 509 of the Indian Penal Code')
  })

  it('finds every citation in a passage, in the order they are written', () => {
    const found = findReferences(
      'Subject to rule 4, a request under section 6 shall be disposed of under rule 7.',
    )
    expect(found.map((reference) => reference.number)).toEqual(['4', '6', '7'])
  })

  it('does not read a sub-clause list as a chain of citations', () => {
    // `(a) … (b) …` inside a rule has no unit word, so nothing here is a
    // component at all — the failure would be a citation per clause letter.
    expect(findReferences('(a) the wife or husband; (b) the children of the Government servant')).toEqual([])
  })
})

describe('resolveReference', () => {
  const exists = (workId: string, number: string): string | null =>
    workId === 'rti' && number === '8' ? 'rti-8' : null

  it('opens a unit of this work when the citation names no Act', () => {
    const [reference] = findReferences('as provided in section 8')
    expect(resolveReference(reference!, 'rti', exists)).toEqual({
      kind: 'unit',
      workId: 'rti',
      unitId: 'rti-8',
    })
  })

  it('opens a unit of the work the citation names', () => {
    const [reference] = findReferences('section 8 of the Right to Information Act, 2005')
    expect(resolveReference(reference!, 'ccs-conduct', exists)).toEqual({
      kind: 'unit',
      workId: 'rti',
      unitId: 'rti-8',
    })
  })

  it('sends a criminal-code citation to the Law Converter as a query naming the Act', () => {
    const [reference] = findReferences('under section 509 of the Indian Penal Code')
    expect(resolveReference(reference!, 'posh', exists)).toEqual({ kind: 'law', query: 'IPC 509' })
  })

  it('resolves to nothing when this work has no such unit', () => {
    const [reference] = findReferences('as provided in rule 999')
    expect(resolveReference(reference!, 'rti', exists)).toBeNull()
  })

  it('resolves to nothing for an Act this Library does not hold', () => {
    const [reference] = findReferences('section 8 of the Companies Act, 2013')
    // The number matches a unit this work HAS, which is exactly the trap: the
    // citation is not about this work at all.
    expect(resolveReference(reference!, 'rti', exists)).toBeNull()
  })
})

describe('referenceLabel', () => {
  it('reads the way an officer writes it', () => {
    const [reference] = findReferences('sub-rule (2) of rule 18')
    expect(referenceLabel(reference!)).toBe('18(2)')
  })
})

describe('DEFAULT_ACTS', () => {
  it('names every work id it claims to, so a resolution cannot point nowhere', () => {
    const workIds = new Set([
      'bns',
      'bnss',
      'bsa',
      'ccs-cca',
      'ccs-conduct',
      'ccs-leave',
      'ccs-pension',
      'csmop',
      'fr-sr',
      'gfr',
      'ol-act',
      'ol-rules',
      'osa',
      'posh',
      'rti',
    ])
    for (const act of DEFAULT_ACTS) {
      if (act.target === 'work') expect(workIds.has(act.id), act.id).toBe(true)
    }
  })

  it('uses the code ids the Law Converter itself resolves', () => {
    const codes = DEFAULT_ACTS.filter((act) => act.target === 'law').map((act) => act.id)
    expect(codes).toEqual(['IPC', 'CrPC', 'IEA', 'BNS', 'BNSS', 'BSA'])
  })
})
