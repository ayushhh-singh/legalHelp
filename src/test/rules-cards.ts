import type { Card, ReviewState } from '@/modules/trainer/schema'

/**
 * Card fixtures for the spaced-repetition suites.
 *
 * Small, hand-built and deliberately not read off `data/rules`: these tests are
 * about the scheduler, and a queue test that depends on which rule happens to
 * be third in the CCS (Conduct) Rules would start failing the next time
 * `scripts/authoring/make_cards.py` runs. `tests/rules-data.test.ts` is what
 * tests the committed dataset.
 *
 * Every card built here satisfies `cardSchema`, so a fixture cannot drift from
 * the shape the trainer will actually be handed — `srs-fixtures.test.ts`
 * asserts that.
 */

export interface CardSpec {
  id: string
  act: string
  rule?: string
  reviewState?: ReviewState
}

export function makeCard(spec: CardSpec): Card {
  const rule = spec.rule ?? '1'
  const reviewState = spec.reviewState ?? 'approved'

  return {
    id: spec.id,
    act: spec.act,
    rule,
    kind: 'rule',
    front: {
      en: `${spec.act} rule ${rule} — what does it say?`,
      hi: `${spec.act} नियम ${rule} — क्या कहता है?`,
    },
    back: { en: `The text of rule ${rule}.`, hi: `नियम ${rule} का पाठ।` },
    ruleRef: {
      textId: `${spec.act}-rule-${rule.toLowerCase()}`,
      citation: { en: `Rule ${rule}`, hi: `नियम ${rule}` },
    },
    difficulty: 'medium',
    reviewed: reviewState !== 'unreviewed',
    reviewState,
    version: '1.0.0',
    source: { name: 'Fixture', url: 'https://example.gov.in/fixture' },
  }
}

/** `n` approved cards of one act, ids `<act>-1` … `<act>-n`, rules "1" … "n". */
export const makeAct = (act: string, n: number, from = 1): Card[] =>
  Array.from({ length: n }, (_, i) => makeCard({ id: `${act}-${from + i}`, act, rule: String(from + i) }))
