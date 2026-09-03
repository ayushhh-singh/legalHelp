import {
  DOC_MODEL_VERSION,
  emptyMeta,
  emptySender,
  emptySignature,
  type Addressee,
  type BodyDoc,
  type BodyNode,
  type DocMeta,
  type OfficialDoc,
  type VarValue,
} from './model'

import type { DraftValues, FieldValue, Lang } from './types'
import type { DocTemplate, TemplateField } from '@/modules/drafting/schema'

/**
 * Every draft written by Sessions 8 through 28, as an `OfficialDoc`.
 *
 * A draft was `Record<fieldId, FieldValue>` and nothing else: the whole
 * document lived in fifteen boxes, and the paragraphs lived in one of them as
 * lines of a textarea. This turns one of those into the new model without
 * losing a character, and the rule it follows is the rule the rest of this
 * session follows:
 *
 * > **Everything the officer typed survives. Nothing is invented.**
 *
 * A field this file recognises goes into `meta` where the new model has a
 * proper home for it. A field it does not recognise goes into `vars` under its
 * own id — which is exactly what the template's layout already interpolates, so
 * the migrated document renders identically. Nothing is dropped, and nothing
 * that was blank becomes filled.
 *
 * Pure: no clock, no Dexie, no id generator. `src/modules/drafting/migrateDrafts.ts`
 * is the half that reads the table, keeps the backup copy and writes the result.
 */

const HOME: Record<string, keyof DocMeta | 'sender' | 'signature' | 'reference' | 'skip'> = {
  fileNumber: 'number',
  date: 'date',
  place: 'place',
  subject: 'subject',
  urgency: 'urgency',
  enclosures: 'enclosures',
  ministry: 'sender',
  department: 'sender',
  phone: 'sender',
  email: 'sender',
  signatoryName: 'signature',
  signatoryDesignation: 'signature',
  reference: 'reference',
  refNumber: 'reference',
  refDate: 'reference',
  addressee: 'to',
  addresseeName: 'to',
  copyTo: 'copyTo',
}

const asText = (value: string | string[]): string => (Array.isArray(value) ? value.join('\n') : value)

const bothOf = (value: FieldValue | undefined): { en: string; hi: string } => {
  if (value === undefined) return { en: '', hi: '' }
  if (typeof value === 'string') return { en: value, hi: value }
  if (Array.isArray(value)) return { en: value.join('\n'), hi: value.join('\n') }
  const en = value.en === undefined ? '' : asText(value.en)
  const hi = value.hi === undefined ? '' : asText(value.hi)
  // A value typed in one language only is still the officer's value — the same
  // fall-through `valueFor` in the engine has always done.
  return { en: en || hi, hi: hi || en }
}

const listOf = (value: FieldValue | undefined, lang: Lang): string[] => {
  if (value === undefined) return []
  const raw =
    typeof value === 'object' && !Array.isArray(value) ? (value[lang] ?? value.en ?? value.hi) : value
  if (raw === undefined) return []
  return (Array.isArray(raw) ? raw : raw.split('\n')).map((line) => line.trim()).filter(Boolean)
}

const oneOf = (value: FieldValue | undefined, lang: Lang): string => {
  const both = bothOf(value)
  return lang === 'hi' ? both.hi : both.en
}

/**
 * The addressee block, back into structured people.
 *
 * The old form held it as free text — three or four lines an officer typed into
 * one box — and there is no honest way to say which line was the designation.
 * So the WHOLE block becomes one `Addressee` whose `name` carries the first
 * line and whose `address` carries the rest, and the document renders exactly
 * as it did. Guessing at the split would put "Department of Personnel and
 * Training" in a designation field on a document already sent.
 */
function addresseeFrom(value: FieldValue | undefined, id: string): Addressee[] {
  const en = listOf(value, 'en')
  const hi = listOf(value, 'hi')
  if (en.length === 0 && hi.length === 0) return []
  return [
    {
      id,
      bookId: null,
      name: { en: en[0] ?? '', hi: hi[0] ?? en[0] ?? '' },
      designation: { en: '', hi: '' },
      organisation: { en: '', hi: '' },
      address: en.slice(1),
      phone: '',
      email: '',
    },
  ]
}

const copyToFrom = (value: FieldValue | undefined): Addressee[] =>
  listOf(value, 'en').map((line, index) => ({
    id: `copy-${index + 1}`,
    bookId: null,
    name: { en: line, hi: listOf(value, 'hi')[index] ?? line },
    designation: { en: '', hi: '' },
    organisation: { en: '', hi: '' },
    address: [],
    phone: '',
    email: '',
  }))

const URGENCIES = new Set(['none', 'immediate', 'priority', 'topPriority'])

/** The body field, as an editor document. One paragraph per line, numbered. */
export function paragraphsToBody(paras: readonly string[]): BodyDoc {
  const content: BodyNode[] = paras
    .filter((para) => para.trim().length > 0)
    .map((para) => ({
      // Every migrated paragraph is a `numberedPara`. The old model had exactly
      // one kind of paragraph and the layout numbered it (`numberFrom`), so a
      // migrated document that used `paragraph` would silently stop being
      // numbered — which is the one visible difference a migration must not
      // introduce.
      type: 'numberedPara' as const,
      attrs: { level: 1 },
      content: [{ type: 'text' as const, text: para }],
    }))
  return { type: 'doc', content: content.length > 0 ? content : [{ type: 'paragraph' }] }
}

export interface MigrationResult {
  doc: OfficialDoc
  /** Field ids that had a value and no structured home — they are in `vars`. */
  keptAsVars: string[]
  /** Field ids the template no longer defines. Kept in `vars` too, never dropped. */
  unknownFields: string[]
}

/**
 * One draft row's values, as an `OfficialDoc`.
 *
 * `id`, `createdAt` and `updatedAt` come from the row rather than from a clock,
 * so a migration run twice produces the same document — which is what makes the
 * backup copy worth keeping and the migration worth re-running.
 */
export function migrateDraft(args: {
  id: string
  templateId: string
  title: string
  values: DraftValues
  createdAt: string
  updatedAt: string
  template: DocTemplate
  /** The language the draft is treated as authored in. Both halves survive either way. */
  lang?: OfficialDoc['lang']
}): MigrationResult {
  const { template, values } = args
  const meta = emptyMeta()
  meta.from = emptySender()
  meta.signature = emptySignature()

  const vars: Record<string, VarValue> = {}
  const keptAsVars: string[] = []
  const unknownFields: string[] = []
  const known = new Set(template.fields.map((field) => field.id))

  const bodyField = template.layout.en.find((block) => block.role === 'body' && block.source)?.source ?? null

  const referenceParts: { number: string; date: string; text: string } = { number: '', date: '', text: '' }

  const place = (field: TemplateField | { id: string }, value: FieldValue | undefined): void => {
    const id = field.id
    if (id === bodyField) return
    const home = HOME[id]

    switch (home) {
      case 'number':
        meta.number = oneOf(value, 'en')
        return
      case 'date':
        meta.date = oneOf(value, 'en')
        return
      case 'place':
        meta.place = oneOf(value, 'en')
        return
      case 'subject':
        meta.subject = bothOf(value)
        return
      case 'urgency': {
        const raw = oneOf(value, 'en').trim()
        meta.urgency = URGENCIES.has(raw) ? (raw as DocMeta['urgency']) : 'none'
        return
      }
      case 'enclosures':
        meta.enclosures = listOf(value, 'en')
        return
      case 'to':
        if (meta.to.length === 0) meta.to = addresseeFrom(value, 'to-1')
        else vars[id] = oneOf(value, 'en')
        return
      case 'copyTo':
        meta.copyTo = copyToFrom(value)
        return
      case 'sender': {
        const both = bothOf(value)
        if (id === 'ministry') meta.from.ministry = both
        else if (id === 'department') meta.from.department = both
        else if (id === 'phone') {
          meta.from.phone = both.en
          meta.signature.phone = both.en
        } else if (id === 'email') {
          meta.from.email = both.en
          meta.signature.email = both.en
        }
        return
      }
      case 'signature': {
        const both = bothOf(value)
        if (id === 'signatoryName') {
          meta.signature.name = both
          meta.from.name = both
        } else {
          meta.signature.designation = both
          meta.from.designation = both
        }
        return
      }
      case 'reference': {
        const text = oneOf(value, 'en')
        if (id === 'refNumber') referenceParts.number = text
        else if (id === 'refDate') referenceParts.date = text
        else referenceParts.text = text
        return
      }
      default: {
        // No structured home. It keeps its own id in `vars`, which is what the
        // template's layout already interpolates — so the migrated document
        // renders character for character as it did.
        const raw = values[id]
        if (raw === undefined) return
        const both = bothOf(raw)
        vars[id] = both.en === both.hi ? both.en : both
        keptAsVars.push(id)
      }
    }
  }

  for (const field of template.fields) place(field, values[field.id])

  // A value under an id the template no longer defines is still the officer's
  // typing. It is kept in `vars` rather than dropped, for the reason `asDraft`
  // gives: a half-restored document is worse than one nobody touched.
  for (const [id, value] of Object.entries(values)) {
    if (known.has(id) || id === bodyField || value === undefined) continue
    unknownFields.push(id)
    const both = bothOf(value)
    vars[id] = both.en === both.hi ? both.en : both
  }

  if (referenceParts.number || referenceParts.date || referenceParts.text) {
    meta.referenceLines = [
      {
        id: 'ref-1',
        number: referenceParts.number || referenceParts.text,
        date: referenceParts.date,
      },
    ]
  }

  const raw = bodyField ? values[bodyField] : undefined
  const body = paragraphsToBody(listOf(raw, 'en'))
  const hiParas = listOf(raw, 'hi')
  const bodyHi = paragraphsToBody(hiParas)
  // A `bodyHi` identical to `body` is not a bilingual document — it is one
  // document the officer never separated, and storing the copy would make the
  // next edit silently diverge the two halves.
  const separate = JSON.stringify(body) !== JSON.stringify(bodyHi)

  const doc: OfficialDoc = {
    id: args.id,
    docModelVersion: DOC_MODEL_VERSION,
    type: args.templateId,
    templateId: args.templateId,
    lang: args.lang ?? (separate ? 'bilingual' : 'en'),
    meta,
    body,
    ...(separate ? { bodyHi } : {}),
    vars,
    status: 'draft',
    tags: [],
    title: args.title,
    createdAt: args.createdAt,
    updatedAt: args.updatedAt,
  }

  return { doc, keptAsVars, unknownFields }
}
