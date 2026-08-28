import { describe, expect, it } from 'vitest'

import { currentStreak } from './day'
import {
  allStreaks,
  exportTrainer,
  forgetCard,
  getDueCount,
  getDueQueue,
  importTrainer,
  loadSettings,
  resetTrainer,
  reviewCard,
  saveSettings,
  statsForDay,
  weakAreasFor,
} from './store'
import { TrainerImportError } from './transfer'
import { DEFAULT_TRAINER_SETTINGS, TRAINER_SETTINGS_ID } from './types'

import { db } from '@/db'
import { makeAct, makeCard } from '@/test/rules-cards'

import type { Grade } from './types'
import type { Card } from '@/modules/trainer/schema'

/**
 * `src/test/setup.ts` clears every table before each test, so each one starts
 * from an empty device. The clock is always passed in — nothing in `src/lib/srs`
 * reads one of its own.
 */
const T0 = new Date('2026-03-02T09:00:00.000Z') // 14:30 IST, 2 March

const catalogue = makeAct('conduct', 20)

const later = (ms: number) => new Date(T0.getTime() + ms)

/** Work through the queue at `now`, grading everything the same way. */
async function clearQueue(cards: readonly Card[], now: Date, grade: Grade = 'Good'): Promise<number> {
  let done = 0
  for (;;) {
    const queue = await getDueQueue(cards, now)
    const next = queue[0]
    if (!next) return done
    await reviewCard({ catalogue: cards, qId: next.qId, grade, now })
    done += 1
    if (done > 500) throw new Error('queue did not drain')
  }
}

describe('settings', () => {
  it('starts at the defaults, with nothing written', async () => {
    expect(await loadSettings()).toEqual(DEFAULT_TRAINER_SETTINGS)
    expect(await db.trainerSettings.count()).toBe(0)
  })

  it('saves a patch and keeps one row', async () => {
    await saveSettings({ dailyNew: 4 })
    await saveSettings({ actsEnabled: ['rti'] })

    expect(await loadSettings()).toEqual({ ...DEFAULT_TRAINER_SETTINGS, dailyNew: 4, actsEnabled: ['rti'] })
    expect(await db.trainerSettings.count()).toBe(1)
  })

  it('falls back to the defaults on a row it cannot read', async () => {
    // A row from some other release, or a corrupted one. It must not be able
    // to make the Trainer unopenable.
    await db.trainerSettings.put({
      id: TRAINER_SETTINGS_ID,
      dailyNew: 10,
      dailyReviewCap: 100,
      desiredRetention: 4,
      actsEnabled: [],
    })
    expect(await loadSettings()).toEqual(DEFAULT_TRAINER_SETTINGS)
  })
})

describe('the queue, over IndexedDB', () => {
  it('offers the daily new cards and nothing more', async () => {
    const queue = await getDueQueue(catalogue, T0)

    expect(queue).toHaveLength(DEFAULT_TRAINER_SETTINGS.dailyNew)
    expect(queue.map((item) => item.qId)).toEqual(Array.from({ length: 10 }, (_, i) => `conduct-${i + 1}`))
    expect(queue.every((item) => item.srs === null)).toBe(true)
  })

  it('respects a smaller daily new setting', async () => {
    await saveSettings({ dailyNew: 3 })
    expect(await getDueQueue(catalogue, T0)).toHaveLength(3)
  })

  it('spends the cap as cards are introduced, and refills at IST midnight', async () => {
    await saveSettings({ dailyNew: 3 })

    for (const qId of ['conduct-1', 'conduct-2', 'conduct-3']) {
      await reviewCard({ catalogue, qId, grade: 'Easy', now: T0 })
    }
    // All three are scheduled days out, and the day's new-card budget is spent.
    expect(await getDueQueue(catalogue, T0)).toHaveLength(0)

    // 00:10 IST the next morning — a new IST day, a fresh three.
    const tomorrow = new Date('2026-03-02T18:40:00.000Z')
    const fresh = await getDueQueue(catalogue, tomorrow)
    expect(fresh.map((item) => item.qId)).toEqual(['conduct-4', 'conduct-5', 'conduct-6'])
  })

  it('brings a failed card straight back, ahead of any new one', async () => {
    await saveSettings({ dailyNew: 2 })
    await reviewCard({ catalogue, qId: 'conduct-1', grade: 'Again', now: T0 })

    const queue = await getDueQueue(catalogue, later(2 * 60_000))
    expect(queue[0]).toMatchObject({ qId: 'conduct-1', kind: 'review' })
    expect(queue[0]?.srs?.state).toBe('learning')
  })

  it('reports the backlog independently of the caps', async () => {
    await saveSettings({ dailyNew: 20, dailyReviewCap: 2 })
    await clearQueue(catalogue, T0, 'Again')

    // Everything is due again within the hour; the queue is capped, the count is not.
    const soon = later(60 * 60_000)
    expect(await getDueCount(catalogue, soon)).toBe(20)
    expect((await getDueQueue(catalogue, soon)).length).toBe(2)
  })
})

describe('reviewCard', () => {
  it('writes the schedule, the log and the day in one go', async () => {
    const result = await reviewCard({
      catalogue,
      qId: 'conduct-1',
      grade: 'Good',
      now: T0,
      durationMs: 2_500,
    })

    expect(await db.srsCards.get('conduct-1')).toEqual(result.card)
    expect(await db.reviewLog.get(result.log.id)).toEqual(result.log)
    expect(await db.streaks.get('2026-03-02')).toEqual(result.streak)
    expect(result.log.durationMs).toBe(2_500)
    expect(result.card.state).toBe('learning')
  })

  it('creates the card row on first sight rather than requiring one', async () => {
    expect(await db.srsCards.count()).toBe(0)
    await reviewCard({ catalogue, qId: 'conduct-1', grade: 'Good', now: T0 })
    expect(await db.srsCards.count()).toBe(1)
  })

  it('appends to the log rather than overwriting a card history', async () => {
    await reviewCard({ catalogue, qId: 'conduct-1', grade: 'Again', now: T0 })
    await reviewCard({ catalogue, qId: 'conduct-1', grade: 'Good', now: later(60_000) })

    expect(await db.reviewLog.where('qId').equals('conduct-1').count()).toBe(2)
    expect(await db.srsCards.count()).toBe(1)
  })

  it('marks the day met once the queue is empty, and not before', async () => {
    await saveSettings({ dailyNew: 2 })

    const first = await reviewCard({ catalogue, qId: 'conduct-1', grade: 'Easy', now: T0 })
    expect(first.remaining).toBe(1)
    expect(first.streak.goalMet).toBe(false)

    const second = await reviewCard({ catalogue, qId: 'conduct-2', grade: 'Easy', now: T0 })
    expect(second.remaining).toBe(0)
    expect(second.streak).toEqual({ date: '2026-03-02', reviewed: 2, goalMet: true })
  })

  it('does not call the day met while a failed card is still waiting', async () => {
    await saveSettings({ dailyNew: 1 })

    // Nothing is due this second — the card comes back in a minute — and that
    // is exactly the state `goalMet` must not mistake for a finished day.
    const lapsed = await reviewCard({ catalogue, qId: 'conduct-1', grade: 'Again', now: T0 })
    expect(lapsed.remaining).toBe(0)
    expect(lapsed.pendingLater).toBe(1)
    expect(lapsed.streak.goalMet).toBe(false)

    const passed = await reviewCard({ catalogue, qId: 'conduct-1', grade: 'Good', now: later(60_000) })
    expect(passed.pendingLater).toBe(1)
    expect(passed.streak.goalMet).toBe(false)

    // The card graduates out of the learning steps and lands days away.
    const done = await reviewCard({ catalogue, qId: 'conduct-1', grade: 'Good', now: later(11 * 60_000) })
    expect(done.pendingLater).toBe(0)
    expect(done.streak).toEqual({ date: '2026-03-02', reviewed: 3, goalMet: true })
  })

  it('calls the day met once the reader own review cap is spent', async () => {
    await saveSettings({ dailyNew: 1, dailyReviewCap: 1 })

    await reviewCard({ catalogue, qId: 'conduct-1', grade: 'Again', now: T0 })
    const capped = await reviewCard({ catalogue, qId: 'conduct-1', grade: 'Again', now: later(60_000) })

    // A card is still pending, but the reader asked for one review a day.
    expect(capped.pendingLater).toBe(1)
    expect(capped.streak.goalMet).toBe(true)
  })

  it('keeps a day met even if the reader carries on afterwards', async () => {
    await saveSettings({ dailyNew: 1 })
    await reviewCard({ catalogue, qId: 'conduct-1', grade: 'Easy', now: T0 })

    // FSRS puts a card back sooner than expected; the reader answers it again.
    const extra = await reviewCard({ catalogue, qId: 'conduct-1', grade: 'Again', now: later(3_600_000) })
    expect(extra.streak.goalMet).toBe(true)
  })

  it('starts a new streak day at IST midnight, not at the device midnight', async () => {
    await saveSettings({ dailyNew: 1 })

    // 23:50 IST on 1 March, then twenty minutes later — 00:10 IST on the 2nd.
    await reviewCard({
      catalogue,
      qId: 'conduct-1',
      grade: 'Easy',
      now: new Date('2026-03-01T18:20:00.000Z'),
    })
    await reviewCard({
      catalogue,
      qId: 'conduct-2',
      grade: 'Easy',
      now: new Date('2026-03-01T18:40:00.000Z'),
    })

    const rows = (await allStreaks()).sort((a, b) => a.date.localeCompare(b.date))
    expect(rows.map((row) => row.date)).toEqual(['2026-03-01', '2026-03-02'])
    expect(rows.map((row) => row.reviewed)).toEqual([1, 1])

    // Two calendar days, twenty minutes apart — a two-day streak.
    expect(currentStreak(rows, new Date('2026-03-01T18:40:00.000Z'))).toBe(2)
  })

  it('forgets a card without touching what the reader actually did', async () => {
    await reviewCard({ catalogue, qId: 'conduct-1', grade: 'Again', now: T0 })
    await forgetCard('conduct-1')

    expect(await db.srsCards.get('conduct-1')).toBeUndefined()
    expect(await db.reviewLog.where('qId').equals('conduct-1').count()).toBe(1)
    expect((await getDueQueue(catalogue, T0))[0]).toMatchObject({ qId: 'conduct-1', kind: 'new' })
  })
})

describe('stats over the stored log', () => {
  it('reports the day work and its accuracy', async () => {
    await saveSettings({ dailyNew: 4 })
    await reviewCard({ catalogue, qId: 'conduct-1', grade: 'Good', now: T0, durationMs: 1_000 })
    await reviewCard({ catalogue, qId: 'conduct-2', grade: 'Again', now: T0, durationMs: 2_000 })
    await reviewCard({ catalogue, qId: 'conduct-3', grade: 'Easy', now: T0, durationMs: 3_000 })

    expect(await statsForDay(catalogue, T0)).toMatchObject({
      day: '2026-03-02',
      reviewed: 3,
      newIntroduced: 3,
      lapses: 1,
      accuracy: 2 / 3,
      durationMs: 6_000,
    })
  })

  it('ranks the rules the reader keeps losing', async () => {
    const cards = [
      makeCard({ id: 'c-1', act: 'conduct', rule: '3' }),
      makeCard({ id: 'c-2', act: 'conduct', rule: '11' }),
    ]
    await reviewCard({ catalogue: cards, qId: 'c-1', grade: 'Again', now: T0 })
    await reviewCard({ catalogue: cards, qId: 'c-1', grade: 'Again', now: later(60_000) })
    await reviewCard({ catalogue: cards, qId: 'c-2', grade: 'Good', now: T0 })

    const ranked = await weakAreasFor(cards)
    expect(ranked.map((area) => area.key)).toEqual(['conduct:3', 'conduct:11'])
    expect(ranked[0]).toMatchObject({ reviews: 2, lapses: 2, rate: 1 })
  })
})

describe('export and import', () => {
  async function seedADevice() {
    await saveSettings({ dailyNew: 4, actsEnabled: ['conduct'] })
    await reviewCard({ catalogue, qId: 'conduct-1', grade: 'Good', now: T0, durationMs: 1_100 })
    await reviewCard({ catalogue, qId: 'conduct-2', grade: 'Again', now: T0, durationMs: 900 })
    await reviewCard({ catalogue, qId: 'conduct-3', grade: 'Easy', now: later(60_000) })
  }

  it('round-trips through JSON into an empty device and comes back equal', async () => {
    await seedADevice()
    const before = await exportTrainer(T0)

    // A different device: nothing stored, and the file arrives as text.
    await resetTrainer()
    await db.trainerSettings.clear()
    expect(await db.srsCards.count()).toBe(0)

    const summary = await importTrainer(JSON.stringify(before))
    expect(summary).toMatchObject({ cardsBefore: 0, cardsAfter: 3, reviewsAdded: 3 })

    expect(await exportTrainer(T0)).toEqual(before)
  })

  it('is idempotent — the same file twice adds nothing the second time', async () => {
    await seedADevice()
    const file = await exportTrainer(T0)

    await importTrainer(file)
    const once = await exportTrainer(T0)
    await importTrainer(file)

    expect(await exportTrainer(T0)).toEqual(once)
  })

  it('keeps the later review when a card was answered on both devices', async () => {
    await seedADevice()
    const file = await exportTrainer(T0)

    // On this device, conduct-1 has since been answered again.
    const newer = await reviewCard({ catalogue, qId: 'conduct-1', grade: 'Easy', now: later(5 * 86_400_000) })
    await importTrainer(file)

    expect(await db.srsCards.get('conduct-1')).toEqual(newer.card)
    // And the older device's log entry for it is still there as evidence.
    expect(await db.reviewLog.where('qId').equals('conduct-1').count()).toBe(2)
  })

  it('takes on work the other device did and this one has not', async () => {
    await seedADevice()
    const file = await exportTrainer(T0)

    await resetTrainer()
    await reviewCard({ catalogue, qId: 'conduct-9', grade: 'Good', now: T0 })

    const summary = await importTrainer(file)
    expect(summary).toMatchObject({ cardsBefore: 1, cardsAfter: 4, reviewsAdded: 3 })
    expect((await db.srsCards.toArray()).map((row) => row.qId).sort()).toEqual([
      'conduct-1',
      'conduct-2',
      'conduct-3',
      'conduct-9',
    ])
  })

  it('writes nothing at all when the file is not one of ours', async () => {
    await seedADevice()
    const before = await exportTrainer(T0)

    await expect(importTrainer({ app: 'anki' })).rejects.toThrow(TrainerImportError)
    expect(await exportTrainer(T0)).toEqual(before)
  })

  it('clears the schedule on request and leaves the settings alone', async () => {
    await seedADevice()
    await resetTrainer()

    expect(await db.srsCards.count()).toBe(0)
    expect(await db.reviewLog.count()).toBe(0)
    expect(await db.streaks.count()).toBe(0)
    expect(await loadSettings()).toMatchObject({ dailyNew: 4, actsEnabled: ['conduct'] })
  })
})

describe('the device', () => {
  it('is cleared entirely by the Settings "clear stored data" path', async () => {
    await reviewCard({ catalogue, qId: 'conduct-1', grade: 'Good', now: T0 })
    await saveSettings({ dailyNew: 2 })

    const { clearAllData } = await import('@/db')
    await clearAllData()

    expect(await db.srsCards.count()).toBe(0)
    expect(await db.reviewLog.count()).toBe(0)
    expect(await db.streaks.count()).toBe(0)
    expect(await db.trainerSettings.count()).toBe(0)
  })
})
