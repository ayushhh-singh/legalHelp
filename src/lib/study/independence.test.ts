import { beforeEach, describe, expect, it } from 'vitest'

import { chapterIdFor, chaptersOf } from './chapters'
import { rateChapterCard, chapterCardsFor, chapterLogFor } from './store'

import { db } from '@/db'
import { buildBackup } from '@/lib/backup'
import { reviewCard } from '@/lib/srs'
import type { Card } from '@/modules/trainer/schema'
import type { ChapterWork } from './chapters'

/**
 * The two decks are separate schedules, and this file is what says so.
 *
 * `src/lib/study/chapters.ts` reuses `gradeCard`/`createCard` from
 * `src/lib/srs` — the brief's own instruction, "reuse src/lib/srs with a deck
 * id, do not fork the engine" — and the risk that creates is the opposite of
 * forking: two decks sharing one table, so that "12 due" silently means twelve
 * of two different things. These tests grade one and assert the other did not
 * move, in both directions.
 *
 * The backup assertion is here rather than in `src/lib/backup.test.ts` because
 * the claim is about THIS session's five tables. `buildBackup` excludes by
 * name, so a new table is included by default — which is the right convention
 * and also the kind of thing that is true until somebody changes it to an
 * allowlist for a good-sounding reason.
 */

const WORK: ChapterWork = {
  id: 'ccs-conduct',
  toc: Array.from({ length: 14 }, (_, at) => ({
    id: `n-ccs-conduct-${at + 1}`,
    number: String(at + 1),
    heading: { en: `Rule ${at + 1}`, hi: `नियम ${at + 1}` },
    unitIds: [`ccs-conduct-${at + 1}`],
  })),
}

const CARD: Card = {
  id: 'ccs-conduct-mcq-1',
  act: 'ccs-conduct',
  rule: '1',
  kind: 'mcq',
  front: { en: 'Front', hi: 'सामने' },
  back: { en: 'Back', hi: 'पीछे' },
  options: [
    { en: 'A', hi: 'क' },
    { en: 'B', hi: 'ख' },
  ],
  answerIndex: 0,
  ruleRef: { textId: 'ccs-conduct-1', citation: { en: 'Rule 1', hi: 'नियम 1' } },
  reviewState: 'approved',
  reviewed: true,
  difficulty: 'medium',
  version: '1.0.0',
  source: { name: 'DoPT', url: 'https://dopt.gov.in/' },
  verify: true,
}

const NOW = new Date('2026-09-03T04:00:00.000Z')

beforeEach(async () => {
  await db.chapterCards.clear()
  await db.chapterLog.clear()
  await db.srsCards.clear()
  await db.reviewLog.clear()
  await db.streaks.clear()
})

describe('the chapter deck and the card deck are separate schedules', () => {
  it('rating a chapter creates no row in srsCards and no reviewLog entry', async () => {
    const chapter = chaptersOf(WORK)[0]
    expect(chapter).toBeDefined()
    await rateChapterCard({ chapter: chapter!, confidence: 3, now: NOW })

    expect(await db.chapterCards.count()).toBe(1)
    expect(await db.srsCards.count()).toBe(0)
    expect(await db.reviewLog.count()).toBe(0)
  })

  it('grading a card creates no chapter card and no chapter log entry', async () => {
    await reviewCard({ qId: CARD.id, grade: 'Good', catalogue: [CARD], now: NOW })

    expect(await db.srsCards.count()).toBe(1)
    expect(await db.chapterCards.count()).toBe(0)
    expect(await db.chapterLog.count()).toBe(0)
  })

  it('the two due dates move independently, even for the same rule', async () => {
    // Chapter 1 of this work contains ccs-conduct-1, which is exactly the unit
    // CARD cites. The strongest form of the claim: the same underlying rule,
    // graded oppositely in each deck.
    const chapter = chaptersOf(WORK)[0]!
    await rateChapterCard({ chapter, confidence: 4, now: NOW })
    await reviewCard({ qId: CARD.id, grade: 'Again', catalogue: [CARD], now: NOW })

    const chapterCard = (await chapterCardsFor(WORK.id))[0]
    const srsCard = await db.srsCards.get(CARD.id)
    expect(chapterCard).toBeDefined()
    expect(srsCard).toBeDefined()
    // "I could explain it to someone" is Easy; "Again" is a lapse. If the two
    // decks shared a row, one of these would have overwritten the other.
    expect(chapterCard!.lastGrade).toBe('Easy')
    expect(srsCard!.lastGrade).toBe('Again')
    expect(chapterCard!.due > srsCard!.due).toBe(true)
  })

  it('a chapter card id is the work and the NODE, never a qId', async () => {
    const chapter = chaptersOf(WORK)[0]!
    expect(chapter.id).toBe(chapterIdFor(WORK.id, chapter.nodeId))
    expect(chapter.id).not.toContain('mcq')

    await rateChapterCard({ chapter, confidence: 2, now: NOW })
    const log = await chapterLogFor(WORK.id)
    expect(log).toHaveLength(1)
    expect(log[0]!.cardId).toBe(chapter.id)
  })
})

describe('the study log is in the backup', () => {
  it('exports all five of this session’s tables', async () => {
    const backup = await buildBackup('test')
    for (const name of ['chapterCards', 'chapterLog', 'feynmanAttempts', 'studySessions', 'studyGoals']) {
      expect(Object.keys(backup.tables), `${name} is not in the backup`).toContain(name)
    }
  })

  it('carries the rows, not just the table names', async () => {
    const chapter = chaptersOf(WORK)[0]!
    await rateChapterCard({ chapter, confidence: 3, now: NOW })

    const backup = await buildBackup('test')
    expect(backup.tables.chapterCards).toHaveLength(1)
    expect(backup.tables.chapterLog).toHaveLength(1)
  })
})
