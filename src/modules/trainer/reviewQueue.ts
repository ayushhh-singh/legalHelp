import { cardSchema, type Card } from './schema'

import type { CardOverrideRow, ProposedCardRow } from '@/db'

/**
 * Folding a reader's local decisions back over the dataset — the Local Review
 * Queue's one piece of logic, and pure so it can be tested without Dexie.
 *
 * `data/rules` never changes at runtime; a reader accepting an AI-proposed
 * card or approving one the authoring pipeline left `unreviewed` is recorded
 * as a `CardOverrideRow`/`ProposedCardRow` instead, and this file is where the
 * two are merged with the catalogue to decide what the FSRS scheduler is
 * handed. `src/lib/srs#isServed` only ever sees the RESULT of that merge — it
 * has no idea an override exists.
 */

/** A patch a reader made while approving a card — front/back/explanation only. */
export interface CardPatch {
  front?: Partial<{ en: string; hi: string }>
  back?: Partial<{ en: string; hi: string }>
  explanation?: Partial<{ en: string; hi: string }>
}

const mergeBilingual = <T extends { en: string; hi: string } | undefined>(
  base: T,
  patch: Partial<{ en: string; hi: string }> | undefined,
): T => (patch ? { ...base, ...patch } : base)

/** A card with a reader's front/back/explanation edits folded in. */
export function applyPatch(card: Card, patch: CardPatch | null | undefined): Card {
  if (!patch) return card
  return {
    ...card,
    front: mergeBilingual(card.front, patch.front),
    back: mergeBilingual(card.back, patch.back),
    ...(card.explanation || patch.explanation
      ? { explanation: mergeBilingual(card.explanation, patch.explanation) }
      : {}),
  }
}

/** A `ProposedCardRow`, parsed back into a `Card` — or null for a row nothing can read. */
export function proposedToCard(row: ProposedCardRow): Card | null {
  const parsed = cardSchema.safeParse(row.card)
  return parsed.success ? parsed.data : null
}

/**
 * Every card the FSRS scheduler may draw on: the dataset's own `approved`
 * cards, plus any `unreviewed` dataset card or AI-`proposed` card a reader has
 * approved through the Local Review Queue — with `reviewState` forced to
 * `approved` and any edit patch applied, so `isServed` treats it exactly like
 * a card `data/rules` shipped as approved.
 *
 * A rejected card, and a proposed or unreviewed card with no decision yet, are
 * both simply absent — `isServed` would exclude them anyway, but leaving them
 * out here is what keeps this the one place that answers "is this schedulable".
 */
export function effectiveCatalogue(
  rawCards: readonly Card[],
  overrides: readonly CardOverrideRow[],
  proposed: readonly ProposedCardRow[],
): Card[] {
  const decisions = new Map(overrides.map((row) => [row.qId, row]))

  const fromDataset = rawCards.map((card) => {
    if (card.reviewState === 'approved') return card
    const decision = decisions.get(card.id)
    if (!decision || decision.action !== 'approved') return card
    return {
      ...applyPatch(card, decision.patch as CardPatch | null),
      reviewState: 'approved' as const,
      reviewed: true,
    }
  })

  const fromProposed = proposed
    .map((row): Card | null => {
      const decision = decisions.get(row.id)
      if (!decision || decision.action !== 'approved') return null
      const card = proposedToCard(row)
      if (!card) return null
      return {
        ...applyPatch(card, decision.patch as CardPatch | null),
        reviewState: 'approved' as const,
        reviewed: true,
      }
    })
    .filter((card): card is Card => card !== null)

  return [...fromDataset, ...fromProposed]
}

/** One card waiting in the Local Review Queue, whichever table it came from. */
export interface QueueEntry {
  card: Card
  source: 'dataset' | 'ai'
  proposedAt: string | null
}

/**
 * Cards nobody has decided on yet: the dataset's own `unreviewed` cards
 * (`scripts/authoring` generated them and a human has not looked), and every
 * AI-`proposed` card with no override row.
 */
export function pendingReviewQueue(
  rawCards: readonly Card[],
  overrides: readonly CardOverrideRow[],
  proposed: readonly ProposedCardRow[],
): QueueEntry[] {
  const decided = new Set(overrides.map((row) => row.qId))

  const dataset: QueueEntry[] = rawCards
    .filter((card) => card.reviewState === 'unreviewed' && !decided.has(card.id))
    .map((card) => ({ card, source: 'dataset' as const, proposedAt: null }))

  const ai: QueueEntry[] = proposed
    .filter((row) => !decided.has(row.id))
    .map((row): QueueEntry | null => {
      const card = proposedToCard(row)
      return card ? { card, source: 'ai', proposedAt: row.createdAt } : null
    })
    .filter((entry): entry is QueueEntry => entry !== null)

  return [...dataset, ...ai]
}

/** A card whose critic and blind-verify both came back clean — safe to bulk-approve. */
export function isBulkApprovable(card: Card): boolean {
  const meta = card.generationMeta
  if (!meta) return false
  if (meta.critic.verdict !== 'approve') return false
  if (meta.blindVerify && !meta.blindVerify.matched) return false
  return true
}
