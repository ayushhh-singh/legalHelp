import { makeCard } from './rules-cards'

import type { SrsCardRow } from '@/lib/srs'
import type { ExamPaper, ExamProfile, ExamUnit } from '@/schemas/exam'
import type { Card } from '@/modules/trainer/schema'

/**
 * Fixtures for the exam-mode suites.
 *
 * Hand-built and deliberately not read off `data/exams`, for the reason
 * `src/test/rules-cards.ts` gives about `data/rules`: these tests are about the
 * plan, the draw and the arithmetic, and a weighted-draw test that depended on
 * the CSS profile having ten units in Paper II would start failing the next
 * time a notification is re-read. `tests/exam-data.test.ts` is what tests the
 * committed profiles.
 *
 * Its own file rather than a widening of `rules-cards.ts` — the mock suites
 * need answerable cards (`options` and an `answerIndex`), and the scheduler
 * suites next door have no use for them.
 */

/** An approved MCQ with four options and a known key. */
export function makeMcq(id: string, act: string, rule: string, answerIndex = 0): Card {
  return {
    ...makeCard({ id, act, rule }),
    kind: 'mcq',
    options: Array.from({ length: 4 }, (_, i) => ({
      en: `Option ${i + 1} for ${id}`,
      hi: `${id} हेतु विकल्प ${i + 1}`,
    })),
    answerIndex,
  }
}

/** `n` approved MCQs of one act, ids `<act>-q1` … `<act>-qn`. */
export const makeMcqs = (act: string, n: number, from = 1): Card[] =>
  Array.from({ length: n }, (_, i) => makeMcq(`${act}-q${from + i}`, act, String(from + i), i % 4))

export interface UnitSpec {
  id: string
  weight: number
  /** Act ids, or `null` for an external unit. */
  acts: string[] | null
  rules?: string[]
}

export function makeUnit(spec: UnitSpec): ExamUnit {
  return {
    id: spec.id,
    name: { en: spec.id, hi: spec.id },
    weight: spec.weight,
    coverage:
      spec.acts === null
        ? { external: true, note: { en: 'Outside this app.', hi: 'इस ऐप के बाहर।' } }
        : spec.acts.map((act) => ({ act, ...(spec.rules ? { rules: spec.rules } : {}) })),
  }
}

export interface PaperSpec {
  id: string
  marks?: number
  durationMinutes?: number
  objective?: boolean
  negativeMarking?: number
  qualifyingMarks?: number
  units: UnitSpec[]
}

export function makePaper(spec: PaperSpec): ExamPaper {
  return {
    id: spec.id,
    name: { en: spec.id, hi: spec.id },
    marks: spec.marks ?? 100,
    durationMinutes: spec.durationMinutes ?? 120,
    objective: spec.objective ?? true,
    ...(spec.negativeMarking === undefined ? {} : { negativeMarking: spec.negativeMarking }),
    ...(spec.qualifyingMarks === undefined ? {} : { qualifyingMarks: spec.qualifyingMarks }),
    units: spec.units.map(makeUnit),
  }
}

export function makeProfile(papers: PaperSpec[], id = 'fixture-exam'): ExamProfile {
  return {
    version: '1.0.0',
    generatedAt: '2026-09-04',
    id,
    name: { en: 'Fixture examination', hi: 'नमूना परीक्षा' },
    organisation: { en: 'Fixture office', hi: 'नमूना कार्यालय' },
    examType: 'ldce',
    eligibilityNote: { en: 'Anyone.', hi: 'कोई भी।' },
    papers: papers.map(makePaper),
    patternSource: {
      name: 'Fixture notification',
      url: 'https://example.gov.in/fixture',
      fetchedAt: '2026-09-04T00:00:00Z',
    },
    weightBasis: { en: 'Even.', hi: 'समान।' },
    disclaimer: { en: 'Reference only.', hi: 'केवल संदर्भ हेतु।' },
    verify: false,
  }
}

/** A schedule row in `review` state at a given stability. */
export function reviewRow(qId: string, stability: number, at = '2026-09-01T00:00:00.000Z'): SrsCardRow {
  return {
    qId,
    due: at,
    stability,
    difficulty: 5,
    elapsed: 1,
    scheduled: Math.round(stability),
    reps: 3,
    lapses: 0,
    state: 'review',
    lastReview: at,
    lastGrade: 'Good',
    learningSteps: 0,
  }
}

/** A row that has been met once and is still in a learning step. */
export function learningRow(qId: string, at = '2026-09-01T00:00:00.000Z'): SrsCardRow {
  return { ...reviewRow(qId, 0.5, at), state: 'learning', reps: 1, scheduled: 0, learningSteps: 1 }
}

export const statesOf = (rows: readonly SrsCardRow[]): Map<string, SrsCardRow> =>
  new Map(rows.map((row) => [row.qId, row]))
