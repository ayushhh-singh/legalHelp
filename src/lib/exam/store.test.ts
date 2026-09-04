import 'fake-indexeddb/auto'

import { beforeEach, describe, expect, it } from 'vitest'

import {
  activeExamChoice,
  allExamChoices,
  clearActiveExam,
  examChoice,
  forgetExam,
  setActiveExam,
  setDailyMinutes,
  setTargetDate,
} from './store'

import { buildBackup } from '@/lib/backup'
import { clearAllData, db } from '@/db'

const NOW = new Date('2026-09-04T06:00:00.000Z')
const LATER = new Date('2026-09-05T06:00:00.000Z')

beforeEach(async () => {
  await clearAllData()
})

describe('choosing an examination', () => {
  it('creates a row on first choice, with no date and no budget yet', async () => {
    const row = await setActiveExam('css-so-ldce', NOW)
    expect(row).toMatchObject({
      id: 'css-so-ldce',
      targetDate: null,
      dailyMinutes: null,
      active: true,
      createdAt: NOW.toISOString(),
    })
    expect(await activeExamChoice()).toMatchObject({ id: 'css-so-ldce' })
  })

  it('keeps exactly one row active', async () => {
    await setActiveExam('css-so-ldce', NOW)
    await setActiveExam('ib-so-ldce', LATER)
    const rows = await allExamChoices()
    expect(rows.filter((row) => row.active).map((row) => row.id)).toEqual(['ib-so-ldce'])
    expect(rows).toHaveLength(2)
  })

  it('keeps the target date of a profile the reader switched away from', async () => {
    // The row is theirs. A reader who looks at a second profile and comes back
    // should find their own date where they left it; retyping it is a tax on
    // curiosity.
    await setActiveExam('css-so-ldce', NOW)
    await setTargetDate('css-so-ldce', '2027-03-15', NOW)
    await setActiveExam('ib-so-ldce', LATER)
    await setActiveExam('css-so-ldce', LATER)
    expect((await examChoice('css-so-ldce'))?.targetDate).toBe('2027-03-15')
  })

  it('reports null rather than undefined when nothing is chosen', async () => {
    // `useLiveQuery` says "still asking" with `undefined`. A screen that cannot
    // tell that from "nothing chosen" bounces the reader back to the picker on
    // the first render after they choose one — ADR-039's addendum, in a new
    // module, fixed here rather than in each caller.
    expect(await activeExamChoice()).toBeNull()
  })
})

describe('the target date', () => {
  beforeEach(async () => {
    await setActiveExam('css-so-ldce', NOW)
  })

  it('stores an IST calendar day', async () => {
    const row = await setTargetDate('css-so-ldce', '2027-03-15', LATER)
    expect(row?.targetDate).toBe('2027-03-15')
    expect(row?.updatedAt).toBe(LATER.toISOString())
  })

  it('REFUSES anything that is not a calendar day rather than clamping it', async () => {
    // Clamping would put a date on the record the reader never gave, and every
    // figure on the readiness screen is counted from this one. Note the third
    // case: `2027-02-31` parses in JavaScript, as the 3rd of March.
    for (const bad of ['2027-3-15', 'tomorrow', '2027-02-31', '', '15.03.2027']) {
      expect(await setTargetDate('css-so-ldce', bad, LATER), bad).toBeNull()
    }
    expect((await examChoice('css-so-ldce'))?.targetDate).toBeNull()
  })

  it('accepts null, which is how a reader takes the date off again', async () => {
    await setTargetDate('css-so-ldce', '2027-03-15', NOW)
    expect((await setTargetDate('css-so-ldce', null, LATER))?.targetDate).toBeNull()
  })

  it('does nothing for a profile that was never chosen', async () => {
    expect(await setTargetDate('never-chosen', '2027-03-15', NOW)).toBeNull()
  })
})

describe('the daily budget', () => {
  beforeEach(async () => {
    await setActiveExam('css-so-ldce', NOW)
  })

  it('rounds a real figure and refuses an impossible one', async () => {
    expect((await setDailyMinutes('css-so-ldce', 45.4, NOW))?.dailyMinutes).toBe(45)
    for (const bad of [0, -10, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(await setDailyMinutes('css-so-ldce', bad, NOW), String(bad)).toBeNull()
    }
    expect((await examChoice('css-so-ldce'))?.dailyMinutes).toBe(45)
  })

  it('accepts null, which falls back to the Session 28 study goal', async () => {
    await setDailyMinutes('css-so-ldce', 45, NOW)
    expect((await setDailyMinutes('css-so-ldce', null, LATER))?.dailyMinutes).toBeNull()
  })
})

describe('stopping', () => {
  it('clears the flag and keeps the rows', async () => {
    await setActiveExam('css-so-ldce', NOW)
    await setTargetDate('css-so-ldce', '2027-03-15', NOW)
    await clearActiveExam(LATER)
    expect(await activeExamChoice()).toBeNull()
    expect((await examChoice('css-so-ldce'))?.targetDate).toBe('2027-03-15')
  })

  it('forgets one examination entirely when asked to', async () => {
    await setActiveExam('css-so-ldce', NOW)
    await forgetExam('css-so-ldce')
    expect(await examChoice('css-so-ldce')).toBeUndefined()
    expect(await allExamChoices()).toEqual([])
  })
})

describe('the backup', () => {
  it('includes examChoices, because buildBackup excludes by name', async () => {
    // "It is backed up" is a claim rather than a comment — the same assertion
    // `src/lib/study/independence.test.ts` and the register's store test make.
    await setActiveExam('css-so-ldce', NOW)
    await setTargetDate('css-so-ldce', '2027-03-15', NOW)
    const backup = await buildBackup('0.0.0-test')
    expect(backup.tables.examChoices).toEqual([
      expect.objectContaining({ id: 'css-so-ldce', targetDate: '2027-03-15' }),
    ])
  })

  it('is cleared by the kill switch, because clearAllData iterates db.tables', async () => {
    await setActiveExam('css-so-ldce', NOW)
    await clearAllData()
    expect(await db.examChoices.count()).toBe(0)
  })
})
