import { z } from 'zod'

/**
 * The runtime half of the rules dataset contract.
 *
 * `schemas/rules-*.schema.json` is what the Python side validates against —
 * `scripts/authoring/extract_rules.py` and `scripts/authoring/make_cards.py`
 * before they write a file, and `scripts/ingest/validate_data.py` over all of
 * them. This is what `pnpm test` validates the committed files against. Two
 * schemas for one shape is the arrangement `data/law`, `data/pay` and
 * `data/drafting` already have (ADR-012, ADR-016, ADR-020): neither the
 * producer nor the consumer can drift alone.
 *
 * Every object is a `strictObject`, for the reason ADR-016's addendum records:
 * plain `z.object` strips keys it does not know about, so a card with
 * `answerIdx` instead of `answerIndex` would parse clean, lose the key, and be
 * reported by nothing — while the JSON Schemas, which all set
 * `additionalProperties: false`, would reject it.
 *
 * Nothing here imports the JSON. `data/rules` is ~4 MB and belongs behind a
 * lazy import on the Trainer route, the way the statute and the pay tables are.
 */

/** Both languages present. Every string a **served** card shows uses this. */
const bilingual = z.strictObject({ en: z.string().min(1), hi: z.string().min(1) })

/**
 * `hi` may be empty — and then the card's `reviewState` must be `needs-hindi`.
 *
 * No Ministry publishes a Hindi issue of these twelve rule books with a usable
 * text layer (see `scripts/authoring/extract_rules.py --audit-hindi`), so Hindi
 * here is authored rather than extracted, and a card whose Hindi has not been
 * written yet exists in the file and is not served. The schema cannot see
 * across two fields; `tests/rules-data.test.ts` asserts the pairing.
 */
const bilingualDraft = z.strictObject({ en: z.string().min(1), hi: z.string() })

const url = z.string().regex(/^https?:\/\//)
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const semver = z.string().regex(/^\d+\.\d+\.\d+$/)
const slug = z.string().regex(/^[a-z0-9-]+$/)

export const rulesSourceSchema = z.strictObject({ name: z.string().min(1), url })

const envelope = {
  $schema: z.string().optional(),
  version: semver,
  generatedAt: isoDate,
  disclaimer: bilingual,
}

// ------------------------------------------------------------------ rule text

export const ruleSchema = z.strictObject({
  id: slug,
  /** As the document prints it: "11", "11A", "5.2", "F.R. 9". */
  number: z.string().min(1),
  heading: bilingualDraft.or(z.strictObject({ en: z.string(), hi: z.string() })),
  text: z.strictObject({ en: z.string(), hi: z.string() }),
  subRules: z
    .array(
      z.strictObject({
        number: z.string().min(1),
        text: z.strictObject({ en: z.string(), hi: z.string() }),
      }),
    )
    .min(1)
    .optional(),
})

export const rulesTextSchema = z.strictObject({
  ...envelope,
  act: z.strictObject({
    id: slug,
    name: bilingual,
    short: bilingual,
    /** What one record is called here — Rule, Section or Paragraph. */
    unit: bilingual,
    publisher: z.string().min(1),
  }),
  hindiTextExtractable: z.boolean(),
  hindiNote: bilingual,
  source: rulesSourceSchema,
  rules: z.array(ruleSchema).min(1),
})

// ---------------------------------------------------------------------- cards

export const cardKindSchema = z.enum(['rule', 'cloze', 'mcq', 'trueFalse', 'scenario', 'fillRuleNo'])
export const difficultySchema = z.enum(['easy', 'medium', 'hard'])

/**
 * `approved` is the only state the trainer schedules. `needs-hindi` is a card
 * whose English is right and whose Hindi has not been written; `rejected` keeps
 * a bad card visible to an auditor without ever showing it to a reader.
 */
export const reviewStateSchema = z.enum(['unreviewed', 'approved', 'rejected', 'needs-hindi'])

/** Resolves into `data/rules/text/<act>.json`; `textId` is a rule record's id. */
export const ruleRefSchema = z.strictObject({ textId: slug, citation: bilingual })

/**
 * The four-stage authoring record, present on every authored question and
 * absent from every generated card — so an audit can tell which is which at a
 * glance. Stage A is `scripts/authoring/authored/`; B, C and D are three
 * separate files under `scripts/authoring/review/`.
 */
export const generationMetaSchema = z.strictObject({
  promptVersion: z.string().min(1),
  batchId: z.string().min(1),
  stageA: z.strictObject({ index: z.number().int().min(1), angle: z.string().min(1) }),
  critic: z.strictObject({ verdict: z.enum(['approve', 'reject']), reason: z.string().min(1) }),
  /** MCQ and true/false only; a mismatch auto-rejects the question. */
  blindVerify: z
    .strictObject({
      answered: z.number().int().min(0),
      matched: z.boolean(),
      note: z.string().optional(),
    })
    .nullable(),
  dedup: z.strictObject({
    maxScore: z.number().min(0).max(100),
    against: z.string().nullable().optional(),
    verdict: z.enum(['keep', 'duplicate']),
  }),
  groundingRuleIds: z.array(slug).min(1),
})

export const cardSchema = z.strictObject({
  id: slug,
  act: slug,
  rule: z.string().min(1),
  subRule: z.string().min(1).optional(),
  kind: cardKindSchema,
  front: bilingualDraft,
  back: bilingualDraft,
  /** The excerpt with the answer replaced by "____", plus the answer itself. */
  cloze: z.strictObject({ text: bilingualDraft, answer: bilingualDraft }).optional(),
  options: z.array(bilingualDraft).min(2).max(5).optional(),
  answerIndex: z.number().int().min(0).optional(),
  explanation: bilingualDraft.optional(),
  ruleRef: ruleRefSchema,
  difficulty: difficultySchema,
  reviewed: z.boolean(),
  reviewState: reviewStateSchema,
  reviewNote: z.string().min(1).optional(),
  tags: z.array(slug).optional(),
  verify: z.boolean().optional(),
  version: semver,
  source: rulesSourceSchema,
  generationMeta: generationMetaSchema.optional(),
})

/**
 * The trainer's word for a card it can ask. The brief asks for `Question` to
 * stay available as an alias, and it is exactly the same shape: a rule card and
 * an authored MCQ differ in `kind`, not in type. Scheduling code that only ever
 * sees approved cards can use either name.
 */
export const questionSchema = cardSchema

export const rulesCardsSchema = z.strictObject({
  ...envelope,
  act: z.strictObject({ id: slug, name: bilingual, short: bilingual, unit: bilingual }),
  source: rulesSourceSchema,
  cards: z.array(cardSchema),
})

// ---------------------------------------------------------------------- index

const countsSchema = z.strictObject({
  rules: z.number().int().min(0),
  subRules: z.number().int().min(0).optional(),
  cards: z.number().int().min(0),
  /** Cards with reviewState "approved". Only these are scheduled. */
  served: z.number().int().min(0),
  needsHindi: z.number().int().min(0).optional(),
  rejected: z.number().int().min(0).optional(),
  /**
   * Served counts per kind. `partialRecord`, not `record`: zod 4's `record`
   * over an enum key demands every member be present, and a kind with no
   * served card is simply omitted from the index rather than written as zero.
   */
  byKind: z.partialRecord(cardKindSchema, z.number().int().min(0)),
})

export const rulesIndexSchema = z.strictObject({
  ...envelope,
  totals: countsSchema,
  acts: z
    .array(
      z.strictObject({
        id: slug,
        name: bilingual,
        short: bilingual,
        unit: bilingual,
        publisher: z.string().min(1),
        text: z.string().regex(/^text\/[a-z0-9-]+\.json$/),
        cards: z.string().regex(/^cards\/[a-z0-9-]+\.json$/),
        counts: countsSchema,
        hindiTextExtractable: z.boolean().optional(),
        source: rulesSourceSchema,
      }),
    )
    .min(1),
})

export type Rule = z.infer<typeof ruleSchema>
export type RulesText = z.infer<typeof rulesTextSchema>
export type Card = z.infer<typeof cardSchema>
/** @see questionSchema — the trainer's name for the same shape. */
export type Question = Card
export type CardKind = z.infer<typeof cardKindSchema>
export type ReviewState = z.infer<typeof reviewStateSchema>
export type GenerationMeta = z.infer<typeof generationMetaSchema>
export type RulesCards = z.infer<typeof rulesCardsSchema>
export type RulesIndex = z.infer<typeof rulesIndexSchema>

/** The one predicate that decides whether a card may be scheduled. */
export const isServed = (card: Card): boolean => card.reviewState === 'approved'
