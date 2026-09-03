import { db } from '@/db'
import {
  addressBookEntrySchema,
  draftingProfileSchema,
  emptyProfile,
  searchTextOf,
  type AddressBookEntry,
  type DraftingProfile,
} from '@/lib/drafting/profile'

import { docId } from './documents'

/**
 * The drafting profile and the address book, on the device.
 *
 * Both are read through their zod schemas on the way out, for the reason
 * `asDraft` gives: a row written by an older release, or by a release that has
 * not been written yet, is untrusted input. A profile that will not parse falls
 * back to a blank one rather than half-filling a letterhead.
 */

const now = () => new Date().toISOString()

export async function readProfile(): Promise<DraftingProfile> {
  const row = await db.draftingProfile.get('profile')
  if (!row) return emptyProfile(now())
  const parsed = draftingProfileSchema.safeParse(row)
  return parsed.success ? parsed.data : emptyProfile(now())
}

export async function saveProfile(profile: DraftingProfile): Promise<DraftingProfile> {
  const next = { ...profile, id: 'profile' as const, updatedAt: now() }
  await db.draftingProfile.put(next)
  return next
}

/** True once the officer has told us who they are — what gates the "set up your profile" nudge. */
export const profileIsSet = (profile: DraftingProfile): boolean =>
  Boolean(profile.name.en.trim() || profile.name.hi.trim())

// ------------------------------------------------------------- address book

export async function listAddressees(): Promise<AddressBookEntry[]> {
  const rows = await db.addressBook.toArray()
  return rows
    .map((row) => addressBookEntrySchema.safeParse(row))
    .filter((parsed) => parsed.success)
    .map((parsed) => parsed.data)
    .sort((a, b) => (a.name.en || a.name.hi).localeCompare(b.name.en || b.name.hi, 'en'))
}

export async function putAddressee(entry: AddressBookEntry): Promise<AddressBookEntry> {
  const existing = await db.addressBook.get(entry.id)
  const next = { ...entry, createdAt: (existing?.createdAt as string) ?? entry.createdAt, updatedAt: now() }
  await db.addressBook.put(next)
  return next
}

export function newAddressee(at = now()): AddressBookEntry {
  return {
    id: `ab-${docId().slice(0, 8)}`,
    name: { en: '', hi: '' },
    designation: { en: '', hi: '' },
    organisation: { en: '', hi: '' },
    address: [],
    phone: '',
    email: '',
    tags: [],
    createdAt: at,
    updatedAt: at,
  }
}

/**
 * Delete an address-book entry.
 *
 * Nothing is done to the documents that named them, and that is the design
 * rather than an omission: `meta.to` holds a SNAPSHOT and `bookId` is only a
 * convenience pointer (ADR-041 §5). A document already sent has to render
 * tomorrow exactly as it rendered the day it went out, and cascading this
 * delete into it would rewrite history to tidy an address list.
 *
 * The count of documents still referring to the entry is returned so the
 * confirmation can say so.
 */
export async function deleteAddressee(
  id: string,
): Promise<{ entry: AddressBookEntry | null; referencedBy: number }> {
  const row = await db.addressBook.get(id)
  const parsed = row ? addressBookEntrySchema.safeParse(row) : null
  const documents = await db.documents.toArray()
  const referencedBy = documents.filter((document) => {
    const doc = document.doc as {
      meta?: { to?: { bookId?: string | null }[]; copyTo?: { bookId?: string | null }[] }
    }
    const people = [...(doc.meta?.to ?? []), ...(doc.meta?.copyTo ?? [])]
    return people.some((person) => person.bookId === id)
  }).length
  await db.addressBook.delete(id)
  return { entry: parsed?.success ? parsed.data : null, referencedBy }
}

/** Substring search over every field, in both languages. */
export function searchAddressees(entries: readonly AddressBookEntry[], query: string): AddressBookEntry[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return [...entries]
  return entries.filter((entry) => searchTextOf(entry).includes(needle))
}
