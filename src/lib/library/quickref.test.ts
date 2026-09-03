import { describe, expect, it } from 'vitest'

import { extractQuickRef } from './quickref'

import { readFromRoot } from '@/test/paths'

/**
 * The quick-reference extractor, on written fixtures and on the RTI Act.
 *
 * The RTI Act is the worked example the session brief names — "all time limits
 * in the RTI Act" — and it is a good test because the four an officer actually
 * needs (thirty days, five days, forty-eight hours, thirty days for the first
 * appeal) are written four different ways in four different sections.
 */

const kinds = (text: string, kind: string) => extractQuickRef(text).filter((row) => row.kind === kind)

describe('time limits', () => {
  it.each([
    ['digits', 'shall be disposed of within 30 days', 30],
    ['words', 'within thirty days of the receipt of the request', 30],
    ['hours', 'within forty-eight hours of the receipt of the request', 2],
    ['months', 'within a period of three months', 90],
    ['a single year', 'not later than one year from that date', 365],
  ])('reads %s and sorts by real duration', (_label, text, days) => {
    const [row] = kinds(text, 'time')
    expect(row).toBeDefined()
    expect(row!.sortKey).toBeCloseTo(days, 5)
  })

  it('marks a period with a deadline lead-in as certain', () => {
    expect(kinds('within thirty days', 'time')[0]?.verify).toBe(false)
  })

  it('marks a period with no lead-in for verification rather than dropping it', () => {
    // "a term of five years" is a period and not a deadline; the table shows it
    // with a Verify badge instead of pretending to know which it is.
    const [row] = kinds('shall hold office for a term of five years', 'time')
    expect(row?.verify).toBe(true)
  })

  it('does not read a bare numeral as a period', () => {
    expect(kinds('as provided in clause 30 of the agreement', 'time')).toEqual([])
  })

  it('refuses an implausible duration rather than reading a year number', () => {
    expect(kinds('the Act of 2005 days', 'time')).toEqual([])
  })

  it('quotes enough context to be read without opening the unit', () => {
    const [row] = kinds(
      'The Central Public Information Officer shall, within thirty days of the receipt of the request, provide the information.',
      'time',
    )
    expect(row!.quote).toContain('Public Information Officer')
  })
})

describe('monetary figures', () => {
  it.each([
    ['a rupee sign', '₹5,000 shall be payable', 5000],
    ['Rs. with a comma', 'a penalty of Rs. 25,000', 25000],
    ['a lakh scale', 'exceeding Rs. 25 lakh', 2_500_000],
    ['a crore scale', 'above Rs. 2 crore', 20_000_000],
    ['words', 'a fee of rupees ten', 10],
  ])('reads %s', (_label, text, rupees) => {
    const [row] = kinds(text, 'money')
    expect(row).toBeDefined()
    expect(row!.sortKey).toBe(rupees)
  })

  it('flags a figure written in words for verification', () => {
    expect(kinds('rupees ten thousand', 'money')[0]?.verify).toBe(true)
    expect(kinds('Rs. 10,000', 'money')[0]?.verify).toBe(false)
  })
})

describe('named authorities', () => {
  it('reads the roles a provision assigns duties to', () => {
    const found = kinds(
      'The disciplinary authority shall forward it to the inquiring authority, and the Central Public Information Officer shall be informed.',
      'authority',
    ).map((row) => row.value.toLowerCase())
    expect(found).toContain('disciplinary authority')
    expect(found).toContain('inquiring authority')
    expect(found).toContain('Central Public Information Officer'.toLowerCase())
  })

  it('prefers the longest name at a position', () => {
    const found = kinds('the Central Public Information Officer shall', 'authority')
    expect(found).toHaveLength(1)
    expect(found[0]?.value.toLowerCase()).toBe('central public information officer')
  })

  it('does not match inside a longer word', () => {
    expect(kinds('the authorities named', 'authority')).toEqual([])
  })

  it('does not treat every capitalised pair as an authority', () => {
    // "the First Schedule" and "the Central Government" are neither roles nor
    // people; a pattern over capitalised words would take both.
    expect(kinds('as set out in the First Schedule to the Central Government order', 'authority')).toEqual([])
  })
})

describe('over the committed RTI Act', () => {
  interface Rule {
    number: string
    text: { en: string }
  }
  const rules = (JSON.parse(readFromRoot('data/rules/text/rti.json')) as { rules: Rule[] }).rules

  const allRows = rules.flatMap((rule) =>
    extractQuickRef(rule.text.en).map((row) => ({ ...row, rule: rule.number })),
  )

  it('finds the Act’s thirty-day limit', () => {
    const thirty = allRows.filter((row) => row.kind === 'time' && row.sortKey === 30)
    expect(thirty.length).toBeGreaterThan(0)
  })

  it('finds the forty-eight-hour limit for life and liberty', () => {
    const urgent = allRows.find((row) => row.kind === 'time' && /forty-eight hours/i.test(row.value))
    expect(urgent).toBeDefined()
  })

  it('finds the Central Public Information Officer', () => {
    expect(
      allRows.some(
        (row) => row.kind === 'authority' && /central public information officer/i.test(row.value),
      ),
    ).toBe(true)
  })

  it('every row quotes text that is really in its own unit', () => {
    for (const row of allRows.slice(0, 200)) {
      const unit = rules.find((rule) => rule.number === row.rule)!
      const cleaned = row.quote.replace(/^…|…$/g, '')
      expect(unit.text.en.replace(/\s+/g, ' ')).toContain(cleaned)
    }
  })

  it('finds a workable number of rows rather than one per sentence', () => {
    // A grammar that matched everything would be as useless as one that matched
    // nothing; this is the sanity bound on both sides.
    expect(allRows.length).toBeGreaterThan(20)
    expect(allRows.length).toBeLessThan(rules.length * 25)
  })
})

describe('extractQuickRef', () => {
  it('is empty for empty text', () => {
    expect(extractQuickRef('   ')).toEqual([])
  })

  it('does not report the same match twice', () => {
    const rows = extractQuickRef('within thirty days. within thirty days.')
    // Two separate sentences, two separate quotes — but one identical clause
    // repeated verbatim is one fact, not two.
    expect(rows.filter((row) => row.kind === 'time')).toHaveLength(1)
  })
})
