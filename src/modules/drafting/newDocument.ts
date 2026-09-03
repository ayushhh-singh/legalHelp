import { db } from '@/db'
import { instantiate } from '@/lib/drafting/skeleton'
import {
  DOC_MODEL_VERSION,
  emptyMeta,
  newDoc,
  type BodyDoc,
  type OfficialDoc,
  type VarValue,
} from '@/lib/drafting/model'
import {
  addresseeFromEntry,
  profileDefault,
  senderFromProfile,
  signatureFromProfile,
} from '@/lib/drafting/profile'
import type { PersonalTemplate } from '@/lib/drafting/personal'
import type { DraftingProfile } from '@/lib/drafting/profile'

import { docId } from './documents'
import type { DocTemplate } from './schema'

/**
 * A new document from a form.
 *
 * The order here is the whole of it, and every step is a copy rather than a
 * reference (ADR-041 §5):
 *
 * 1. **The profile is snapshotted** into `meta.from` and `meta.signature`.
 * 2. **Each variable takes its default** — from the profile where the template
 *    declares `defaultFrom`, from a personal template's frozen value where
 *    there is one, and otherwise nothing. A variable is NOT seeded from its
 *    `sample`: the sample is the worked example a form ships with, and filling
 *    a document with the specimen's telephone number is the exact failure
 *    `sampleValues` was pulled out of the engine to prevent.
 * 3. **The skeleton is instantiated** against those bindings, so a variable with
 *    a value becomes text and one without becomes a `{{placeholder}}` chip.
 *
 * Pure apart from the id and the clock, both of which are arguments.
 */
export function documentFromTemplate(args: {
  id: string
  at: string
  template: DocTemplate
  profile: DraftingProfile
  personal?: PersonalTemplate | null
  book?: readonly { id: string; name: { en: string; hi: string } }[]
}): OfficialDoc {
  const { template, profile, personal } = args
  const meta = emptyMeta()
  meta.from = senderFromProfile(profile)
  meta.signature = signatureFromProfile(profile)
  meta.place = profile.place
  meta.urgency = profile.defaultUrgency
  meta.date = args.at.slice(0, 10)

  const vars: Record<string, VarValue> = {}
  for (const variable of template.variables ?? []) {
    const frozen = personal?.frozen[variable.key]
    if (frozen !== undefined) {
      vars[variable.key] = frozen
      continue
    }
    if (variable.defaultFrom) {
      const value = profileDefault(profile, variable.defaultFrom)
      if (typeof value === 'string' ? value.trim() : value.en.trim() || value.hi.trim())
        vars[variable.key] = value
    }
  }
  for (const [key, value] of Object.entries(personal?.frozen ?? {})) {
    if (!(key in vars)) vars[key] = value
  }

  const bindings: Record<string, string | string[]> = {}
  for (const [key, value] of Object.entries(vars)) {
    bindings[key] = typeof value === 'object' && !Array.isArray(value) ? value.en || value.hi : value
  }
  const bindingsHi: Record<string, string | string[]> = {}
  for (const [key, value] of Object.entries(vars)) {
    bindingsHi[key] = typeof value === 'object' && !Array.isArray(value) ? value.hi || value.en : value
  }

  const skeleton = personal?.bodySkeleton ?? template.bodySkeleton
  const blank: BodyDoc = { type: 'doc', content: [{ type: 'paragraph' }] }
  const body: BodyDoc = skeleton ? instantiate(skeleton.en, bindings).body : blank
  const bodyHi: BodyDoc = skeleton ? instantiate(skeleton.hi, bindingsHi).body : blank

  const doc = newDoc({
    id: args.id,
    templateId: template.id,
    lang: profile.defaultLanguage,
    at: args.at,
    meta,
    body,
    bodyHi,
    vars,
    title: '',
  })
  return {
    ...doc,
    docModelVersion: DOC_MODEL_VERSION,
    ...(personal ? { personalTemplateId: personal.id } : {}),
  }
}

/** Create the document, write it, and hand back its id for the route. */
export async function createDocument(args: {
  template: DocTemplate
  profile: DraftingProfile
  personal?: PersonalTemplate | null
}): Promise<OfficialDoc> {
  const at = new Date().toISOString()
  const book = await db.addressBook.toArray()
  const doc = documentFromTemplate({
    id: docId(),
    at,
    template: args.template,
    profile: args.profile,
    personal: args.personal ?? null,
    book: book as unknown as { id: string; name: { en: string; hi: string } }[],
  })

  // The profile's default copy-to list is copied in as real addressees, then
  // owned by the document. An id-only reference would make deleting an entry
  // change a document that had already been written.
  const wanted = new Set(args.profile.defaultCopyTo)
  const copyTo = book
    .filter((entry) => wanted.has(entry.id))
    .map((entry, index) =>
      addresseeFromEntry(entry as unknown as Parameters<typeof addresseeFromEntry>[0], `copy-${index + 1}`),
    )

  const withCopies: OfficialDoc = copyTo.length > 0 ? { ...doc, meta: { ...doc.meta, copyTo } } : doc
  await db.documents.put({
    id: withCopies.id,
    templateId: withCopies.templateId,
    title: withCopies.title,
    status: withCopies.status,
    createdAt: withCopies.createdAt,
    updatedAt: withCopies.updatedAt,
    doc: withCopies,
  })
  return withCopies
}
