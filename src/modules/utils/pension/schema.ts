import { z } from 'zod'

/**
 * The runtime half of the pension-facts dataset contract —
 * `schemas/pension-facts.schema.json` is the Python half. NPS and UPS
 * themselves are NOT re-declared here: `src/modules/pay/schema.ts`'s
 * `schemeSchema` already describes `data/pay/nps.json` and `data/pay/
 * ups.json`, and this module's `data.ts` parses both against it directly.
 */

const bilingual = z.strictObject({ en: z.string().min(1), hi: z.string().min(1) })
const url = z.string().regex(/^https?:\/\//)
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const semver = z.string().regex(/^\d+\.\d+\.\d+$/)

const pensionSourceSchema = z.strictObject({
  name: z.string().min(1),
  url,
  reference: z.string().optional(),
  dated: isoDate.optional(),
  note: bilingual.optional(),
})

const deathGratuityRowSchema = z.strictObject({
  minYears: z.number(),
  maxYears: z.number().nullable(),
  multiplier: z.union([z.number(), z.literal('half-per-six-months-max-33')]),
  label: bilingual,
})

export const pensionFactsSchema = z.strictObject({
  $schema: z.string().optional(),
  version: semver,
  generatedAt: z.string(),
  disclaimer: bilingual,
  superannuation: z.strictObject({
    ageYears: z.literal(60),
    rule: bilingual,
    source: pensionSourceSchema,
    verify: z.boolean(),
  }),
  gratuity: z.strictObject({
    fractionPerSixMonths: z.number(),
    maxMultiplier: z.number(),
    baseCeiling: z.number(),
    daLinked: z.strictObject({
      kind: z.enum(['quarter-per-fifty', 'not-applicable']),
      timesApplied: z.number().int().min(0),
      note: bilingual.optional(),
    }),
    deathGratuityTable: z.array(deathGratuityRowSchema).min(1),
    rule: bilingual,
    source: pensionSourceSchema,
    verify: z.boolean(),
  }),
  commutation: z.strictObject({
    maxFraction: z.literal(0.4),
    rule: bilingual,
    table: z.array(z.strictObject({ ageNextBirthday: z.number().int(), factor: z.number() })).min(10),
    source: pensionSourceSchema,
    verify: z.boolean(),
  }),
  gpf: z.strictObject({
    rateHistory: z.array(z.strictObject({ effectiveFrom: isoDate, rate: z.number() })).min(1),
    source: pensionSourceSchema,
    verify: z.boolean(),
  }),
})

export type PensionFactsDataset = z.infer<typeof pensionFactsSchema>
