import { cardsForUnit, coverageOf, splitByCoverage } from './coverage'
import { paperUnits, type PaperUnit } from './types'

import { compareStrings, istDay, isIstDay, type IstDay, type SrsCardRow } from '@/lib/srs'
import type { ExamProfile } from '@/schemas/exam'
import type { Card } from '@/modules/trainer/schema'

/**
 * How ready the reader is, per unit and overall.
 *
 * Pure. Handed the catalogue and the schedule rows; reads no clock of its own.
 *
 * ## The three numbers, and why they are three
 *
 * `mastery` is about the reader: of the cards this app CAN ask on this unit,
 * how far through them are they. `coverage` is about the app: of the cards that
 * exist for this unit, how many are approved to ask. `ready` is the product,
 * and it is the bar the screen paints — because a reader who has learnt
 * everything the app can teach them about the GFR has not learnt the GFR.
 *
 * Collapsing them would be the tempting simplification and it is the one that
 * makes this module dishonest. `mastery` alone reaches 1.0 on a unit the app
 * has four cards for; `coverage` alone says nothing about the reader. Only the
 * product moves for the right reason in both directions, and the screen shows
 * all three so the reader can see which half is short.
 *
 * ## Monotonicity
 *
 * `cardScore` is non-decreasing in a card's progress: no row < new < learning ≈
 * relearning < review, and within `review` it rises with stability. Every
 * figure here is a non-negative weighted mean of card scores, so improving any
 * card can never lower any bar. `readiness.test.ts` asserts that over the real
 * committed catalogue rather than trusting the reasoning.
 */

/**
 * Days of stability at which a card counts as fully held.
 *
 * Three weeks: long enough that a card at this interval has survived several
 * successful recalls under FSRS, short enough to be reachable inside the
 * preparation window a departmental examination actually gives. It is a
 * presentation constant, not an FSRS parameter — nothing here feeds it back
 * into the scheduler.
 */
export const STABILITY_TARGET_DAYS = 21

/** The floor a card in `review` state starts from, before stability is counted. */
const REVIEW_FLOOR = 0.6

/** Part credit for a card that is in hand but not yet held. */
const LEARNING_CREDIT = 0.35

/**
 * One card's progress, 0-1.
 *
 * `relearning` scores the same as `learning` deliberately: a lapsed card is
 * genuinely back in hand rather than held, and scoring it above a card being
 * met for the first time would let a reader improve their readiness by
 * forgetting things — which is the one direction this number must never move.
 */
export function cardScore(row: SrsCardRow | undefined): number {
  if (!row || row.reps === 0) return 0
  switch (row.state) {
    case 'new':
      return 0
    case 'learning':
    case 'relearning':
      return LEARNING_CREDIT
    case 'review': {
      /*
        A row out of IndexedDB is untrusted input, and two values that cannot
        occur in a schedule this app wrote both used to get through here.

        A non-finite stability made `Math.min(1, NaN / 21)` NaN, and the mean
        below carried that all the way to `overall` — "NaN% ready" is what the
        screen rendered. A NEGATIVE stability scored 0.50: more than a card the
        reader has genuinely met once, out of a number that means nothing.

        Clamped to [0, 1] before use, so a corrupt row scores its state's floor
        rather than poisoning every figure above it.
      */
      const ratio = Number.isFinite(row.stability)
        ? Math.min(1, Math.max(0, row.stability / STABILITY_TARGET_DAYS))
        : 0
      return REVIEW_FLOOR + (1 - REVIEW_FLOOR) * ratio
    }
  }
}

export interface UnitReadiness extends PaperUnit {
  external: boolean
  /** Of the cards this app can ask, how far through them the reader is. 0-1. */
  mastery: number
  /** Of the cards that exist for this unit, how many are approved. 0-1. */
  coverage: number
  /** `mastery * coverage` — what the bar paints. */
  ready: number
  /** Approved cards behind this unit. 0 for an external unit. */
  servedCards: number
  /** Approved cards the reader has never been shown. */
  unseenCards: number
  /** Marks still to be won here: `marks * (1 - ready)`. Ranks the next actions. */
  gapMarks: number
}

export interface ReadinessInput {
  profile: ExamProfile
  catalogue: readonly Card[]
  states: ReadonlyMap<string, SrsCardRow>
  now: Date
  /** The IST day of the examination, from the reader's own choice. */
  targetDate?: IstDay | null
}

export interface Readiness {
  units: UnitReadiness[]
  /**
   * Marks-weighted readiness over the MAPPED units only, 0-1.
   *
   * Over the mapped units and not the whole paper, so the figure is reachable:
   * a reader who has done everything this app offers should see 100%, and then
   * `mappedMarksShare` beside it tells them what fraction of the examination
   * that 100% was about. The alternative — dividing by the whole paper — hides
   * the caveat inside the number, where nobody can read it.
   */
  overall: number
  /** Share of the examination's marks this app holds anything for, 0-1. */
  mappedMarksShare: number
  /** Null when no target date has been chosen; negative once the day has passed. */
  daysRemaining: number | null
  /** Approved cards across every mapped unit, and how many are still unseen. */
  servedCards: number
  unseenCards: number
}

/** Milliseconds in a day. IST has a fixed +05:30 offset, so a difference of two
 * IST calendar days is exact arithmetic rather than an approximation. */
const MS_PER_DAY = 86_400_000

/**
 * Whole IST days from `now` to the examination. 0 on the day itself, negative
 * once it has passed, and **null for anything that is not an IST calendar day**.
 *
 * The first version walked `addIstDays` up to a five-year limit and returned the
 * limit when it ran out. Two things were wrong with that, and the second is the
 * one that matters. A date ten years away reported 1,830 days — wrong, and
 * wrong in a way nothing on the screen could contradict. And a string that is
 * not a date at all reported 1,830 too, so a corrupt row was indistinguishable
 * from a real five-year window: `daysUntil('not-a-day', now) === daysUntil(
 * '2031-09-04', now)`. A row out of IndexedDB is untrusted input like any
 * other, and a function that cannot read one has to say so rather than return
 * a plausible number.
 *
 * `null` rather than a throw, for the reason `src/lib/study/types.ts#isConfidence`
 * refuses rather than clamps: the caller decides what an unreadable date means,
 * and on the readiness screen it means "no date set" while on the plan it means
 * "nothing to draw".
 */
export function daysUntil(target: IstDay, now: Date): number | null {
  if (!isIstDay(target)) return null
  const today = istDay(now)
  // Both sides are IST calendar days at midnight IST, so the offset cancels and
  // this is a difference of two dates rather than of two instants. `ExamHubPage`
  // had its own copy of exactly this arithmetic — two code paths answering one
  // question, and disagreeing about it while the walk above was saturating.
  return Math.round((Date.parse(`${target}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / MS_PER_DAY)
}

export function readinessFor(input: ReadinessInput): Readiness {
  const units: UnitReadiness[] = paperUnits(input.profile).map((entry) => {
    const cards = cardsForUnit(entry.unit, input.catalogue)
    const external = cards.acts.length === 0 && cards.total === 0
    const coverage = coverageOf(entry.unit, input.catalogue)

    let scored = 0
    let unseen = 0
    for (const card of cards.served) {
      const row = input.states.get(card.id)
      scored += cardScore(row)
      if (!row || row.reps === 0) unseen += 1
    }
    const mastery = cards.served.length === 0 ? 0 : scored / cards.served.length
    const ready = mastery * coverage

    return {
      ...entry,
      external,
      mastery,
      coverage,
      ready,
      servedCards: cards.served.length,
      unseenCards: unseen,
      gapMarks: entry.marks * (1 - ready),
    }
  })

  const { mapped } = splitByCoverage(input.profile)
  const mappedKeys = new Set(mapped.map((entry) => entry.key))
  const mappedUnits = units.filter((unit) => mappedKeys.has(unit.key))

  const weight = mappedUnits.reduce((sum, unit) => sum + unit.paper.marks * unit.unit.weight, 0)
  const earned = mappedUnits.reduce((sum, unit) => sum + unit.paper.marks * unit.unit.weight * unit.ready, 0)
  const total = input.profile.papers.reduce((sum, paper) => sum + paper.marks, 0)

  return {
    units,
    overall: weight === 0 ? 0 : earned / weight,
    mappedMarksShare: total === 0 ? 0 : weight / total,
    daysRemaining: input.targetDate ? daysUntil(input.targetDate, input.now) : null,
    servedCards: mappedUnits.reduce((sum, unit) => sum + unit.servedCards, 0),
    unseenCards: mappedUnits.reduce((sum, unit) => sum + unit.unseenCards, 0),
  }
}

/* ------------------------------------------------------------------ *
 * The next three things to do
 * ------------------------------------------------------------------ */

export type NextActionKind =
  'meet-new-cards' | 'drill-weak-unit' | 'take-mock' | 'read-outside' | 'set-target-date'

/**
 * One thing to do, as DATA. No copy: `src/modules/trainer/exam` renders these
 * through the i18n catalogue, so the same three actions read in either
 * language and a change of wording is not a change to this file.
 */
export interface NextAction {
  kind: NextActionKind
  /** `<paperId>:<unitId>` for the two unit-shaped actions, null otherwise. */
  unitKey: string | null
  paperId: string | null
  unitId: string | null
  /** The act to open, where the action is about one. */
  actId: string | null
  /** Cards to meet, or marks at stake — whichever the kind's sentence needs. */
  count: number
}

export interface NextActionsInput extends Readiness {
  profile: ExamProfile
  /**
   * How far through the preparation window the reader is, 0-1.
   *
   * Optional, and DERIVED when it is not given — which is the fix for the
   * defect this parameter caused. `nextActions` already has `daysRemaining`;
   * requiring the caller to work the fraction out meant `ExamHubPage` passed
   * `null` on every render and `take-mock` could never fire from the only place
   * that calls it. A caller with a better idea of the window (a plan screen
   * that knows the start date) can still pass one.
   */
  elapsedFraction?: number | null
}

/**
 * The share of the preparation window that has gone, from the days remaining
 * alone.
 *
 * The window's START is not stored — `examChoices` holds a target date and
 * nothing else — so this reads the remaining days against a nominal window
 * rather than against a real one. `NOMINAL_WINDOW_DAYS` is what a departmental
 * examination is usually notified ahead by; the figure only ever decides
 * whether a mock is worth suggesting yet, so being approximately right is what
 * it needs to be.
 */
export const NOMINAL_WINDOW_DAYS = 90

export function elapsedFractionOf(daysRemaining: number | null): number {
  if (daysRemaining === null) return 0
  if (daysRemaining <= 0) return 1
  return Math.min(1, Math.max(0, 1 - daysRemaining / NOMINAL_WINDOW_DAYS))
}

/** A unit at or above this is not something to do next. */
const READY_ENOUGH = 0.95

/** Unit actions never take more than this many of the three slots. */
const MAX_UNIT_ACTIONS = 2

/**
 * At most three, worst first, and deliberately not more.
 *
 * The ranking among units is by `gapMarks` — marks at stake, not accuracy —
 * because a unit worth thirty marks the reader is half-ready on matters more
 * than one worth eight they have not started. Ties break on the unit key, so
 * the list is stable rather than dependent on the order the catalogue came out
 * in.
 *
 * ## Why unit actions are capped at two
 *
 * The first version filled all three slots from the ranked units, and on every
 * profile in `data/exams` — each of which has at least three weak units on day
 * one — `take-mock` and `read-outside` could therefore never appear. They had
 * their kinds, their i18n keys and their branches, and no input reached them:
 * CLAUDE.md's "wired up and cannot fire" family, in a function written that
 * hour. Capping the units at two keeps the third slot for the thing the reader
 * would not otherwise be told, which is the only reason those two kinds exist.
 * `readiness.test.ts` asserts both can fire.
 */
export function nextActions(input: NextActionsInput): NextAction[] {
  const actions: NextAction[] = []

  if (input.daysRemaining === null) {
    actions.push({
      kind: 'set-target-date',
      unitKey: null,
      paperId: null,
      unitId: null,
      actId: null,
      count: 0,
    })
  }

  const ranked = input.units
    .filter((unit) => !unit.external && unit.servedCards > 0 && unit.ready < READY_ENOUGH)
    .sort((a, b) => b.gapMarks - a.gapMarks || compareStrings(a.key, b.key))
    .map((unit): NextAction => ({
      kind: unit.unseenCards > 0 ? 'meet-new-cards' : 'drill-weak-unit',
      unitKey: unit.key,
      paperId: unit.paper.id,
      unitId: unit.unit.id,
      actId: firstAct(unit),
      count: unit.unseenCards > 0 ? unit.unseenCards : Math.round(unit.gapMarks),
    }))

  actions.push(...ranked.slice(0, MAX_UNIT_ACTIONS))

  // A mock earns its place once there is something to measure and the window is
  // past its half-way point — sitting one on day one measures nothing but the
  // reader's morale.
  const elapsed = input.elapsedFraction ?? elapsedFractionOf(input.daysRemaining)
  if (input.overall >= 0.3 && elapsed >= 0.5) {
    actions.push({ kind: 'take-mock', unitKey: null, paperId: null, unitId: null, actId: null, count: 0 })
  }

  // The part of the syllabus this app cannot help with. The least actionable
  // thing here and also the one nothing else on the screen will ever say.
  const external = input.units.filter((unit) => unit.external)
  if (external.length > 0) {
    actions.push({
      kind: 'read-outside',
      unitKey: null,
      paperId: null,
      unitId: null,
      actId: null,
      count: Math.round(external.reduce((sum, unit) => sum + unit.marks, 0)),
    })
  }

  // Whatever room is left goes back to the ranked units — a reader with four
  // weak units and no external ones should see three of them, not two.
  actions.push(...ranked.slice(MAX_UNIT_ACTIONS))

  return actions.slice(0, 3)
}

function firstAct(unit: UnitReadiness): string | null {
  if (!Array.isArray(unit.unit.coverage)) return null
  return unit.unit.coverage[0]?.act ?? null
}
