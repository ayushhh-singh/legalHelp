import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'

import { isExamProfileId, loadExamIndex, loadExamProfile } from './data'

import { useAsync, type AsyncState } from '../useCatalogue'

import { activeExamChoice } from '@/lib/exam'
import type { ExamChoiceRow } from '@/lib/exam'
import type { SrsCardRow } from '@/lib/srs'
import { db } from '@/db'
import type { ExamIndex, ExamProfile } from '@/schemas/exam'

/**
 * The exam screens' data, and the reader's own choice.
 *
 * `useAsync` is `useCatalogue.ts`'s — only the SETTLED outcome is state, tagged
 * with the request key, so a retry cannot render a stale result under a fresh
 * key. Imported rather than copied here because it is the SAME module's hook
 * one directory down, and both end up in the Trainer's chunks either way.
 */

export function useExamIndex(enabled = true): AsyncState<ExamIndex> & { retry: () => void } {
  return useAsync(loadExamIndex, 'exam-index', enabled)
}

export function useExamProfile(profileId: string | null): AsyncState<ExamProfile> & { retry: () => void } {
  const id = profileId && isExamProfileId(profileId) ? profileId : null
  return useAsync(
    () => (id ? loadExamProfile(id) : Promise.reject(new Error('no profile'))),
    `exam-profile:${id ?? 'none'}`,
    id !== null,
  )
}

/**
 * The examination the reader is preparing for.
 *
 * Three states and they are genuinely different: `undefined` is "still asking"
 * (`useLiveQuery`'s own initial value), `null` is "nothing chosen", and a row
 * is a choice. `activeExamChoice` already maps "no such row" to `null` so a
 * screen that treats `undefined` as "not chosen" would only be wrong for one
 * render — which is exactly long enough to bounce a reader who has just chosen
 * a profile back to the picker (ADR-039's addendum, in a new module).
 */
export function useActiveExam(): ExamChoiceRow | null | undefined {
  return useLiveQuery(() => activeExamChoice(), [], undefined)
}

/** Every schedule row, keyed by card id — what readiness and the plan are handed. */
export function useSrsStates(): Map<string, SrsCardRow> | undefined {
  const rows = useLiveQuery(() => db.srsCards.toArray(), [], undefined)
  return useMemo(() => (rows ? new Map(rows.map((row) => [row.qId, row])) : undefined), [rows])
}
