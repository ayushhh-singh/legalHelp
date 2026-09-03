import { z } from 'zod'

import { bodySchema, type BodyDoc, type VarValue } from './model'

import { docTemplateSchema, type DocTemplate, type TemplateVariable } from '@/modules/drafting/schema'

/**
 * Templates an officer saved themselves.
 *
 * A personal template is a **clone of an official one with some of its values
 * frozen and some of them turned into variables**. It is not a new form: the
 * layout, the checklist and the CSMOP reference all still come from the base
 * template, which is what stops a saved letterhead from quietly becoming a
 * document type nobody can validate.
 *
 * Two rules, both enforced here rather than described:
 *
 * 1. **A personal template never claims a CSMOP reference it does not have.**
 *    `personalTemplateSchema` has no `csmopRef` at all, and `resolvePersonal`
 *    hands back the BASE template's reference with `personal: true` beside it,
 *    so every surface can badge it "yours". An officer's own wording is not the
 *    Manual of Office Procedure and must never render as though it were.
 * 2. **Import reissues the id and renames on a collision.** A file shared
 *    between two officers must not overwrite the recipient's own template of
 *    the same name, and silently merging two different templates under one id
 *    is the worst of the three options.
 */

const bilingualSchema = z.object({ en: z.string(), hi: z.string() })

export const PERSONAL_TEMPLATE_VERSION = 1

export const personalTemplateSchema = z.object({
  schemaVersion: z.number().int().min(1),
  id: z.string().min(1),
  name: z.string().min(1),
  /** The official template this was cloned from. Its layout and checklist govern. */
  baseTemplateId: z.string().min(1),
  note: z.string().default(''),
  /** Values frozen into every document made from this template. */
  frozen: z.record(z.string(), z.union([z.string(), z.array(z.string()), bilingualSchema])).default({}),
  /** Variables the officer chose to keep asking about. */
  variables: z
    .array(
      z.object({
        key: z.string(),
        label: bilingualSchema,
        hint: bilingualSchema.optional(),
        type: z.enum(['text', 'textarea', 'date', 'number', 'select', 'addressee', 'enclosures', 'copyTo']),
        required: z.boolean(),
        sample: bilingualSchema,
        options: z.array(z.object({ value: z.string(), label: bilingualSchema })).optional(),
        pattern: z.string().optional(),
        patternHint: bilingualSchema.optional(),
      }),
    )
    .default([]),
  bodySkeleton: z.object({ en: bodySchema, hi: bodySchema }),
  favourite: z.boolean().default(false),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type PersonalTemplate = z.infer<typeof personalTemplateSchema>

/**
 * The export file.
 *
 * `templates` is `z.unknown()` and each row is validated one at a time by
 * `importTemplates`, deliberately: a file carrying nineteen good templates and
 * one written by a version that added a field should import nineteen and say
 * so, not fail as a whole. `rejected` is that count.
 */
export const personalTemplateFileSchema = z.object({
  kind: z.literal('sahayak-drafting-templates'),
  schemaVersion: z.number().int().min(1),
  exportedAt: z.string(),
  templates: z.array(z.unknown()),
})

export interface PersonalTemplateFile {
  kind: 'sahayak-drafting-templates'
  schemaVersion: number
  exportedAt: string
  templates: PersonalTemplate[]
}

/**
 * A personal template made from a document.
 *
 * `keepAsVariable` names the keys the officer wants to go on being asked about;
 * everything else in `vars` is frozen. The skeleton is the document's own body
 * with the kept keys turned back into `{{placeholders}}` — which is why a
 * template saved from a document reproduces that document's structure exactly,
 * including its tables and headings.
 */
export function personalFromDocument(args: {
  id: string
  name: string
  baseTemplateId: string
  vars: Record<string, VarValue>
  body: BodyDoc
  bodyHi?: BodyDoc
  keepAsVariable: readonly string[]
  base: DocTemplate
  at: string
}): PersonalTemplate {
  const keep = new Set(args.keepAsVariable)
  const frozen: PersonalTemplate['frozen'] = {}
  for (const [key, value] of Object.entries(args.vars)) {
    if (!keep.has(key)) frozen[key] = value
  }

  const declared = new Map((args.base.variables ?? []).map((entry) => [entry.key, entry]))
  const variables: PersonalTemplate['variables'] = [...keep].map((key) => {
    const source = declared.get(key)
    const current = args.vars[key]
    const sample =
      typeof current === 'object' && !Array.isArray(current)
        ? current
        : {
            en: Array.isArray(current) ? current.join('\n') : (current ?? ''),
            hi: Array.isArray(current) ? current.join('\n') : (current ?? ''),
          }
    return {
      key,
      label: source?.label ?? { en: key, hi: key },
      ...(source?.hint ? { hint: source.hint } : {}),
      type: source?.type ?? 'text',
      required: source?.required ?? false,
      sample,
      ...(source?.options ? { options: source.options } : {}),
      ...(source?.pattern ? { pattern: source.pattern } : {}),
      ...(source?.patternHint ? { patternHint: source.patternHint } : {}),
    }
  })

  return {
    schemaVersion: PERSONAL_TEMPLATE_VERSION,
    id: args.id,
    name: args.name,
    baseTemplateId: args.baseTemplateId,
    note: '',
    frozen,
    variables,
    bodySkeleton: { en: args.body, hi: args.bodyHi ?? args.body },
    favourite: false,
    createdAt: args.at,
    updatedAt: args.at,
  }
}

/**
 * The base template, with the personal template's variables and skeleton
 * substituted in.
 *
 * Everything else — the layout, the fields, the checklist, the CSMOP reference
 * — is the base's, unchanged. That is the whole safety property: a personal
 * template can change what a document starts as and can never change what the
 * checklist checks.
 */
export function resolvePersonal(base: DocTemplate, personal: PersonalTemplate): DocTemplate {
  const parsed = docTemplateSchema.safeParse({
    ...base,
    variables: personal.variables as TemplateVariable[],
    bodySkeleton: personal.bodySkeleton,
  })
  // A personal template that produces something the template schema rejects is
  // not applied at all — the officer gets the official form rather than a form
  // whose shape nothing downstream can rely on.
  return parsed.success ? parsed.data : base
}

/** A name nobody else in the list is using — `Name (2)`, `Name (3)`. */
export function uniqueName(name: string, taken: readonly string[]): string {
  const existing = new Set(taken)
  if (!existing.has(name)) return name
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${name} (${suffix})`
    if (!existing.has(candidate)) return candidate
  }
  return `${name} (${Date.now()})`
}

export interface ImportResult {
  imported: PersonalTemplate[]
  renamed: { from: string; to: string }[]
  rejected: number
}

/**
 * Read an export file.
 *
 * Every template gets a NEW id and, on a name collision, a new name — never an
 * overwrite. `newId` is an argument because this file is pure and has no
 * `crypto`.
 */
export function importTemplates(
  raw: unknown,
  existing: readonly PersonalTemplate[],
  newId: (index: number) => string,
): ImportResult | { error: 'malformed' | 'wrong-version' } {
  const parsed = personalTemplateFileSchema.safeParse(raw)
  if (!parsed.success) return { error: 'malformed' }
  if (parsed.data.schemaVersion > PERSONAL_TEMPLATE_VERSION) return { error: 'wrong-version' }

  const names = existing.map((entry) => entry.name)
  const imported: PersonalTemplate[] = []
  const renamed: { from: string; to: string }[] = []
  let rejected = 0

  parsed.data.templates.forEach((entry, index) => {
    const check = personalTemplateSchema.safeParse(entry)
    if (!check.success) {
      rejected += 1
      return
    }
    const name = uniqueName(check.data.name, names)
    if (name !== check.data.name) renamed.push({ from: check.data.name, to: name })
    names.push(name)
    imported.push({ ...check.data, id: newId(index), name, favourite: false })
  })

  return { imported, renamed, rejected }
}

export function exportTemplates(templates: readonly PersonalTemplate[], at: string): PersonalTemplateFile {
  return {
    kind: 'sahayak-drafting-templates',
    schemaVersion: PERSONAL_TEMPLATE_VERSION,
    exportedAt: at,
    templates: [...templates],
  }
}
