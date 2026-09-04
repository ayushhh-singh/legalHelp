import { db, type DocumentRow } from '@/db'
import { migrateDraft, type MigrationResult } from '@/lib/drafting/migrate'

import { loadTemplate } from './data'
import { valuesOf } from './drafts'

import type { DocTemplate } from './schema'

/**
 * Moving every Session 8 draft into the new document model.
 *
 * **Nothing is deleted.** The `drafts` table is left exactly as it is and the
 * migrated copy goes into `documents` carrying `migratedFrom`. That is the
 * backup the brief asks for, and it is the backup the officer would actually
 * want: a migration that deletes its own source is one nobody can re-run, and a
 * separate exported file is one nobody would find.
 *
 * It is **idempotent**. A draft already migrated is skipped by looking for a
 * document carrying its id in `migratedFrom`, so running it twice — on two
 * tabs, or after a failed run — produces one document per draft.
 *
 * A draft whose template no longer exists is REPORTED rather than dropped or
 * guessed at. There is no honest way to lay out a document whose form has been
 * removed, and inventing one would put an officer's paragraphs on a page the
 * app made up.
 */

export interface MigrationReport {
  migrated: number
  skipped: number
  failed: { draftId: string; templateId: string; reason: 'unknown-template' | 'unreadable' }[]
  /** Field ids that had no structured home and are carried in `vars`. */
  keptAsVars: string[]
}

const now = () => new Date().toISOString()

async function templateFor(id: string, cache: Map<string, DocTemplate | null>): Promise<DocTemplate | null> {
  const cached = cache.get(id)
  if (cached !== undefined) return cached
  const template = await loadTemplate(id).catch(() => null)
  cache.set(id, template)
  return template
}

export async function migrateAllDrafts(): Promise<MigrationReport> {
  const report: MigrationReport = { migrated: 0, skipped: 0, failed: [], keptAsVars: [] }
  const drafts = await db.drafts.toArray()
  if (drafts.length === 0) return report

  const already = new Set(
    (await db.documents.toArray()).map((row) => row.migratedFrom).filter((id): id is string => Boolean(id)),
  )
  const cache = new Map<string, DocTemplate | null>()

  for (const draft of drafts) {
    if (already.has(draft.id)) {
      report.skipped += 1
      continue
    }
    const template = await templateFor(draft.templateId, cache)
    if (!template) {
      report.failed.push({ draftId: draft.id, templateId: draft.templateId, reason: 'unknown-template' })
      continue
    }

    let result: MigrationResult
    try {
      result = migrateDraft({
        id: draft.id,
        templateId: draft.templateId,
        title: draft.title,
        values: valuesOf(draft),
        createdAt: draft.createdAt,
        updatedAt: draft.updatedAt,
        template,
      })
    } catch {
      report.failed.push({ draftId: draft.id, templateId: draft.templateId, reason: 'unreadable' })
      continue
    }

    const row: DocumentRow = {
      id: result.doc.id,
      templateId: result.doc.templateId,
      title: result.doc.title,
      status: result.doc.status,
      createdAt: result.doc.createdAt,
      // The migrated document keeps the draft's own `updatedAt`, so the list
      // opens in the order the officer left their work in rather than in the
      // order the migration happened to walk the table.
      updatedAt: result.doc.updatedAt,
      migratedFrom: draft.id,
      doc: result.doc,
    }
    await db.documents.put(row)
    report.migrated += 1
    for (const id of [...result.keptAsVars, ...result.unknownFields]) {
      if (!report.keptAsVars.includes(id)) report.keptAsVars.push(id)
    }
  }

  return report
}

/**
 * Bring ONE draft across, and say where it landed.
 *
 * ADR-046 removed the Session 8 form-and-preview editor, which is the only
 * screen that could open a `drafts` row — so a row in that table now has
 * exactly one useful action, and this is it. The alternative considered was
 * letting the old route redirect to `/draft/new/<type>`, which creates a blank
 * document of the right type and silently loses the officer's afternoon; a
 * redirect that appears to work and throws the work away is worse than a dead
 * link.
 *
 * A draft already migrated returns the document it became rather than making a
 * second copy: this is reachable by pressing the row twice, and two documents
 * with the same text is a worse outcome than either.
 *
 * `drafts` is NOT deleted here, exactly as `migrateAllDrafts` does not delete
 * it. The migration copies; the originals stay until the officer erases them.
 */
export async function migrateOneDraft(
  draftId: string,
): Promise<
  | { ok: true; docId: string; alreadyMigrated: boolean; keptAsVars: string[] }
  | { ok: false; reason: 'missing' | 'unknown-template' | 'unreadable' }
> {
  const draft = await db.drafts.get(draftId)
  if (!draft) return { ok: false, reason: 'missing' }

  const existing = (await db.documents.toArray()).find((row) => row.migratedFrom === draftId)
  if (existing) return { ok: true, docId: existing.id, alreadyMigrated: true, keptAsVars: [] }

  const template = await loadTemplate(draft.templateId).catch(() => null)
  if (!template) return { ok: false, reason: 'unknown-template' }

  let result: MigrationResult
  try {
    result = migrateDraft({
      id: draft.id,
      templateId: draft.templateId,
      title: draft.title,
      values: valuesOf(draft),
      createdAt: draft.createdAt,
      updatedAt: draft.updatedAt,
      template,
    })
  } catch {
    return { ok: false, reason: 'unreadable' }
  }

  await db.documents.put({
    id: result.doc.id,
    templateId: result.doc.templateId,
    title: result.doc.title,
    status: result.doc.status,
    createdAt: result.doc.createdAt,
    updatedAt: result.doc.updatedAt,
    migratedFrom: draft.id,
    doc: result.doc,
  })

  return {
    ok: true,
    docId: result.doc.id,
    alreadyMigrated: false,
    keptAsVars: [...new Set([...result.keptAsVars, ...result.unknownFields])],
  }
}

/** How many drafts are still waiting — what a "migrate my drafts" banner reads. */
export async function pendingMigrationCount(): Promise<number> {
  const drafts = await db.drafts.count()
  if (drafts === 0) return 0
  const migrated = new Set(
    (await db.documents.toArray()).map((row) => row.migratedFrom).filter((id): id is string => Boolean(id)),
  )
  const ids = await db.drafts.toCollection().primaryKeys()
  return ids.filter((id) => !migrated.has(String(id))).length
}

/** Used by the migration test and by a "start over" control in Settings. */
export const migratedAt = now
