import { z } from 'zod'

import { emptyBilingual, type Addressee, type Bilingual, type Sender, type SignatureBlock } from './model'

/**
 * The officer's drafting profile — the letterhead, the signature block and the
 * defaults every new document starts from.
 *
 * One rule governs the whole file and it is ADR-041 §5: **a profile change
 * never rewrites a document that already exists.** `meta.from` and
 * `meta.signature` on an `OfficialDoc` are SNAPSHOTS taken when the document
 * was created. An officer promoted in March does not want February's minutes
 * re-signed with the new designation, and a document already issued has to
 * render tomorrow exactly as it rendered the day it went out.
 *
 * So this file has two halves and they never cross: `senderFromProfile` and
 * `signatureFromProfile` COPY out of the profile at creation time, and nothing
 * anywhere reads the profile while rendering.
 */

const bilingualSchema = z.object({ en: z.string(), hi: z.string() })

/*
  There is deliberately no `dateFormat` on the profile.

  It was here, with a select in the profile screen offering three formats, and
  nothing anywhere read it — an edge-case pass found it. Removed rather than
  implemented, because there is nothing for it to decide: CSMOP's specimens
  print dd.mm.yyyy and `format.ts#formatDate` produces exactly that, and the
  one real variation — Devanagari numerals — is already a global setting
  (`SETTING_KEYS.devanagariDigits`, wired through `RenderOptions`). A second
  control for the same thing is a second answer.
*/

export const draftingProfileSchema = z.object({
  id: z.literal('profile'),
  name: bilingualSchema,
  designation: bilingualSchema,
  office: bilingualSchema,
  section: bilingualSchema,
  ministry: bilingualSchema,
  department: bilingualSchema,
  addressLines: z.array(z.string()).default([]),
  phone: z.string().default(''),
  email: z.string().default(''),
  /** Up to four bilingual lines printed above the document. */
  letterhead: z.array(bilingualSchema).max(4).default([]),
  place: z.string().default(''),
  defaultUrgency: z.enum(['none', 'immediate', 'priority', 'topPriority']).default('none'),
  /** Addressee ids from the address book. Copied into a new document, then owned by it. */
  defaultCopyTo: z.array(z.string()).default([]),
  signatureLayout: z.enum(['right', 'left', 'centre']).default('right'),
  signatureShowSd: z.boolean().default(true),
  defaultLanguage: z.enum(['en', 'hi', 'bilingual']).default('en'),
  updatedAt: z.string(),
})

export type DraftingProfile = z.infer<typeof draftingProfileSchema>

export function emptyProfile(at: string): DraftingProfile {
  return {
    id: 'profile',
    name: emptyBilingual(),
    designation: emptyBilingual(),
    office: emptyBilingual(),
    section: emptyBilingual(),
    ministry: emptyBilingual(),
    department: emptyBilingual(),
    addressLines: [],
    phone: '',
    email: '',
    letterhead: [],
    place: '',
    defaultUrgency: 'none',
    defaultCopyTo: [],
    signatureLayout: 'right',
    signatureShowSd: true,
    defaultLanguage: 'en',
    updatedAt: at,
  }
}

/** The `meta.from` snapshot a new document takes. */
export function senderFromProfile(profile: DraftingProfile): Sender {
  return {
    name: profile.name,
    designation: profile.designation,
    office: profile.office,
    ministry: profile.ministry,
    department: profile.department,
    address: [...profile.addressLines],
    phone: profile.phone,
    email: profile.email,
    letterhead: profile.letterhead.map((line) => ({ ...line })),
  }
}

/** The `meta.signature` snapshot a new document takes. */
export function signatureFromProfile(profile: DraftingProfile): SignatureBlock {
  return {
    name: profile.name,
    designation: profile.designation,
    layout: profile.signatureLayout,
    showSd: profile.signatureShowSd,
    phone: profile.phone,
    email: profile.email,
  }
}

/**
 * What a template variable declaring `defaultFrom` starts as.
 *
 * Returns the bilingual pair, not one language: a variable's value is stored as
 * a `{ en, hi }` pair whenever the two differ, exactly as a field's is.
 */
export function profileDefault(
  profile: DraftingProfile,
  key: NonNullable<VariableDefaultKey>,
): Bilingual | string {
  switch (key) {
    case 'name':
      return profile.name
    case 'designation':
      return profile.designation
    case 'office':
      return profile.office
    case 'ministry':
      return profile.ministry
    case 'department':
      return profile.department
    case 'phone':
      return profile.phone
    case 'email':
      return profile.email
    case 'place':
      return profile.place
  }
}

export type VariableDefaultKey =
  'name' | 'designation' | 'office' | 'ministry' | 'department' | 'phone' | 'email' | 'place'

// ------------------------------------------------------------- address book

export const addressBookEntrySchema = z.object({
  id: z.string().min(1),
  name: bilingualSchema,
  designation: bilingualSchema,
  organisation: bilingualSchema,
  address: z.array(z.string()).default([]),
  phone: z.string().default(''),
  email: z.string().default(''),
  tags: z.array(z.string()).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type AddressBookEntry = z.infer<typeof addressBookEntrySchema>

/**
 * An address-book row, as a document's addressee.
 *
 * `bookId` carries the row's id so a live entry can still be OFFERED, and every
 * other member is a copy. Deleting the entry leaves this addressee — and every
 * document that named them — exactly as it was, which is the point.
 */
export function addresseeFromEntry(entry: AddressBookEntry, id: string): Addressee {
  return {
    id,
    bookId: entry.id,
    name: { ...entry.name },
    designation: { ...entry.designation },
    organisation: { ...entry.organisation },
    address: [...entry.address],
    phone: entry.phone,
    email: entry.email,
  }
}

/** The reverse — "add this addressee to my address book". */
export function entryFromAddressee(person: Addressee, id: string, at: string): AddressBookEntry {
  return {
    id,
    name: { ...person.name },
    designation: { ...person.designation },
    organisation: { ...person.organisation },
    address: [...person.address],
    phone: person.phone,
    email: person.email,
    tags: [],
    createdAt: at,
    updatedAt: at,
  }
}

/** Everything a search box over the address book should match on. */
export const searchTextOf = (entry: AddressBookEntry): string =>
  [
    entry.name.en,
    entry.name.hi,
    entry.designation.en,
    entry.designation.hi,
    entry.organisation.en,
    entry.organisation.hi,
    ...entry.address,
    entry.email,
    ...entry.tags,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
