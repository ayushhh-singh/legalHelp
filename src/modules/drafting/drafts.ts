import { db, type DraftDefaultsRow, type DraftRow } from '@/db'
import type { DraftValues, FieldValue, Lang } from '@/lib/drafting/types'

/**
 * Drafts, on the device.
 *
 * Every rule the master context sets for user state applies here and is the
 * reason this file exists rather than a `useState`: a draft is the most
 * personal thing this app holds — it may name a case, a colleague or a
 * grievance — and it never leaves IndexedDB. There is no account, no sync and
 * no outbound request, which is what the privacy banner on every editor
 * promises and what `tests/e2e/draft.spec.ts` asserts by counting requests
 * through the whole flow.
 *
 * Two tables, and the split is deliberate (see `src/db/index.ts`): `drafts`
 * holds documents, `draftDefaults` holds the letterhead an officer wants back
 * every time. Clearing the first must not take the second.
 *
 * Nothing here deletes anything to make room. Unlike the Pay module's ten
 * named scenarios there is no cap at all, because a draft is work rather than
 * a comparison — an officer who has written sixty office memoranda has sixty
 * documents, not fifty-nine and a mistake.
 */

const now = () => new Date().toISOString()

/**
 * A short, collision-resistant id.
 *
 * Deliberately NOT derived from the title, which is how `payScenarios` keys
 * its rows: two scenarios called "Delhi posting" are the same comparison, but
 * two drafts called "Office Memorandum" are two different documents, and
 * slugging the title would make saving the second one overwrite the first.
 */
export function draftId(): string {
  const bytes = new Uint8Array(9)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Strip anything that is not a plain, structured-cloneable value.
 *
 * IndexedDB throws a `DataCloneError` on a function or a class instance, and
 * the throw happens inside the autosave — where nobody is watching and where
 * losing it means losing the officer's typing. Everything reaching this table
 * is validated on the way in as well as on the way out.
 */
export function cleanValues(values: DraftValues): DraftValues {
  const out: DraftValues = {}
  for (const [id, value] of Object.entries(values)) {
    const cleaned = cleanValue(value)
    if (cleaned !== undefined) out[id] = cleaned
  }
  return out
}

const isStringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string')

function cleanValue(value: unknown): FieldValue | undefined {
  if (typeof value === 'string') return value
  if (isStringList(value)) return [...value]
  if (!value || typeof value !== 'object') return undefined

  const pair: Partial<Record<Lang, string | string[]>> = {}
  for (const lang of ['en', 'hi'] as const) {
    const side = (value as Record<string, unknown>)[lang]
    if (typeof side === 'string') pair[lang] = side
    else if (isStringList(side)) pair[lang] = [...side]
  }
  return Object.keys(pair).length > 0 ? pair : undefined
}

/**
 * A row from IndexedDB, believed only as far as it can be checked.
 *
 * A row written by an older release, or by a release that has not been written
 * yet, is untrusted input. A draft whose `values` is not an object is dropped
 * rather than merged, for the reason `asScenario` gives in the Pay module: a
 * half-restored form is worse than an empty one.
 */
export function asDraft(row: unknown): DraftRow | null {
  if (!row || typeof row !== 'object') return null
  const record = row as Record<string, unknown>
  if (typeof record.id !== 'string' || !record.id) return null
  if (typeof record.templateId !== 'string' || !record.templateId) return null
  if (!record.values || typeof record.values !== 'object' || Array.isArray(record.values)) return null
  return {
    id: record.id,
    templateId: record.templateId,
    title: typeof record.title === 'string' ? record.title : '',
    values: cleanValues(record.values as DraftValues),
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : now(),
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : now(),
  }
}

/** The `values` of a draft row, as the engine wants them. */
export const valuesOf = (row: DraftRow | DraftDefaultsRow): DraftValues =>
  cleanValues((row.values ?? {}) as DraftValues)

// ------------------------------------------------------------------ drafts

export async function listDrafts(limit = 50): Promise<DraftRow[]> {
  const rows = await db.drafts.orderBy('updatedAt').reverse().limit(limit).toArray()
  return rows.map(asDraft).filter((row): row is DraftRow => row !== null)
}

export async function getDraft(id: string): Promise<DraftRow | null> {
  return asDraft(await db.drafts.get(id))
}

/**
 * Write a draft, creating it if this is the first keystroke.
 *
 * `createdAt` is preserved across every later save so the list can be ordered
 * by when the document was last worked on without losing when it was started.
 */
export async function putDraft(draft: {
  id: string
  templateId: string
  title: string
  values: DraftValues
}): Promise<DraftRow> {
  const existing = await db.drafts.get(draft.id)
  const row: DraftRow = {
    id: draft.id,
    templateId: draft.templateId,
    title: draft.title,
    values: cleanValues(draft.values),
    createdAt: existing?.createdAt ?? now(),
    updatedAt: now(),
  }
  await db.drafts.put(row)
  return row
}

export async function renameDraft(id: string, title: string): Promise<void> {
  const trimmed = title.trim()
  if (!trimmed) return
  await db.drafts.update(id, { title: trimmed, updatedAt: now() })
}

/** A copy, with its own id, so editing it cannot touch the original. */
export async function duplicateDraft(id: string, title: string): Promise<DraftRow | null> {
  const source = await getDraft(id)
  if (!source) return null
  const row: DraftRow = {
    ...source,
    id: draftId(),
    title,
    // Deep-copied by `cleanValues`, which rebuilds every array and pair. A
    // shallow spread would leave the copy sharing the original's `paras`
    // array, and editing one would silently edit both.
    values: valuesOf(source),
    createdAt: now(),
    updatedAt: now(),
  }
  await db.drafts.put(row)
  return row
}

/**
 * Delete, and hand back what was deleted.
 *
 * The row IS the undo. Returning it rather than keeping a module-level "last
 * deleted" means the undo cannot be confused by a second delete, cannot leak
 * a draft's contents into a module variable that outlives the screen, and is
 * restored by exactly the same `put` that any other write uses.
 */
export async function deleteDraft(id: string): Promise<DraftRow | null> {
  const row = await getDraft(id)
  if (!row) return null
  await db.drafts.delete(id)
  return row
}

export async function restoreDraft(row: DraftRow): Promise<void> {
  await db.drafts.put({ ...row, values: valuesOf(row) })
}

// ------------------------------------------------------- my templates

/**
 * "Save as my template" — the field values this officer starts from.
 *
 * One per document type, keyed on the template id, because that is the
 * question being answered: *what is my letterhead for an O.M.?* A second save
 * updates it rather than accumulating a list nobody would choose between.
 *
 * The body paragraphs are deliberately NOT saved. A letterhead is a name, a
 * designation, a telephone number and a Department; the paragraphs are the
 * document, and restoring last week's argument into a blank form is how a
 * wrong sentence gets signed.
 */
export async function saveDefaults(
  templateId: string,
  name: string,
  values: DraftValues,
  omit: readonly string[],
): Promise<DraftDefaultsRow> {
  const kept = cleanValues(values)
  for (const id of omit) delete kept[id]

  const existing = await db.draftDefaults.get(templateId)
  const row: DraftDefaultsRow = {
    id: templateId,
    templateId,
    name,
    values: kept,
    createdAt: existing?.createdAt ?? now(),
    updatedAt: now(),
  }
  await db.draftDefaults.put(row)
  return row
}

export async function readDefaults(templateId: string): Promise<DraftValues | null> {
  const row = await db.draftDefaults.get(templateId)
  return row ? valuesOf(row) : null
}

export async function clearDefaults(templateId: string): Promise<void> {
  await db.draftDefaults.delete(templateId)
}
