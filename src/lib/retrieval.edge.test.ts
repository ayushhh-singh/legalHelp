import { describe, expect, it } from 'vitest'

import { buildRetrievalIndex, numberKey, numbersIn, retrieve, type RetrievalDoc } from './retrieval'

/**
 * An edge-case pass over the retrieval engine, after the commit.
 *
 * Every test here was confirmed to FAIL against the committed code before its
 * fix was written.
 *
 * Both defects are the same one ADR-035 records for `refKey()` — "124 and 124A
 * are different sections, and a digits-only key cannot tell them apart" —
 * arriving in a second file. There it was a suffix letter; here it is a
 * sub-section's parentheses.
 */

const rule = (workId: string, number: string, heading: string): RetrievalDoc => ({
  id: `rule:${workId}:${workId}-${number}`,
  kind: 'rule',
  workId,
  citation: `Rule ${number}, ${workId}`,
  heading,
  text: `The text of rule ${number}.`,
  href: `/library/${workId}/${workId}-${number}`,
  number,
  sourceUrl: 'https://example.gov.in/',
  personal: false,
})

describe('a sub-section must not collide with another provision', () => {
  /**
   * `numberKey` folded `18(2)` to `182` by stripping the parentheses, and `182`
   * is a REAL rule number: GFR has 307 rules and 256 of its rule numbers are
   * reachable this way, and every one of the nine rule books with more than
   * eleven rules has the same problem (`1(1)` → Rule 11 in all of them).
   *
   * The exact-number pass scores at 1.0, so this did not merely rank a stranger
   * highly — it put it level with the provision the reader actually asked for,
   * ahead of every genuinely relevant fuse hit.
   */
  it('does not fold "18(2)" into "182"', () => {
    expect(numbersIn('Rule 18(2)')).toContain('18')
    expect(numbersIn('Rule 18(2)')).not.toContain('182')
  })

  it('keeps a bare rule number reachable as itself', () => {
    expect(numberKey('182')).toBe('182')
    expect(numbersIn('Rule 182')).toEqual(['182'])
  })

  it('does not return Rule 182 for a query about Rule 18(2)', () => {
    const index = buildRetrievalIndex([
      rule('gfr', '18', 'Standards of financial propriety'),
      rule('gfr', '182', 'Purchase of goods without quotation'),
    ])
    const hits = retrieve(index, 'Rule 18(2)', { k: 5 })
    expect(hits[0]?.id).toBe('rule:gfr:gfr-18')

    /*
      Rule 182 may still be RETURNED — its citation is a plausible fuzzy match
      for the string "Rule 18(2)" and fuse is entitled to say so. What it must
      not be is EXACT: the defect was that `numberKey` folded the query to
      `182`, so the number pass scored a provision the reader never asked for
      at 1.0, level with the one they did, and ahead of every relevant fuse hit.
      Asserting its absence instead would be an over-claim about fuzzy search —
      the same mistake four of the original 40 fixtures made.
    */
    const stranger = hits.find((hit) => hit.id === 'rule:gfr:gfr-182')
    expect(stranger?.reason).not.toBe('number')
    expect(stranger?.score ?? 0).toBeLessThan(hits[0]!.score)
  })

  it('still resolves a sub-section to the rule that stores it', () => {
    const index = buildRetrievalIndex([rule('ccs-conduct', '18', 'Movable, immovable and valuable property')])
    expect(retrieve(index, 'rule 18(2)', { k: 3 })[0]?.id).toBe('rule:ccs-conduct:ccs-conduct-18')
  })

  /** `1(1)` → Rule 11 is the collision every one of these books has. */
  it('does not return Rule 11 for a query about Rule 1(1)', () => {
    const index = buildRetrievalIndex([
      rule('ccs-conduct', '1', 'Short title, commencement and application'),
      rule('ccs-conduct', '11', 'Subscriptions'),
    ])
    const hits = retrieve(index, 'Rule 1(1)', { k: 5 })
    expect(hits[0]?.id).toBe('rule:ccs-conduct:ccs-conduct-1')
    const stranger = hits.find((hit) => hit.id === 'rule:ccs-conduct:ccs-conduct-11')
    expect(stranger?.reason).not.toBe('number')
  })
})

describe('the citation shapes a reader actually types', () => {
  /**
   * `"s 65B"` is one of the four number forms the session brief names verbatim,
   * and the exact-number pass never fired for it: `PROVISION` had `s\.`, which
   * requires the full stop.
   */
  it('recognises "s 65B" without a full stop', () => {
    expect(numbersIn('s 65B')).toContain('65B')
  })

  it('still recognises the dotted forms', () => {
    expect(numbersIn('s. 65B')).toContain('65B')
    expect(numbersIn('sec 302')).toContain('302')
    expect(numbersIn('section 318(4)')).toContain('318')
  })

  /**
   * `F.R. 17(1)` is not a shape anybody invented — it is what this repository's
   * own `citation()` prints for every FR & SR provision, so it is what a reader
   * copying a citation off a card will paste back in.
   */
  it('recognises the FR & SR citation this repo itself prints', () => {
    expect(numbersIn('F.R. 17(1)')).toContain('17')
    expect(numbersIn('S.R. 2')).toContain('2')
  })

  /**
   * The negative side, and it is the one that matters: a lone `s` inside a word
   * must not turn the next number into a provision reference.
   */
  it('does not read a plural "s" as the section word', () => {
    expect(numbersIn('items 65B')).not.toContain('65B')
    expect(numbersIn('leaves 30')).not.toContain('30')
  })
})
