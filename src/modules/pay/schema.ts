import { z } from 'zod'

/**
 * The runtime half of the pay dataset contract.
 *
 * `schemas/pay-*.schema.json` is what the Python side validates against —
 * `scripts/ingest/pay_matrix.py` before it writes the matrix, and
 * `scripts/ingest/validate_data.py` over every hand-authored file. This is what
 * `pnpm test` validates the committed files against, the same arrangement the
 * law datasets have (ADR-012). Two schemas for one shape is a real cost, and it
 * buys the thing that matters: neither the producer nor the consumer can drift
 * alone.
 *
 * Every object here is a `strictObject`, deliberately. `z.object` *strips* keys
 * it does not know about, so a dataset with `gradePayy` or `taxabl` in it would
 * parse clean, lose the field, and tell nobody — while the JSON Schemas, which
 * all set `additionalProperties: false`, would reject it. That asymmetry made
 * the "both must pass" claim above false for every optional field. Strict is
 * what makes the two halves actually describe the same shape.
 *
 * Nothing here imports the JSON. `data/pay` is 1.2 MB and belongs behind a lazy
 * import on the Pay route, not in the initial bundle.
 */

const bilingual = z.strictObject({ en: z.string().min(1), hi: z.string().min(1) })
const url = z.string().regex(/^https?:\/\//)
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const semver = z.string().regex(/^\d+\.\d+\.\d+$/)
/** '1' … '18', plus the interpolated '13A'. */
const payLevel = z.string().regex(/^(1[0-8]|[1-9]|13A)$/)
const slug = z.string().regex(/^[a-z0-9-]+$/)

/**
 * The master context's rule, as a type: every fact in `/data` carries where it
 * came from. `verify` is the honest half — true means no official order was
 * read for this figure, and the UI owes the reader a "verify with your DDO"
 * banner.
 */
export const paySourceSchema = z.strictObject({
  name: z.string().min(1),
  url,
  reference: z.string().optional(),
  dated: isoDate.optional(),
  note: bilingual.optional(),
})

const sourced = {
  source: paySourceSchema,
  fetchedAt: z.string(),
  verify: z.boolean(),
}

const envelope = {
  $schema: z.string().optional(),
  version: semver,
  generatedAt: z.string(),
  disclaimer: bilingual,
}

// ---------------------------------------------------------------- pay matrix

export const payLevelSchema = z.strictObject({
  level: payLevel,
  order: z.number().int().min(1).max(19).optional(),
  gradePay: z.number().int().nullable().optional(),
  payBand: z.strictObject({
    name: z.string().min(1),
    range: z.string().min(1),
    preRevisedEntryPay: z.number().int().nullable().optional(),
  }),
  indexOfRationalisation: z.number().optional(),
  entryPay: z.number().int(),
  cells: z.array(z.number().int()).min(1).max(40),
  note: bilingual.nullable().optional(),
  ...sourced,
})

export const payMatrixSchema = z.strictObject({
  ...envelope,
  cpc: z.literal(7),
  rule: z.strictObject({
    multiplier: z.literal(1.03),
    rounding: z.literal('nearest-100'),
    description: bilingual,
    fitmentFactor: z.number().optional(),
  }),
  levels: z.array(payLevelSchema).min(19),
})

// ---------------------------------------------------------------- DA history

export const daRateSchema = z.strictObject({
  effectiveFrom: isoDate,
  rate: z.number().min(0),
  status: z.enum(['notified', 'frozen', 'projected']),
  supersededBy: z.string().nullable().optional(),
  range: z.strictObject({ low: z.number(), high: z.number() }).optional(),
  note: bilingual.nullable().optional(),
  ...sourced,
})

export const daHistorySchema = z.strictObject({
  ...envelope,
  base: z.strictObject({
    cpc: z.literal(7),
    from: isoDate,
    index: z.number(),
    linkingFactor: z.number(),
    note: bilingual.optional(),
  }),
  formula: z.strictObject({
    expression: z.string().min(1),
    description: bilingual,
    source: paySourceSchema,
  }),
  rates: z.array(daRateSchema).min(19),
})

// -------------------------------------------------------------------- cities

export const citySchema = z.strictObject({
  id: slug,
  name: bilingual,
  aliases: z.array(z.string().min(1)).optional(),
  state: bilingual,
  class: z.enum(['X', 'Y']),
  unit: z.enum(['UA', 'M.Corpn.', 'CT', 'NPP', 'city']),
  delhiRateProtected: z.boolean().optional(),
  note: bilingual.nullable().optional(),
  ...sourced,
})

export const citiesSchema = z.strictObject({
  ...envelope,
  /** Z is not a list. Anything the annexure does not name is Z. */
  fallbackClass: z.literal('Z'),
  source: paySourceSchema,
  classes: z
    .array(z.strictObject({ id: z.enum(['X', 'Y', 'Z']), name: bilingual, description: bilingual }))
    .min(3),
  cities: z.array(citySchema).min(90),
})

// ---------------------------------------------------------------- allowances

export const allowanceRateSchema = z.strictObject({
  key: z.string().nullable().optional(),
  when: bilingual,
  measure: z.enum([
    'percent-of-basic-pay',
    'percent-of-basic-pay-plus-da',
    'rupees-per-month',
    'rupees-per-year',
    'rupees-per-day',
    'rupees-per-hour',
    'formula',
    'not-a-money-value',
  ]),
  value: z.number().nullable().optional(),
  floor: z.number().nullable().optional(),
  ceiling: z.number().nullable().optional(),
  expression: z.string().nullable().optional(),
})

export const allowanceSchema = z.strictObject({
  id: slug,
  name: bilingual,
  shortName: bilingual.optional(),
  type: z.enum([
    'percent-of-pay',
    'fixed',
    'slab',
    'matrix',
    'formula',
    'concession',
    'subsumed',
    'abolished',
  ]),
  status: z.enum(['current', 'subsumed', 'abolished']),
  subsumedInto: slug.nullable().optional(),
  appliesTo: bilingual,
  rates: z.array(allowanceRateSchema),
  /**
   * Most of these figures are the rate the order states, not the rate payable
   * today: an allowance marked `quarter-per-fifty` goes up by 25% each time DA
   * crosses 50%, and DA crossed 50% on 01.01.2024. A calculator that shows the
   * stated figure without applying `timesApplied` is short by a quarter.
   */
  daLinked: z.strictObject({
    kind: z.enum(['fully-indexed', 'quarter-per-fifty', 'none', 'not-applicable']),
    timesApplied: z.number().int().min(0),
    since: isoDate.nullable().optional(),
    note: bilingual.nullable().optional(),
  }),
  taxable: z.boolean(),
  taxSection: z.string().nullable().optional(),
  taxNote: bilingual.nullable().optional(),
  conditions: z.array(bilingual),
  note: bilingual.nullable().optional(),
  ...sourced,
})

export const allowancesSchema = z.strictObject({
  ...envelope,
  allowances: z.array(allowanceSchema).min(25),
})

// ---------------------------------------------------------------------- jobs

export const jobSchema = z.strictObject({
  id: slug,
  title: bilingual,
  organisation: slug,
  cadre: bilingual.nullable().optional(),
  group: z.enum(['A', 'B', 'C']),
  gazetted: z.boolean().optional(),
  entryLevel: payLevel,
  gradePay: z.number().int().nullable(),
  recruitment: z.strictObject({
    mode: z.enum(['direct', 'promotion', 'both']),
    exam: slug.nullable(),
    note: bilingual.nullable().optional(),
  }),
  allowances: z
    .array(
      z.strictObject({
        id: slug,
        /** True only where the allowance is automatic for the post. */
        enabledByDefault: z.boolean(),
        note: bilingual.nullable().optional(),
      }),
    )
    .min(1),
  promotionPath: z.array(z.strictObject({ title: bilingual, level: payLevel })),
  note: bilingual.nullable().optional(),
  ...sourced,
})

export const jobsSchema = z.strictObject({
  ...envelope,
  organisations: z.record(slug, z.strictObject({ name: bilingual, ministry: bilingual })),
  exams: z.record(slug, z.strictObject({ name: bilingual, authority: bilingual, url })),
  jobs: z.array(jobSchema).min(55),
})

// ------------------------------------------------------ schemes: CGHS/GIS/NPS/UPS

const schemeEntrySchema = z.strictObject({
  key: z.string().min(1),
  label: bilingual,
  measure: z.enum([
    'percent-of-basic-pay',
    'percent-of-basic-pay-plus-da',
    'rupees-per-month',
    'rupees-per-year',
    'rupees',
    'formula',
    'not-a-money-value',
  ]),
  value: z.number().nullable().optional(),
  expression: z.string().nullable().optional(),
  appliesToLevels: z.array(payLevel).optional(),
  note: bilingual.nullable().optional(),
})

export const schemeSchema = z.strictObject({
  ...envelope,
  scheme: z.strictObject({
    id: slug,
    name: bilingual,
    shortName: bilingual.optional(),
    administeredBy: bilingual,
    effectiveFrom: isoDate.nullable().optional(),
    summary: bilingual,
    contributions: z.array(schemeEntrySchema),
    slabs: z.array(schemeEntrySchema),
    rules: z.array(z.strictObject({ key: slug, title: bilingual, body: bilingual })),
    note: bilingual.nullable().optional(),
    ...sourced,
  }),
})

// ----------------------------------------------------------------------- tax

const provisionSchema = z.strictObject({
  id: slug,
  name: bilingual,
  /** The number every officer already knows. */
  section1961: z.string().min(1),
  /** The Income-tax Act, 2025 number, where it has been confirmed. */
  section2025: z.string().nullable().optional(),
  limit: z.number().int().nullable().optional(),
  limitNote: bilingual.nullable().optional(),
  regimes: z.array(z.enum(['old', 'new'])).min(1),
  description: bilingual,
  ...sourced,
})

export const taxSchema = z.strictObject({
  ...envelope,
  financialYear: z.string().regex(/^\d{4}-\d{2}$/),
  taxYear: z.string().regex(/^\d{4}-\d{2}$/),
  note: bilingual.nullable().optional(),
  regimes: z
    .array(
      z.strictObject({
        id: z.enum(['old', 'new']),
        name: bilingual,
        isDefault: z.boolean(),
        standardDeduction: z.number().int().min(0),
        slabs: z
          .array(
            z.strictObject({
              from: z.number().int().min(0),
              to: z.number().int().nullable(),
              rate: z.number().min(0).max(100),
              ageBand: z.enum(['below-60', '60-to-80', '80-and-above']).optional(),
            }),
          )
          .min(3),
        rebate: z.strictObject({
          section: z.string().min(1),
          incomeCeiling: z.number().int().min(0),
          maxRebate: z.number().int().min(0),
          note: bilingual.nullable().optional(),
        }),
        note: bilingual.nullable().optional(),
        ...sourced,
      }),
    )
    .min(2),
  deductions: z.array(provisionSchema).min(1),
  exemptions: z.array(provisionSchema).min(1),
  surcharge: z.strictObject({
    note: bilingual,
    bands: z.array(
      z.strictObject({
        from: z.number().min(0),
        to: z.number().nullable(),
        rate: z.number().min(0),
        regimes: z.array(z.enum(['old', 'new'])),
      }),
    ),
  }),
  cess: z.strictObject({ name: bilingual, rate: z.number().min(0) }),
})

// ------------------------------------------------------------------- 8th CPC

export const cpc8Schema = z.strictObject({
  ...envelope,
  status: z.literal('constituted'),
  commission: z.strictObject({
    name: bilingual,
    constitutedOn: isoDate,
    resolutionNumber: z.string().min(1),
    members: z.array(z.strictObject({ role: bilingual, name: bilingual })).min(3),
    headquarters: bilingual,
    reportDue: z.strictObject({
      withinMonths: z.number().int().min(1),
      notBefore: isoDate,
      note: bilingual,
    }),
    ...sourced,
  }),
  termsOfReference: z.array(z.strictObject({ key: slug, text: bilingual })).min(1),
  /** Every one of these is somebody's estimate. None is a rate. */
  fitmentFactorsDiscussed: z
    .array(
      z.strictObject({
        value: z.number(),
        status: z.literal('projected'),
        attributedTo: bilingual,
        note: bilingual.nullable().optional(),
        ...sourced,
      }),
    )
    .min(1),
  whatIsNotKnown: z.array(bilingual).min(1),
})

export type PayMatrix = z.infer<typeof payMatrixSchema>
export type PayMatrixLevel = z.infer<typeof payLevelSchema>
export type DaHistory = z.infer<typeof daHistorySchema>
export type DaRate = z.infer<typeof daRateSchema>
export type HraCities = z.infer<typeof citiesSchema>
export type HraCity = z.infer<typeof citySchema>
export type Allowances = z.infer<typeof allowancesSchema>
export type Allowance = z.infer<typeof allowanceSchema>
export type AllowanceRate = z.infer<typeof allowanceRateSchema>
export type Jobs = z.infer<typeof jobsSchema>
export type Job = z.infer<typeof jobSchema>
export type PayScheme = z.infer<typeof schemeSchema>
export type TaxYear = z.infer<typeof taxSchema>
export type Cpc8 = z.infer<typeof cpc8Schema>
