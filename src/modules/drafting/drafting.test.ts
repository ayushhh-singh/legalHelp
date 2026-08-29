import { describe, expect, it } from 'vitest'

import {
  asDraft,
  cleanValues,
  deleteDraft,
  duplicateDraft,
  draftId,
  getDraft,
  listDrafts,
  putDraft,
  readDefaults,
  renameDraft,
  restoreDraft,
  saveDefaults,
  valuesOf,
} from './drafts'
import { applyChanges, changesOf } from './suggestion'
import { draftParamsToSearch, editorSessionKey, parseDraftParams } from './url'
import {
  asText,
  blankValues,
  collapseIdentical,
  documentFields,
  draftTitle,
  fromText,
  insertAt,
  isSplit,
  mergeField,
  readValue,
  setValue,
  splitField,
} from './values'

import { db } from '@/db'
import { diffWords } from '@/lib/diff'
import { fixtureTemplate } from '@/test/drafting-fixture'
import type { DraftValues } from '@/lib/drafting/types'

const template = fixtureTemplate()
const field = (id: string) => {
  const found = template.fields.find((candidate) => candidate.id === id)
  if (!found) throw new Error(`no such fixture field: ${id}`)
  return found
}

/* ------------------------------------------------------------------ values */

describe('one shared value until the languages are separated', () => {
  it('writes a plain value that both issues read', () => {
    const next = setValue({}, field('fileNumber'), 'en', 'A-11011/2/2026')
    expect(next.fileNumber).toBe('A-11011/2/2026')
    expect(readValue(next, field('fileNumber'), 'hi')).toBe('A-11011/2/2026')
  })

  it('seeds both sides when a field is split, rather than blanking one', () => {
    const shared = setValue({}, field('subject'), 'en', 'Children Education Allowance')
    const split = splitField(shared, field('subject'))
    expect(isSplit(split.subject)).toBe(true)
    expect(readValue(split, field('subject'), 'hi')).toBe('Children Education Allowance')
  })

  it('writes only the named side once split', () => {
    let values = splitField(setValue({}, field('subject'), 'en', 'Leave'), field('subject'))
    values = setValue(values, field('subject'), 'hi', 'अवकाश')
    expect(readValue(values, field('subject'), 'en')).toBe('Leave')
    expect(readValue(values, field('subject'), 'hi')).toBe('अवकाश')
  })

  it('collapses a pair to the language shown', () => {
    let values = splitField(setValue({}, field('subject'), 'en', 'Leave'), field('subject'))
    values = setValue(values, field('subject'), 'hi', 'अवकाश')
    const merged = mergeField(values, field('subject'), 'hi')
    expect(merged.subject).toBe('अवकाश')
    expect(readValue(merged, field('subject'), 'en')).toBe('अवकाश')
  })

  it('never mutates what it was handed', () => {
    const before: DraftValues = { subject: 'One' }
    setValue(before, field('subject'), 'en', 'Two')
    splitField(before, field('subject'))
    expect(before).toEqual({ subject: 'One' })
  })

  it('falls back to the other side when one is missing', () => {
    const values: DraftValues = { subject: { en: 'Only English' } }
    expect(readValue(values, field('subject'), 'hi')).toBe('Only English')
  })

  it('edits a paras field as one box, a paragraph per line', () => {
    const text = 'First paragraph.\nSecond paragraph.'
    const values = setValue({}, field('paras'), 'en', fromText(text, field('paras')))
    expect(values.paras).toEqual(['First paragraph.', 'Second paragraph.'])
    expect(asText(readValue(values, field('paras'), 'en'))).toBe(text)
  })

  it('collapses a specimen pair whose two sides are the same string', () => {
    // Every `sample` is an { en, hi } pair, but the O.M. specimen's telephone
    // number and e-mail address are identical on both sides. Without this,
    // "Fill with the worked example" put all fifteen fields into two boxes.
    const collapsed = collapseIdentical({
      phone: { en: '011-2309 2590', hi: '011-2309 2590' },
      subject: { en: 'Leave', hi: 'अवकाश' },
      list: { en: ['a'], hi: ['a'] },
      plain: 'untouched',
    })
    expect(collapsed.phone).toBe('011-2309 2590')
    expect(collapsed.list).toEqual(['a'])
    expect(collapsed.subject).toEqual({ en: 'Leave', hi: 'अवकाश' })
    expect(collapsed.plain).toBe('untouched')
  })

  it('leaves a half-filled pair split rather than picking a side', () => {
    const collapsed = collapseIdentical({ subject: { en: 'Only English' } })
    expect(collapsed.subject).toEqual({ en: 'Only English' })
  })

  it('turns an emptied list box into an empty array, not one blank entry', () => {
    /*
      The checklist and the engine's required-field validation both read the
      RESOLVED value, and `['']` is an array with something in it as far as
      either is concerned. Clearing the Copy-to box used to leave "Copies are
      endorsed to everyone concerned" passing, and emptying the body left its
      required issue unreported — while the rendered document was correct both
      times, because `asList` filters blanks. Caught in a real browser.
    */
    expect(fromText('', field('enclosures'))).toEqual([])
    expect(fromText('   \n  \n ', field('enclosures'))).toEqual([])
    expect(fromText('', field('paras'))).toEqual([])
  })

  it('keeps the blank line an officer just typed', () => {
    // `fromText` runs on every keystroke; dropping a trailing empty entry
    // would take the caret with it the moment Enter was pressed.
    expect(fromText('One.\n', field('paras'))).toEqual(['One.', ''])
    expect(fromText('One.\n\nTwo.', field('paras'))).toEqual(['One.', '', 'Two.'])
  })

  it('starts a new draft blank, not from the specimen', () => {
    // The engine used to fall back to `field.sample` per field, which produced
    // a complete document signed by "(A.B.C.)" from a form with one field
    // filled in. A blank start is what makes the required-field issues real.
    const blank = blankValues(template)
    expect(blank.fileNumber).toBe('')
    expect(blank.paras).toEqual([])
    expect(Object.keys(blank).sort()).toEqual(template.fields.map((each) => each.id).sort())
  })
})

describe('insertAt', () => {
  it('inserts at the caret and reports where the caret goes', () => {
    expect(insertAt('The undersigned .', 16, 'is directed')).toEqual({
      text: 'The undersigned is directed.',
      caret: 27,
    })
  })

  it('clamps a caret outside the text instead of throwing', () => {
    expect(insertAt('abc', 99, 'X').text).toBe('abcX')
    expect(insertAt('abc', -5, 'X').text).toBe('Xabc')
  })
})

describe('what "Save as my template" refuses to keep', () => {
  it('drops the body, the date and the subject', () => {
    const omit = documentFields(template)
    expect(omit).toContain('paras')
    expect(omit).toContain('date')
    expect(omit).toContain('subject')
    expect(omit).toContain('enclosures')
    // The letterhead is what it is for.
    expect(omit).not.toContain('fileNumber')
  })
})

describe('draftTitle', () => {
  it('uses the subject, which is how an officer refers to a document', () => {
    const values = setValue({}, field('subject'), 'en', 'Grant of Children Education Allowance')
    expect(draftTitle(template, values, 'en')).toBe('Grant of Children Education Allowance')
  })

  it('falls back to the form name when there is no subject yet', () => {
    expect(draftTitle(template, {}, 'hi')).toBe('नमूना')
  })

  it('trims a subject that would wrap the row', () => {
    const long = 'x'.repeat(200)
    const values = setValue({}, field('subject'), 'en', long)
    expect(draftTitle(template, values, 'en')).toHaveLength(90)
    expect(draftTitle(template, values, 'en').endsWith('…')).toBe(true)
  })
})

/* --------------------------------------------------------------------- url */

describe('the editor view state in the URL', () => {
  const parse = (search: string) => parseDraftParams(new URLSearchParams(search), 'en')

  it('defaults the preview to the reader’s own language', () => {
    expect(parseDraftParams(new URLSearchParams(''), 'hi').view).toBe('hi')
    expect(parse('').view).toBe('en')
  })

  it('round-trips every value', () => {
    const params = {
      draftId: 'a1b2c3d4e5f60718a9',
      view: 'both' as const,
      pane: 'preview' as const,
      checklistOpen: true,
    }
    expect(parseDraftParams(draftParamsToSearch(params, 'en'), 'en')).toEqual(params)
  })

  it('omits defaults, so `?d=` stays the readable part', () => {
    const search = draftParamsToSearch(
      { draftId: 'a1b2c3d4e5f60718a9', view: 'en', pane: 'form', checklistOpen: false },
      'en',
    )
    expect(search.toString()).toBe('d=a1b2c3d4e5f60718a9')
  })

  it('drops a hand-edited draft id rather than querying IndexedDB with it', () => {
    expect(parse('d=../../etc/passwd').draftId).toBeNull()
    expect(parse('d=' + 'z'.repeat(18)).draftId).toBeNull()
    expect(parse('d=abc').draftId).toBeNull()
  })

  it('falls back on a view or pane it does not recognise', () => {
    expect(parse('view=klingon').view).toBe('en')
    expect(parse('pane=sideways').pane).toBe('form')
  })
})

/* ------------------------------------------------------------------ drafts */

describe('drafts on the device', () => {
  const values: DraftValues = { fileNumber: 'A-1/2026', paras: ['One.', 'Two.'] }

  it('creates and reads back what was written', async () => {
    const first = await putDraft({ id: draftId(), templateId: 'letter', title: 'First', values })
    const second = await putDraft({ id: draftId(), templateId: 'noting', title: 'Second', values })

    const rows = await listDrafts()
    expect(rows.map((row) => row.id).sort()).toEqual([first.id, second.id].sort())
    expect(valuesOf(rows.find((row) => row.id === first.id)!)).toEqual(values)
  })

  it('lists newest first', async () => {
    /*
      The timestamps are written directly, an hour apart, rather than by
      calling `putDraft` twice.

      Two `putDraft` calls in a test land in the SAME millisecond, so
      `updatedAt` ties and Dexie falls back to the primary key — which is
      random here, so the assertion would pass or fail on the value of
      `crypto.getRandomValues`. Asserting an order the data does not determine
      is how a suite earns a `retry: 2` and stops meaning anything.
    */
    await db.drafts.bulkPut([
      {
        id: 'aaaaaaaaaaaaaaaaaa',
        templateId: 'letter',
        title: 'Older',
        values,
        createdAt: '2026-08-28T09:00:00.000Z',
        updatedAt: '2026-08-28T09:00:00.000Z',
      },
      {
        id: 'bbbbbbbbbbbbbbbbbb',
        templateId: 'noting',
        title: 'Newer',
        values,
        createdAt: '2026-08-28T09:00:00.000Z',
        updatedAt: '2026-08-28T10:00:00.000Z',
      },
    ])

    expect((await listDrafts()).map((row) => row.title)).toEqual(['Newer', 'Older'])
  })

  it('keeps createdAt across a re-save and moves updatedAt', async () => {
    const id = draftId()
    const first = await putDraft({ id, templateId: 'letter', title: 'A', values })
    const again = await putDraft({ id, templateId: 'letter', title: 'B', values })
    expect(again.createdAt).toBe(first.createdAt)
    expect(again.title).toBe('B')
    expect(await db.drafts.count()).toBe(1)
  })

  it('gives every draft its own id, so two O.M.s are two documents', async () => {
    // Deliberately unlike `payScenarios`, which keys on a slug of the name:
    // two scenarios called "Delhi posting" are one comparison, two drafts
    // called "Office Memorandum" are two documents.
    await putDraft({ id: draftId(), templateId: 'office-memorandum', title: 'O.M.', values })
    await putDraft({ id: draftId(), templateId: 'office-memorandum', title: 'O.M.', values })
    expect(await db.drafts.count()).toBe(2)
  })

  it('renames', async () => {
    const row = await putDraft({ id: draftId(), templateId: 'letter', title: 'Old', values })
    await renameDraft(row.id, '  New name  ')
    expect((await getDraft(row.id))?.title).toBe('New name')
  })

  it('refuses to rename to nothing', async () => {
    const row = await putDraft({ id: draftId(), templateId: 'letter', title: 'Keep', values })
    await renameDraft(row.id, '   ')
    expect((await getDraft(row.id))?.title).toBe('Keep')
  })

  it('duplicates into a copy that does not share its arrays', async () => {
    const row = await putDraft({ id: draftId(), templateId: 'letter', title: 'Original', values })
    const copy = await duplicateDraft(row.id, 'Copy of Original')
    expect(copy).not.toBeNull()
    expect(copy!.id).not.toBe(row.id)

    // Editing the copy must not reach the original — a shallow spread would
    // have left both pointing at the same `paras` array.
    await putDraft({
      id: copy!.id,
      templateId: 'letter',
      title: copy!.title,
      values: { ...valuesOf(copy!), paras: ['Changed.'] },
    })
    expect(valuesOf((await getDraft(row.id))!).paras).toEqual(['One.', 'Two.'])
  })

  it('hands back what it deleted, and puts it back unchanged', async () => {
    const row = await putDraft({ id: draftId(), templateId: 'letter', title: 'Doomed', values })
    const deleted = await deleteDraft(row.id)
    expect(deleted?.title).toBe('Doomed')
    expect(await getDraft(row.id)).toBeNull()

    await restoreDraft(deleted!)
    const restored = await getDraft(row.id)
    expect(restored?.title).toBe('Doomed')
    expect(valuesOf(restored!)).toEqual(values)
  })

  it('deleting something that is not there is not an error', async () => {
    expect(await deleteDraft('deadbeefdeadbeef00')).toBeNull()
  })
})

describe('a row from IndexedDB is untrusted input', () => {
  it('drops one with no id or no template', () => {
    expect(asDraft(null)).toBeNull()
    expect(asDraft({ id: '', templateId: 'letter', values: {} })).toBeNull()
    expect(asDraft({ id: 'a', templateId: '', values: {} })).toBeNull()
  })

  it('drops one whose values are not an object', () => {
    expect(asDraft({ id: 'a', templateId: 'letter', values: 'nope' })).toBeNull()
    expect(asDraft({ id: 'a', templateId: 'letter', values: ['nope'] })).toBeNull()
  })

  it('strips anything IndexedDB could not have stored anyway', () => {
    const cleaned = cleanValues({
      good: 'text',
      list: ['a', 'b'],
      pair: { en: 'x', hi: 'य' },
      // @ts-expect-error deliberately the shape a bad release could have written
      bad: 42,
      // @ts-expect-error ditto
      worse: () => 'boom',
      // @ts-expect-error a list with a hole in it
      holed: ['a', 3],
    })
    expect(cleaned).toEqual({ good: 'text', list: ['a', 'b'], pair: { en: 'x', hi: 'य' } })
  })

  it('deep-copies, so a cleaned value shares nothing with its source', () => {
    const source = { list: ['a'] }
    const cleaned = cleanValues(source)
    ;(cleaned.list as string[]).push('b')
    expect(source.list).toEqual(['a'])
  })
})

describe('my template', () => {
  it('keeps the letterhead and drops the document', async () => {
    await saveDefaults(
      'office-memorandum',
      'O.M.',
      {
        fileNumber: 'A-1/2026',
        subject: 'Last week’s subject',
        paras: ['Last week’s argument.'],
        date: '2026-01-01',
      },
      documentFields(template),
    )
    const defaults = await readDefaults('office-memorandum')
    expect(defaults).toEqual({ fileNumber: 'A-1/2026' })
  })

  it('is one per form — a second save updates rather than accumulating', async () => {
    await saveDefaults('letter', 'Letter', { fileNumber: 'first' }, [])
    await saveDefaults('letter', 'Letter', { fileNumber: 'second' }, [])
    expect(await db.draftDefaults.count()).toBe(1)
    expect((await readDefaults('letter'))?.fileNumber).toBe('second')
  })

  it('does not exist for a form nobody has saved one for', async () => {
    expect(await readDefaults('notification')).toBeNull()
  })
})

/* -------------------------------------------------------------- suggestion */

describe('accepting and rejecting individual changes', () => {
  const parts = (before: string, after: string) => {
    const result = diffWords(before, after)
    if (!result) throw new Error('the fixture is too long to diff')
    return result
  }

  it('groups a replacement into one change, not a delete and an insert', () => {
    const p = parts('the officer shall submit', 'the officer may submit')
    expect(changesOf(p)).toHaveLength(1)
  })

  it('accepting everything yields the suggestion', () => {
    const p = parts('It is noticed that', 'I notice that')
    const changes = changesOf(p)
    expect(
      applyChanges(
        p,
        changes,
        changes.map(() => true),
      ),
    ).toBe('I notice that')
  })

  it('rejecting everything yields the original', () => {
    const p = parts('It is noticed that', 'I notice that')
    const changes = changesOf(p)
    expect(
      applyChanges(
        p,
        changes,
        changes.map(() => false),
      ),
    ).toBe('It is noticed that')
  })

  it('rejecting a DELETION keeps the original words', () => {
    // The one inversion in the whole file: a deletion survives being refused.
    const p = parts('may be sent immediately please', 'may be sent please')
    const changes = changesOf(p)
    expect(applyChanges(p, changes, [false])).toBe('may be sent immediately please')
    expect(applyChanges(p, changes, [true])).toBe('may be sent please')
  })

  it('takes one change of several and leaves the rest alone', () => {
    const p = parts(
      'the officer shall submit the report immediately',
      'an officer may submit the report by 28.02.2026',
    )
    const changes = changesOf(p)
    expect(changes.length).toBeGreaterThan(1)

    const first = applyChanges(
      p,
      changes,
      changes.map((_, index) => index === 0),
    )
    // The first change is taken…
    expect(first).toContain('an officer')
    // …and the last one is not.
    expect(first).toContain('immediately')
    expect(first).not.toContain('28.02.2026')
  })

  it('keeps hard line breaks rather than joining sub-sections with a space', () => {
    const p = parts('one\ntwo', 'one\nthree')
    const changes = changesOf(p)
    expect(applyChanges(p, changes, [true])).toBe('one\nthree')
  })

  it('reports no changes when nothing changed', () => {
    expect(changesOf(parts('same text', 'same text'))).toEqual([])
  })
})

describe('editorSessionKey', () => {
  it('does not change when this editor creates the draft row it is already editing', () => {
    // The sequence that used to remount the AI panel mid-review: a blank form
    // (null), then the row this editor created appearing as `?d=`. The old
    // expression was `draftId ?? 'new'`, which goes 'new' -> 'abc' here.
    expect(editorSessionKey(null, null)).toBe(editorSessionKey('abc', 'abc'))
  })

  it('does change when the reader opens a different draft', () => {
    expect(editorSessionKey('xyz', 'abc')).not.toBe(editorSessionKey(null, 'abc'))
    expect(editorSessionKey('xyz', 'abc')).toBe('xyz')
  })

  it('treats a resumed draft the editor did not create as its own document', () => {
    expect(editorSessionKey('xyz', null)).toBe('xyz')
  })
})
