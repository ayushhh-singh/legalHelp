import { describe, expect, it } from 'vitest'

import {
  addDaysIso,
  compareEntries,
  duplicateNumbers,
  dueFollowUps,
  filterEntries,
  followUpState,
  fromJsonExport,
  newEntry,
  readEntry,
  threadIdFor,
  threadOf,
  normaliseDates,
  toCsv,
  toJsonExport,
  type RegisterEntry,
} from './register'

/**
 * The register's arithmetic: threads, follow-ups, duplicates and the two
 * exports.
 *
 * Every date here is supplied. There is no clock in this library
 * (`purity.test.ts`), which is what makes "overdue tomorrow" a test that fails
 * rather than one that passes until tomorrow — the trap `lint.ts`'s future-date
 * rule already records.
 */

const AT = '2026-09-04T10:00:00.000Z'

const entry = (id: string, patch: Partial<RegisterEntry> = {}): RegisterEntry =>
  newEntry({
    id,
    direction: patch.direction ?? 'received',
    at: patch.createdAt ?? AT,
    ...(patch.threadId ? { threadId: patch.threadId } : {}),
    patch,
  })

describe('a row', () => {
  it('defaults everything a stored row may lack', () => {
    const row = newEntry({ id: 'r1', direction: 'received', at: AT })
    expect(row.status).toBe('pending')
    expect(row.number).toBe('')
    expect(row.inReplyTo).toBeNull()
    expect(row.docId).toBeNull()
  })

  it('starts its own thread when it answers nothing', () => {
    expect(newEntry({ id: 'r1', direction: 'received', at: AT }).threadId).toBe('r1')
  })

  it('refuses a row whose direction is not one of the two', () => {
    expect(readEntry({ ...entry('r1'), direction: 'sideways' })).toBeNull()
  })

  it('reads a row this build wrote', () => {
    expect(readEntry(entry('r1'))?.id).toBe('r1')
  })
})

describe('threads', () => {
  it('gives a reply the thread of what it answers', () => {
    const original = entry('r1')
    expect(threadIdFor({ id: 'r2' }, original)).toBe('r1')
  })

  it('keeps a whole chain on one thread, however deep', () => {
    const first = entry('r1')
    const second = entry('r2', { inReplyTo: 'r1', threadId: 'r1', direction: 'sent' })
    const third = entry('r3', { inReplyTo: 'r2', threadId: threadIdFor({ id: 'r3' }, second) })
    expect(third.threadId).toBe('r1')
    expect(threadOf([first, second, third], 'r3').map((each) => each.id)).toEqual(['r1', 'r2', 'r3'])
  })

  it('finds the whole thread from any member of it', () => {
    const rows = [
      entry('r1', { date: '2026-08-12' }),
      entry('r2', { inReplyTo: 'r1', threadId: 'r1', direction: 'sent', date: '2026-08-20' }),
    ]
    expect(threadOf(rows, 'r1').map((each) => each.id)).toEqual(['r1', 'r2'])
    expect(threadOf(rows, 'r2').map((each) => each.id)).toEqual(['r1', 'r2'])
  })

  it('terminates on a cycle rather than hanging', () => {
    // Two entries answering each other is a state an officer can type into two
    // dropdowns. A register that hangs on it is worse than one that shows an
    // odd chain.
    const a = entry('r1', { inReplyTo: 'r2', threadId: 'r1' })
    const b = entry('r2', { inReplyTo: 'r1', threadId: 'r1' })
    expect(threadOf([a, b], 'r1').map((each) => each.id)).toEqual(['r1', 'r2'])
  })

  it('survives a parent that has been deleted', () => {
    const orphan = entry('r2', { inReplyTo: 'gone', threadId: 'gone' })
    expect(threadOf([orphan], 'r2').map((each) => each.id)).toEqual(['r2'])
  })

  it('returns nothing for an id that is not in the register', () => {
    expect(threadOf([entry('r1')], 'nope')).toEqual([])
  })
})

describe('follow-ups', () => {
  const pending = (followUpDate: string) => entry('r1', { followUpDate, status: 'pending' })

  it('is overdue the day after, due on the day, upcoming before', () => {
    expect(followUpState(pending('2026-09-10'), '2026-09-11')).toBe('overdue')
    expect(followUpState(pending('2026-09-10'), '2026-09-10')).toBe('due')
    expect(followUpState(pending('2026-09-10'), '2026-09-09')).toBe('upcoming')
  })

  it('is nothing at all once the entry has been replied to or closed', () => {
    // The date is what the entry was waiting for. It is not waiting any more.
    expect(followUpState({ ...pending('2026-09-01'), status: 'replied' }, '2026-09-11')).toBe('none')
    expect(followUpState({ ...pending('2026-09-01'), status: 'closed' }, '2026-09-11')).toBe('none')
  })

  it('is nothing when no follow-up is being kept', () => {
    expect(followUpState(entry('r1'), '2026-09-11')).toBe('none')
  })

  it('lists what wants attention, most overdue first', () => {
    const rows = [
      entry('r1', { followUpDate: '2026-09-10' }),
      entry('r2', { followUpDate: '2026-09-01' }),
      entry('r3', { followUpDate: '2026-12-01' }),
      entry('r4', { followUpDate: '2026-09-01', status: 'replied' }),
    ]
    expect(dueFollowUps(rows, '2026-09-10').map((each) => each.id)).toEqual(['r2', 'r1'])
  })

  it('adds days without a timezone in the room', () => {
    expect(addDaysIso('2026-09-04', 15)).toBe('2026-09-19')
    expect(addDaysIso('2026-12-25', 10)).toBe('2027-01-04')
    // A leap day, crossed both ways.
    expect(addDaysIso('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDaysIso('2028-02-29', 1)).toBe('2028-03-01')
  })

  it('answers nothing for something that is not a date', () => {
    expect(addDaysIso('', 7)).toBe('')
    expect(addDaysIso('04.09.2026', 7)).toBe('')
  })
})

describe('duplicate numbers', () => {
  const sent = (id: string, number: string) => entry(id, { direction: 'sent', number })

  it('finds a number already used on another outbound communication', () => {
    const rows = [sent('r1', 'A-11011/4/2026-Estt.'), sent('r2', 'A-11011/5/2026-Estt.')]
    expect(duplicateNumbers(rows, 'A-11011/4/2026-Estt.').map((each) => each.id)).toEqual(['r1'])
  })

  it('ignores whitespace and case', () => {
    const rows = [sent('r1', 'A-11011/4/2026-Estt.')]
    expect(duplicateNumbers(rows, 'a-11011/4/2026 -estt.')).toHaveLength(1)
  })

  it('does not report an entry against itself', () => {
    const rows = [sent('r1', 'A-11011/4/2026-Estt.')]
    expect(duplicateNumbers(rows, 'A-11011/4/2026-Estt.', 'r1')).toEqual([])
  })

  it('never reports an inbound number as a duplicate', () => {
    // Two offices may perfectly well use the same file number; only what THIS
    // office issued can collide with what this office is about to issue.
    const rows = [entry('r1', { direction: 'received', number: 'A-11011/4/2026-Estt.' })]
    expect(duplicateNumbers(rows, 'A-11011/4/2026-Estt.')).toEqual([])
  })

  it('reports nothing for an empty number', () => {
    expect(duplicateNumbers([sent('r1', '')], '')).toEqual([])
  })
})

describe('filters and search', () => {
  const rows = [
    entry('r1', {
      direction: 'received',
      number: 'A-11011/4/2026-Estt.',
      subject: 'Children Education Allowance',
      date: '2026-08-12',
      correspondent: { name: 'R. K. Sharma', organisation: 'DoPT', bookId: null },
    }),
    entry('r2', {
      direction: 'sent',
      number: 'B-1/2026',
      subject: 'Reply regarding allowance',
      date: '2026-08-20',
      status: 'replied',
      threadId: 'r1',
      inReplyTo: 'r1',
    }),
    entry('r3', { direction: 'received', subject: 'Transfer request', date: '2026-09-01' }),
  ]

  it('is newest first', () => {
    expect(filterEntries(rows, {}).map((each) => each.id)).toEqual(['r3', 'r2', 'r1'])
  })

  it('filters by direction and by status', () => {
    expect(filterEntries(rows, { direction: 'sent' }).map((each) => each.id)).toEqual(['r2'])
    expect(filterEntries(rows, { status: 'pending' }).map((each) => each.id)).toEqual(['r3', 'r1'])
  })

  it('filters by thread', () => {
    expect(filterEntries(rows, { threadId: 'r1' }).map((each) => each.id)).toEqual(['r2', 'r1'])
  })

  it('searches the number, the subject and the correspondent', () => {
    expect(filterEntries(rows, { query: 'A-11011' }).map((each) => each.id)).toEqual(['r1'])
    expect(filterEntries(rows, { query: 'allowance' }).map((each) => each.id)).toEqual(['r2', 'r1'])
    expect(filterEntries(rows, { query: 'sharma' }).map((each) => each.id)).toEqual(['r1'])
  })

  it('finds nothing rather than something close', () => {
    // Substring and not fuse.js, deliberately: a register holds words the
    // officer chose themselves, and the number is the thing they are sure of.
    expect(filterEntries(rows, { query: 'A-11012' })).toEqual([])
  })
})

describe('ordering', () => {
  it('sorts by the communication’s own date, falling back to receipt then creation', () => {
    const a = entry('r1', { date: '2026-08-12' })
    const b = entry('r2', { date: '', receivedOn: '2026-08-20' })
    expect(compareEntries(a, b)).toBeLessThan(0)
  })

  it('breaks a tie on the creation instant, never on ICU collation', () => {
    const a = entry('r1', { date: '2026-08-12', createdAt: '2026-08-12T09:00:00.000Z' })
    const b = entry('r2', { date: '2026-08-12', createdAt: '2026-08-12T10:00:00.000Z' })
    expect(compareEntries(a, b)).toBeLessThan(0)
    expect(compareEntries(b, a)).toBeGreaterThan(0)
    expect(compareEntries(a, a)).toBe(0)
  })
})

describe('export', () => {
  const rows = [
    entry('r1', {
      direction: 'received',
      number: 'A-11011/4/2026-Estt.',
      subject: 'Allowance, and other matters',
      date: '2026-08-12',
      correspondent: { name: 'R. K. "Bobby" Sharma', organisation: 'DoPT', bookId: null },
      notes: 'Two lines\nof note',
    }),
  ]

  it('quotes every field and doubles an inner quote', () => {
    const csv = toCsv(rows)
    expect(csv).toContain('"R. K. ""Bobby"" Sharma"')
    // A subject with a comma in it must not become two columns.
    expect(csv).toContain('"Allowance, and other matters"')
  })

  it('ends every line with CRLF', () => {
    // Excel on a Government desktop puts the whole register on one row without
    // it.
    const csv = toCsv(rows)
    expect(csv.split('\r\n').length).toBe(3)
    expect(csv.endsWith('\r\n')).toBe(true)
  })

  it('flattens a multi-line note rather than breaking the row', () => {
    expect(toCsv(rows)).toContain('"Two lines of note"')
  })

  it('round-trips through JSON', () => {
    const file = toJsonExport(rows, AT)
    const read = fromJsonExport(file)
    expect(read?.dropped).toBe(0)
    expect(read?.entries.map((each) => each.id)).toEqual(['r1'])
  })

  it('salvages a file whose envelope is right and one of whose rows is not', () => {
    const file = { ...toJsonExport(rows, AT), entries: [rows[0], { id: 'broken' }] }
    const read = fromJsonExport(file)
    expect(read?.entries.map((each) => each.id)).toEqual(['r1'])
    expect(read?.dropped).toBe(1)
  })

  it('refuses a file that is not a register at all', () => {
    expect(fromJsonExport({ kind: 'something-else', entries: [] })).toBeNull()
    expect(fromJsonExport(null)).toBeNull()
  })
})

describe('dates are stored ISO, whatever shape they arrived in', () => {
  /*
    Found by a test rather than designed, and worth the note.

    A register mixes two sources: an intake's date is `2026-08-12`, read off a
    letter by `extract.ts`, and a document's `meta.date` is `12.08.2026`, which
    is what CSMOP's specimens print. Stored as they arrive and compared as
    strings, `04.09.2026` sorts BEFORE `2026-08-12`, so a September reply
    appeared above the August letter it answered — in the list, in the thread
    view and in the CSV. `registerStore.test.ts`'s thread test is what caught
    it.

    This is CLAUDE.md's recorded `Number(date.slice(0, 4))` trap in a new place.
  */
  it('reads dd.mm.yyyy and yyyy-mm-dd into the same value', () => {
    expect(normaliseDates({ date: '12.08.2026' }).date).toBe('2026-08-12')
    expect(normaliseDates({ date: '2026-08-12' }).date).toBe('2026-08-12')
    expect(normaliseDates({ receivedOn: '04.09.2026' }).receivedOn).toBe('2026-09-04')
    expect(normaliseDates({ followUpDate: '30.09.2026' }).followUpDate).toBe('2026-09-30')
  })

  it('reads Devanagari digits, because a Hindi document prints them', () => {
    expect(normaliseDates({ date: '१२.०८.२०२६' }).date).toBe('2026-08-12')
  })

  it('empties a date it cannot read rather than keeping it unorderable', () => {
    expect(normaliseDates({ date: 'sometime in August' }).date).toBe('')
    expect(normaliseDates({ date: '' }).date).toBe('')
  })

  it('leaves a field the patch did not mention alone', () => {
    expect(normaliseDates({ subject: 'Allowance' })).toEqual({ subject: 'Allowance' })
  })

  it('orders a mixed thread chronologically once both sides are normalised', () => {
    const letter = newEntry({
      id: 'r1',
      direction: 'received',
      at: AT,
      patch: { date: '2026-08-12' },
    })
    const reply = newEntry({
      id: 'r2',
      direction: 'sent',
      at: AT,
      threadId: 'r1',
      patch: { date: '04.09.2026', inReplyTo: 'r1' },
    })
    expect(threadOf([letter, reply], 'r2').map((each) => each.id)).toEqual(['r1', 'r2'])
  })
})
