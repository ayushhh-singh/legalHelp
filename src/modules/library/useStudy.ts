import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useMemo } from 'react'

import { db, type FeynmanAttemptRow, type StudyGoalRow, type StudySessionRow } from '@/db'
import { isWorkId, loadStudyAids, loadWork } from '@/lib/library'
import {
  allChapterCards,
  allChapterLog,
  attemptsFor,
  chapterCardsFor,
  chaptersOf,
  dueChapters,
  runningSession,
  type Chapter,
  type ChapterCardRow,
  type ChapterWork,
  type DueChapter,
} from '@/lib/study'
import { useAsync, type AsyncState } from '@/lib/useAsync'
import { isAidServed, type LibraryAids, type LibraryWork, type StudyAid } from '@/schemas/library'

/**
 * The study layer's data hooks.
 *
 * Every reactive number here is a `useLiveQuery` over an `src/lib/study/store.ts`
 * function rather than a load-once effect — the rule CLAUDE.md records for the
 * Trainer and for the same reason: Dexie's live query tracks every table the
 * querier reads, transitively through `await`, so rating a chapter updates the
 * "due" count on the hub with no manual refetch anywhere.
 *
 * NO CALLER MAY BLOCK ITS RENDER on one of these. On a device whose storage is
 * refused — a private window, a managed device with site data blocked —
 * `useLiveQuery` never produces a value at all, and the Library learned in
 * Session 27 what that costs: three screens sat on a skeleton for ever with the
 * corpus in a precached chunk beside them. `undefined` here means "nothing
 * yet", and every consumer treats it as empty for display.
 */

/** One work's study aids, served only. `null` while the file is loading. */
export function useStudyAids(workId: string | undefined): AsyncState<LibraryAids> & { retry: () => void } {
  const load = useCallback(
    () => (workId ? loadStudyAids(workId) : Promise.reject(new Error('no work'))),
    [workId],
  )
  return useAsync(load, `study-aids:${workId ?? ''}`, Boolean(workId))
}

/** The aid for one unit, or `null`. Rejected and unreviewed aids never surface. */
export function useStudyAid(workId: string | undefined, unitId: string | undefined): StudyAid | null {
  const aids = useStudyAids(workId)
  return useMemo(() => {
    if (aids.status !== 'ready' || !unitId) return null
    return aids.data.aids.filter(isAidServed).find((aid) => aid.unitId === unitId) ?? null
  }, [aids, unitId])
}

/* ------------------------------------------------------------------ *
 * The chapter deck
 * ------------------------------------------------------------------ */

/** Every chapter of one work, memoised on the work object `loadWork` caches. */
export function useChapters(work: ChapterWork | null): Chapter[] {
  return useMemo(() => (work ? chaptersOf(work) : []), [work])
}

export function useChapterCards(workId: string | undefined): ChapterCardRow[] | undefined {
  return useLiveQuery(
    (): Promise<ChapterCardRow[]> => (workId ? chapterCardsFor(workId) : Promise.resolve([])),
    [workId],
  )
}

/** The chapter card for one node, or `null` once the read has landed. */
export function useChapterCard(
  workId: string | undefined,
  nodeId: string | undefined,
): ChapterCardRow | null | undefined {
  const cards = useChapterCards(workId)
  return useMemo(() => {
    if (!cards) return undefined
    return cards.find((card) => card.nodeId === nodeId) ?? null
  }, [cards, nodeId])
}

/**
 * What is due in one work, soonest first.
 *
 * `now` is passed in rather than read here, so a caller that ticks a clock gets
 * a fresh list and a caller that does not gets a stable one. `src/lib/study`
 * reads no clock of its own — `purity.test.ts` asserts it.
 */
export function useDueChapters(
  work: ChapterWork | null,
  now: Date,
  options: { includeNew?: boolean } = {},
): DueChapter[] {
  const chapters = useChapters(work)
  const cards = useChapterCards(work?.id)
  // `now` is a Date and would change identity on every tick if the caller built
  // one inline; callers pass a value from `useNow`, which does not. The instant
  // is hoisted to a plain value because the lint rule wants a dependency list
  // of simple expressions, and a call inside one is invisible to it.
  const at = now.getTime()
  const includeNew = options.includeNew
  return useMemo(
    () => (cards ? dueChapters(chapters, cards, new Date(at), { includeNew }) : []),
    [chapters, cards, at, includeNew],
  )
}

/** Every chapter card on the device — what the hub and `/study/practise` count from. */
export function useAllChapterCards(): ChapterCardRow[] | undefined {
  return useLiveQuery(() => allChapterCards(), [])
}

export function useAllChapterLog() {
  return useLiveQuery(() => allChapterLog(), [])
}

/* ------------------------------------------------------------------ *
 * Feynman attempts
 * ------------------------------------------------------------------ */

export function useAttempts(
  workId: string | undefined,
  unitId: string | undefined,
): FeynmanAttemptRow[] | undefined {
  const rows = useLiveQuery(
    (): Promise<FeynmanAttemptRow[]> =>
      workId && unitId ? attemptsFor(workId, unitId) : Promise.resolve([]),
    [workId, unitId],
  )
  // Newest first. Sorted here rather than by an index: `at` is indexed
  // globally, not per (work, unit), so the compound query cannot also order by
  // it — and one unit has at most a handful of attempts.
  return useMemo(() => (rows ? [...rows].sort((a, b) => (a.at < b.at ? 1 : -1)) : undefined), [rows])
}

export function useAllAttempts(): FeynmanAttemptRow[] | undefined {
  return useLiveQuery(() => db.feynmanAttempts.toArray(), [])
}

/* ------------------------------------------------------------------ *
 * Sessions and goals
 * ------------------------------------------------------------------ */

/** The session still running, or `null`. There is at most one. */
export function useRunningSession(): StudySessionRow | null | undefined {
  return useLiveQuery(() => runningSession(), [])
}

export function useAllSessions(): StudySessionRow[] | undefined {
  return useLiveQuery(() => db.studySessions.toArray(), [])
}

export function useGoals(): StudyGoalRow[] | undefined {
  return useLiveQuery(() => db.studyGoals.toArray(), [])
}

export function useGoal(workId: string | undefined): StudyGoalRow | null | undefined {
  const goals = useGoals()
  return useMemo(() => {
    if (!goals) return undefined
    return goals.find((goal) => goal.id === workId) ?? null
  }, [goals, workId])
}

/**
 * Every chapter that is DUE right now, across every work, with its heading.
 *
 * The two hubs need a "Revise: <chapter>" line, and a chapter card carries no
 * heading — only `workId` and `nodeId`, because the heading lives in the work
 * file and storing a second copy in Dexie would go stale the day a table of
 * contents improves (`docs/DATA-GAPS.md` #70).
 *
 * So the work file is fetched, and only for works that ACTUALLY have a due
 * card. A chapter card exists only after the reader has rated that chapter, so
 * on a fresh device this fetches nothing at all, and in ordinary use it is one
 * or two works of 8-220 KB rather than all fifteen. `includeNew` is deliberately
 * off here for the same reason: an unrated chapter is not something the reader
 * is behind on, and offering all 2,000 of them as "due" would make the list
 * useless on the first day.
 */
export function useDueChaptersEverywhere(now: Date): DueChapter[] | undefined {
  const cards = useAllChapterCards()
  // Rounded to the minute: a due list re-sorted on every second would repaint
  // the busiest screen in the app sixty times a minute to change nothing.
  const minute = Math.floor(now.getTime() / 60_000)

  const dueWorkIds = useMemo(() => {
    if (!cards) return null
    const at = new Date(minute * 60_000).toISOString()
    const ids = new Set<string>()
    for (const card of cards) if (card.due <= at && isWorkId(card.workId)) ids.add(card.workId)
    // Sorted so the fetch key below is stable across renders that find the
    // same set in a different order.
    return [...ids].sort()
  }, [cards, minute])

  const key = dueWorkIds ? dueWorkIds.join(',') : ''
  const works = useAsync(
    useMemo(
      () => () =>
        /*
          SETTLED, not `Promise.all`.

          One work file that fails to load — a chunk lost offline, a work id
          from a backup restored onto a build that no longer ships it — made the
          whole promise reject, `useAsync` report `error`, and the memo below
          return `undefined` for ever. The effect is that the revise list
          silently disappears from BOTH hubs and never comes back, with no
          message and nothing in the console. A due list that vanishes is worse
          than one that is short: the reader concludes they are up to date.
        */
        Promise.allSettled((dueWorkIds ?? []).map((id) => loadWork(id))).then((results) =>
          results
            .filter((row): row is PromiseFulfilledResult<LibraryWork> => row.status === 'fulfilled')
            .map((row) => row.value),
        ),
      // The identity of the loader is what `useAsync` re-runs on, so it is
      // keyed on the SET of works rather than on the array's identity.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [key],
    ),
    `due-chapters:${key}`,
    dueWorkIds !== null && dueWorkIds.length > 0,
  )

  return useMemo(() => {
    if (!cards) return undefined
    if (dueWorkIds && dueWorkIds.length === 0) return []
    if (works.status !== 'ready') return undefined
    return works.data.flatMap((work) =>
      dueChapters(chaptersOf(work), cards, new Date(minute * 60_000), { includeNew: false }),
    )
  }, [cards, dueWorkIds, works, minute])
}
