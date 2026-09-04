import type { ExamChoiceRow } from '@/db'
import type { ExamPaper, ExamProfile, ExamUnit } from '@/schemas/exam'

/**
 * The exam layer's vocabulary.
 *
 * `src/lib/exam` is the third pure library in this app built over
 * `src/lib/srs`, and it inherits the rule `src/lib/srs/purity.test.ts` states:
 * no React, no dataset import, no clock of its own, and storage in `store.ts`
 * alone. `exam/purity.test.ts` asserts the same over this directory — reading
 * the directory rather than a hand-written list, which is the shape
 * `src/lib/drafting/purity.test.ts` settled on and CLAUDE.md asks for.
 *
 * The dataset's own shapes live in `src/schemas/exam.ts` and the stored row in
 * `src/db`, exactly as `src/lib/srs/types.ts` and `src/lib/study/types.ts`
 * treat theirs. Nothing here restates either.
 *
 * ## The boundary, restated where the code can see it
 *
 * An `ExamUnit` either points at acts this app ships or says `external`. There
 * is no third state and there must never be one: a unit that names an internal
 * departmental document is `external`, holds nothing, and is COUNTED — every
 * figure this library reports says how much of the examination it is speaking
 * for, so a reader is never told they are 80% ready to a paper the app can
 * teach a fifth of.
 */
export type { ExamChoiceRow }
export type {
  CoverageRef,
  ExamCoverage,
  ExamIndex,
  ExamIndexEntry,
  ExamPaper,
  ExamProfile,
  ExamType,
  ExamUnit,
  ExternalCoverage,
} from '@/schemas/exam'

/** One unit with the paper it belongs to. What almost everything here walks. */
export interface PaperUnit {
  paper: ExamPaper
  unit: ExamUnit
  /** `<paperId>:<unitId>` — unique within a profile, and a stable React key. */
  key: string
  /** The unit's share of the whole examination, in marks. */
  marks: number
}

/** Every unit of every paper, in the profile's own order. */
export function paperUnits(profile: ExamProfile): PaperUnit[] {
  return profile.papers.flatMap((paper) =>
    paper.units.map((unit) => ({
      paper,
      unit,
      key: `${paper.id}:${unit.id}`,
      // Rounded, because marks are marks. The rounding is presentational: every
      // weighted calculation below uses `paper.marks * unit.weight` unrounded,
      // so a 0.5 lost here never accumulates into a readiness figure.
      marks: Math.round(paper.marks * unit.weight),
    })),
  )
}

/** The examination's total, from the papers rather than from a stored figure. */
export const totalMarks = (profile: ExamProfile): number =>
  profile.papers.reduce((sum, paper) => sum + paper.marks, 0)

/** Total scheduled writing time, in minutes. */
export const totalDurationMinutes = (profile: ExamProfile): number =>
  profile.papers.reduce((sum, paper) => sum + paper.durationMinutes, 0)
