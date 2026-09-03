import { db, type PersonalTemplateRow, type TemplateFavouriteRow, type TemplateRecentRow } from '@/db'
import { personalTemplateSchema, type PersonalTemplate } from '@/lib/drafting/personal'

import { docId } from './documents'

const now = () => new Date().toISOString()

export const personalId = (): string => `pt-${docId().slice(0, 8)}`

export async function listPersonal(): Promise<PersonalTemplate[]> {
  const rows = await db.personalTemplates.toArray()
  return rows
    .map((row) => personalTemplateSchema.safeParse(row.template))
    .filter((parsed) => parsed.success)
    .map((parsed) => parsed.data)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function getPersonal(id: string): Promise<PersonalTemplate | null> {
  const row = await db.personalTemplates.get(id)
  if (!row) return null
  const parsed = personalTemplateSchema.safeParse(row.template)
  return parsed.success ? parsed.data : null
}

export async function savePersonal(template: PersonalTemplate): Promise<PersonalTemplate> {
  const existing = await db.personalTemplates.get(template.id)
  const next = { ...template, createdAt: existing?.createdAt ?? template.createdAt, updatedAt: now() }
  const row: PersonalTemplateRow = {
    id: next.id,
    name: next.name,
    baseTemplateId: next.baseTemplateId,
    createdAt: next.createdAt,
    updatedAt: next.updatedAt,
    template: next,
  }
  await db.personalTemplates.put(row)
  return next
}

export const deletePersonal = (id: string): Promise<void> => db.personalTemplates.delete(id)

// -------------------------------------------- favourites and recent forms

/**
 * Favourites and recents over the FORM PICKER — official templates and personal
 * ones share one id space here, because that is the list the officer is
 * choosing from and splitting it would mean two stars on one card.
 *
 * The same `{ id, createdAt }` / `{ id, viewedAt }` shape the law, glossary and
 * command-palette tables already use.
 */
export const listFavourites = (): Promise<string[]> =>
  db.templateFavourites
    .orderBy('createdAt')
    .reverse()
    .toArray()
    .then((rows) => rows.map((row) => row.id))

export async function toggleFavourite(id: string): Promise<boolean> {
  const existing = await db.templateFavourites.get(id)
  if (existing) {
    await db.templateFavourites.delete(id)
    return false
  }
  await db.templateFavourites.put({ id, createdAt: now() } satisfies TemplateFavouriteRow)
  return true
}

const RECENT_CAP = 8

export async function recordRecent(id: string): Promise<void> {
  await db.transaction('rw', db.templateRecents, async () => {
    await db.templateRecents.put({ id, viewedAt: now() } satisfies TemplateRecentRow)
    const rows = await db.templateRecents.orderBy('viewedAt').reverse().toArray()
    await db.templateRecents.bulkDelete(rows.slice(RECENT_CAP).map((row) => row.id))
  })
}

export const listRecents = (): Promise<string[]> =>
  db.templateRecents
    .orderBy('viewedAt')
    .reverse()
    .limit(RECENT_CAP)
    .toArray()
    .then((rows) => rows.map((row) => row.id))
