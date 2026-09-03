import { describe, expect, it } from 'vitest'

import {
  chapterFor,
  chapterIdFor,
  chaptersOf,
  createChapterCard,
  dueChapterCount,
  dueChapters,
  FLAT_GROUP_SIZE,
  rateChapter,
  type ChapterWork,
} from './chapters'
import type { ChapterCardRow } from './types'

import type { TocNode } from '@/schemas/library'

/**
 * The chapter revision deck, against a frozen clock.
 *
 * Every assertion about an interval here depends on FSRS's fuzz being off
 * (ADR-025). Turning it on makes this file nondeterministic by design, which is
 * the same warning `src/lib/srs/engine.test.ts` carries.
 */

const NOW = new Date('2026-09-03T06:00:00.000Z')

const leaf = (id: string, number: string): TocNode => ({
  id,
  number,
  heading: { en: `Rule ${number}`, hi: `नियम ${number}` },
  unitIds: [id],
})

const flatWork = (count: number): ChapterWork => ({
  id: 'flat',
  toc: Array.from({ length: count }, (_, at) => leaf(`u-${at + 1}`, String(at + 1))),
})

const groupedWork: ChapterWork = {
  id: 'grouped',
  toc: [
    {
      id: 'ch-1',
      number: 'I',
      heading: { en: 'Preliminary', hi: 'प्रारंभिक' },
      children: [leaf('a', '1'), leaf('b', '2')],
      unitIds: ['a', 'b'],
    },
    {
      id: 'ch-2',
      number: 'II',
      heading: { en: 'Offences', hi: 'अपराध' },
      children: [leaf('c', '3')],
      unitIds: ['c'],
    },
  ],
}

describe('chaptersOf', () => {
  it('takes a grouped work’s top level as it stands', () => {
    const chapters = chaptersOf(groupedWork)
    expect(chapters.map((chapter) => chapter.nodeId)).toEqual(['ch-1', 'ch-2'])
    expect(chapters[0]?.unitIds).toEqual(['a', 'b'])
    expect(chapters[0]?.id).toBe('grouped:ch-1')
  })

  it('groups a flat work rather than making one chapter per rule', () => {
    // Eleven of the fifteen works are `tocSource: 'flat'`. A revision deck with
    // one card per rule is the card deck again, with worse questions.
    const chapters = chaptersOf(flatWork(30))
    expect(chapters.length).toBe(Math.ceil(30 / FLAT_GROUP_SIZE))
    expect(chapters[0]?.unitIds.length).toBe(FLAT_GROUP_SIZE)
    expect(chapters.at(-1)?.unitIds.length).toBe(30 % FLAT_GROUP_SIZE)
  })

  it('covers every unit exactly once when it groups', () => {
    const units = chaptersOf(flatWork(25)).flatMap((chapter) => chapter.unitIds)
    expect(units.length).toBe(25)
    expect(new Set(units).size).toBe(25)
  })

  it('keys a group on its FIRST unit, not on its position', () => {
    // Inserting a rule at the top of a book must not renumber every chapter
    // card the reader has built a schedule on — the rule docs/AUTHORING.md
    // states for a cloze card's id.
    const before = chaptersOf(flatWork(24))
    const after = chaptersOf({
      id: 'flat',
      toc: [leaf('u-0', '0'), ...flatWork(24).toc],
    })
    expect(before[1]?.nodeId).toBe('group-u-13')
    // The second group still starts at a unit, and the id names it rather than
    // saying "group 2" — which is what would have shifted.
    expect(after[1]?.nodeId).toBe('group-u-12')
    expect(after[1]?.nodeId.startsWith('group-')).toBe(true)
  })

  it('drops a top-level node with no units', () => {
    const chapters = chaptersOf({
      id: 'w',
      toc: [
        { id: 'empty', number: '0', heading: { en: '', hi: '' }, children: [leaf('x', '1')], unitIds: [] },
        groupedWork.toc[0] as TocNode,
      ],
    })
    expect(chapters.map((chapter) => chapter.nodeId)).toEqual(['ch-1'])
  })

  it('handles a single-unit flat work without producing an empty group', () => {
    const chapters = chaptersOf(flatWork(1))
    expect(chapters.length).toBe(1)
    expect(chapters[0]?.number).toBe('1')
  })
})

describe('chapterFor', () => {
  it('finds the chapter a unit belongs to', () => {
    expect(chapterFor(groupedWork, 'c')?.nodeId).toBe('ch-2')
  })

  it('returns null for a unit the work does not have', () => {
    expect(chapterFor(groupedWork, 'nope')).toBeNull()
  })
})

describe('chapterIdFor', () => {
  it('joins the work and the node', () => {
    expect(chapterIdFor('rti', 'ch-1')).toBe('rti:ch-1')
  })
})

describe('createChapterCard and rateChapter', () => {
  const chapter = chaptersOf(groupedWork)[0]!

  it('creates a card that is due immediately and carries its identity', () => {
    const card = createChapterCard(chapter, NOW)
    expect(card.id).toBe('grouped:ch-1')
    expect(card.workId).toBe('grouped')
    expect(card.nodeId).toBe('ch-1')
    expect(card.state).toBe('new')
    expect(new Date(card.due).getTime()).toBeLessThanOrEqual(NOW.getTime())
  })

  it('maps 1-4 onto Again/Hard/Good/Easy, in that order', () => {
    const card = createChapterCard(chapter, NOW)
    expect(rateChapter(card, 1, NOW).log.grade).toBe('Again')
    expect(rateChapter(card, 2, NOW).log.grade).toBe('Hard')
    expect(rateChapter(card, 3, NOW).log.grade).toBe('Good')
    expect(rateChapter(card, 4, NOW).log.grade).toBe('Easy')
  })

  it('schedules a higher confidence no sooner than a lower one', () => {
    const card = createChapterCard(chapter, NOW)
    const dues = ([1, 2, 3, 4] as const).map((level) => rateChapter(card, level, NOW).card.due)
    for (let at = 1; at < dues.length; at += 1) {
      expect(dues[at]! >= dues[at - 1]!, `confidence ${at + 1} scheduled before ${at}`).toBe(true)
    }
  })

  it('keeps the work and node on the rescheduled card', () => {
    const card = rateChapter(createChapterCard(chapter, NOW), 3, NOW).card
    expect(card.workId).toBe('grouped')
    expect(card.nodeId).toBe('ch-1')
    expect(card.id).toBe('grouped:ch-1')
  })

  it('records the state the reader was shown, not the one they produced', () => {
    const first = rateChapter(createChapterCard(chapter, NOW), 3, NOW)
    expect(first.log.stateBefore).toBe('new')
    expect(first.card.state).not.toBe('new')
    const second = rateChapter(first.card, 3, new Date('2026-09-10T06:00:00.000Z'))
    expect(second.log.stateBefore).toBe(first.card.state)
  })

  it('defaults the reason to confidence and carries a given one', () => {
    const card = createChapterCard(chapter, NOW)
    expect(rateChapter(card, 3, NOW).log.reason).toBe('confidence')
    expect(rateChapter(card, 3, NOW, { reason: 'quiz' }).log.reason).toBe('quiz')
    expect(rateChapter(card, 3, NOW, { reason: 'feynman' }).log.reason).toBe('feynman')
  })

  it('gives the log an id that cannot collide with itself', () => {
    const first = rateChapter(createChapterCard(chapter, NOW), 3, NOW)
    const second = rateChapter(first.card, 3, new Date('2026-09-10T06:00:00.000Z'))
    expect(second.log.id).not.toBe(first.log.id)
    expect(second.log.cardId).toBe(first.log.cardId)
  })

  it('honours a desired retention without throwing on an out-of-range one', () => {
    const card = createChapterCard(chapter, NOW)
    expect(() => rateChapter(card, 3, NOW, { desiredRetention: 0.99 })).not.toThrow()
    expect(() => rateChapter(card, 3, NOW, { desiredRetention: -1 })).not.toThrow()
  })
})

describe('dueChapters', () => {
  const chapters = chaptersOf(groupedWork)
  const overdue = (id: string, due: string): ChapterCardRow => ({
    ...createChapterCard(
      chapters.find((chapter) => chapter.id === id)!,
      NOW,
    ),
    due,
    state: 'review',
    reps: 1,
  })

  it('puts a genuinely due chapter ahead of one never rated', () => {
    // The opposite of the card deck's order, and deliberately so: a new chapter
    // is one the reader has not read, and the Library already has a surface for
    // reading it. This deck is for bringing a chapter back.
    const due = dueChapters(chapters, [overdue('grouped:ch-2', '2026-09-01T00:00:00.000Z')], NOW)
    expect(due[0]?.chapter.nodeId).toBe('ch-2')
    expect(due[0]?.card).not.toBeNull()
    expect(due[1]?.card).toBeNull()
  })

  it('orders two due chapters by due date, oldest first', () => {
    const due = dueChapters(
      chapters,
      [
        overdue('grouped:ch-2', '2026-09-02T00:00:00.000Z'),
        overdue('grouped:ch-1', '2026-08-01T00:00:00.000Z'),
      ],
      NOW,
    )
    expect(due.map((entry) => entry.chapter.nodeId)).toEqual(['ch-1', 'ch-2'])
  })

  it('leaves out a chapter that is not due yet', () => {
    const due = dueChapters(chapters, [overdue('grouped:ch-1', '2027-01-01T00:00:00.000Z')], NOW, {
      includeNew: false,
    })
    expect(due).toEqual([])
  })

  it('excludes never-rated chapters on request', () => {
    expect(dueChapters(chapters, [], NOW, { includeNew: false })).toEqual([])
    expect(dueChapters(chapters, [], NOW).length).toBe(2)
  })

  it('counts only what is genuinely due', () => {
    expect(dueChapterCount(chapters, [], NOW)).toBe(0)
    expect(dueChapterCount(chapters, [overdue('grouped:ch-1', '2026-01-01T00:00:00.000Z')], NOW)).toBe(1)
  })

  it('is deterministic when two chapters fall due at the same instant', () => {
    const cards = [
      overdue('grouped:ch-2', '2026-09-01T00:00:00.000Z'),
      overdue('grouped:ch-1', '2026-09-01T00:00:00.000Z'),
    ]
    const once = dueChapters(chapters, cards, NOW).map((entry) => entry.chapter.id)
    const twice = dueChapters(chapters, [...cards].reverse(), NOW).map((entry) => entry.chapter.id)
    expect(once).toEqual(twice)
  })

  it('ignores a card for a chapter the work no longer has', () => {
    const stale: ChapterCardRow = {
      ...overdue('grouped:ch-1', '2026-01-01T00:00:00.000Z'),
      id: 'grouped:gone',
    }
    expect(dueChapters(chapters, [stale], NOW, { includeNew: false })).toEqual([])
  })
})
