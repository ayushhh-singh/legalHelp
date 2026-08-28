import { readdirSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { buildQueue, DEFAULT_TRAINER_SETTINGS, gradeCard, createCard, type SrsCardRow } from '@/lib/srs'
import { isServed, type Card, type RulesCards } from '@/modules/trainer/schema'
import { fromRoot, readFromRoot } from '@/test/paths'

/**
 * The scheduler, driven over the committed `data/rules` cards rather than over
 * a fixture.
 *
 * `src/lib/srs/*.test.ts` tests the scheduler; `tests/rules-data.test.ts` tests
 * the dataset. This is the seam between them: 571 served cards across ten acts,
 * with act ids and card ids nobody wrote for a test, run through the queue and
 * the engine. It is what would catch an assumption about card ids or act names
 * that the fixtures quietly satisfy.
 */

const CARDS_DIR = 'data/rules/cards'

const catalogue: Card[] = readdirSync(fromRoot(CARDS_DIR))
  .filter((name) => name.endsWith('.json'))
  .sort()
  .flatMap((name) => (JSON.parse(readFromRoot(`${CARDS_DIR}/${name}`)) as RulesCards).cards)

const served = catalogue.filter(isServed)
const T0 = new Date('2026-03-02T09:00:00.000Z')

describe('the scheduler over the committed card set', () => {
  it('has a corpus to schedule', () => {
    expect(served.length).toBeGreaterThan(500)
    expect(served.length).toBeLessThan(catalogue.length)
  })

  it('offers the day new cards, and only approved ones', () => {
    const queue = buildQueue({
      cards: catalogue,
      states: new Map(),
      now: T0,
      settings: DEFAULT_TRAINER_SETTINGS,
    })

    expect(queue).toHaveLength(10)
    const servedIds = new Set(served.map((card) => card.id))
    for (const item of queue) expect(servedIds.has(item.qId)).toBe(true)
  })

  it('spreads the first day over the acts rather than sinking into one', () => {
    const queue = buildQueue({
      cards: catalogue,
      states: new Map(),
      now: T0,
      settings: { ...DEFAULT_TRAINER_SETTINGS, dailyNew: 10 },
    })

    // Eight of the twelve books have served cards; four are still all
    // `needs-hindi`. Ten new cards over eight acts is one each and a second for
    // the first two — never ten from whichever act happens to sort first.
    const acts = new Set(queue.map((item) => item.card.act))
    const perAct = [...acts].map((act) => queue.filter((item) => item.card.act === act).length)

    expect(acts.size).toBe(8)
    expect(Math.max(...perAct)).toBe(2)
  })

  it('honours a single act when the reader picks one', () => {
    const queue = buildQueue({
      cards: catalogue,
      states: new Map(),
      now: T0,
      acts: ['rti'],
      settings: DEFAULT_TRAINER_SETTINGS,
    })

    expect(queue).toHaveLength(10)
    expect(queue.every((item) => item.card.act === 'rti')).toBe(true)
  })

  it('schedules every served card without throwing, whatever it is graded', () => {
    const grades = ['Again', 'Hard', 'Good', 'Easy'] as const
    const rows: SrsCardRow[] = []

    served.forEach((card, index) => {
      const graded = gradeCard(createCard(card.id, T0), grades[index % 4]!, T0)
      rows.push(graded.card)
      expect(Number.isFinite(Date.parse(graded.card.due))).toBe(true)
      expect(graded.log.qId).toBe(card.id)
    })

    // Card ids are unique across the corpus, so the schedule keys are too.
    expect(new Set(rows.map((row) => row.qId)).size).toBe(served.length)
  })
})
