import { describe, expect, it } from 'vitest'

import { currentStreak, isIstDay, istDay, longestStreak } from './day'
import { clampRetention, createCard, gradeCard } from './engine'
import { buildQueue, dueLaterToday } from './queue'
import { weakAreas } from './stats'
import { getDueQueue, reviewCard, saveSettings, statsForDay } from './store'
import {
  buildExport,
  emptyTrainerData,
  mergeTrainerData,
  parseTrainerExport,
  TrainerImportError,
  type TrainerData,
} from './transfer'
import { compareStrings, DEFAULT_TRAINER_SETTINGS } from './types'

import { db } from '@/db'
import { makeAct, makeCard } from '@/test/rules-cards'

import type { ReviewLogRow, StreakRow } from './types'

/**
 * The edge cases, each of which was a real defect in this library before it was
 * a test here. Grouped by what goes wrong rather than by which file it is in,
 * because every one of them crosses a file boundary — which is why none of them
 * showed up in the suites that test each file on its own.
 */

const T0 = new Date('2026-03-02T09:00:00.000Z') // 14:30 IST, 2 March
const data = (patch: Partial<TrainerData> = {}): TrainerData => ({ ...emptyTrainerData(), ...patch })
const streak = (date: string, goalMet = true): StreakRow => ({ date, reviewed: 1, goalMet })

// ---------------------------------------------------------------- ordering

describe('ordering is by code unit, never by locale', () => {
  it('compares the way the sort of a plain string array does', () => {
    const ids = ['A-1', 'a-1', 'a-2', 'ab', 'a1']
    expect([...ids].sort(compareStrings)).toEqual([...ids].sort())
    // And it is NOT what `localeCompare` gives, which is the whole point.
    expect([...ids].sort(compareStrings)).not.toEqual([...ids].sort((a, b) => a.localeCompare(b)))
  })

  it('orders an export the same way whatever the device locale collates', () => {
    const rows = ['a-1', 'A-1'].map((qId) => createCard(qId, T0))
    const file = buildExport(data({ srsCards: rows }), T0)

    // `localeCompare` puts 'a-1' first here; code-unit order does not. Two
    // devices holding the same history must produce the same bytes, and ICU
    // collation is a property of the runtime, not of the data.
    expect(file.srsCards.map((row) => row.qId)).toEqual(['A-1', 'a-1'])
  })

  it('breaks a queue tie on the id the same way', () => {
    const cards = [makeCard({ id: 'A-1', act: 'a' }), makeCard({ id: 'a-1', act: 'a' })]
    const due = new Date(T0.getTime() - 1_000).toISOString()
    const states = new Map(
      cards.map((card) => [
        card.id,
        { ...gradeCard(createCard(card.id, T0), 'Good', T0).card, due, state: 'review' as const },
      ]),
    )

    const queue = buildQueue({
      cards,
      states,
      now: T0,
      settings: { ...DEFAULT_TRAINER_SETTINGS, dailyNew: 0 },
    })
    expect(queue.map((item) => item.qId)).toEqual(['A-1', 'a-1'])
  })

  it('ranks two equally weak areas the same way', () => {
    const cards = [makeCard({ id: 'x', act: 'A' }), makeCard({ id: 'y', act: 'a' })]
    const logs: ReviewLogRow[] = cards.map((card, i) => ({
      id: `${card.id}#1`,
      qId: card.id,
      grade: 'Again',
      at: `2026-03-02T04:0${i}:00.000Z`,
      durationMs: 0,
      stateBefore: 'review',
      elapsed: 1,
      retrievability: 0.9,
    }))

    expect(weakAreas({ cards, logs, by: 'act' }).map((area) => area.key)).toEqual(['A', 'a'])
  })
})

// ------------------------------------------------------------ impossible days

describe('a day that does not exist', () => {
  it('is recognised as such, however well-shaped it looks', () => {
    expect(isIstDay('2026-03-02')).toBe(true)
    expect(isIstDay('2024-02-29')).toBe(true)
    // JavaScript parses this one — as the 3rd of March. The pattern alone
    // would wave it through, and the row would then be the 3rd of March to
    // anything that walks the calendar and a day that never happens to
    // anything that matches the string.
    expect(isIstDay('2026-02-31')).toBe(false)
    expect(isIstDay('2026-04-31')).toBe(false)
    expect(isIstDay('2026-13-45')).toBe(false)
    expect(isIstDay('2026-00-10')).toBe(false)
    expect(isIstDay('2 March 2026')).toBe(false)
  })

  it('is refused by an import rather than stored', () => {
    for (const date of ['2026-02-31', '2026-13-45']) {
      expect(() => parseTrainerExport(buildExport(data({ streaks: [streak(date)] }), T0))).toThrow(
        TrainerImportError,
      )
    }
    expect(() => parseTrainerExport(buildExport(data({ streaks: [streak('2026-03-02')] }), T0))).not.toThrow()
  })

  it('cannot take the stats screen down if one is already stored', () => {
    // A row written by some other release. `longestStreak` is the one function
    // that steps a stored date forward, so it is the one that would throw.
    const rows = [streak('2026-01-45'), streak('2026-03-01'), streak('2026-03-02')]
    expect(() => longestStreak(rows)).not.toThrow()
    expect(longestStreak(rows)).toBe(2)
    expect(currentStreak(rows, T0)).toBe(2)
  })
})

// ------------------------------------------------------- timestamps on an index

describe('stored timestamps', () => {
  it('are written in the one form that sorts chronologically as a string', () => {
    // `reviewLog.at` is a Dexie index that `store.ts` range-queries, and
    // IndexedDB compares strings by code unit. This is the property that makes
    // that query correct.
    let card = createCard('q1', T0)
    let now = T0
    const written: string[] = []

    for (let i = 0; i < 12; i += 1) {
      const result = gradeCard(card, i % 3 === 0 ? 'Again' : 'Good', now)
      written.push(result.log.at)
      card = result.card
      now = new Date(card.due)
    }

    for (const at of written) expect(new Date(at).toISOString()).toBe(at)
    expect([...written].sort(compareStrings)).toEqual(
      [...written].sort((a, b) => Date.parse(a) - Date.parse(b)),
    )
  })

  it('are refused by an import in any other form', () => {
    const base = buildExport(data(), T0)
    const log = gradeCard(createCard('q1', T0), 'Good', T0).log

    for (const at of ['2026-03-02T09:00:00Z', '2026-03-02T14:30:00+05:30', '2026-02-31T00:00:00.000Z']) {
      expect(() => parseTrainerExport({ ...base, reviewLog: [{ ...log, at }] }), at).toThrow(
        TrainerImportError,
      )
    }
    expect(() => parseTrainerExport({ ...base, reviewLog: [log] })).not.toThrow()
  })
})

// ------------------------------------------------------------- corrupt rows

describe('a row the device cannot read', () => {
  it('does not stop the card being graded', () => {
    let learnt = createCard('q1', T0)
    for (const grade of ['Good', 'Good', 'Good'] as const) {
      learnt = gradeCard(learnt, grade, new Date(learnt.due)).card
    }

    // An unreadable `lastReview` used to come back out as `RangeError: Invalid
    // time value` from `toISOString`, losing the review the reader just gave.
    expect(() => gradeCard({ ...learnt, lastReview: 'rubbish' }, 'Good', T0)).not.toThrow()
    expect(() => gradeCard({ ...learnt, due: 'rubbish' }, 'Good', T0)).not.toThrow()

    const recovered = gradeCard({ ...learnt, due: 'rubbish', lastReview: 'rubbish' }, 'Good', T0)
    expect(Number.isNaN(Date.parse(recovered.card.due))).toBe(false)
    expect(recovered.card.lastReview).toBe(T0.toISOString())
  })

  it('does not stop the queue being built', async () => {
    const catalogue = makeAct('a', 5)
    const first = await reviewCard({ catalogue, qId: 'a-1', grade: 'Good', now: T0 })
    await db.reviewLog.put({ ...first.log, id: 'corrupt', at: 'not-a-date' })

    // This threw `RangeError: Not an instant` out of `getDueQueue` — an
    // unhandled rejection — while `dayStats` tolerated the very same row.
    await expect(getDueQueue(catalogue, T0)).resolves.toBeInstanceOf(Array)
    await expect(statsForDay(catalogue, T0)).resolves.toMatchObject({ reviewed: 1 })
  })
})

// ------------------------------------------------------------ the day's goal

describe('the day goal and the acts the reader chose', () => {
  const catalogue = [...makeAct('conduct', 3), ...makeAct('cca', 3)]

  it('is not held open by a card in a book the reader is not studying', async () => {
    // A `cca` card was failed while that book was selected, and is standing on
    // a learning step.
    await saveSettings({ dailyNew: 40, actsEnabled: ['cca'] })
    await reviewCard({ catalogue, qId: 'cca-1', grade: 'Again', now: T0 })

    // The reader switches to `conduct` and clears everything it asks for.
    await saveSettings({ dailyNew: 1, actsEnabled: ['conduct'] })
    const done = await reviewCard({ catalogue, qId: 'conduct-1', grade: 'Easy', now: T0 })

    expect(await getDueQueue(catalogue, T0)).toEqual([])
    expect(done.pendingLater).toBe(0)
    expect(done.streak.goalMet).toBe(true)
  })

  it('still counts a pending card in a book that IS selected', async () => {
    await saveSettings({ dailyNew: 1, actsEnabled: ['conduct'] })
    const lapsed = await reviewCard({ catalogue, qId: 'conduct-1', grade: 'Again', now: T0 })

    expect(lapsed.pendingLater).toBe(1)
    expect(lapsed.streak.goalMet).toBe(false)
  })

  it('does not hold the day open for a card that falls due after IST midnight', () => {
    const cards = makeAct('a', 1)
    const nearMidnight = new Date('2026-03-02T18:25:00.000Z') // 23:55 IST
    const states = new Map([
      [
        'a-1',
        {
          ...gradeCard(createCard('a-1', T0), 'Good', T0).card,
          due: '2026-03-02T18:35:00.000Z', // 00:05 IST tomorrow
        },
      ],
    ])

    expect(dueLaterToday({ cards, states, now: nearMidnight })).toBe(0)
  })
})

// ---------------------------------------------------------------- the rest

describe('the arithmetic that has no obvious answer', () => {
  it('bounds the scheduler cache by rounding the retention it is keyed on', () => {
    expect(clampRetention(0.9000000001)).toBe(0.9)
    expect(clampRetention(0.8567)).toBe(0.857)
    expect(clampRetention(1 / 3 + 0.5)).toBe(0.833)
  })

  it('terminates when the day asks for more new cards than exist', () => {
    const queue = buildQueue({
      cards: makeAct('a', 3),
      states: new Map(),
      now: T0,
      settings: { ...DEFAULT_TRAINER_SETTINGS, dailyNew: 1_000_000 },
    })
    expect(queue).toHaveLength(3)
  })

  it('offers a card that is due at exactly this instant', () => {
    const cards = makeAct('a', 1)
    const states = new Map([
      ['a-1', { ...gradeCard(createCard('a-1', T0), 'Good', T0).card, due: T0.toISOString() }],
    ])
    const queue = buildQueue({
      cards,
      states,
      now: T0,
      settings: { ...DEFAULT_TRAINER_SETTINGS, dailyNew: 0 },
    })

    expect(queue.map((item) => item.qId)).toEqual(['a-1'])
  })

  it('leaves the device alone when neither copy of a card has ever been reviewed', () => {
    // Both `lastReview` are null, so the comparison is -Infinity minus
    // -Infinity, which is NaN. Every comparison against NaN is false, and the
    // fall-through has to be "keep what is here".
    const held = createCard('q1', new Date('2026-01-01T00:00:00.000Z'))
    const incoming = createCard('q1', new Date('2026-06-01T00:00:00.000Z'))

    expect(mergeTrainerData(data({ srsCards: [held] }), data({ srsCards: [incoming] })).srsCards).toEqual([
      held,
    ])
  })

  it('does not credit a streak for a day that has not happened yet', () => {
    expect(currentStreak([streak('2030-01-01')], T0)).toBe(0)
    expect(istDay(T0)).toBe('2026-03-02')
  })
})
