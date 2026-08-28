import { z } from 'zod'

/**
 * The runtime half of the glossary dataset contract.
 *
 * `schemas/glossary.schema.json` is what the Python side validates against
 * (`scripts/ingest/glossary_seed.py` before it writes, and
 * `scripts/ingest/validate_data.py` afterwards); this is what `pnpm test`
 * validates the committed file against — neither producer nor consumer can
 * drift alone (ADR-012, ADR-016, ADR-020).
 *
 * Every object is a `strictObject`, not `z.object`: `z.object` strips a key it
 * does not recognise, so a mistyped `alosHi` would parse clean, vanish, and be
 * reported by nothing, while the JSON Schema (`additionalProperties: false`)
 * rejects it outright. Nothing here imports `data/glossary.json` — it is
 * ~700 KB and belongs behind the lazy import in `data.ts`, loaded only once
 * `/utils/glossary` is opened.
 */

const bilingual = z.strictObject({ en: z.string().min(1), hi: z.string().min(1) })
const url = z.string().regex(/^https?:\/\//)
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const semver = z.string().regex(/^\d+\.\d+\.\d+$/)
const slug = z.string().regex(/^[a-z0-9-]+$/)

export const glossarySourceSchema = z.strictObject({
  name: z.string().min(1),
  url,
  reference: z.string().optional(),
  dated: isoDate.optional(),
  note: bilingual.optional(),
})

export const glossaryCategorySchema = z.enum([
  'designation',
  'office',
  'file',
  'finance',
  'establishment',
  'legal',
  'it',
])

export const glossaryTermSchema = z.strictObject({
  id: slug,
  category: glossaryCategorySchema,
  en: z.string().min(1),
  hi: z.string().min(1),
  alsoHi: z.array(z.string().min(1)).optional(),
  note: bilingual.optional(),
  source: glossarySourceSchema,
  fetchedAt: z.string(),
  verify: z.boolean(),
})

export const glossarySchema = z.strictObject({
  $schema: z.string().optional(),
  version: semver,
  generatedAt: z.string(),
  disclaimer: bilingual,
  terms: z.array(glossaryTermSchema).min(1),
})

export type GlossaryCategory = z.infer<typeof glossaryCategorySchema>
export type GlossaryTerm = z.infer<typeof glossaryTermSchema>
export type GlossarySource = z.infer<typeof glossarySourceSchema>
export type Glossary = z.infer<typeof glossarySchema>

/** The category order shown in the UI, and the order the picker groups by. */
export const GLOSSARY_CATEGORIES: readonly GlossaryCategory[] = [
  'designation',
  'office',
  'file',
  'finance',
  'establishment',
  'legal',
  'it',
]
