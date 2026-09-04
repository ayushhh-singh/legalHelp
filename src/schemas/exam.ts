import { z } from 'zod'

/**
 * The runtime half of the exam-profile dataset contract.
 *
 * `schemas/exam-profile.schema.json` and `schemas/exam-index.schema.json` are
 * what the Python side validates against — `scripts/ingest/exams_seed.py`
 * before it writes a file, and `scripts/ingest/validate_data.py` over all of
 * them. This is what `pnpm test` validates the committed files against. Two
 * schemas for one shape is the arrangement `data/law`, `data/pay`,
 * `data/drafting`, `data/rules` and `data/library` already have: neither the
 * producer nor the consumer can drift alone.
 *
 * It lives in `src/schemas/` rather than in the module, for the reason
 * `src/schemas/library.ts` records: the shape is read by two places that are
 * not the module — `src/lib/exam`, which is pure and must not import one, and
 * the tests that read the committed bytes off disk.
 *
 * ## The boundary this file encodes
 *
 * A profile is PUBLIC syllabus structure over PUBLIC law. `coverage` points at
 * an act in `data/rules` — statute this app already ships — or says `external`
 * and holds nothing. There is deliberately no field for a question paper, a
 * departmental manual, an internal standing order or anything about an
 * organisation's operations, and there must never be one: a syllabus head that
 * names such a document is `{ external: true }` with a note saying to study it
 * from the officer's own office copy. `ib-so-ldce`'s "Intelligence Bureau
 * Standing Orders" unit is that case, and it is the worked example.
 *
 * ## Why `weight` is not in any notification
 *
 * A notification gives a PAPER's marks. It does not say how many of Paper II's
 * 150 marks fall on the Leave Rules rather than on the GFR — no notification
 * this project could find does. So `weight` is this app's own apportionment,
 * `weightBasis` states the rule it was apportioned by, and every surface that
 * renders a weight renders that sentence too.
 */

const bilingual = z.strictObject({ en: z.string().min(1), hi: z.string().min(1) })

const url = z.string().regex(/^https?:\/\//)
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const semver = z.string().regex(/^\d+\.\d+\.\d+$/)
const slug = z.string().regex(/^[a-z0-9-]+$/)

export const examSourceSchema = z.strictObject({
  name: z.string().min(1),
  url,
  /** Present ONLY where this repository actually retrieved the document. */
  fetchedAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T/)
    .optional(),
  sha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
})

export const examTypeSchema = z.enum(['ldce', 'departmental-promotion', 'confirmation', 'other'])

/**
 * A pointer into `data/rules`. `rules` narrows an act to particular rule ids.
 *
 * No profile shipped today uses `rules`, and that is a fact about the SOURCES
 * rather than about the schema: every notification found names a whole rule
 * book ("The Central Civil Services (Conduct) Rules"), never a run of rules
 * inside one. The field is here because the first notification that does name
 * one should not need a schema change, and `src/lib/exam/coverage.ts` resolves
 * it — `coverage.test.ts` exercises that path over a fixture so it is not a
 * capability that has never once run.
 */
export const coverageRefSchema = z.strictObject({
  act: slug,
  rules: z.array(slug).min(1).optional(),
})

export const externalCoverageSchema = z.strictObject({
  external: z.literal(true),
  /** What to study instead, and where. Rendered as "self-study, outside this app". */
  note: bilingual.optional(),
})

/**
 * A list of pointers, or the single `external` object. Never both, never empty.
 *
 * `z.union` rather than two optional members, because "a unit that maps to
 * nothing" and "a unit nobody has mapped yet" have to be the same thing here:
 * an empty array would let a syllabus head silently drop out of the readiness
 * figure, which is the one number a reader acts on.
 */
export const coverageSchema = z.union([z.array(coverageRefSchema).min(1), externalCoverageSchema])

export const examUnitSchema = z.strictObject({
  id: slug,
  name: bilingual,
  /** Share of its own paper, 0-1. A paper's units sum to 1. */
  weight: z.number().gt(0).max(1),
  coverage: coverageSchema,
})

export const examPaperSchema = z.strictObject({
  id: slug,
  name: bilingual,
  marks: z.number().int().min(1),
  durationMinutes: z.number().int().min(1),
  /** Only an objective paper can be drawn as a mock. See `src/lib/exam/mock.ts`. */
  objective: z.boolean(),
  /** Fraction of a question's marks deducted for a wrong answer. Absent means none. */
  negativeMarking: z.number().gt(0).max(1).optional(),
  /** Present only where the notification FIXES a figure, never where it reserves the right to. */
  qualifyingMarks: z.number().int().min(0).optional(),
  units: z.array(examUnitSchema).min(1),
})

export const examProfileSchema = z.strictObject({
  $schema: z.string().optional(),
  version: semver,
  generatedAt: isoDate,
  id: slug,
  name: bilingual,
  organisation: bilingual,
  examType: examTypeSchema,
  eligibilityNote: bilingual,
  papers: z.array(examPaperSchema).min(1),
  patternSource: examSourceSchema,
  weightBasis: bilingual,
  disclaimer: bilingual,
  verify: z.boolean(),
})

export const examIndexSchema = z.strictObject({
  $schema: z.string().optional(),
  version: semver,
  generatedAt: isoDate,
  disclaimer: bilingual,
  profiles: z
    .array(
      z.strictObject({
        id: slug,
        name: bilingual,
        organisation: bilingual,
        examType: examTypeSchema,
        file: z.string().regex(/^profiles\/[a-z0-9-]+\.json$/),
        paperCount: z.number().int().min(1),
        totalMarks: z.number().int().min(1),
        mappedUnits: z.number().int().min(0),
        externalUnits: z.number().int().min(0),
        verify: z.boolean(),
      }),
    )
    .min(1),
})

export type ExamSource = z.infer<typeof examSourceSchema>
export type ExamType = z.infer<typeof examTypeSchema>
export type CoverageRef = z.infer<typeof coverageRefSchema>
export type ExternalCoverage = z.infer<typeof externalCoverageSchema>
export type ExamCoverage = z.infer<typeof coverageSchema>
export type ExamUnit = z.infer<typeof examUnitSchema>
export type ExamPaper = z.infer<typeof examPaperSchema>
export type ExamProfile = z.infer<typeof examProfileSchema>
export type ExamIndex = z.infer<typeof examIndexSchema>
export type ExamIndexEntry = ExamIndex['profiles'][number]

/**
 * The one predicate that decides whether a unit is this app's to teach.
 *
 * Written as a type guard over the union so every caller narrows rather than
 * re-testing the shape: `isExternal(unit.coverage)` is the question, and the
 * answer is load-bearing on four screens.
 */
export const isExternal = (coverage: ExamCoverage): coverage is ExternalCoverage => !Array.isArray(coverage)
