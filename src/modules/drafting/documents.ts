import { db, type DocCommentRow, type DocVersionRow, type DocumentRow } from '@/db'
import { readDoc, type OfficialDoc } from '@/lib/drafting/model'
import {
  prune,
  restoreInto,
  type DocComment,
  type DocVersion,
  type SnapshotReason,
} from '@/lib/drafting/versions'

/**
 * Documents on the device — the Session 29 replacement for `drafts.ts`.
 *
 * Every rule the master context sets for user state applies here and is the
 * reason this file exists rather than a `useState`: a document is the most
 * personal thing this app holds — it may name a case, a colleague or a
 * grievance — and it never leaves IndexedDB.
 *
 * `drafts.ts` is still there and still works. This module owns the new
 * `documents`, `docVersions` and `docComments` tables; `migrateDrafts.ts` is
 * what moves a Session 8 draft across, and it copies rather than moves.
 */

const now = () => new Date().toISOString()

export function docId(): string {
  const bytes = new Uint8Array(9)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** A short id for something inside a document — an addressee, a reference line. */
export const localId = (prefix: string): string => `${prefix}-${docId().slice(0, 6)}`

const toRow = (doc: OfficialDoc, extra: Partial<DocumentRow> = {}): DocumentRow => ({
  id: doc.id,
  templateId: doc.templateId,
  title: doc.title,
  status: doc.status,
  createdAt: doc.createdAt,
  updatedAt: doc.updatedAt,
  ...(doc.threadId ? { threadId: doc.threadId } : {}),
  doc,
  ...extra,
})

export type ReadFailure = { ok: false; reason: 'missing' | 'malformed' | 'too-new'; storedVersion?: number }
export type ReadOk = { ok: true; doc: OfficialDoc; row: DocumentRow }

/**
 * One document, believed only as far as `readDoc` can check it.
 *
 * Three outcomes, and the third is the one that matters: a document written by
 * a LATER build of the app is refused rather than half-read, so the editor can
 * say "this was written by a newer version" instead of silently showing a page
 * with paragraphs missing (ADR-041 §2).
 */
export async function getDocument(id: string): Promise<ReadOk | ReadFailure> {
  const row = await db.documents.get(id)
  if (!row) return { ok: false, reason: 'missing' }
  const parsed = readDoc(row.doc)
  if (!parsed.ok)
    return {
      ok: false,
      reason: parsed.reason,
      ...(parsed.storedVersion !== undefined ? { storedVersion: parsed.storedVersion } : {}),
    }
  return { ok: true, doc: parsed.doc, row }
}

/** Newest first. A row that will not parse is listed, because it can be deleted. */
export async function listDocuments(limit = 100): Promise<DocumentRow[]> {
  return db.documents.orderBy('updatedAt').reverse().limit(limit).toArray()
}

export async function putDocument(doc: OfficialDoc): Promise<DocumentRow> {
  const existing = await db.documents.get(doc.id)
  const row = toRow(
    { ...doc, createdAt: existing?.createdAt ?? doc.createdAt, updatedAt: now() },
    existing?.migratedFrom ? { migratedFrom: existing.migratedFrom } : {},
  )
  await db.documents.put(row)
  return row
}

/**
 * Delete a document, and hand back everything that was deleted.
 *
 * The rows ARE the undo. Versions and comments go with it — a version of a
 * document that no longer exists is unreachable — and they come back in the
 * same object, so an undo restores the whole thing rather than an orphaned
 * shell. Same shape `deleteDraft` established.
 */
export async function deleteDocument(id: string): Promise<{
  row: DocumentRow
  versions: DocVersionRow[]
  comments: DocCommentRow[]
} | null> {
  return db.transaction('rw', db.documents, db.docVersions, db.docComments, async () => {
    const row = await db.documents.get(id)
    if (!row) return null
    const versions = await db.docVersions.where('docId').equals(id).toArray()
    const comments = await db.docComments.where('docId').equals(id).toArray()
    await db.documents.delete(id)
    await db.docVersions.bulkDelete(versions.map((version) => version.id))
    await db.docComments.bulkDelete(comments.map((comment) => comment.id))
    return { row, versions, comments }
  })
}

export async function restoreDocument(bundle: {
  row: DocumentRow
  versions: DocVersionRow[]
  comments: DocCommentRow[]
}): Promise<void> {
  await db.transaction('rw', db.documents, db.docVersions, db.docComments, async () => {
    await db.documents.put(bundle.row)
    await db.docVersions.bulkPut(bundle.versions)
    await db.docComments.bulkPut(bundle.comments)
  })
}

export async function duplicateDocument(id: string, title: string): Promise<OfficialDoc | null> {
  const source = await getDocument(id)
  if (!source.ok) return null
  const at = now()
  const copy: OfficialDoc = {
    // A structured clone, not a spread: a shallow copy would leave the
    // duplicate sharing the original's `body.content` array, and editing one
    // would silently edit both. `drafts.ts#duplicateDraft` records the same
    // lesson about `values`.
    ...(JSON.parse(JSON.stringify(source.doc)) as OfficialDoc),
    id: docId(),
    title,
    status: 'draft',
    createdAt: at,
    updatedAt: at,
  }
  delete copy.issuedAt
  await db.documents.put(toRow(copy))
  return copy
}

// -------------------------------------------------------------- versions

const versionId = () => `v-${docId()}`

/**
 * A stored version row as `prune` wants it.
 *
 * `prune` only reads `at`, so this is a widening rather than a claim about the
 * stored document — which is why it does not go near `readDoc`. `listVersions`
 * is where a version's document is actually parsed.
 */
const asVersionRow = (row: DocVersionRow): DocVersion => row as unknown as DocVersion

/**
 * Take a snapshot, then prune to thirty.
 *
 * The prune is inside the same transaction as the insert, so a burst of
 * autosaves cannot leave thirty-one rows behind. `prune` itself is pure and
 * lives in `src/lib/drafting/versions.ts` with the reasoning.
 */
export async function snapshot(doc: OfficialDoc, reason: SnapshotReason, label = ''): Promise<DocVersion> {
  const version: DocVersion = { id: versionId(), docId: doc.id, at: now(), reason, label, doc }
  await db.transaction('rw', db.docVersions, async () => {
    await db.docVersions.put(version)
    const all = await db.docVersions.where('docId').equals(doc.id).toArray()
    const keep = new Set(prune(all.map(asVersionRow)).map((entry) => entry.id))
    await db.docVersions.bulkDelete(all.filter((entry) => !keep.has(entry.id)).map((entry) => entry.id))
  })
  return version
}

/** Newest first. A version whose stored document will not parse is skipped. */
export async function listVersions(docIdValue: string): Promise<DocVersion[]> {
  const rows = await db.docVersions.where('docId').equals(docIdValue).toArray()
  return rows
    .map((row) => {
      const parsed = readDoc(row.doc)
      return parsed.ok
        ? ({
            id: row.id,
            docId: row.docId,
            at: row.at,
            reason: row.reason as SnapshotReason,
            label: row.label,
            doc: parsed.doc,
          } satisfies DocVersion)
        : null
    })
    .filter((entry): entry is DocVersion => entry !== null)
    .sort((a, b) => b.at.localeCompare(a.at))
}

/**
 * Restore, non-destructively.
 *
 * The live document is snapshotted FIRST, with reason `restore`, so the state
 * being restored away from is itself recoverable. That is what "restore creates
 * a new version, never destructive" means in practice, and doing it in the
 * other order — restore then snapshot — would snapshot the restored content and
 * lose what was there.
 */
export async function restoreVersion(
  docIdValue: string,
  versionIdValue: string,
): Promise<OfficialDoc | null> {
  const live = await getDocument(docIdValue)
  if (!live.ok) return null
  const versions = await listVersions(docIdValue)
  const version = versions.find((entry) => entry.id === versionIdValue)
  if (!version) return null

  await snapshot(live.doc, 'restore', '')
  const restored = restoreInto(live.doc, version, now())
  await putDocument(restored)
  return restored
}

// -------------------------------------------------------------- comments

export async function addComment(
  docIdValue: string,
  blockIndex: number,
  blockText: string,
  text: string,
): Promise<DocComment> {
  const at = now()
  const comment: DocComment = {
    id: `c-${docId()}`,
    docId: docIdValue,
    blockIndex,
    blockText,
    text,
    resolved: false,
    createdAt: at,
    updatedAt: at,
  }
  await db.docComments.put(comment)
  return comment
}

export const listComments = (docIdValue: string): Promise<DocComment[]> =>
  db.docComments
    .where('docId')
    .equals(docIdValue)
    .toArray()
    .then((rows) =>
      rows.sort((a, b) => a.blockIndex - b.blockIndex || a.createdAt.localeCompare(b.createdAt)),
    )

export async function setCommentResolved(id: string, resolved: boolean): Promise<void> {
  await db.docComments.update(id, { resolved, updatedAt: now() })
}

export async function deleteComment(id: string): Promise<void> {
  await db.docComments.delete(id)
}
