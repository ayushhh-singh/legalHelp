import { istDay, istDayEnd, withinIstDay, type IstDay } from './day'
import { dueCount } from './queue'
import { isLapse } from './types'

import { isServed, type Card } from '@/modules/trainer/schema'

import type { ReviewLogRow, SrsCardRow } from './types'

/**
 * What the reader is told about their own progress. Pure, and computed from the
 * review log rather than from the card rows.
 *
 * That distinction is the whole reason `ReviewLogRow` carries `stateBefore` and
 * `retrievability`. A card row says where the schedule is **now**; grading a
 * card overwrites where it was. "Of the cards you had actually learnt, what
 * share did you recall?" is a question about the state a card was in when it
 * was asked, and it can only be answered from a row written at that moment.
 */

export interface DayStats {
  day: IstDay
  /**
   * Cards outstanding by the close of that IST day.
   *
   * Computed from the **current** schedule, because a past day's queue is not
   * stored anywhere and cannot be reconstructed — a card reviewed since has
   * moved. For today this is exactly the outstanding workload, backlog
   * included; for an earlier day it is a retrospective reading, and any UI that
   * shows a history should say so or show `reviewed` alone.
   */
  due: number
  /** Cards graded that day. A card graded twice counts twice. */
  reviewed: number
  /** Distinct cards met for the first time that day. */
  newIntroduced: number
  /** Of those reviews, the ones graded `Again`. */
  lapses: number
  /** Share of that day's reviews not graded `Again`, 0-1. 0 if none. */
  accuracy: number
  /**
   * **Measured** retention: the pass rate over that day's reviews of cards that
   * were already in `review` state — cards the schedule had claimed were
   * learnt. This is the number to hold against `desiredRetention`; `accuracy`
   * above includes learning and relearning cards and will always read higher.
   *
   * Null when the day contained no review-state cards at all.
   */
  retentionEstimate: number | null
  /**
   * What FSRS **predicted**, averaged over the same day's reviews of cards that
   * had a memory to predict on. The gap between this and `retentionEstimate` is
   * the gap between the model and the reader.
   */
  predictedRetention: number | null
  /** Total time spent grading, from `durationMs`. */
  durationMs: number
}

export interface StatsInput {
  day?: IstDay
  cards: readonly Card[]
  states: ReadonlyMap<string, SrsCardRow>
  logs: readonly ReviewLogRow[]
  now: Date
  acts?: readonly string[]
}

const mean = (values: readonly number[]): number | null =>
  values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length

export function dayStats(input: StatsInput): DayStats {
  const day = input.day ?? istDay(input.now)
  const allowed = new Set(input.acts ?? [])

  const actOf = new Map(input.cards.map((card) => [card.id, card.act]))
  const inScope = (qId: string): boolean => {
    if (allowed.size === 0) return true
    const act = actOf.get(qId)
    return act !== undefined && allowed.has(act)
  }

  const logs = input.logs.filter((log) => withinIstDay(log.at, day) && inScope(log.qId))

  const introduced = new Set(logs.filter((log) => log.stateBefore === 'new').map((log) => log.qId))
  const lapses = logs.filter((log) => isLapse(log.grade)).length
  const mature = logs.filter((log) => log.stateBefore === 'review')
  const predicted = logs.map((log) => log.retrievability).filter((value): value is number => value !== null)

  // The close of the day, as an instant inside it — `istDayEnd` is exclusive.
  const close = new Date(istDayEnd(day).getTime() - 1)

  return {
    day,
    due: dueCount({
      cards: input.cards,
      states: input.states,
      now: close,
      ...(allowed.size > 0 ? { acts: [...allowed] } : {}),
    }),
    reviewed: logs.length,
    newIntroduced: introduced.size,
    lapses,
    accuracy: logs.length === 0 ? 0 : (logs.length - lapses) / logs.length,
    retentionEstimate:
      mature.length === 0 ? null : mature.filter((log) => !isLapse(log.grade)).length / mature.length,
    predictedRetention: mean(predicted),
    durationMs: logs.reduce((sum, log) => sum + log.durationMs, 0),
  }
}

// ------------------------------------------------------------------ weak areas

/**
 * Where the reader is losing cards, grouped.
 *
 * The default grouping is the **rule** — `act` plus `rule` number — because
 * that is the unit the books, the citations and the cards themselves are
 * organised in, and it is what an officer would act on ("read Rule 11 again").
 *
 * Note what is *not* used: `Card.tags`. Every card in `data/rules/cards` carries
 * tags, but they record provenance and shape — `generated`, `cloze`, `mcq`,
 * `authored` — not subject. Grouping by them would rank card formats, not law.
 */
export type WeakAreaGrouping = 'rule' | 'act'

export interface WeakArea {
  /** `<act>:<rule>` when grouping by rule, `<act>` when grouping by act. */
  key: string
  act: string
  /** Null when grouping by act. */
  rule: string | null
  /** The citation the cards in this group carry, for rendering. */
  citation: { en: string; hi: string } | null
  reviews: number
  lapses: number
  /** `lapses / reviews`, 0-1. */
  rate: number
}

export interface WeakAreaInput {
  cards: readonly Card[]
  logs: readonly ReviewLogRow[]
  by?: WeakAreaGrouping
  acts?: readonly string[]
  /** Groups with fewer reviews than this are not ranked. Default 1. */
  minReviews?: number
  /** Consider only reviews at or after this instant. */
  since?: Date
}

/**
 * Ranked worst first.
 *
 * The tie-breaks matter as much as the rate does. Two groups at 50% are not
 * equally interesting if one is two reviews and the other is forty, so a tie on
 * rate is broken by `lapses` and then by `reviews` — more evidence ranks
 * higher. The last tie-break is the key itself, so the ranking is stable rather
 * than dependent on the order the log happened to come out of Dexie in.
 */
export function weakAreas(input: WeakAreaInput): WeakArea[] {
  const by = input.by ?? 'rule'
  const minReviews = input.minReviews ?? 1
  const allowed = new Set(input.acts ?? [])
  const sinceMs = input.since ? input.since.getTime() : null

  const cardById = new Map(input.cards.filter(isServed).map((card) => [card.id, card]))
  const groups = new Map<string, WeakArea>()

  for (const log of input.logs) {
    if (sinceMs !== null && Date.parse(log.at) < sinceMs) continue
    const card = cardById.get(log.qId)
    if (!card) continue
    if (allowed.size > 0 && !allowed.has(card.act)) continue

    const key = by === 'rule' ? `${card.act}:${card.rule}` : card.act
    let group = groups.get(key)
    if (!group) {
      group = {
        key,
        act: card.act,
        rule: by === 'rule' ? card.rule : null,
        citation: by === 'rule' ? card.ruleRef.citation : null,
        reviews: 0,
        lapses: 0,
        rate: 0,
      }
      groups.set(key, group)
    }
    group.reviews += 1
    if (isLapse(log.grade)) group.lapses += 1
  }

  return [...groups.values()]
    .filter((group) => group.reviews >= minReviews)
    .map((group) => ({ ...group, rate: group.lapses / group.reviews }))
    .sort(
      (a, b) => b.rate - a.rate || b.lapses - a.lapses || b.reviews - a.reviews || a.key.localeCompare(b.key),
    )
}
