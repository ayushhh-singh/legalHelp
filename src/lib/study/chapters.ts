import {
  CONFIDENCE_GRADES,
  type Chapter,
  type ChapterCardRow,
  type Confidence,
  type DueChapter,
} from './types'

import type { ChapterLogRow } from '@/db'
import { createCard, gradeCard, type SrsCardRow } from '@/lib/srs'
import type { LibraryWork, TocNode } from '@/schemas/library'

/**
 * The chapter revision deck.
 *
 * ### It reuses the engine; it does not fork it
 *
 * `gradeCard` and `createCard` in `src/lib/srs/engine.ts` are pure and take a
 * row, so this file borrows them wholesale. What it does NOT do is put a
 * chapter into `srsCards`: a chapter has no `qId` in `data/rules/cards`, so
 * every function in `src/lib/srs` that is handed a catalogue would look it up
 * and find nothing, and "12 due" would silently mean twelve of two different
 * things. The row lives in its own table (`ChapterCardRow`), and `toSrs` /
 * `fromSrs` below are the whole of the translation between them — the two
 * shapes differ by one field, the identifier.
 *
 * ### What a "chapter" is here
 *
 * A TOP-LEVEL table-of-contents node, not a leaf. Eleven of the fifteen works
 * have `tocSource: 'flat'` (`docs/DATA-GAPS.md` #70), which means one node per
 * rule — and a revision deck with one card per rule is the card deck again,
 * with worse questions. `chaptersOf` therefore takes the top level and treats
 * a flat work as one chapter per rule only when that is genuinely all the work
 * has; `groupFlat` is what stops a 307-rule book becoming a 307-chapter deck.
 */

const chapterCardId = (workId: string, nodeId: string): string => `${workId}:${nodeId}`

/** Exported so a caller can address a chapter card without rebuilding a Chapter. */
export const chapterIdFor = chapterCardId

/**
 * How many rules a flat work is grouped into. Twelve is not arbitrary: it is
 * about a fortnight of one chapter a day, which is the cadence a revision deck
 * is for, and it keeps the largest work in this library (GFR, 307 rules) to
 * twenty-six chapters rather than three hundred and seven.
 */
export const FLAT_GROUP_SIZE = 12

const label = (from: string, to: string): { en: string; hi: string } =>
  from === to ? { en: from, hi: from } : { en: `${from}–${to}`, hi: `${from}–${to}` }

/**
 * A flat work's leaves, grouped into runs of `FLAT_GROUP_SIZE`.
 *
 * The node id is derived from the FIRST unit in the run rather than from the
 * run's index, so inserting a rule at the top of a book does not renumber every
 * chapter card the reader has built a schedule on. That is the same rule
 * `docs/AUTHORING.md` states for a cloze card's id: never key on a position.
 */
function groupFlat(leaves: readonly TocNode[], workId: string): Chapter[] {
  const chapters: Chapter[] = []
  for (let at = 0; at < leaves.length; at += FLAT_GROUP_SIZE) {
    const run = leaves.slice(at, at + FLAT_GROUP_SIZE)
    const first = run[0]
    const last = run[run.length - 1]
    if (!first || !last) continue
    const nodeId = `group-${first.id}`
    chapters.push({
      id: chapterCardId(workId, nodeId),
      workId,
      nodeId,
      number: first.number === last.number ? first.number : `${first.number}–${last.number}`,
      heading: label(first.number, last.number),
      unitIds: run.flatMap((node) => node.unitIds),
    })
  }
  return chapters
}

export type ChapterWork = Pick<LibraryWork, 'id' | 'toc'>

/**
 * Every chapter of one work, in reading order.
 *
 * A work whose top level already groups its units — the three Sanhitas' NCRB
 * chapters, CSMOP's `4.x` numbering — is taken as it stands. A work whose top
 * level IS its leaves is grouped, because one card per rule is not a chapter
 * deck. `hasGrouping` is the test, and it is about the shape of the tree rather
 * than about `tocSource`, so a work whose structure improves later
 * (`docs/DATA-GAPS.md` #70) starts producing real chapters with no change here.
 */
export function chaptersOf(work: ChapterWork): Chapter[] {
  const top = work.toc
  const hasGrouping = top.some((node) => (node.children ?? []).length > 0)
  if (!hasGrouping) return groupFlat(top, work.id)

  return top
    .filter((node) => node.unitIds.length > 0)
    .map((node) => ({
      id: chapterCardId(work.id, node.id),
      workId: work.id,
      nodeId: node.id,
      number: node.number,
      heading: node.heading,
      unitIds: node.unitIds,
    }))
}

/** The chapter a unit belongs to, or `null` where the work has none. */
export function chapterFor(work: ChapterWork, unitId: string): Chapter | null {
  return chaptersOf(work).find((chapter) => chapter.unitIds.includes(unitId)) ?? null
}

/* ------------------------------------------------------------------ *
 * The engine translation
 * ------------------------------------------------------------------ */

const toSrs = (row: ChapterCardRow): SrsCardRow => ({
  qId: row.id,
  due: row.due,
  stability: row.stability,
  difficulty: row.difficulty,
  elapsed: row.elapsed,
  scheduled: row.scheduled,
  reps: row.reps,
  lapses: row.lapses,
  state: row.state,
  lastReview: row.lastReview,
  lastGrade: row.lastGrade,
  learningSteps: row.learningSteps,
})

const fromSrs = (row: SrsCardRow, workId: string, nodeId: string): ChapterCardRow => ({
  id: row.qId,
  workId,
  nodeId,
  due: row.due,
  stability: row.stability,
  difficulty: row.difficulty,
  elapsed: row.elapsed,
  scheduled: row.scheduled,
  reps: row.reps,
  lapses: row.lapses,
  state: row.state,
  lastReview: row.lastReview,
  lastGrade: row.lastGrade,
  learningSteps: row.learningSteps,
})

/** A chapter the reader has never rated. Due immediately, like a new card. */
export function createChapterCard(chapter: Chapter, now: Date): ChapterCardRow {
  return fromSrs(createCard(chapter.id, now), chapter.workId, chapter.nodeId)
}

export interface RateResult {
  card: ChapterCardRow
  log: ChapterLogRow
}

/**
 * Rate a chapter, and produce both the new schedule and the log entry.
 *
 * The two come back together for the reason `src/lib/srs/engine.ts#gradeCard`
 * gives: the log records the state the card was in when the reader was asked,
 * and grading destroys it.
 */
export function rateChapter(
  row: ChapterCardRow,
  confidence: Confidence,
  now: Date,
  options: { reason?: ChapterLogRow['reason']; desiredRetention?: number } = {},
): RateResult {
  const grade = CONFIDENCE_GRADES[confidence]
  const graded = gradeCard(toSrs(row), grade, now, {
    ...(options.desiredRetention === undefined ? {} : { desiredRetention: options.desiredRetention }),
  })
  return {
    card: fromSrs(graded.card, row.workId, row.nodeId),
    log: {
      id: graded.log.id,
      cardId: row.id,
      workId: row.workId,
      grade,
      at: graded.log.at,
      stateBefore: row.state,
      reason: options.reason ?? 'confidence',
    },
  }
}

/* ------------------------------------------------------------------ *
 * The queue
 * ------------------------------------------------------------------ */

/**
 * The chapters that want revising, soonest first, with the never-rated ones
 * LAST.
 *
 * That order is the opposite of the card deck's, and it is deliberate. A new
 * card is a card the reader has not learnt yet and the trainer's whole job is
 * to introduce it. A new CHAPTER is one they have not read yet — and the
 * Library already has a surface for reading a chapter for the first time. What
 * this deck is for is bringing a chapter back before it is forgotten, so a
 * chapter that is genuinely due outranks one that has never been opened.
 */
export function dueChapters(
  chapters: readonly Chapter[],
  cards: readonly ChapterCardRow[],
  now: Date,
  options: { includeNew?: boolean } = {},
): DueChapter[] {
  const byId = new Map(cards.map((card) => [card.id, card]))
  const at = now.toISOString()

  const due: DueChapter[] = []
  const fresh: DueChapter[] = []
  for (const chapter of chapters) {
    const card = byId.get(chapter.id)
    if (!card) {
      if (options.includeNew !== false) fresh.push({ chapter, card: null })
      continue
    }
    if (card.due <= at) due.push({ chapter, card })
  }

  due.sort((a, b) => byString(a.card?.due ?? '', b.card?.due ?? '') || byString(a.chapter.id, b.chapter.id))
  return [...due, ...fresh]
}

/**
 * Code-unit order, never `localeCompare` — the rule `src/lib/srs/types.ts`
 * states and the reason it gives: two devices holding the same history must
 * produce the same order, and ICU collation is a property of the runtime rather
 * than of the data. It applies to the ISO due date as much as to the id.
 */
const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/** How many chapters are due right now, across every work. New ones excluded. */
export function dueChapterCount(
  chapters: readonly Chapter[],
  cards: readonly ChapterCardRow[],
  now: Date,
): number {
  return dueChapters(chapters, cards, now, { includeNew: false }).length
}
