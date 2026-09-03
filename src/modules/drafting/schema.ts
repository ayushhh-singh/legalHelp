import { z } from 'zod'

import { bodySchema } from '@/lib/drafting/model'

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
  // Not `z.string()`: a rule whose role is a typo matches no block, and
  // `regexAbsent` over no text always passes — a checklist item that silently
  // checks nothing. `drafting_seed.py` additionally requires that the
  // template's own layout places the role.
  role: blockRoleSchema.optional(),
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

/**
 * Template Library v2 — a typed variable.
 *
 * A **variable** is what the template's `bodySkeleton` interpolates; a
 * **field** is what its `layout` interpolates. They are separate id spaces on
 * purpose: the layout is the page's chrome and is nearly the same across
 * forty-three forms, while the variables are what one form's body is about.
 * `bindings()` in `src/lib/drafting/model.ts` merges the two into the one
 * lookup every placeholder, condition and repeater reads.
 *
 * `sample` is required and is not decoration: the seed DERIVES each template's
 * `paras` worked example by substituting these into the skeleton, so a variable
 * without one would ship a form whose own worked example still contains
 * `{{key}}` — and `noPlaceholders` is a `must` on most of the library.
 */
export const templateVariableSchema = z.strictObject({
  key: fieldId,
  label: bilingual,
  hint: bilingual.optional(),
  type: z.enum(['text', 'textarea', 'date', 'number', 'select', 'addressee', 'enclosures', 'copyTo']),
  required: z.boolean(),
  sample: bilingualText,
  options: z.array(z.strictObject({ value: z.string(), label: bilingual })).optional(),
  /**
   * A key of the officer's drafting profile this variable defaults from. The
   * default is copied in once, when the document is created — changing the
   * profile never rewrites a document that already exists (ADR-041 §5).
   */
  defaultFrom: z
    .enum(['name', 'designation', 'office', 'ministry', 'department', 'phone', 'email', 'place'])
    .optional(),
  pattern: z.string().optional(),
  patternHint: bilingual.optional(),
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
  /** Template Library v2. Absent on a form built before this session. */
  variables: z.array(templateVariableSchema).optional(),
  /**
   * The starting body, in editor JSON, in both languages. Marker paragraphs
   * (`{{#if x}}`, `{{#each xs}}`) are expanded by `src/lib/drafting/skeleton.ts`
   * when a document is created from this form.
   */
  bodySkeleton: z.strictObject({ en: bodySchema, hi: bodySchema }).optional(),
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
        /** One line for the picker card. The long form is `whenToUse` on the template. */
        useWhen: bilingual,
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
export type TemplateVariable = z.infer<typeof templateVariableSchema>
export type ChecklistRule = z.infer<typeof ruleSchema>
export type ChecklistItem = z.infer<typeof checklistItemSchema>
export type DocTemplate = z.infer<typeof docTemplateSchema>
export type DocTemplateFile = z.infer<typeof docTemplateFileSchema>
export type DraftingIndex = z.infer<typeof draftingIndexSchema>
