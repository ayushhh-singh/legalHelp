import { z } from 'zod'

/**
 * The runtime half of the drafting dataset contract.
 *
 * `schemas/drafting-*.schema.json` is what the Python side validates against —
 * `scripts/ingest/drafting_seed.py` before it writes a file, and
 * `scripts/ingest/validate_data.py` over all seventeen of them. This is what
 * `pnpm test` validates the committed files against. Two schemas for one shape
 * is the arrangement the law and pay datasets already have (ADR-012, ADR-016):
 * neither the producer nor the consumer can drift alone.
 *
 * Every object is a `strictObject`. `z.object` strips keys it does not know
 * about, so a template with `numberedFrom` instead of `numberFrom` would parse
 * clean, lose the field, and silently number its first paragraph — while the
 * JSON Schemas, which all set `additionalProperties: false`, would reject it.
 *
 * Nothing here imports the JSON. `data/drafting` is ~476 KB and belongs behind
 * a lazy import on the Drafting route.
 */

const bilingual = z.strictObject({ en: z.string().min(1), hi: z.string().min(1) })
/** A sample may be empty — an optional field has nothing to show. */
const bilingualText = z.strictObject({ en: z.string(), hi: z.string() })
const bilingualList = z.strictObject({ en: z.array(z.string()), hi: z.array(z.string()) })
const url = z.string().regex(/^https?:\/\//)
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const semver = z.string().regex(/^\d+\.\d+\.\d+$/)
const slug = z.string().regex(/^[a-z0-9-]+$/)
const fieldId = z.string().regex(/^[a-zA-Z][a-zA-Z0-9]*$/)

export const draftingSourceSchema = z.strictObject({
  name: z.string().min(1),
  url,
  reference: z.string().optional(),
  dated: isoDate.optional(),
  note: bilingual.optional(),
})

const sourced = {
  source: draftingSourceSchema,
  fetchedAt: z.string(),
  verify: z.boolean(),
}

const envelope = {
  $schema: z.string().optional(),
  version: semver,
  generatedAt: z.string(),
  disclaimer: bilingual,
}

// ------------------------------------------------------------------- terms

export const structureTermSchema = z.strictObject({
  id: slug,
  category: z.enum(['form', 'part', 'urgency', 'designation', 'process', 'phraseElement']),
  en: z.string().min(1),
  hi: z.string().min(1),
  alsoHi: z.array(z.string().min(1)).optional(),
  note: bilingual.optional(),
  csmopRef: z.string().optional(),
  ...sourced,
})

export const structureTermsSchema = z.strictObject({
  ...envelope,
  terms: z.array(structureTermSchema).min(1),
})

// ----------------------------------------------------------------- phrases

export const phraseSchema = z.strictObject({
  id: slug,
  kind: z.enum(['opening', 'transition', 'closing', 'noting', 'endorsement', 'courtesy']),
  appliesTo: z.array(z.string().regex(/^([a-z0-9-]+|\*)$/)).min(1),
  text: bilingual,
  tags: z.array(slug).optional(),
  note: bilingual.optional(),
  csmopRef: z.string().optional(),
  ...sourced,
})

export const phraseLibrarySchema = z.strictObject({
  ...envelope,
  phrases: z.array(phraseSchema).min(1),
})

// --------------------------------------------------------------- templates

export const blockRoleSchema = z.enum([
  'fileNumber',
  'urgency',
  'gazetteLine',
  'header',
  'title',
  'dateLine',
  'addressee',
  'attention',
  'subject',
  'refLine',
  'salutation',
  'body',
  'closing',
  'signature',
  'enclosures',
  'copyTo',
  'endorsement',
  'footer',
])

export const blockSchema = z.strictObject({
  role: blockRoleSchema,
  align: z.enum(['left', 'center', 'right']).optional(),
  emphasis: z.enum(['normal', 'bold', 'title']).optional(),
  lines: z.array(z.string()).optional(),
  lead: z.string().optional(),
  source: fieldId.optional(),
  numbered: z.boolean().optional(),
  numberFrom: z.number().int().min(1).optional(),
  itemPrefix: z.enum(['none', 'ordinal', 'roman', 'bullet']).optional(),
  omitWhenEmpty: z.boolean().optional(),
})

export const fieldSchema = z.strictObject({
  id: fieldId,
  label: bilingual,
  hint: bilingual.optional(),
  type: z.enum(['text', 'textarea', 'date', 'paras', 'list', 'select']),
  required: z.boolean(),
  sample: z.union([bilingualText, bilingualList]),
  options: z.array(z.strictObject({ value: z.string().min(1), label: bilingual })).optional(),
  maxWords: z.number().int().min(1).optional(),
})

export const ruleSchema = z.strictObject({
  kind: z.enum([
    'required',
    'allRequired',
    'blockPresent',
    'contains',
    'regex',
    'regexAbsent',
    'paraNumbering',
    'noPlaceholders',
    'person',
    'enclosuresConsistent',
    'listNonEmpty',
    'maxWords',
    'replyDate',
  ]),
  field: fieldId.optional(),
  fields: z.array(fieldId).optional(),
  role: z.string().optional(),
  text: bilingual.optional(),
  pattern: z.string().optional(),
  value: z.string().optional(),
  count: z.number().int().min(1).optional(),
})

export const checklistItemSchema = z.strictObject({
  id: slug,
  label: bilingual,
  why: bilingual,
  severity: z.enum(['must', 'should']),
  csmopRef: z.string().optional(),
  rule: ruleSchema,
})

export const docTemplateSchema = z.strictObject({
  id: slug,
  name: bilingual,
  shortName: bilingual,
  person: z.enum(['first', 'third']),
  usedBy: bilingual,
  whenToUse: bilingual,
  salutation: bilingual.nullable().optional(),
  subscription: bilingual.nullable().optional(),
  urgencyAllowed: z.boolean().optional(),
  csmopRef: z.strictObject({
    edition: z.string().min(1),
    paras: z.array(z.string().min(1)).min(1),
    pages: z.array(z.number().int().min(1)).optional(),
    chassis: slug.optional(),
    note: bilingual.optional(),
  }),
  fields: z.array(fieldSchema).min(1),
  layout: z.strictObject({ en: z.array(blockSchema).min(1), hi: z.array(blockSchema).min(1) }),
  checklist: z.array(checklistItemSchema).min(1),
  notes: z
    .array(
      z.strictObject({
        key: slug,
        title: bilingual,
        body: bilingual,
        csmopRef: z.string().optional(),
      }),
    )
    .optional(),
  ...sourced,
})

export const docTemplateFileSchema = z.strictObject({
  ...envelope,
  template: docTemplateSchema,
})

export const draftingIndexSchema = z.strictObject({
  ...envelope,
  templates: z
    .array(
      z.strictObject({
        id: slug,
        name: bilingual,
        shortName: bilingual,
        group: z.enum(['communication', 'internal', 'personal', 'statutory']),
        person: z.enum(['first', 'third']),
        csmopParas: z.array(z.string()).min(1),
        verify: z.boolean().optional(),
      }),
    )
    .min(1),
})

export type Bilingual = z.infer<typeof bilingual>
export type DraftingSource = z.infer<typeof draftingSourceSchema>
export type StructureTerm = z.infer<typeof structureTermSchema>
export type StructureTerms = z.infer<typeof structureTermsSchema>
export type Phrase = z.infer<typeof phraseSchema>
export type PhraseLibrary = z.infer<typeof phraseLibrarySchema>
export type BlockRole = z.infer<typeof blockRoleSchema>
export type LayoutBlock = z.infer<typeof blockSchema>
export type TemplateField = z.infer<typeof fieldSchema>
export type ChecklistRule = z.infer<typeof ruleSchema>
export type ChecklistItem = z.infer<typeof checklistItemSchema>
export type DocTemplate = z.infer<typeof docTemplateSchema>
export type DocTemplateFile = z.infer<typeof docTemplateFileSchema>
export type DraftingIndex = z.infer<typeof draftingIndexSchema>
