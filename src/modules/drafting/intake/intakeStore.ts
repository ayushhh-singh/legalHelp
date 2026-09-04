import { db, type IntakeRow } from '@/db'
import { docId } from '../documents'
import { analyseIntake, type IntakeAnalysis } from '@/lib/drafting/intake'

/**
 * The letters an officer has kept.
 *
 * ### Nothing is stored until the officer says so
 *
 * A letter pasted into the reply screen is read, chipped, and held in component
 * state. It reaches this file only when "keep with the draft" is pressed, and
 * that is the single most important property of the whole reply flow: an
 * officer who pastes a letter to see what it asks for, decides it is not worth
 * a reply, and closes the tab has left nothing on the device.
 *
 * The screen says so before the paste box, in both languages, and
 * `tests/e2e/draft-reply.spec.ts` asserts that a pasted-and-abandoned letter
 * leaves `intakes` empty. It is a claim, so it is tested.
 *
 * ### The stored analysis is the OFFICER's, not the extractor's
 *
 * `analyseIntake` produces chips; the officer corrects them; what is stored is
 * what they corrected. Re-running the extractor on read would silently
 * overwrite a file number they fixed by hand — the same reason a document
 * snapshots its sender rather than pointing at the profile (ADR-041 §5).
 */

export interface Intake {
  id: string
  text: string
  subject: string
  number: string
  date: string
  receivedOn: string
  createdAt: string
  updatedAt: string
  analysis: IntakeAnalysis
  replyDocId?: string
}

/**
 * A stored row, believed only as far as it can be checked.
 *
 * The analysis is re-derived from the stored TEXT when the stored analysis
 * cannot be read, rather than the row being dropped. That is the right
 * direction here and the opposite of `readDoc`'s: the letter itself is the
 * thing of value and it is stored verbatim, so a re-read loses only the
 * officer's corrections to the chips — which the screen then shows them, with
 * the chips editable. Dropping the row would lose the letter.
 */
export function readIntake(row: IntakeRow): Intake {
  const stored = row.analysis
  const analysis = isAnalysis(stored) ? stored : analyseIntake(row.text)
  return {
    id: row.id,
    text: row.text,
    subject: row.subject,
    number: row.number,
    date: row.date,
    receivedOn: row.receivedOn,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    analysis,
    ...(row.replyDocId ? { replyDocId: row.replyDocId } : {}),
  }
}

/**
 * A shape check rather than a zod schema, deliberately.
 *
 * `IntakeAnalysis` is a reading of a letter, not a contract with a dataset:
 * every member of it is derived and every one is correctable on screen. A zod
 * schema here would be a third copy of a shape `intake.ts` already defines and
 * the extractor already produces, and its only power would be to reject a row
 * this file can rebuild from the text in one call.
 */
function isAnalysis(value: unknown): value is IntakeAnalysis {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<IntakeAnalysis>
  return (
    typeof candidate.letterDate === 'string' &&
    Array.isArray(candidate.asks) &&
    Array.isArray(candidate.provisions) &&
    typeof candidate.meta === 'object'
  )
}

const toRow = (intake: Intake): IntakeRow => ({
  id: intake.id,
  text: intake.text,
  subject: intake.subject,
  number: intake.number,
  date: intake.date,
  receivedOn: intake.receivedOn,
  createdAt: intake.createdAt,
  updatedAt: intake.updatedAt,
  analysis: intake.analysis,
  ...(intake.replyDocId ? { replyDocId: intake.replyDocId } : {}),
})

export async function listIntakes(limit = 100): Promise<Intake[]> {
  const rows = await db.intakes.orderBy('createdAt').reverse().limit(limit).toArray()
  return rows.map(readIntake)
}

export async function getIntake(id: string): Promise<Intake | null> {
  const row = await db.intakes.get(id)
  // `undefined` from `Table.get` means "no such row"; mapping it to `null` is
  // what lets a `useLiveQuery` tell that apart from "still asking", which is
  // also `undefined` (ADR-039's addendum — a personal work bounced back to the
  // shelf on every first render for exactly this reason).
  return row ? readIntake(row) : null
}

export async function saveIntake(args: {
  text: string
  analysis: IntakeAnalysis
  at: string
  id?: string
  subject?: string
  number?: string
  date?: string
  receivedOn?: string
}): Promise<Intake> {
  const existing = args.id ? await getIntake(args.id) : null
  const intake: Intake = {
    id: existing?.id ?? args.id ?? `in-${docId()}`,
    text: args.text,
    // Denormalised from the analysis unless the caller states otherwise, so a
    // list renders without parsing every letter it holds.
    subject: args.subject ?? args.analysis.meta.subject,
    number: args.number ?? args.analysis.meta.number,
    date: args.date ?? args.analysis.letterDate,
    receivedOn: args.receivedOn ?? args.analysis.receiptDate,
    createdAt: existing?.createdAt ?? args.at,
    updatedAt: args.at,
    analysis: args.analysis,
    ...(existing?.replyDocId ? { replyDocId: existing.replyDocId } : {}),
  }
  await db.intakes.put(toRow(intake))
  return intake
}

/** Point an intake at the document drafted in reply to it. */
export async function linkReply(intakeId: string, replyDocId: string, at: string): Promise<void> {
  const existing = await getIntake(intakeId)
  if (!existing) return
  await db.intakes.put(toRow({ ...existing, replyDocId, updatedAt: at }))
}

/**
 * Delete a letter, and hand back what was deleted.
 *
 * The row IS the undo, the shape `deleteDocument` established. Nothing cascades
 * — a document drafted in reply keeps its `linkedIntakeId`, which then points
 * at nothing, and every screen that reads it treats a missing intake as "the
 * letter is no longer kept" rather than as an error. That is the register's own
 * rule one level down: deleting the paper must not delete the record of it.
 */
export async function deleteIntake(id: string): Promise<Intake | null> {
  const existing = await getIntake(id)
  if (existing) await db.intakes.delete(id)
  return existing
}

export async function restoreIntake(intake: Intake): Promise<void> {
  await db.intakes.put(toRow(intake))
}
