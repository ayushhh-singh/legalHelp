import { db } from '@/db'
import { createDocument } from '../newDocument'
import { loadTemplate } from '../data'
import { readProfile } from '../profileStore'
import type { Language } from '@/i18n'
import type { IntakeAnalysis } from '@/lib/drafting/intake'
import { emptyBilingual, type Addressee, type OfficialDoc } from '@/lib/drafting/model'
import { docId } from '../documents'

/**
 * Creating the reply to a letter.
 *
 * It goes through `createDocument` — the same path "new from a template" takes —
 * rather than assembling an `OfficialDoc` here, and that is not tidiness. That
 * path is where `senderFromProfile` and `signatureFromProfile` are applied, and
 * `checklist.ts`'s `signature-block` rule is a `must` wanting the designation,
 * the telephone and the e-mail. A reply built by hand would export-gate on a
 * rule the officer never touched, and the failure would look like a defect in
 * the reply flow rather than a missing profile.
 *
 * What this file adds afterwards is the four things a reply knows that a blank
 * document does not:
 *
 *  1. **The subject**, prefixed with the reply convention this corpus uses —
 *     the same subject, so the file is followable, which is the whole reason
 *     CSMOP 9.2(iv) asks for the previous number and date to be quoted.
 *  2. **A reference line** naming the letter's number and date, which is that
 *     paragraph's actual requirement.
 *  3. **The addressee**, taken from the letter's own `To` block — reversed: the
 *     office that wrote to us is the office we write back to.
 *  4. **The links**: `linkedIntakeId` and `threadId`, the two members Session 29
 *     put on the model with nothing writing them.
 */

/**
 * The addressee of a reply, from the sender of the letter.
 *
 * A letter's `To` block is who it was addressed TO — this office — so it is not
 * the reply's addressee. What is, is the office that SIGNED it, and that block
 * is at the foot of the page rather than in a labelled field. So this takes the
 * conservative route: it uses the reference the letter quoted about itself to
 * name the office, and leaves the name and designation EMPTY for the officer to
 * fill from the address book.
 *
 * Guessing would be worse than blank here. A reply addressed to the wrong
 * officer of the right Ministry is a reply that is returned, and an officer
 * checking a name they did not type is exactly the failure `extract.ts` refuses
 * to create by never inventing.
 */
function addresseeFromLetter(analysis: IntakeAnalysis): Addressee | null {
  const lines = analysis.meta.to.filter((line) => line.trim())
  if (lines.length === 0) return null
  return {
    id: `to-${docId().slice(0, 6)}`,
    bookId: null,
    name: emptyBilingual(),
    designation: emptyBilingual(),
    organisation: emptyBilingual(),
    // The block as printed, kept whole. An officer edits it in the Details tab;
    // splitting it into name/designation/organisation would be three guesses
    // where the letter gave one block.
    address: lines,
    phone: '',
    email: '',
  }
}

/** "Reply — <the letter's own subject>", in the language the officer is in. */
const REPLY_PREFIX: Record<Language, string> = { en: 'Reply — ', hi: 'उत्तर — ' }

export async function createDocumentFromIntake(args: {
  templateId: string
  analysis: IntakeAnalysis
  intakeId: string | null
  at: string
  language: Language
}): Promise<OfficialDoc> {
  const template = await loadTemplate(args.templateId)
  const profile = await readProfile()
  const base = await createDocument({ template, profile })

  const subject = args.analysis.meta.subject
  const addressee = addresseeFromLetter(args.analysis)
  const reference = args.analysis.meta.number || args.analysis.references[0] || ''

  const doc: OfficialDoc = {
    ...base,
    meta: {
      ...base.meta,
      subject: subject
        ? { en: `${REPLY_PREFIX.en}${subject}`, hi: `${REPLY_PREFIX.hi}${subject}` }
        : base.meta.subject,
      ...(addressee ? { to: [addressee] } : {}),
      referenceLines:
        reference || args.analysis.letterDate
          ? [
              {
                id: 'ref-1',
                number: reference,
                date: args.analysis.letterDate,
              },
              ...base.meta.referenceLines,
            ]
          : base.meta.referenceLines,
      /*
        The urgency of the letter is NOT copied onto the reply.

        A grading is a claim about how urgently the RECIPIENT should act, and
        the sender of the reply is the one making it. Copying it across would
        have the app grade an officer's own communication Top Priority because
        somebody else did — a claim it has no standing to make, and one that
        prints at the top of a signed document.
      */
    },
    ...(args.intakeId ? { linkedIntakeId: args.intakeId } : {}),
    // The thread is the intake's id, so the register's own thread and the
    // document's agree without either having to read the other.
    ...(args.intakeId ? { threadId: args.intakeId } : {}),
    title: subject ? `${REPLY_PREFIX[args.language]}${subject}` : base.title,
    updatedAt: args.at,
  }

  await db.documents.put({
    id: doc.id,
    templateId: doc.templateId,
    title: doc.title,
    status: doc.status,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    ...(doc.threadId ? { threadId: doc.threadId } : {}),
    doc,
  })
  return doc
}
