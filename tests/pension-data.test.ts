import { describe, expect, it } from 'vitest'

import { pensionFactsSchema, type PensionFactsDataset } from '@/modules/utils/pension/schema'
import { readFromRoot } from '@/test/paths'

/**
 * `data/pension/pension-facts.json`, read off disk rather than imported.
 *
 * The same shape `tests/pay-data.test.ts` uses, and for the same reason: this
 * suite tests the committed bytes — the artefact `scripts/ingest/utils_seed.py`
 * writes and a reviewer diffs — rather than a transformed copy of them. Until
 * this file existed the dataset had no test of its own at all; the engine over
 * it (`src/lib/pension/engine.test.ts`) is thorough and runs entirely against a
 * fixture, so nothing was reading the real table.
 */
const facts = pensionFactsSchema.parse(
  JSON.parse(readFromRoot('data/pension/pension-facts.json')) as unknown,
) satisfies PensionFactsDataset

describe('pension facts dataset', () => {
  it('matches the schema the app parses it with', () => {
    // The parse above is the assertion; this states it so a failure names it.
    expect(facts.version).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('retires a Government servant at 60', () => {
    expect(facts.superannuation.ageYears).toBe(60)
  })
})

describe('the commutation table', () => {
  const table = facts.commutation.table
  const factorFor = (age: number) => table.find((row) => row.ageNextBirthday === age)?.factor

  it('covers every age the Schedule prints, once each', () => {
    expect(table).toHaveLength(62)
    const ages = table.map((row) => row.ageNextBirthday)
    expect(ages[0]).toBe(20)
    expect(ages.at(-1)).toBe(81)
    expect(new Set(ages).size).toBe(ages.length)
  })

  it('holds the three factors read off the Schedule itself', () => {
    /*
      docs/DATA-GAPS.md #52 said the table rested on two secondary
      reproductions because the fetched PDF "could not be parsed". It can:
      pdfplumber finds no table on that page because the page draws no rules,
      but the text layer is clean and PyMuPDF reads it in three age/value
      column pairs. All 62 rows were compared against page 36 of
      `ccs_coprules_1981_060613.pdf` and all 62 agreed, which is why
      `commutation.verify` is now false.

      These three are the ends and the retirement age — the rows an error in a
      hand-edit or a re-parse would most plausibly move, and the only ones
      whose value can be quoted from the source in a sentence.
    */
    expect(factorFor(20)).toBe(9.188)
    expect(factorFor(60)).toBe(8.287)
    expect(factorFor(81)).toBe(4.611)
  })

  it('falls monotonically, because the factor is a present value', () => {
    // Every extra year of age buys less. A transposed pair of digits in one
    // row is the failure this catches and a spot-check of three rows does not.
    for (let i = 1; i < table.length; i += 1) {
      const previous = table[i - 1]!
      const current = table[i]!
      expect(current.ageNextBirthday).toBe(previous.ageNextBirthday + 1)
      expect(current.factor).toBeLessThan(previous.factor)
    }
  })

  it('is no longer flagged for verification, and says where it was read from', () => {
    expect(facts.commutation.verify).toBe(false)
    expect(facts.commutation.source.url).toContain('ccs_coprules_1981')
    // A record that stops carrying `verify` owes the reader the reason.
    expect(facts.commutation.source.note?.en).toMatch(/page 36/i)
    expect(facts.commutation.source.note?.hi.trim().length ?? 0).toBeGreaterThan(0)
  })

  it('commutes at most 40 per cent', () => {
    expect(facts.commutation.maxFraction).toBe(0.4)
  })
})
