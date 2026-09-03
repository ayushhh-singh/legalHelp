import { db, type NumberIssueRow } from '@/db'
import { expandNumber, nextSequence, newPattern, type NumberPattern } from '@/lib/drafting/numbering'

import { docId } from './documents'

/**
 * Issuing a reference number — the half that touches the database.
 *
 * `src/lib/drafting/numbering.ts` is pure and does the substitution and the
 * reset arithmetic. This file reads the pattern, advances it and records the
 * issue, and it does all three **in one Dexie transaction** — a sequence read
 * in one tick and written in another can hand two documents the same number,
 * which is exactly the failure the register exists to catch.
 */

const now = () => new Date().toISOString()

export const listPatterns = (): Promise<NumberPattern[]> =>
  db.numberPatterns
    .toArray()
    .then((rows) => (rows as unknown as NumberPattern[]).sort((a, b) => a.name.localeCompare(b.name, 'en')))

export const getPattern = (id: string): Promise<NumberPattern | undefined> =>
  db.numberPatterns.get(id).then((row) => row as unknown as NumberPattern | undefined)

export async function savePattern(pattern: NumberPattern): Promise<NumberPattern> {
  const next = { ...pattern, updatedAt: now() }
  await db.numberPatterns.put(next)
  return next
}

export function createPattern(year: number): NumberPattern {
  return newPattern({ id: `np-${docId().slice(0, 8)}`, at: now(), year })
}

export const deletePattern = (id: string): Promise<void> => db.numberPatterns.delete(id)

export interface IssueResult {
  number: string
  seq: number
  /** Numbers already in the register that are the same string. Session 31 reads more. */
  duplicates: NumberIssueRow[]
  unknownTokens: string[]
}

/**
 * Stamp a number on a document and advance the sequence.
 *
 * The duplicate check runs BEFORE the write and its result is returned rather
 * than being made a bar. An office genuinely re-issues a number — a corrigendum
 * carries the number of the communication it corrects — so refusing would be
 * wrong; not saying anything would be worse.
 */
export async function issueNumber(args: {
  patternId: string
  docId: string
  type: string
  year: number
}): Promise<IssueResult | null> {
  return db.transaction('rw', db.numberPatterns, db.numberIssues, async () => {
    const row = await db.numberPatterns.get(args.patternId)
    if (!row) return null
    const pattern = row as unknown as NumberPattern
    const seq = nextSequence(pattern, args.year)
    const { number, unknownTokens } = expandNumber({
      pattern: pattern.pattern,
      file: pattern.file,
      section: pattern.section,
      type: args.type,
      seq,
      seqPad: pattern.seqPad,
      year: args.year,
    })
    // A pattern with a token this app does not know would print `{SEQNO}` on a
    // signed communication. The number is never issued; the editor shows the
    // token and sends the officer to the pattern.
    if (unknownTokens.length > 0) return { number, seq, duplicates: [], unknownTokens }

    const duplicates = await db.numberIssues.where('number').equals(number).toArray()
    await db.numberPatterns.put({
      ...pattern,
      seq,
      seqYear: args.year,
      lastIssued: number,
      lastIssuedAt: now(),
      updatedAt: now(),
    })
    await db.numberIssues.put({
      id: `ni-${docId().slice(0, 8)}`,
      patternId: pattern.id,
      number,
      docId: args.docId,
      issuedAt: now(),
    })
    return { number, seq, duplicates, unknownTokens }
  })
}

export const listIssues = (patternId: string): Promise<NumberIssueRow[]> =>
  db.numberIssues
    .where('patternId')
    .equals(patternId)
    .toArray()
    .then((rows) => rows.sort((a, b) => b.issuedAt.localeCompare(a.issuedAt)))
