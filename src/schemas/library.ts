import { z } from 'zod'

/**
 * The runtime half of the Library dataset contract.
 *
 * `schemas/library-work.schema.json` and `schemas/library-index.schema.json`
 * are what the Python side validates against — `scripts/ingest/library_seed.py`
 * before it writes a file, and `scripts/ingest/validate_data.py` over all
 * sixteen of them. This is what `pnpm test` validates the committed files
 * against. Two schemas for one shape is the arrangement `data/law`, `data/pay`,
 * `data/drafting` and `data/rules` already have (ADR-012, ADR-016, ADR-020,
 * ADR-023): neither the producer nor the consumer can drift alone.
 *
 * Every object is a `strictObject`, for the reason ADR-016's addendum records:
 * plain `z.object` strips keys it does not know about, so a work with
 * `readOrder` instead of `readingOrder` would parse clean, lose the key, and be
 * reported by nothing — while the JSON Schemas, which all set
 * `additionalProperties: false`, would reject it.
 *
 * Nothing here imports the JSON. `data/library` is ~820 KB and belongs behind
 * the Library route's lazy import, the way the statute and the pay tables are.
 *
 * This lives in `src/schemas/` rather than in the module, unlike the four
 * schemas that came before it, because the Library's shape is read by two
 * places that are not the module: `src/lib/library` (which is pure and must not
 * import a module) and the tests that read the committed bytes off disk.
 */

/**
 * Both languages present.
 *
 * Used only where every record in the dataset genuinely has both. A heading is
 * NOT one of those places — see `bilingualDraft`.
 */
const bilingual = z.strictObject({ en: z.string().min(1), hi: z.string().min(1) })

/**
 * Either half may be empty, and both halves are missing from real records.
 *
 * Four of the twelve rule books print no heading this repository could extract
 * (the whole of FR/SR and CSMOP, thirteen GFR rules, five others), so 221 leaf
 * nodes have no English heading; two CCS (Leave) rules have neither; and 71 of
 * the 87 chapter titles on NCRB Sankalan have no Hindi. Nothing is invented to
 * fill any of those — `excerpt` is what the table of contents falls back to,
 * and `docs/DATA-GAPS.md` #70 and #71 are what closing them would take.
 */
const bilingualDraft = z.strictObject({ en: z.string(), hi: z.string() })

const url = z.string().regex(/^https?:\/\//)
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const semver = z.string().regex(/^\d+\.\d+\.\d+$/)
const slug = z.string().regex(/^[a-z0-9-]+$/)

export const librarySourceSchema = z.strictObject({ name: z.string().min(1), url })

/**
 * How an officer would look for the book, not anything a Ministry published.
 * Adding a member means adding a `library.category.<value>` key to both i18n
 * catalogues; `LIBRARY_CATEGORIES` in `src/lib/library/categories.ts` is the
 * ordered list the hub renders and is exhaustive over this enum by construction.
 */
export const libraryCategorySchema = z.enum([
  'criminal-law',
  'service-rules',
  'office-procedure',
  'transparency',
  'official-language',
  'security',
  'workplace',
  'finance',
  'other',
])

/**
 * Where the table of contents came from — and, for `flat`, an admission.
 *
 * `chapters`: the corpus records a chapter per unit (`data/law/*.json` does).
 * `numbering`: the unit numbers carry the division themselves (CSMOP's `4.7`).
 * `flat`: the corpus holds no division at all, so there is one node per unit.
 * The session brief asked for exactly this rather than inventing structure, and
 * the work page says so to the reader in both languages.
 */
export const tocSourceSchema = z.enum(['chapters', 'numbering', 'flat'])

/** A pointer into a dataset that already exists. NEVER a copy of its text. */
export const corpusRefSchema = z.strictObject({
  kind: z.enum(['rules', 'law']),
  file: z.string().regex(/^(rules\/text|law)\/[a-z0-9-]+\.json$/),
})

export interface TocNode {
  id: string
  number: string
  heading: { en: string; hi: string }
  excerpt?: { en: string; hi: string }
  children?: TocNode[]
  unitIds: string[]
}

/**
 * Recursive, so the type is declared above and handed to zod rather than
 * inferred. `z.lazy` is what lets `children` refer back to this schema; the
 * explicit `ZodType<TocNode>` annotation is what stops TypeScript trying to
 * infer a type that refers to itself.
 */
export const tocNodeSchema: z.ZodType<TocNode> = z.lazy(() =>
  z.strictObject({
    id: z.string().min(1),
    number: z.string(),
    heading: bilingualDraft,
    /**
     * Present only on a leaf whose heading is missing in one language or both.
     * A quotation for navigation, capped at ~96 characters — the same fallback
     * `scripts/authoring/make_cards.py` uses on a rule card's front.
     */
    excerpt: bilingualDraft.optional(),
    children: z.array(tocNodeSchema).min(1).optional(),
    /** Every unit under this node, flattened. A leaf carries exactly one. */
    unitIds: z.array(z.string().min(1)),
  }),
)

export const libraryWorkSchema = z.strictObject({
  $schema: z.string().optional(),
  version: semver,
  generatedAt: isoDate,
  id: slug,
  title: bilingual,
  shortTitle: bilingual,
  year: z.number().int().min(1800).max(2100).optional(),
  category: libraryCategorySchema,
  description: bilingual,
  corpus: corpusRefSchema,
  /** What one unit is called here — Rule, Section or Paragraph. */
  unitLabel: bilingual,
  publisher: z.string().min(1),
  tocSource: tocSourceSchema,
  toc: z.array(tocNodeSchema).min(1),
  /** Every unit id in the pointed-at corpus, in document order. */
  readingOrder: z.array(z.string().min(1)).min(1),
  estimatedMinutes: z.number().int().min(1),
  /**
   * Unit id -> how many APPROVED Trainer cards cite it, counted at build time.
   * Empty for a law work; no card in `data/rules` cites a law section.
   *
   * It is in the dataset rather than computed at read time because
   * `data/rules/cards/gfr.json` alone is 1.1 MB, and downloading it to find out
   * whether a rule has anything to practise is the wrong trade for a link in a
   * side rail.
   */
  practiseCounts: z.record(z.string(), z.number().int().min(1)),
  examTags: z.array(slug).min(1),
  officialUrl: url,
  source: librarySourceSchema,
  disclaimer: bilingual,
  /**
   * True wherever any Hindi in this work is authored or curated by this project
   * rather than published — which is every work so far, since no Ministry
   * publishes a Hindi issue of any of these fifteen documents with a readable
   * text layer (ADR-023) and the Sanhitas' Hindi headings are this project's
   * own curation (`data/law/overlays/*-hindi-curated.json`).
   */
  verify: z.boolean().optional(),
})

export const libraryIndexEntrySchema = z.strictObject({
  id: slug,
  title: bilingual,
  shortTitle: bilingual,
  year: z.number().int().min(1800).max(2100).optional(),
  category: libraryCategorySchema,
  description: bilingual,
  unitLabel: bilingual,
  publisher: z.string().min(1),
  corpus: corpusRefSchema,
  tocSource: tocSourceSchema,
  unitCount: z.number().int().min(1),
  estimatedMinutes: z.number().int().min(1),
  examTags: z.array(slug).min(1),
  officialUrl: url,
  source: librarySourceSchema,
  file: z.string().regex(/^works\/[a-z0-9-]+\.json$/),
  verify: z.boolean().optional(),
})

export const libraryIndexSchema = z.strictObject({
  $schema: z.string().optional(),
  version: semver,
  generatedAt: isoDate,
  disclaimer: bilingual,
  totals: z.strictObject({
    works: z.number().int().min(1),
    units: z.number().int().min(1),
    minutes: z.number().int().min(1),
  }),
  works: z.array(libraryIndexEntrySchema).min(1),
})

export type Bilingual = z.infer<typeof bilingual>
export type LibraryCategory = z.infer<typeof libraryCategorySchema>
export type TocSource = z.infer<typeof tocSourceSchema>
export type CorpusRef = z.infer<typeof corpusRefSchema>
export type LibraryWork = z.infer<typeof libraryWorkSchema>
export type LibraryIndexEntry = z.infer<typeof libraryIndexEntrySchema>
export type LibraryIndex = z.infer<typeof libraryIndexSchema>
export type LibrarySource = z.infer<typeof librarySourceSchema>
