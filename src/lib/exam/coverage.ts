import { paperUnits, type PaperUnit } from './types'

import type { ExamCoverage, ExamProfile, ExamUnit } from '@/schemas/exam'
import { isExternal } from '@/schemas/exam'
import { compareStrings } from '@/lib/srs'
import { isServed, type Card } from '@/modules/trainer/schema'

/**
 * Resolving a syllabus unit on to the cards this app actually has.
 *
 * Pure, and handed the catalogue, for the reason every function in
 * `src/lib/srs` is: `data/rules` is ~4 MB and belongs behind the Trainer
 * route's lazy import. The caller already has the cards.
 *
 * ## `served` and `total` are both reported, and the difference is the point
 *
 * A unit's cards are not all askable. `isServed` is the one predicate that
 * decides whether a card may be scheduled (`reviewState === 'approved'`), and a
 * rule book can carry cards that are `needs-hindi`, `unreviewed` or `rejected`.
 * So `cardsForUnit` returns both counts, `coverageOf` is the RATIO, and the
 * readiness bar is mastery × that ratio: a reader who has learnt every card
 * this app can ask them about a rule book still has not covered the rule book,
 * and telling them otherwise is the failure mode this whole module has to avoid.
 */

export { isExternal }

/** Whether a card falls inside one unit's coverage. */
export function cardMatches(coverage: ExamCoverage, card: Card): boolean {
  if (isExternal(coverage)) return false
  return coverage.some(
    (ref) =>
      ref.act === card.act &&
      // `rules` narrows an act to particular rule RECORDS, and a card names the
      // record it was written from in `ruleRef.textId`. `card.rule` is the
      // printed number ("11A", "F.R. 17"), which is not an id and would not
      // resolve; `textId` is the slug `data/rules/text/<act>.json` keys on.
      (ref.rules === undefined || ref.rules.includes(card.ruleRef.textId)),
  )
}

export interface UnitCards {
  /** Approved cards — the only ones the trainer or a mock may ask. */
  served: Card[]
  /** Every card in the unit's coverage, approved or not. */
  total: number
  /** The acts this unit draws on, sorted. Empty for an external unit. */
  acts: string[]
}

const EMPTY: UnitCards = { served: [], total: 0, acts: [] }

export function cardsForUnit(unit: ExamUnit, catalogue: readonly Card[]): UnitCards {
  if (isExternal(unit.coverage)) return EMPTY

  const served: Card[] = []
  let total = 0
  for (const card of catalogue) {
    if (!cardMatches(unit.coverage, card)) continue
    total += 1
    if (isServed(card)) served.push(card)
  }
  return {
    served,
    total,
    acts: [...new Set(unit.coverage.map((ref) => ref.act))].sort(compareStrings),
  }
}

/**
 * How much of a unit this app can teach at all, 0-1.
 *
 * An external unit is 0 — not `null`, and not left out. It is a real part of
 * the examination and the reader is really not being helped with it, and a
 * figure that quietly excluded it would be a claim about a smaller examination
 * than the one they are sitting.
 */
export function coverageOf(unit: ExamUnit, catalogue: readonly Card[]): number {
  const cards = cardsForUnit(unit, catalogue)
  if (cards.total === 0) return 0
  return cards.served.length / cards.total
}

/** Every act id any unit of the profile points at, sorted. */
export function actsOf(profile: ExamProfile): string[] {
  const acts = new Set<string>()
  for (const { unit } of paperUnits(profile)) {
    if (isExternal(unit.coverage)) continue
    for (const ref of unit.coverage) acts.add(ref.act)
  }
  return [...acts].sort(compareStrings)
}

/** The units this app holds something for, and the ones it does not. */
export function splitByCoverage(profile: ExamProfile): {
  mapped: PaperUnit[]
  external: PaperUnit[]
} {
  const mapped: PaperUnit[] = []
  const external: PaperUnit[] = []
  for (const entry of paperUnits(profile)) {
    if (isExternal(entry.unit.coverage)) external.push(entry)
    else mapped.push(entry)
  }
  return { mapped, external }
}

/**
 * The share of the examination's marks this app holds anything for, 0-1.
 *
 * This is the caveat on the readiness figure, as a number rather than as a
 * sentence — and the readiness screen renders both. For `railway-so-ldce` it is
 * about a fifth, which is exactly the thing a reader has to know before they
 * trust any other figure on the page.
 */
export function mappedMarksShare(profile: ExamProfile): number {
  const total = profile.papers.reduce((sum, paper) => sum + paper.marks, 0)
  if (total === 0) return 0
  const mapped = splitByCoverage(profile).mapped.reduce(
    (sum, entry) => sum + entry.paper.marks * entry.unit.weight,
    0,
  )
  return mapped / total
}
