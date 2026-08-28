import { describe, expect, it } from 'vitest'

import { createCard, gradeCard } from './engine'
import { buildQueue, dueCount, usageForDay } from './queue'
import { DEFAULT_TRAINER_SETTINGS, type ReviewLogRow, type SrsCardRow, type TrainerSettings } from './types'

import { makeAct, makeCard } from '@/test/rules-cards'

import type { Card } from '@/modules/trainer/schema'

const T0 = new Date('2026-03-02T09:00:00.000Z') // 14:30 IST, 2 March

const settings = (patch: Partial<TrainerSettings> = {}): TrainerSettings => ({
  ...DEFAULT_TRAINER_SETTINGS,
  ...patch,
})

const states = (rows: readonly SrsCardRow[]) => new Map(rows.map((row) => [row.qId, row]))

/** A card that has been seen once and is due at `due`. */
function seen(qId: string, due: Date, at = new Date(T0.getTime() - 86_400_000)): SrsCardRow {
  const graded = gradeCard(createCard(qId, at), 'Good', at).card
  return { ...graded, due: due.toISOString(), state: 'review', scheduled: 1 }
}

const log = (qId: string, at: string, stateBefore: SrsCardRow['state']): ReviewLogRow => ({
  id: `${qId}#1#${at}`,
  qId,
  grade: 'Good',
  at,
  durationMs: 1_000,
  stateBefore,
  elapsed: 0,
  retrievability: stateBefore === 'new' ? null : 0.9,
})

describe('buildQueue', () => {
  it('offers new cards in index order, and only up to dailyNew', () => {
    const cards = makeAct('ccs-conduct', 25)
    const queue = buildQueue({ cards, states: states([]), now: T0, settings: settings() })

    expect(queue).toHaveLength(10)
    expect(queue.every((item) => item.kind === 'new')).toBe(true)
    expect(queue.map((item) => item.qId)).toEqual(
      Array.from({ length: 10 }, (_, i) => `ccs-conduct-${i + 1}`),
    )
  })

  it('never schedules a card that is not approved', () => {
    const cards: Card[] = [
      makeCard({ id: 'a-1', act: 'a', reviewState: 'approved' }),
      makeCard({ id: 'a-2', act: 'a', reviewState: 'needs-hindi' }),
      makeCard({ id: 'a-3', act: 'a', reviewState: 'rejected' }),
      makeCard({ id: 'a-4', act: 'a', reviewState: 'unreviewed' }),
    ]
    const queue = buildQueue({ cards, states: states([]), now: T0, settings: settings() })
    expect(queue.map((item) => item.qId)).toEqual(['a-1'])
  })

  it('puts due reviews ahead of every new card', () => {
    const cards = makeAct('a', 5)
    const rows = [
      seen('a-4', new Date(T0.getTime() - 60_000)),
      seen('a-2', new Date(T0.getTime() - 3_600_000)),
    ]
    const queue = buildQueue({ cards, states: states(rows), now: T0, settings: settings() })

    expect(queue.slice(0, 2).map((item) => item.qId)).toEqual(['a-2', 'a-4'])
    expect(queue.slice(0, 2).every((item) => item.kind === 'review')).toBe(true)
    expect(queue.slice(2).every((item) => item.kind === 'new')).toBe(true)
  })

  it('leaves a card that is not yet due out of the queue entirely', () => {
    const cards = makeAct('a', 2)
    const rows = [seen('a-1', new Date(T0.getTime() + 86_400_000))]
    const queue = buildQueue({ cards, states: states(rows), now: T0, settings: settings({ dailyNew: 0 }) })

    expect(queue).toHaveLength(0)
  })

  it('sorts equally-due reviews by id, so the queue is the same on every run', () => {
    const cards = makeAct('a', 3)
    const due = new Date(T0.getTime() - 1_000)
    const rows = [seen('a-3', due), seen('a-1', due), seen('a-2', due)]

    const built = () =>
      buildQueue({ cards, states: states(rows), now: T0, settings: settings({ dailyNew: 0 }) }).map(
        (item) => item.qId,
      )

    expect(built()).toEqual(['a-1', 'a-2', 'a-3'])
    expect(built()).toEqual(built())
  })

  it('introduces new cards round-robin across the enabled acts', () => {
    const cards = [...makeAct('conduct', 10), ...makeAct('cca', 10), ...makeAct('leave', 10)]
    const queue = buildQueue({
      cards,
      states: states([]),
      now: T0,
      settings: settings({ dailyNew: 6, actsEnabled: ['conduct', 'cca', 'leave'] }),
    })

    expect(queue.map((item) => item.qId)).toEqual([
      'conduct-1',
      'cca-1',
      'leave-1',
      'conduct-2',
      'cca-2',
      'leave-2',
    ])
  })

  it('falls back on the acts that still have new cards once one runs dry', () => {
    const cards = [...makeAct('conduct', 1), ...makeAct('cca', 5)]
    const queue = buildQueue({
      cards,
      states: states([]),
      now: T0,
      settings: settings({ dailyNew: 4, actsEnabled: ['conduct', 'cca'] }),
    })

    expect(queue.map((item) => item.qId)).toEqual(['conduct-1', 'cca-1', 'cca-2', 'cca-3'])
  })

  it('draws from every act when actsEnabled is empty', () => {
    const cards = [...makeAct('conduct', 2), ...makeAct('cca', 2)]
    const queue = buildQueue({ cards, states: states([]), now: T0, settings: settings({ dailyNew: 4 }) })

    expect(queue.map((item) => item.card.act).sort()).toEqual(['cca', 'cca', 'conduct', 'conduct'])
  })

  it('honours an explicit acts argument over the stored setting', () => {
    const cards = [...makeAct('conduct', 3), ...makeAct('cca', 3)]
    const queue = buildQueue({
      cards,
      states: states([]),
      now: T0,
      acts: ['cca'],
      settings: settings({ actsEnabled: ['conduct'] }),
    })

    expect(queue.every((item) => item.card.act === 'cca')).toBe(true)
  })

  it('spends the daily new cap against cards already introduced today', () => {
    const cards = makeAct('a', 20)
    // Three cards met for the first time at 09:00 IST today.
    const today = ['a-1', 'a-2', 'a-3'].map((qId) => log(qId, '2026-03-02T03:30:00.000Z', 'new'))

    const queue = buildQueue({
      cards,
      states: states(['a-1', 'a-2', 'a-3'].map((qId) => seen(qId, new Date(T0.getTime() + 86_400_000)))),
      now: T0,
      settings: settings(),
      logs: today,
    })

    expect(queue).toHaveLength(7)
    expect(queue.map((item) => item.qId)).toEqual(Array.from({ length: 7 }, (_, i) => `a-${i + 4}`))
  })

  it('refuses no new cards at all once dailyNew has been spent', () => {
    const cards = makeAct('a', 20)
    const spent = Array.from({ length: 10 }, (_, i) => log(`a-${i + 1}`, '2026-03-02T03:30:00.000Z', 'new'))

    const queue = buildQueue({ cards, states: states([]), now: T0, settings: settings(), logs: spent })
    expect(queue).toHaveLength(0)
  })

  it('resets the daily caps at IST midnight, not at the device midnight', () => {
    const cards = makeAct('a', 20)
    // 23:50 IST on 1 March. Yesterday's work, from today's point of view.
    const yesterday = Array.from({ length: 10 }, (_, i) =>
      log(`a-${i + 1}`, '2026-03-01T18:20:00.000Z', 'new'),
    )

    expect(usageForDay(yesterday, T0)).toEqual({ introduced: 0, reviewed: 0 })
    expect(
      buildQueue({ cards, states: states([]), now: T0, settings: settings(), logs: yesterday }),
    ).toHaveLength(10)

    // The same ten reviews twenty minutes later — 00:10 IST on 2 March — are
    // today's, and the cap is spent.
    const today = yesterday.map((row) => ({ ...row, at: '2026-03-01T18:40:00.000Z' }))
    expect(usageForDay(today, T0)).toEqual({ introduced: 10, reviewed: 0 })
    expect(
      buildQueue({ cards, states: states([]), now: T0, settings: settings(), logs: today }),
    ).toHaveLength(0)
  })

  it('caps due reviews separately from new cards', () => {
    const cards = makeAct('a', 40)
    const rows = Array.from({ length: 30 }, (_, i) => seen(`a-${i + 1}`, new Date(T0.getTime() - 1_000)))

    const queue = buildQueue({
      cards,
      states: states(rows),
      now: T0,
      settings: settings({ dailyReviewCap: 5, dailyNew: 2 }),
    })

    expect(queue.filter((item) => item.kind === 'review')).toHaveLength(5)
    expect(queue.filter((item) => item.kind === 'new')).toHaveLength(2)
  })

  it('counts a card met earlier today against the review cap, not the new one', () => {
    const cards = makeAct('a', 12)
    // a-1 was introduced today and failed; it is due again now.
    const rows = [seen('a-1', new Date(T0.getTime() - 1_000))]
    const logs = [log('a-1', '2026-03-02T03:30:00.000Z', 'new')]

    const queue = buildQueue({ cards, states: states(rows), now: T0, settings: settings(), logs })
    const relearn = queue.find((item) => item.qId === 'a-1')

    expect(relearn?.kind).toBe('review')
    // Nine of the ten new-card slots are left: a-1 used one of them this morning.
    expect(queue.filter((item) => item.kind === 'new')).toHaveLength(9)
  })
})

describe('dueCount', () => {
  it('reports the backlog without applying either cap', () => {
    const cards = makeAct('a', 40)
    const rows = Array.from({ length: 30 }, (_, i) => seen(`a-${i + 1}`, new Date(T0.getTime() - 1_000)))

    expect(dueCount({ cards, states: states(rows), now: T0 })).toBe(30)
    expect(
      buildQueue({ cards, states: states(rows), now: T0, settings: settings({ dailyReviewCap: 5 }) }).filter(
        (item) => item.kind === 'review',
      ),
    ).toHaveLength(5)
  })

  it('counts only the acts asked for', () => {
    const cards = [...makeAct('conduct', 3), ...makeAct('cca', 3)]
    const rows = [
      seen('conduct-1', new Date(T0.getTime() - 1_000)),
      seen('cca-1', new Date(T0.getTime() - 1_000)),
    ]

    expect(dueCount({ cards, states: states(rows), now: T0, acts: ['cca'] })).toBe(1)
    expect(dueCount({ cards, states: states(rows), now: T0 })).toBe(2)
  })
})
