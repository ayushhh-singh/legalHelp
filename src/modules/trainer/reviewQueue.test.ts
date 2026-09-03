import { describe, expect, it } from 'vitest'

import {
  applyPatch,
  effectiveCatalogue,
  isBulkApprovable,
  pendingReviewQueue,
  proposedToCard,
} from './reviewQueue'
import { isServed } from './schema'

import { makeCard } from '@/test/rules-cards'

import type { CardOverrideRow, ProposedCardRow } from '@/db'
import type { GenerationMeta } from './schema'

const proposedRow = (id: string, patch: Record<string, unknown> = {}): ProposedCardRow => ({
  id,
  createdAt: '2026-08-28T00:00:00.000Z',
  card: { ...makeCard({ id, act: 'ccs-conduct', reviewState: 'unreviewed' }), reviewed: false, ...patch },
})

describe('applyPatch', () => {
  it('leaves the card alone with no patch', () => {
    const card = makeCard({ id: 'a-1', act: 'a' })
    expect(applyPatch(card, null)).toEqual(card)
    expect(applyPatch(card, undefined)).toEqual(card)
  })

  it('merges only the language given, keeping the other', () => {
    const card = makeCard({ id: 'a-1', act: 'a' })
    const patched = applyPatch(card, { front: { en: 'Edited question' } })
    expect(patched.front.en).toBe('Edited question')
    expect(patched.front.hi).toBe(card.front.hi)
    expect(patched.back).toEqual(card.back)
  })

  it('adds an explanation a card did not have', () => {
    const card = makeCard({ id: 'a-1', act: 'a' })
    expect(card.explanation).toBeUndefined()
    const patched = applyPatch(card, { explanation: { en: 'Because Rule 1 says so.' } })
    expect(patched.explanation?.en).toBe('Because Rule 1 says so.')
  })
})

describe('proposedToCard', () => {
  it('parses a valid stored card', () => {
    const row = proposedRow('ai-1')
    const card = proposedToCard(row)
    expect(card?.id).toBe('ai-1')
  })

  it('returns null for a row nothing can read, rather than throwing', () => {
    const row: ProposedCardRow = { id: 'bad', createdAt: '2026-08-28T00:00:00.000Z', card: { garbage: true } }
    expect(proposedToCard(row)).toBeNull()
  })
})

describe('effectiveCatalogue', () => {
  it('keeps every already-approved dataset card untouched', () => {
    const approved = makeCard({ id: 'a-1', act: 'a', reviewState: 'approved' })
    expect(effectiveCatalogue([approved], [], [])).toEqual([approved])
  })

  it('excludes an unreviewed card with no decision', () => {
    const pending = makeCard({ id: 'a-1', act: 'a', reviewState: 'unreviewed' })
    const result = effectiveCatalogue([pending], [], [])
    expect(result.find((card) => card.id === 'a-1')?.reviewState).toBe('unreviewed')
    expect(result.filter(isServed)).toHaveLength(0)
  })

  it('promotes an unreviewed dataset card the reader approved', () => {
    const pending = makeCard({ id: 'a-1', act: 'a', reviewState: 'unreviewed' })
    const decision: CardOverrideRow = {
      qId: 'a-1',
      action: 'approved',
      patch: null,
      decidedAt: '2026-08-28T00:00:00.000Z',
    }
    const result = effectiveCatalogue([pending], [decision], [])
    const card = result.find((c) => c.id === 'a-1')
    expect(card?.reviewState).toBe('approved')
    expect(card?.reviewed).toBe(true)
    expect(isServed(card!)).toBe(true)
  })

  it('applies an edit patch while approving', () => {
    const pending = makeCard({ id: 'a-1', act: 'a', reviewState: 'unreviewed' })
    const decision: CardOverrideRow = {
      qId: 'a-1',
      action: 'approved',
      patch: { front: { en: 'Corrected question?' } },
      decidedAt: '2026-08-28T00:00:00.000Z',
    }
    const result = effectiveCatalogue([pending], [decision], [])
    expect(result.find((c) => c.id === 'a-1')?.front.en).toBe('Corrected question?')
  })

  it('never resurrects a rejected card', () => {
    const pending = makeCard({ id: 'a-1', act: 'a', reviewState: 'unreviewed' })
    const decision: CardOverrideRow = {
      qId: 'a-1',
      action: 'rejected',
      patch: null,
      decidedAt: '2026-08-28T00:00:00.000Z',
    }
    const result = effectiveCatalogue([pending], [decision], [])
    expect(result.find((c) => c.id === 'a-1')?.reviewState).toBe('unreviewed')
    expect(result.filter(isServed)).toHaveLength(0)
  })

  it('brings an approved AI-proposed card into the catalogue as a new entry', () => {
    const row = proposedRow('ai-1')
    const decision: CardOverrideRow = {
      qId: 'ai-1',
      action: 'approved',
      patch: null,
      decidedAt: '2026-08-28T00:00:00.000Z',
    }
    const result = effectiveCatalogue([], [decision], [row])
    const card = result.find((c) => c.id === 'ai-1')
    expect(card?.reviewState).toBe('approved')
    expect(isServed(card!)).toBe(true)
  })

  it('leaves an undecided proposed card out entirely', () => {
    const row = proposedRow('ai-1')
    expect(effectiveCatalogue([], [], [row])).toEqual([])
  })

  it('leaves a rejected proposed card out entirely', () => {
    const row = proposedRow('ai-1')
    const decision: CardOverrideRow = {
      qId: 'ai-1',
      action: 'rejected',
      patch: null,
      decidedAt: '2026-08-28T00:00:00.000Z',
    }
    expect(effectiveCatalogue([], [decision], [row])).toEqual([])
  })

  it('drops a proposed row whose stored card cannot be parsed', () => {
    const row: ProposedCardRow = { id: 'bad', createdAt: '2026-08-28T00:00:00.000Z', card: { garbage: true } }
    const decision: CardOverrideRow = {
      qId: 'bad',
      action: 'approved',
      patch: null,
      decidedAt: '2026-08-28T00:00:00.000Z',
    }
    expect(effectiveCatalogue([], [decision], [row])).toEqual([])
  })
})

describe('pendingReviewQueue', () => {
  it('lists an unreviewed dataset card and an undecided proposed card, and nothing else', () => {
    const approved = makeCard({ id: 'a-1', act: 'a', reviewState: 'approved' })
    const pending = makeCard({ id: 'a-2', act: 'a', reviewState: 'unreviewed' })
    const proposed = proposedRow('ai-1')

    const queue = pendingReviewQueue([approved, pending], [], [proposed])
    expect(queue.map((entry) => entry.card.id).sort()).toEqual(['a-2', 'ai-1'])
    expect(queue.find((entry) => entry.card.id === 'a-2')?.source).toBe('dataset')
    expect(queue.find((entry) => entry.card.id === 'ai-1')?.source).toBe('ai')
  })

  it('drops a card once it has a decision, approved or rejected', () => {
    const pending = makeCard({ id: 'a-1', act: 'a', reviewState: 'unreviewed' })
    const decision: CardOverrideRow = {
      qId: 'a-1',
      action: 'approved',
      patch: null,
      decidedAt: '2026-08-28T00:00:00.000Z',
    }
    expect(pendingReviewQueue([pending], [decision], [])).toEqual([])
  })

  it('does not list a rejected card twice under a second decision', () => {
    const proposed = proposedRow('ai-1')
    const decision: CardOverrideRow = {
      qId: 'ai-1',
      action: 'rejected',
      patch: null,
      decidedAt: '2026-08-28T00:00:00.000Z',
    }
    expect(pendingReviewQueue([], [decision], [proposed])).toEqual([])
  })
})

describe('isBulkApprovable', () => {
  const meta = (overrides: Partial<GenerationMeta> = {}): GenerationMeta => ({
    promptVersion: '1',
    batchId: 'b1',
    stageA: { index: 1, angle: 'plain' },
    critic: { verdict: 'approve', reason: 'looks right' },
    blindVerify: { answered: 1, matched: true },
    dedup: { maxScore: 10, verdict: 'keep' },
    groundingRuleIds: ['ccs-conduct-rule-1'],
    ...overrides,
  })

  it('is false with no generation metadata at all', () => {
    expect(isBulkApprovable(makeCard({ id: 'a-1', act: 'a', reviewState: 'unreviewed' }))).toBe(false)
  })

  it('is true when the critic approved and blind verify matched', () => {
    const card = { ...makeCard({ id: 'a-1', act: 'a', reviewState: 'unreviewed' }), generationMeta: meta() }
    expect(isBulkApprovable(card)).toBe(true)
  })

  it('is false when the critic rejected', () => {
    const card = {
      ...makeCard({ id: 'a-1', act: 'a', reviewState: 'unreviewed' }),
      generationMeta: meta({ critic: { verdict: 'reject', reason: 'wrong' } }),
    }
    expect(isBulkApprovable(card)).toBe(false)
  })

  it('is false when blind verify did not match', () => {
    const card = {
      ...makeCard({ id: 'a-1', act: 'a', reviewState: 'unreviewed' }),
      generationMeta: meta({ blindVerify: { answered: 1, matched: false } }),
    }
    expect(isBulkApprovable(card)).toBe(false)
  })

  it('is true when there is nothing to blind-verify (a rule-flip card)', () => {
    const card = {
      ...makeCard({ id: 'a-1', act: 'a', reviewState: 'unreviewed' }),
      generationMeta: meta({ blindVerify: null }),
    }
    expect(isBulkApprovable(card)).toBe(true)
  })
})
