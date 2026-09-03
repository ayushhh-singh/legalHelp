import { beforeEach, describe, expect, it } from 'vitest'

import { chaptersOf } from './chapters'
import {
  allAttempts,
  allChapterCards,
  allChapterLog,
  allGoals,
  allSessions,
  attemptsFor,
  attemptsInWork,
  chapterCardsFor,
  chapterLogFor,
  deleteAttempt,
  forgetChapter,
  goalFor,
  rateChapterCard,
  runningSession,
  saveAttempt,
  saveGoal,
  startSession,
  stopSession,
} from './store'
import type { ChapterWork } from './chapters'

import { clearAllData } from '@/db'

/**
 * The Dexie half, against `fake-indexeddb` and a frozen clock.
 *
 * Everything scheduled here goes through `src/lib/srs/engine.ts` with fuzz off
 * (ADR-025), so a due date asserted below is reproducible.
 */

const NOW = new Date('2026-09-03T06:00:00.000Z')
const later = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000)

const work: ChapterWork = {
  id: 'rti',
  toc: [
    {
      id: 'ch-1',
      number: 'I',
      heading: { en: 'Preliminary', hi: 'प्रारंभिक' },
      children: [
        { id: 'rti-1', number: '1', heading: { en: 'Title', hi: 'नाम' }, unitIds: ['rti-1'] },
        { id: 'rti-2', number: '2', heading: { en: 'Definitions', hi: 'परिभाषाएँ' }, unitIds: ['rti-2'] },
      ],
      unitIds: ['rti-1', 'rti-2'],
    },
    {
      id: 'ch-2',
      number: 'II',
      heading: { en: 'The right', hi: 'अधिकार' },
      children: [{ id: 'rti-3', number: '3', heading: { en: 'Right', hi: 'अधिकार' }, unitIds: ['rti-3'] }],
      unitIds: ['rti-3'],
    },
  ],
}

const [first, second] = chaptersOf(work)

beforeEach(async () => {
  await clearAllData()
})

describe('the chapter deck', () => {
  it('creates a card on the first rating rather than on arrival', async () => {
    expect(await allChapterCards()).toEqual([])
    const card = await rateChapterCard({ chapter: first!, confidence: 3, now: NOW })
    expect(card.id).toBe('rti:ch-1')
    expect((await allChapterCards()).map((row) => row.id)).toEqual(['rti:ch-1'])
  })

  it('writes the card and the log together', async () => {
    await rateChapterCard({ chapter: first!, confidence: 3, now: NOW })
    const log = await allChapterLog()
    expect(log).toHaveLength(1)
    expect(log[0]?.cardId).toBe('rti:ch-1')
    expect(log[0]?.grade).toBe('Good')
    expect(log[0]?.stateBefore).toBe('new')
  })

  it('reschedules an existing card rather than starting it over', async () => {
    const one = await rateChapterCard({ chapter: first!, confidence: 3, now: NOW })
    const two = await rateChapterCard({ chapter: first!, confidence: 3, now: later(60 * 24 * 3) })
    expect(two.reps).toBe(2)
    expect(two.due > one.due).toBe(true)
    expect(await allChapterCards()).toHaveLength(1)
    expect(await allChapterLog()).toHaveLength(2)
  })

  it('records the reason a rating was given', async () => {
    await rateChapterCard({ chapter: first!, confidence: 2, reason: 'quiz', now: NOW })
    expect((await allChapterLog())[0]?.reason).toBe('quiz')
  })

  it('scopes reads to one work', async () => {
    await rateChapterCard({ chapter: first!, confidence: 3, now: NOW })
    await rateChapterCard({
      chapter: { ...second!, workId: 'posh', id: 'posh:ch-2' },
      confidence: 3,
      now: NOW,
    })
    expect(await chapterCardsFor('rti')).toHaveLength(1)
    expect(await chapterLogFor('rti')).toHaveLength(1)
    expect(await allChapterCards()).toHaveLength(2)
  })

  it('forgets a chapter’s schedule and its whole history', async () => {
    await rateChapterCard({ chapter: first!, confidence: 3, now: NOW })
    await rateChapterCard({ chapter: first!, confidence: 3, now: later(60 * 24 * 3) })
    await rateChapterCard({ chapter: second!, confidence: 3, now: NOW })

    await forgetChapter('rti:ch-1')
    expect((await allChapterCards()).map((row) => row.id)).toEqual(['rti:ch-2'])
    expect((await allChapterLog()).every((row) => row.cardId === 'rti:ch-2')).toBe(true)
  })
})

describe('Feynman attempts', () => {
  it('stores the body exactly as typed', async () => {
    const body = '  Rule 3 requires\n\n  absolute integrity.  '
    const row = await saveAttempt({
      workId: 'rti',
      unitId: 'rti-3',
      body,
      grades: ['got-it', 'partial', 'missed'],
      now: NOW,
    })
    expect(row?.body).toBe(body)
  })

  it('refuses an empty attempt rather than writing a row nobody wrote', async () => {
    expect(
      await saveAttempt({ workId: 'rti', unitId: 'rti-3', body: '   ', grades: [], now: NOW }),
    ).toBeNull()
    expect(await allAttempts()).toEqual([])
  })

  it('normalises a short or corrupt grade array without losing the writing', async () => {
    const row = await saveAttempt({
      workId: 'rti',
      unitId: 'rti-3',
      body: 'something real',
      grades: ['got-it'] as never,
      now: NOW,
    })
    expect(row?.grades).toEqual(['got-it', 'missed', 'missed'])
  })

  it('finds attempts by work and unit, and by work alone', async () => {
    await saveAttempt({ workId: 'rti', unitId: 'rti-1', body: 'one attempt here', grades: [], now: NOW })
    await saveAttempt({ workId: 'rti', unitId: 'rti-3', body: 'another attempt', grades: [], now: later(1) })
    await saveAttempt({
      workId: 'posh',
      unitId: 'posh-1',
      body: 'elsewhere entirely',
      grades: [],
      now: later(2),
    })

    expect(await attemptsFor('rti', 'rti-1')).toHaveLength(1)
    expect(await attemptsInWork('rti')).toHaveLength(2)
    expect(await allAttempts()).toHaveLength(3)
  })

  it('keeps two attempts on the same unit rather than overwriting', async () => {
    await saveAttempt({ workId: 'rti', unitId: 'rti-1', body: 'first attempt text', grades: [], now: NOW })
    await saveAttempt({
      workId: 'rti',
      unitId: 'rti-1',
      body: 'second attempt text',
      grades: [],
      now: later(60),
    })
    expect(await attemptsFor('rti', 'rti-1')).toHaveLength(2)
  })

  it('stores an AI comment only where one was given', async () => {
    const without = await saveAttempt({
      workId: 'rti',
      unitId: 'rti-1',
      body: 'no comment here',
      grades: [],
      now: NOW,
    })
    expect(without && 'comment' in without).toBe(false)
    const with_ = await saveAttempt({
      workId: 'rti',
      unitId: 'rti-2',
      body: 'with a comment',
      grades: [],
      comment: 'One grounded remark.',
      now: NOW,
    })
    expect(with_?.comment).toBe('One grounded remark.')
  })

  it('deletes one', async () => {
    const row = await saveAttempt({
      workId: 'rti',
      unitId: 'rti-1',
      body: 'to be deleted',
      grades: [],
      now: NOW,
    })
    await deleteAttempt(row!.id)
    expect(await allAttempts()).toEqual([])
  })
})

describe('sessions', () => {
  it('starts one and reports it as running', async () => {
    const row = await startSession({ workId: 'rti', mode: 'free', now: NOW })
    expect(row.endedAt).toBeNull()
    expect((await runningSession())?.id).toBe(row.id)
  })

  it('closes a session left running when a new one starts', async () => {
    const stale = await startSession({ workId: 'rti', mode: 'free', now: NOW })
    const fresh = await startSession({ workId: 'posh', mode: 'free', now: later(40) })
    const rows = await allSessions()
    expect(rows).toHaveLength(2)
    expect(rows.find((row) => row.id === stale.id)?.endedAt).not.toBeNull()
    expect(rows.find((row) => row.id === stale.id)?.minutes).toBe(40)
    expect((await runningSession())?.id).toBe(fresh.id)
  })

  it('discards a stale session that produced under a minute', async () => {
    await startSession({ workId: 'rti', mode: 'free', now: NOW })
    await startSession({ workId: 'posh', mode: 'free', now: later(0.5) })
    expect(await allSessions()).toHaveLength(1)
  })

  it('stops one and records the focused minutes', async () => {
    const row = await startSession({ workId: 'rti', mode: 'pomodoro', now: NOW })
    const closed = await stopSession(row.id, later(30))
    expect(closed?.minutes).toBe(25)
    expect(closed?.pomodoros).toBe(1)
    expect(await runningSession()).toBeNull()
  })

  it('returns null and stores nothing when a session was under a minute', async () => {
    const row = await startSession({ workId: 'rti', mode: 'free', now: NOW })
    expect(await stopSession(row.id, later(0.4))).toBeNull()
    expect(await allSessions()).toEqual([])
  })

  it('refuses to stop a session twice', async () => {
    const row = await startSession({ workId: 'rti', mode: 'free', now: NOW })
    await stopSession(row.id, later(10))
    expect(await stopSession(row.id, later(20))).toBeNull()
  })

  it('returns null for a session that does not exist', async () => {
    expect(await stopSession('nope')).toBeNull()
  })

  it('reports no running session on a fresh device', async () => {
    expect(await runningSession()).toBeNull()
  })
})

describe('goals', () => {
  it('stores a goal keyed on the work', async () => {
    const row = await saveGoal('rti', { minutesPerWeek: 180 }, NOW)
    expect(row?.id).toBe('rti')
    expect(row?.minutesPerWeek).toBe(180)
    expect(await goalFor('rti')).toBeDefined()
  })

  it('keeps one goal per work', async () => {
    await saveGoal('rti', { minutesPerWeek: 180 }, NOW)
    await saveGoal('rti', { minutesPerWeek: 240 }, later(1))
    expect(await allGoals()).toHaveLength(1)
    expect((await goalFor('rti'))?.minutesPerWeek).toBe(240)
  })

  it('deletes the goal when both targets are cleared', async () => {
    await saveGoal('rti', { minutesPerWeek: 180 }, NOW)
    expect(await saveGoal('rti', { minutesPerWeek: null, unitsPerWeek: null }, later(1))).toBeNull()
    expect(await allGoals()).toEqual([])
  })

  it('treats zero, a negative and a non-number as no target at all', async () => {
    expect(await saveGoal('rti', { minutesPerWeek: 0 }, NOW)).toBeNull()
    expect(await saveGoal('rti', { minutesPerWeek: -30 }, NOW)).toBeNull()
    expect(await saveGoal('rti', { minutesPerWeek: NaN }, NOW)).toBeNull()
  })

  it('rounds a fractional target', async () => {
    expect((await saveGoal('rti', { unitsPerWeek: 7.6 }, NOW))?.unitsPerWeek).toBe(8)
  })

  it('stores only the field that was set', async () => {
    const row = await saveGoal('rti', { unitsPerWeek: 10 }, NOW)
    expect(row && 'minutesPerWeek' in row).toBe(false)
    expect(row?.unitsPerWeek).toBe(10)
  })
})
