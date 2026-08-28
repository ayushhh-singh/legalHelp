import { z } from 'zod'

/**
 * The runtime half of the law dataset contract.
 *
 * `schemas/law-mapping.schema.json` is what the Python ingest validates against
 * before it writes; this is what `pnpm test` validates the committed files
 * against. Two schemas for one shape is a real cost, and it buys the thing that
 * matters: a dataset cannot land in the repo unless *both* the producer and the
 * consumer agree on it. A drift between them fails the build rather than
 * showing a reader a section with no heading.
 */

const bilingual = z.object({ en: z.string(), hi: z.string() })
/** Where an empty string would be a bug rather than a recorded gap. */
const bilingualRequired = z.object({ en: z.string().min(1), hi: z.string().min(1) })

const sectionNumber = z.string().regex(/^\d{1,4}[A-Z]{0,2}$/)
const sectionRef = z.string().regex(/^\d{1,4}[A-Z]{0,2}(\([0-9a-zA-Z]{1,4}\))*$/)
const url = z.string().regex(/^https:\/\//)

const noteSource = z.object({ name: bilingualRequired, url })

const note = z.object({
  kind: z.enum(['trap', 'transitional', 'context', 'caution']),
  title: bilingualRequired,
  body: bilingualRequired,
  source: noteSource.optional(),
})

const classification = z.object({
  clause: sectionRef,
  offence: bilingual,
  punishment: bilingual,
  cognizable: z.enum(['cognizable', 'non-cognizable', 'depends', 'unspecified']),
  bailable: z.enum(['bailable', 'non-bailable', 'depends', 'unspecified']),
  triableBy: bilingual,
  compoundable: z.enum(['compoundable', 'compoundable-with-court-permission', 'non-compoundable']),
  compoundableBy: bilingual.optional(),
  source: z.string().optional(),
})

const oldRef = z.object({
  act: z.enum(['IPC', 'CrPC', 'IEA']),
  section: sectionRef,
  base: sectionNumber,
  heading: bilingual,
})

const mapping = z.object({
  clause: sectionRef,
  old: z.array(oldRef),
  isNewProvision: z.boolean(),
  changed: z.boolean(),
})

export const lawSectionSchema = z.object({
  section: sectionNumber,
  act: z.enum(['BNS', 'BNSS', 'BSA']),
  heading: bilingual,
  status: z.enum(['unchanged', 'changed', 'renumbered', 'new']),
  chapter: z.object({ number: z.string(), title: bilingual }),
  mappings: z.array(mapping),
  repeals: z.array(sectionNumber),
  text: bilingual,
  classification: z.array(classification),
  punishment: bilingual,
  keywords: z.object({ en: z.array(z.string()), hi: z.array(z.string()), roman: z.array(z.string()) }),
  notes: z.array(note),
  sources: z.array(z.string()).min(1),
  verify: z.boolean(),
  provenance: z.record(z.string(), z.unknown()).optional(),
})

const actRef = z.object({
  id: z.enum(['BNS', 'BNSS', 'BSA', 'IPC', 'CrPC', 'IEA']),
  year: z.number().int(),
  name: bilingualRequired,
})

export const lawDatasetSchema = z.object({
  $schema: z.string().optional(),
  id: z.enum(['bns', 'bnss', 'bsa']),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  fetchedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/),
  newAct: actRef,
  oldAct: actRef,
  commencement: z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    note: bilingualRequired,
    source: noteSource,
  }),
  disclaimer: bilingualRequired,
  sources: z
    .array(
      z.object({
        id: z.string().min(1),
        name: bilingualRequired,
        url,
        fetchedAt: z.string(),
        sha256: z
          .string()
          .regex(/^([0-9a-f]{64})?$/)
          .optional(),
        bytes: z.number().optional(),
      }),
    )
    .min(1),
  counts: z.record(z.string(), z.union([z.number(), z.string()])),
  sections: z.record(sectionNumber, lawSectionSchema),
})

export const lawIndexEntrySchema = z.object({
  oldAct: z.enum(['IPC', 'CrPC', 'IEA']),
  newAct: z.enum(['BNS', 'BNSS', 'BSA']),
  newSections: z.array(sectionRef),
  status: z.enum(['mapped', 'omitted']),
  heading: bilingual,
  note: bilingualRequired.nullable(),
  warnings: z.array(note).optional(),
})

export const lawIndexSchema = z.object({
  $schema: z.string().optional(),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  generatedAt: z.string(),
  disclaimer: bilingualRequired,
  acts: z.record(
    z.enum(['IPC', 'CrPC', 'IEA']),
    z.object({
      newAct: z.enum(['BNS', 'BNSS', 'BSA']),
      oldActName: bilingualRequired.optional(),
      newActName: bilingualRequired.optional(),
      entries: z.record(sectionRef, lawIndexEntrySchema),
    }),
  ),
})
