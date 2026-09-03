import { z } from 'zod'

/**
 * The document model — what an officer's document actually is, once it stopped
 * being fifteen boxes on a form.
 *
 * Sessions 8 and 21 stored a draft as `Record<fieldId, FieldValue>`, and every
 * paragraph of every document was a line in one textarea. That is fine for a
 * leave application and impossible for a note on a file: no heading, no table,
 * no quoted rule, no sub-paragraph. This file is the replacement, and it is the
 * deliverable of this session rather than the toolbar above it — Sessions 30
 * and 31 build print, `.docx` and an issue register on top of it.
 *
 * Four rules hold the whole thing together, and each is enforced rather than
 * described:
 *
 * 1. **The body is editor JSON and the vocabulary is ours.** `bodySchema`
 *    enumerates every node type a stored body may contain. Tiptap emits it and
 *    Tiptap reads it back, but a Tiptap release that starts emitting a node
 *    this file has never heard of fails a test rather than landing an
 *    unreadable row on somebody's phone.
 *
 * 2. **Nothing downstream of the editor imports Tiptap.** This file, the
 *    renderer, the lint and the migration read the body as plain data.
 *    `purity.test.ts` reads the source and fails on an `@tiptap/` import
 *    anywhere under `src/lib/drafting/`.
 *
 * 3. **`docModelVersion` travels with the document.** `upgradeDoc` raises an
 *    older one on read; a document written by a NEWER build than this one is
 *    refused rather than half-read, which is the rule `asDraft` already states
 *    for a draft row — a half-restored document is worse than none.
 *
 * 4. **`meta` is chrome and `vars` is bindings.** The number, the date, the
 *    subject, the addressees, the enclosures and the signature are things every
 *    official document has. A `sanctionAmount` or a `leaveKind` is a variable of
 *    one template's skeleton and has no business widening the meta of every
 *    other form. `bindings()` is the one function that merges them, so "what is
 *    `subject` worth here" has exactly one answer.
 */

/**
 * `{ en, hi }`.
 *
 * Declared here rather than imported from `@/modules/drafting/schema`, and
 * deliberately: that module imports `bodySchema` from THIS one for the
 * template's `bodySkeleton`, and a zod schema that participates in an import
 * cycle is initialised as `undefined` at the wrong moment in a way no type
 * error catches. The structure is identical, so the two are interchangeable
 * wherever either is used.
 */
export interface Bilingual {
  en: string
  hi: string
}

// ---------------------------------------------------------------- version

/**
 * The model version stamped on every document this build writes.
 *
 * Bump it in the same commit as any change to `officialDocSchema` that an
 * existing stored document would not satisfy, and add the upgrade step to
 * `upgradeDoc`. `purity.test.ts` asserts this constant is named in exactly one
 * file, so a second copy cannot drift.
 */
export const DOC_MODEL_VERSION = 1

// ------------------------------------------------------------------ body

/**
 * Every node type a stored body may contain.
 *
 * `pageBreak` and `placeholder` are this app's own; the rest are Tiptap's
 * starter kit and table extension under their standard names. `text` carries
 * marks, which is why it is here rather than being implied.
 */
export const BODY_NODES = [
  'doc',
  'paragraph',
  'numberedPara',
  'heading',
  'bulletList',
  'orderedList',
  'listItem',
  'blockquote',
  'table',
  'tableRow',
  'tableCell',
  'tableHeader',
  'pageBreak',
  'placeholder',
  'hardBreak',
  'text',
] as const

export type BodyNodeType = (typeof BODY_NODES)[number]

/** The marks a run of text may carry. Nothing decorative — this is a document. */
export const BODY_MARKS = ['bold', 'italic', 'underline'] as const
export type BodyMark = (typeof BODY_MARKS)[number]

const markSchema = z.object({ type: z.enum(BODY_MARKS) }).loose()

/**
 * A body node. Recursive, and deliberately `loose()` on attributes: Tiptap
 * attaches its own bookkeeping (`colspan`, `colwidth`, `textAlign`) and
 * refusing a key we do not read would make every Tiptap point release a
 * migration. The TYPE is strict, which is the half that matters — an unknown
 * node is content this app cannot render, print or lint.
 */
export interface BodyNode {
  type: BodyNodeType
  attrs?: Record<string, unknown>
  content?: BodyNode[]
  marks?: { type: BodyMark }[]
  text?: string
}

export const bodyNodeSchema: z.ZodType<BodyNode> = z.lazy(() =>
  z.object({
    type: z.enum(BODY_NODES),
    attrs: z.record(z.string(), z.unknown()).optional(),
    content: z.array(bodyNodeSchema).optional(),
    marks: z.array(markSchema).optional(),
    text: z.string().optional(),
  }),
)

/** The root. Always `doc`; the editor produces nothing else at the top. */
export const bodySchema = z.object({
  type: z.literal('doc'),
  content: z.array(bodyNodeSchema).default([]),
})

export type BodyDoc = z.infer<typeof bodySchema>

/** An empty body — one paragraph, so the editor has a caret to put somewhere. */
export const emptyBody = (): BodyDoc => ({ type: 'doc', content: [{ type: 'paragraph' }] })

// ------------------------------------------------------------------ meta

const bilingualSchema = z.object({ en: z.string(), hi: z.string() })

export const URGENCIES = ['none', 'immediate', 'priority', 'topPriority'] as const
export type Urgency = (typeof URGENCIES)[number]

/**
 * Somebody a document is addressed to, or copied to.
 *
 * Every field is bilingual because an addressee's designation genuinely differs
 * between the two issues of a document — "Under Secretary" and "अवर सचिव" — and
 * because this is the one place an officer types a name they will type again.
 *
 * `bookId` points at an `addressBook` row and is a CONVENIENCE, never the source
 * of what prints. Deleting an addressee must leave every document that named
 * them intact; a document already issued has to render tomorrow exactly as it
 * rendered the day it went out. So the document holds a snapshot and the id
 * only lets a live row be offered.
 */
export const addresseeSchema = z.object({
  id: z.string(),
  bookId: z.string().nullable().default(null),
  name: bilingualSchema,
  designation: bilingualSchema,
  organisation: bilingualSchema,
  address: z.array(z.string()).default([]),
  phone: z.string().default(''),
  email: z.string().default(''),
})

export type Addressee = z.infer<typeof addresseeSchema>

/**
 * Who the document is from, snapshotted off the profile when it was created.
 *
 * A snapshot rather than a reference, for the reason ADR-041 §5 gives: an
 * officer promoted in March does not want February's minutes re-signed with the
 * new designation.
 */
export const senderSchema = z.object({
  name: bilingualSchema,
  designation: bilingualSchema,
  office: bilingualSchema,
  ministry: bilingualSchema,
  department: bilingualSchema,
  address: z.array(z.string()).default([]),
  phone: z.string().default(''),
  email: z.string().default(''),
  /** Up to four lines, printed above the document. The profile's own copy. */
  letterhead: z.array(bilingualSchema).default([]),
})

export type Sender = z.infer<typeof senderSchema>

/**
 * The signature block, as it prints.
 *
 * `layout` is where it sits on the page: CSMOP's specimens put it on the right
 * for a letter and an O.M. and on the left for a note (7.3(xi)). `showSd`
 * prints `-Sd/-` above the name, which a fair copy carries and a draft
 * for approval does not.
 */
export const signatureSchema = z.object({
  name: bilingualSchema,
  designation: bilingualSchema,
  layout: z.enum(['right', 'left', 'centre']).default('right'),
  showSd: z.boolean().default(true),
  phone: z.string().default(''),
  email: z.string().default(''),
})

export type SignatureBlock = z.infer<typeof signatureSchema>

/**
 * A previous communication in the series.
 *
 * CSMOP 9.2(iv) requires the number and date of the last communication to be
 * quoted, and a series of them to go in the margin. A reference line "resolves"
 * when it has both — `lintDocument` reports one that has neither, because a
 * dangling "your letter of even number" is what makes a file unfollowable.
 */
export const referenceLineSchema = z.object({
  id: z.string(),
  number: z.string().default(''),
  date: z.string().default(''),
  label: bilingualSchema.optional(),
})

export type ReferenceLine = z.infer<typeof referenceLineSchema>

export const docMetaSchema = z.object({
  number: z.string().default(''),
  date: z.string().default(''),
  subject: bilingualSchema,
  urgency: z.enum(URGENCIES).default('none'),
  from: senderSchema,
  to: z.array(addresseeSchema).default([]),
  copyTo: z.array(addresseeSchema).default([]),
  enclosures: z.array(z.string()).default([]),
  signature: signatureSchema,
  referenceLines: z.array(referenceLineSchema).default([]),
  /**
   * The document is deliberately dated ahead. `lintDocument` reports a future
   * date as an error unless this is set, and then says so as a hint instead —
   * an ante-dated order is a real thing and a typo in the year is commoner.
   */
  futureDateIntended: z.boolean().default(false),
  place: z.string().default(''),
})

export type DocMeta = z.infer<typeof docMetaSchema>

// -------------------------------------------------------------- variables

/** What one template variable is worth. A list for `enclosures`/`copyTo` kinds. */
export const varValueSchema = z.union([z.string(), z.array(z.string()), bilingualSchema])
export type VarValue = z.infer<typeof varValueSchema>

// -------------------------------------------------------------- the document

export const DOC_STATUSES = ['draft', 'final', 'sent'] as const
export type DocStatus = (typeof DOC_STATUSES)[number]

export const officialDocSchema = z.object({
  id: z.string().min(1),
  docModelVersion: z.number().int().min(1),
  /** The template id. `templateId` is its alias; both are stored, see below. */
  type: z.string().min(1),
  templateId: z.string().min(1),
  lang: z.enum(['en', 'hi', 'bilingual']),
  meta: docMetaSchema,
  body: bodySchema,
  bodyHi: bodySchema.optional(),
  /** Template variable bindings — see ADR-041 §4 for why these are not in meta. */
  vars: z.record(z.string(), varValueSchema).default({}),
  status: z.enum(DOC_STATUSES).default('draft'),
  tags: z.array(z.string()).default([]),
  title: z.string().default(''),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** Set when a personal template produced this document. */
  personalTemplateId: z.string().optional(),
  /** Session 31: the inbound paper this document answers. */
  linkedIntakeId: z.string().optional(),
  /** Session 31: the correspondence thread this document belongs to. */
  threadId: z.string().optional(),
  /** Stamped by `issueNumber`; absent until the number is issued. */
  issuedAt: z.string().optional(),
})

export type OfficialDoc = z.infer<typeof officialDocSchema>

// ---------------------------------------------------------------- defaults

export const emptyBilingual = (): Bilingual => ({ en: '', hi: '' })

export function emptySender(): Sender {
  return {
    name: emptyBilingual(),
    designation: emptyBilingual(),
    office: emptyBilingual(),
    ministry: emptyBilingual(),
    department: emptyBilingual(),
    address: [],
    phone: '',
    email: '',
    letterhead: [],
  }
}

export function emptySignature(): SignatureBlock {
  return {
    name: emptyBilingual(),
    designation: emptyBilingual(),
    layout: 'right',
    showSd: true,
    phone: '',
    email: '',
  }
}

export function emptyMeta(): DocMeta {
  return {
    number: '',
    date: '',
    subject: emptyBilingual(),
    urgency: 'none',
    from: emptySender(),
    to: [],
    copyTo: [],
    enclosures: [],
    signature: emptySignature(),
    referenceLines: [],
    futureDateIntended: false,
    place: '',
  }
}

/**
 * A blank document of a type.
 *
 * `id`, `createdAt` and `updatedAt` are arguments rather than generated here,
 * because this file is pure — it has no clock and no `crypto` (`purity.test.ts`
 * asserts both). The caller has a clock; it just showed the officer a screen.
 */
export function newDoc(args: {
  id: string
  templateId: string
  lang: OfficialDoc['lang']
  at: string
  meta?: Partial<DocMeta>
  body?: BodyDoc
  bodyHi?: BodyDoc
  vars?: Record<string, VarValue>
  title?: string
}): OfficialDoc {
  return {
    id: args.id,
    docModelVersion: DOC_MODEL_VERSION,
    type: args.templateId,
    templateId: args.templateId,
    lang: args.lang,
    meta: { ...emptyMeta(), ...args.meta },
    body: args.body ?? emptyBody(),
    ...(args.bodyHi ? { bodyHi: args.bodyHi } : {}),
    vars: args.vars ?? {},
    status: 'draft',
    tags: [],
    title: args.title ?? '',
    createdAt: args.at,
    updatedAt: args.at,
  }
}

// ---------------------------------------------------------------- upgrade

export type DocReadResult =
  | { ok: true; doc: OfficialDoc; upgraded: boolean }
  | { ok: false; reason: 'malformed' | 'too-new'; storedVersion?: number }

/**
 * Read a stored document, believing it only as far as it can be checked.
 *
 * Three outcomes rather than two, and the third is the one that matters. A
 * document written by a LATER build carries node types and meta keys this build
 * cannot render, and rendering it half-read would show an officer a document
 * missing paragraphs with nothing on screen saying so. It is refused, and the
 * caller says "this document was written by a newer version of the app" — which
 * an officer can act on, unlike a silently shortened page.
 */
export function readDoc(raw: unknown): DocReadResult {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'malformed' }
  const version = (raw as { docModelVersion?: unknown }).docModelVersion
  if (typeof version === 'number' && version > DOC_MODEL_VERSION) {
    return { ok: false, reason: 'too-new', storedVersion: version }
  }
  const upgradedRaw = upgradeDoc(raw)
  const parsed = officialDocSchema.safeParse(upgradedRaw)
  if (!parsed.success) return { ok: false, reason: 'malformed' }
  return {
    ok: true,
    doc: { ...parsed.data, docModelVersion: DOC_MODEL_VERSION },
    upgraded: version !== DOC_MODEL_VERSION,
  }
}

/**
 * Raise an older stored shape to the current one.
 *
 * There is one version, so this only fills in what an unversioned row would
 * lack. It is here now rather than when it is first needed because the shape of
 * the upgrade path is what makes storing vendor JSON safe, and a migration
 * function written after the first breaking change is a migration function
 * written against rows that already exist.
 */
export function upgradeDoc(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw
  const doc = { ...(raw as Record<string, unknown>) }
  if (typeof doc.docModelVersion !== 'number') doc.docModelVersion = 1
  // `type` and `templateId` are the same value under two names — the session
  // brief names both, and a document missing either is one no lookup finds.
  if (typeof doc.templateId !== 'string' && typeof doc.type === 'string') doc.templateId = doc.type
  if (typeof doc.type !== 'string' && typeof doc.templateId === 'string') doc.type = doc.templateId
  return doc
}

// --------------------------------------------------------------- bindings

/** One language of a bilingual value, falling through to the other side. */
export const pick = (value: Bilingual, lang: 'en' | 'hi'): string =>
  value[lang] || value[lang === 'en' ? 'hi' : 'en'] || ''

const addresseeLines = (person: Addressee, lang: 'en' | 'hi'): string[] =>
  [
    pick(person.name, lang),
    pick(person.designation, lang),
    pick(person.organisation, lang),
    ...person.address,
  ].filter((line) => line.trim().length > 0)

/**
 * Every name a placeholder, a condition, a repeater or a legacy layout block
 * may refer to, resolved into this language.
 *
 * This is the single resolution point ADR-041 §4 describes. Meta-derived
 * built-ins are computed first and `vars` is layered over them, so a template
 * that genuinely wants its own `subject` variable can have one — and so that
 * the fourteen templates written before this model existed, whose layouts
 * interpolate `{{subject}}` and `{{fileNumber}}`, keep rendering with no change
 * to their data at all.
 *
 * The keys are deliberately the ids the old templates already use
 * (`fileNumber`, `subject`, `signatoryName`), because that compatibility is
 * what lets one renderer serve both.
 */
export function bindings(doc: OfficialDoc, lang: 'en' | 'hi'): Record<string, string | string[]> {
  const { meta } = doc
  const out: Record<string, string | string[]> = {
    fileNumber: meta.number,
    number: meta.number,
    date: meta.date,
    place: meta.place,
    subject: pick(meta.subject, lang),
    urgency: meta.urgency,
    ministry: pick(meta.from.ministry, lang),
    department: pick(meta.from.department, lang),
    office: pick(meta.from.office, lang),
    senderName: pick(meta.from.name, lang),
    senderDesignation: pick(meta.from.designation, lang),
    senderPhone: meta.from.phone,
    senderEmail: meta.from.email,
    signatoryName: pick(meta.signature.name, lang),
    signatoryDesignation: pick(meta.signature.designation, lang),
    telephone: meta.signature.phone || meta.from.phone,
    phone: meta.signature.phone || meta.from.phone,
    email: meta.signature.email || meta.from.email,
    addressee: meta.to.flatMap((person) => addresseeLines(person, lang)),
    addresseeName: meta.to[0] ? pick(meta.to[0].name, lang) : '',
    addresseeDesignation: meta.to[0] ? pick(meta.to[0].designation, lang) : '',
    copyTo: meta.copyTo.flatMap((person) => [
      [pick(person.designation, lang), pick(person.organisation, lang)].filter(Boolean).join(', ') ||
        pick(person.name, lang),
    ]),
    enclosures: meta.enclosures,
    reference: meta.referenceLines[0]
      ? [meta.referenceLines[0].number, meta.referenceLines[0].date].filter(Boolean).join(' dated ')
      : '',
    refNumber: meta.referenceLines[0]?.number ?? '',
    refDate: meta.referenceLines[0]?.date ?? '',
    references: meta.referenceLines
      .map((line) => [line.number, line.date].filter(Boolean).join(', '))
      .filter(Boolean),
  }

  for (const [key, value] of Object.entries(doc.vars)) {
    out[key] = typeof value === 'object' && !Array.isArray(value) ? pick(value, lang) : value
  }
  return out
}

/** True when a binding has nothing in it — the test a `{{#if}}` runs. */
export const isBlank = (value: string | string[] | undefined): boolean =>
  value === undefined || (Array.isArray(value) ? value.length === 0 : value.trim().length === 0)

// ------------------------------------------------------------ body walking

/** Every node in a body, depth first, including the root. */
export function* walkBody(node: BodyNode): Generator<BodyNode> {
  yield node
  for (const child of node.content ?? []) yield* walkBody(child)
}

/** Every placeholder field named anywhere in a body, in document order. */
export function placeholderFields(body: BodyDoc): string[] {
  const out: string[] = []
  for (const node of walkBody(body)) {
    if (node.type !== 'placeholder') continue
    const field = node.attrs?.field
    if (typeof field === 'string' && field) out.push(field)
  }
  return out
}
