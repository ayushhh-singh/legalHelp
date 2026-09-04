import { beforeEach, describe, expect, it } from 'vitest'

import {
  createEntry,
  deleteEntry,
  duplicatesOf,
  getEntry,
  listEntries,
  listEntriesWithDropped,
  markReplied,
  recordIntake,
  recordIssuedNumber,
  updateEntry,
} from './registerStore'
import { saveIntake } from '../intake/intakeStore'

import { buildBackup } from '@/lib/backup'
import { clearAllData, db } from '@/db'
import { analyseIntake } from '@/lib/drafting/intake'
import { dueFollowUps, threadOf } from '@/lib/drafting/register'
import { INTAKE_LETTERS } from '../../../../tests/fixtures/drafting/intake'

/**
 * The register against a real IndexedDB (`fake-indexeddb`).
 *
 * What is tested here is the WIRING — that an issued number produces one entry
 * and not two, that a reply joins the thread of the letter it answers, and that
 * both new tables are in the backup. The arithmetic is
 * `src/lib/drafting/register.test.ts`'s and is not repeated.
 */

const AT = '2026-09-04T10:00:00.000Z'
const LATER = '2026-09-05T10:00:00.000Z'

beforeEach(async () => {
  await clearAllData()
})

describe('automatic entries', () => {
  it('records an inbound letter when the officer keeps it', async () => {
    const analysis = analyseIntake(INTAKE_LETTERS.englishOm)
    const intake = await saveIntake({ text: INTAKE_LETTERS.englishOm, analysis, at: AT })
    const entry = await recordIntake({
      intakeId: intake.id,
      number: intake.number,
      date: intake.date,
      receivedOn: '2026-08-14',
      subject: intake.subject,
      at: AT,
    })

    expect(entry.direction).toBe('received')
    expect(entry.number).toBe('A-11011/4/2026-Estt.(Allowances)')
    expect(entry.intakeId).toBe(intake.id)
    expect(await listEntries()).toHaveLength(1)
  })

  it('keeps one entry when the same letter is kept twice', async () => {
    const analysis = analyseIntake(INTAKE_LETTERS.englishOm)
    const intake = await saveIntake({ text: INTAKE_LETTERS.englishOm, analysis, at: AT })
    const args = {
      intakeId: intake.id,
      number: intake.number,
      date: intake.date,
      receivedOn: '',
      subject: intake.subject,
      at: AT,
    }
    const first = await recordIntake(args)
    const second = await recordIntake({ ...args, subject: 'Corrected subject', at: LATER })

    expect(second.id).toBe(first.id)
    expect(second.subject).toBe('Corrected subject')
    expect(await listEntries()).toHaveLength(1)
  })

  it('records an outbound communication when a number is issued', async () => {
    const entry = await recordIssuedNumber({
      docId: 'doc-1',
      number: 'B-1/2026-Estt.',
      date: '04.09.2026',
      subject: 'Reply regarding the allowance',
      at: AT,
    })
    expect(entry.direction).toBe('sent')
    expect(entry.docId).toBe('doc-1')
    expect(entry.status).toBe('pending')
  })

  it('updates rather than duplicating when a document is renumbered', async () => {
    // A renumbered document is still one communication.
    const first = await recordIssuedNumber({
      docId: 'doc-1',
      number: 'B-1/2026',
      date: '04.09.2026',
      subject: 'Reply',
      at: AT,
    })
    const second = await recordIssuedNumber({
      docId: 'doc-1',
      number: 'B-2/2026',
      date: '05.09.2026',
      subject: 'Reply',
      at: LATER,
    })
    expect(second.id).toBe(first.id)
    expect(second.number).toBe('B-2/2026')
    expect(await listEntries()).toHaveLength(1)
  })
})

describe('threads', () => {
  it('puts a reply on the thread of the letter it answers', async () => {
    const inbound = await createEntry({
      direction: 'received',
      at: AT,
      patch: { number: 'A-11011/4/2026-Estt.', subject: 'Allowance', date: '2026-08-12' },
    })
    const reply = await recordIssuedNumber({
      docId: 'doc-1',
      number: 'B-1/2026',
      date: '04.09.2026',
      subject: 'Reply regarding the allowance',
      at: LATER,
      inReplyTo: inbound.id,
    })

    expect(reply.threadId).toBe(inbound.id)
    const thread = threadOf(await listEntries(), reply.id)
    expect(thread.map((entry) => entry.id)).toEqual([inbound.id, reply.id])
  })

  it('carries the thread through a chain three deep', async () => {
    const first = await createEntry({ direction: 'received', at: AT, patch: { date: '2026-08-01' } })
    const second = await createEntry({
      direction: 'sent',
      at: AT,
      inReplyTo: first.id,
      patch: { date: '2026-08-10' },
    })
    const third = await createEntry({
      direction: 'received',
      at: AT,
      inReplyTo: second.id,
      patch: { date: '2026-08-20' },
    })
    expect(third.threadId).toBe(first.id)
    expect(threadOf(await listEntries(), third.id)).toHaveLength(3)
  })

  it('marks the inbound letter replied, as a separate step', async () => {
    const inbound = await createEntry({ direction: 'received', at: AT })
    await recordIssuedNumber({
      docId: 'doc-1',
      number: 'B-1/2026',
      date: '04.09.2026',
      subject: 'Reply',
      at: LATER,
      inReplyTo: inbound.id,
    })
    // Issuing a number does not itself close the inbound side: the two are
    // different facts and either can be corrected without the other.
    expect((await getEntry(inbound.id))?.status).toBe('pending')

    await markReplied(inbound.id, LATER)
    expect((await getEntry(inbound.id))?.status).toBe('replied')
  })
})

describe('follow-ups', () => {
  it('becomes overdue once the date has passed', async () => {
    const entry = await createEntry({
      direction: 'received',
      at: AT,
      patch: { followUpDate: '2026-09-10' },
    })
    const entries = await listEntries()
    expect(dueFollowUps(entries, '2026-09-09')).toEqual([])
    expect(dueFollowUps(entries, '2026-09-11').map((each) => each.id)).toEqual([entry.id])
  })

  it('drops out of the due list once it is replied to', async () => {
    const entry = await createEntry({
      direction: 'received',
      at: AT,
      patch: { followUpDate: '2026-09-01' },
    })
    await markReplied(entry.id, LATER)
    expect(dueFollowUps(await listEntries(), '2026-09-11')).toEqual([])
  })
})

describe('duplicate numbers', () => {
  it('warns on a number this office has already sent under', async () => {
    await recordIssuedNumber({
      docId: 'doc-1',
      number: 'B-1/2026-Estt.',
      date: '04.09.2026',
      subject: 'Reply',
      at: AT,
    })
    expect(await duplicatesOf('B-1/2026-Estt.')).toHaveLength(1)
    expect(await duplicatesOf('b-1/2026 -estt.')).toHaveLength(1)
    expect(await duplicatesOf('B-2/2026-Estt.')).toEqual([])
  })

  it('finds a number the officer recorded BY HAND, which numberIssues cannot', async () => {
    /*
      The half of the check that only the register has.

      `issueNumber` reads `numberIssues`, which holds what THIS APP issued. An
      officer who issued B-1/2026 last year from a paper register and typed it
      in here has a `registerEntries` row and no `numberIssues` row, so the
      generator's warning is silent without this. `DocEditorPage` folds both
      into one notice.
    */
    await createEntry({
      direction: 'sent',
      at: AT,
      patch: { number: 'B-1/2026-Estt.', subject: 'Issued before this app existed' },
    })
    expect(await db.numberIssues.count()).toBe(0)
    expect(await duplicatesOf('B-1/2026-Estt.')).toHaveLength(1)
  })

  it('does not warn about an entry against itself', async () => {
    const entry = await recordIssuedNumber({
      docId: 'doc-1',
      number: 'B-1/2026',
      date: '04.09.2026',
      subject: 'Reply',
      at: AT,
    })
    expect(await duplicatesOf('B-1/2026', entry.id)).toEqual([])
  })
})

describe('editing', () => {
  it('refuses to change what an entry is', async () => {
    const entry = await createEntry({ direction: 'received', at: AT })
    const updated = await updateEntry(
      entry.id,
      { direction: 'sent', id: 'somebody-else', createdAt: '1999-01-01', subject: 'Changed' },
      LATER,
    )
    expect(updated?.direction).toBe('received')
    expect(updated?.id).toBe(entry.id)
    expect(updated?.createdAt).toBe(AT)
    expect(updated?.subject).toBe('Changed')
  })

  it('hands back what was deleted, so an undo can put it back', async () => {
    const entry = await createEntry({ direction: 'received', at: AT, patch: { subject: 'Allowance' } })
    const deleted = await deleteEntry(entry.id)
    expect(deleted?.subject).toBe('Allowance')
    expect(await listEntries()).toEqual([])
  })
})

describe('a row this build cannot read', () => {
  it('is dropped and counted, not allowed to empty the screen', async () => {
    await createEntry({ direction: 'received', at: AT })
    await db.registerEntries.put({
      id: 'broken',
      direction: 'received',
      number: '',
      date: '',
      status: 'pending',
      threadId: 'broken',
      followUpDate: '',
      updatedAt: AT,
      createdAt: AT,
      entry: { id: 'broken', direction: 'sideways' },
    })
    const { entries, dropped } = await listEntriesWithDropped()
    expect(entries).toHaveLength(1)
    expect(dropped).toBe(1)
  })
})

describe('the backup', () => {
  it('carries both of this session’s tables', async () => {
    // `buildBackup` excludes by NAME, so a new table is included by default.
    // Asserted anyway, because "it is in the backup" is a claim rather than a
    // comment — the same assertion Session 28 wrote for its five tables.
    await createEntry({ direction: 'received', at: AT, patch: { subject: 'Allowance' } })
    await saveIntake({
      text: INTAKE_LETTERS.englishOm,
      analysis: analyseIntake(INTAKE_LETTERS.englishOm),
      at: AT,
    })

    const backup = await buildBackup('test')
    expect(Object.keys(backup.tables)).toContain('registerEntries')
    expect(Object.keys(backup.tables)).toContain('intakes')
    expect(backup.tables.registerEntries).toHaveLength(1)
    expect(backup.tables.intakes).toHaveLength(1)
  })
})
