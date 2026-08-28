import { istDay, istDayEnd, withinIstDay } from './day'

import { isServed, type Card } from '@/modules/trainer/schema'

import type { QueueItem, ReviewLogRow, SrsCardRow, TrainerSettings } from './types'

/**
 * What to ask next.
 *
 * Pure, and given everything it needs: the catalogue of cards, the schedule
 * rows, today's log and the settings. It does not read `data/rules` — that is
 * ~4 MB and belongs behind the Trainer route's lazy import — and it does not
 * read Dexie. `store.ts` is the half that does both.
 *
 * ## The order, and why
 *
 * **Due reviews first, then new cards.** A card already half-learnt is worth
 * more than a card never seen, and a reader who runs out of time should run out
 * of it having kept what they had. FSRS is a schedule for the reviews; the new
 * cards are the reader's decision about how fast to grow the collection.
 *
 * **New cards round-robin across the enabled acts, in index order within each.**
 * Index order is the order `scripts/authoring/make_cards.py` wrote them, which
 * is rule order — so a reader meets Rule 3 before Rule 11. Round-robin across
 * acts is what makes `actsEnabled` mean anything: a flat concatenation with
 * `dailyNew` at 10 would spend six months inside the CCS (Conduct) Rules before
 * the CCA Rules were ever offered a card.
 *
 * ## The two caps are counted separately
 *
 * `dailyNew` limits **introductions** — distinct cards seen for the first time
 * today. `dailyReviewCap` limits cards shown that were already in learning or
 * review. A card introduced this morning and failed comes back this afternoon
 * as a review, and counts against the review cap, not the new one: it is work
 * the day has already taken on, and refusing it would leave the reader having
 * met a card once and abandoned it.
 */

export interface QueueInput {
  /** Every card the trainer could ask. Unapproved ones are filtered out here. */
  cards: readonly Card[]
  /** `qId` -> schedule. A card absent from this map has never been seen. */
  states: ReadonlyMap<string, SrsCardRow>
  now: Date
  /** Act ids to draw from. Empty or omitted means every act in `cards`. */
  acts?: readonly string[]
  settings: TrainerSettings
  /**
   * Every review log row. Only today's (IST) are read, and only to work out how
   * much of each cap the day has already spent.
   */
  logs?: readonly ReviewLogRow[]
}

/** How much of each daily cap has already gone, on the IST day of `now`. */
export interface DayUsage {
  /** Distinct cards introduced today. */
  introduced: number
  /** Cards in learning, review or relearning shown today. */
  reviewed: number
}

export function usageForDay(logs: readonly ReviewLogRow[], now: Date): DayUsage {
  const day = istDay(now)
  const introduced = new Set<string>()
  let reviewed = 0

  for (const log of logs) {
    if (!withinIstDay(log.at, day)) continue
    if (log.stateBefore === 'new') introduced.add(log.qId)
    else reviewed += 1
  }
  return { introduced: introduced.size, reviewed }
}

/** A card that has a row and has been graded at least once. */
const isSeen = (row: SrsCardRow | undefined): row is SrsCardRow => row !== undefined && row.reps > 0

/**
 * The act order new cards are drawn in: the reader's own `actsEnabled` order if
 * they gave one, otherwise the order the acts appear in the catalogue.
 */
function actOrder(cards: readonly Card[], acts: readonly string[]): string[] {
  if (acts.length > 0) return [...acts]
  const seen: string[] = []
  for (const card of cards) if (!seen.includes(card.act)) seen.push(card.act)
  return seen
}

export function buildQueue(input: QueueInput): QueueItem[] {
  const { cards, states, now, settings } = input
  const acts = input.acts ?? settings.actsEnabled
  const allowed = new Set(acts)

  // Only approved cards are ever scheduled. `isServed` is the one predicate
  // that decides this, in `src/modules/trainer/schema.ts`.
  const eligible = cards.filter((card) => isServed(card) && (allowed.size === 0 || allowed.has(card.act)))

  const usage = usageForDay(input.logs ?? [], now)
  const reviewBudget = Math.max(0, settings.dailyReviewCap - usage.reviewed)
  const newBudget = Math.max(0, settings.dailyNew - usage.introduced)

  // ---- due reviews, soonest first ------------------------------------------
  const nowMs = now.getTime()
  const due = eligible
    .map((card) => ({ card, srs: states.get(card.id) }))
    .filter((entry): entry is { card: Card; srs: SrsCardRow } => isSeen(entry.srs))
    .filter((entry) => Date.parse(entry.srs.due) <= nowMs)
    .sort((a, b) => {
      const byDue = Date.parse(a.srs.due) - Date.parse(b.srs.due)
      // Tie-break on the id so the queue is the same on every run and on
      // every device holding the same history.
      return byDue !== 0 ? byDue : a.card.id.localeCompare(b.card.id)
    })
    .slice(0, reviewBudget)
    .map(({ card, srs }): QueueItem => ({ qId: card.id, card, srs, kind: 'review' }))

  // ---- new cards, round-robin over the acts --------------------------------
  const unseen = new Map<string, Card[]>()
  for (const card of eligible) {
    if (isSeen(states.get(card.id))) continue
    const list = unseen.get(card.act)
    if (list) list.push(card)
    else unseen.set(card.act, [card])
  }

  const order = actOrder(eligible, acts).filter((act) => unseen.has(act))
  const cursor = new Map<string, number>(order.map((act) => [act, 0]))
  const fresh: QueueItem[] = []

  while (fresh.length < newBudget) {
    let placed = false
    for (const act of order) {
      if (fresh.length >= newBudget) break
      const list = unseen.get(act)
      const at = cursor.get(act) ?? 0
      const card = list?.[at]
      if (!card) continue
      cursor.set(act, at + 1)
      fresh.push({ qId: card.id, card, srs: states.get(card.id) ?? null, kind: 'new' })
      placed = true
    }
    if (!placed) break
  }

  return [...due, ...fresh]
}

/**
 * Cards that are **not** due yet but will fall due before the IST day is out —
 * in practice, cards standing on a learning or relearning step.
 *
 * This is what separates "nothing is due this second" from "the day is done".
 * A card just graded `Again` is back in a minute; a queue that is momentarily
 * empty because of it has not been cleared, and `store.ts#reviewCard` uses this
 * to decide `goalMet`.
 */
export function dueLaterToday(input: Omit<QueueInput, 'settings' | 'logs'>): number {
  const allowed = new Set(input.acts ?? [])
  const nowMs = input.now.getTime()
  const closeMs = istDayEnd(istDay(input.now)).getTime()

  return input.cards.filter((card) => {
    if (!isServed(card)) return false
    if (allowed.size > 0 && !allowed.has(card.act)) return false
    const srs = input.states.get(card.id)
    if (!isSeen(srs)) return false
    const due = Date.parse(srs.due)
    return due > nowMs && due < closeMs
  }).length
}

/** Cards due at `now`, ignoring both caps — the honest size of the backlog. */
export function dueCount(input: Omit<QueueInput, 'settings' | 'logs'>): number {
  const allowed = new Set(input.acts ?? [])
  const nowMs = input.now.getTime()

  return input.cards.filter((card) => {
    if (!isServed(card)) return false
    if (allowed.size > 0 && !allowed.has(card.act)) return false
    const srs = input.states.get(card.id)
    return isSeen(srs) && Date.parse(srs.due) <= nowMs
  }).length
}
