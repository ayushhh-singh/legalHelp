import { describe, expect, it } from 'vitest'

import {
  addComment,
  deleteComment,
  deleteDocument,
  docId,
  duplicateDocument,
  getDocument,
  listComments,
  listDocuments,
  listVersions,
  putDocument,
  restoreDocument,
  restoreVersion,
  setCommentResolved,
  snapshot,
} from './documents'
import { createDocument } from './newDocument'
import { issueNumber, savePattern } from './numberingStore'
import {
  deleteAddressee,
  listAddressees,
  newAddressee,
  putAddressee,
  readProfile,
  saveProfile,
} from './profileStore'
import { migrateAllDrafts, pendingMigrationCount } from './migrateDrafts'
import { loadTemplate } from './data'

import { db } from '@/db'
import { buildBackup } from '@/lib/backup'
import { DOC_MODEL_VERSION, emptyMeta, newDoc, type BodyDoc, type OfficialDoc } from '@/lib/drafting/model'
import { newPattern } from '@/lib/drafting/numbering'
import { emptyProfile } from '@/lib/drafting/profile'
import { VERSION_CAP } from '@/lib/drafting/versions'

const body = (...paras: string[]): BodyDoc => ({
  type: 'doc',
  content: paras.map((text) => ({
    type: 'numberedPara',
    attrs: { level: 1 },
    content: [{ type: 'text', text }],
  })),
})

const make = (id = 'doc-1', over: Partial<OfficialDoc> = {}): OfficialDoc => ({
  ...newDoc({
    id,
    templateId: 'office-memorandum',
    lang: 'en',
    at: '2026-09-01T00:00:00.000Z',
    meta: { ...emptyMeta(), number: 'A-1/2026', subject: { en: 'A subject', hi: 'एक विषय' } },
    body: body('One.'),
    title: 'A document',
  }),
  ...over,
})

describe('documents', () => {
  it('writes and reads one back', async () => {
    await putDocument(make())
    const result = await getDocument('doc-1')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.doc.meta.number).toBe('A-1/2026')
  })

  it('answers `missing` for a document that is not there', async () => {
    expect(await getDocument('nope')).toEqual({ ok: false, reason: 'missing' })
  })

  it('refuses a row written by a NEWER build', async () => {
    await db.documents.put({
      id: 'future',
      templateId: 'office-memorandum',
      title: '',
      status: 'draft',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      doc: { ...make('future'), docModelVersion: DOC_MODEL_VERSION + 5 },
    })
    expect(await getDocument('future')).toEqual({
      ok: false,
      reason: 'too-new',
      storedVersion: DOC_MODEL_VERSION + 5,
    })
  })

  it('keeps createdAt across a save and moves updatedAt', async () => {
    const first = await putDocument(make())
    const second = await putDocument({ ...make(), title: 'Renamed' })
    expect(second.createdAt).toBe(first.createdAt)
    expect(second.title).toBe('Renamed')
  })

  it('lists newest first', async () => {
    await putDocument(make('a'))
    await putDocument(make('b'))
    const listed = await listDocuments()
    expect(listed.map((row) => row.id)).toEqual(['b', 'a'])
  })

  it('duplicates deeply — editing the copy cannot touch the original', async () => {
    await putDocument(make())
    const copy = await duplicateDocument('doc-1', 'A document (2)')
    expect(copy).not.toBeNull()
    if (!copy) return
    expect(copy.id).not.toBe('doc-1')
    copy.body.content?.push({ type: 'paragraph' })
    const original = await getDocument('doc-1')
    if (!original.ok) throw new Error('lost the original')
    expect(original.doc.body.content).toHaveLength(1)
  })

  it('deletes the document, its versions and its comments — and hands all three back', async () => {
    const doc = make()
    await putDocument(doc)
    await snapshot(doc, 'manual', 'v1')
    await addComment('doc-1', 0, '1. One.', 'a note')

    const bundle = await deleteDocument('doc-1')
    expect(bundle).not.toBeNull()
    if (!bundle) return
    expect(bundle.versions).toHaveLength(1)
    expect(bundle.comments).toHaveLength(1)
    expect(await db.docVersions.count()).toBe(0)
    expect(await db.docComments.count()).toBe(0)

    await restoreDocument(bundle)
    expect(await db.documents.count()).toBe(1)
    expect(await db.docVersions.count()).toBe(1)
    expect(await db.docComments.count()).toBe(1)
  })

  it('mints an id that is 18 hex characters', () => {
    expect(docId()).toMatch(/^[0-9a-f]{18}$/)
  })
})

describe('versions', () => {
  it('caps at thirty and prunes the oldest, inside the write', async () => {
    const doc = make()
    await putDocument(doc)
    for (let index = 0; index < VERSION_CAP + 5; index += 1) {
      await snapshot({ ...doc, body: body(`Version ${index}.`) }, 'auto')
    }
    expect(await db.docVersions.count()).toBe(VERSION_CAP)
  })

  it('restores non-destructively — what was on screen is snapshotted FIRST', async () => {
    const doc = make()
    await putDocument(doc)
    const old = await snapshot({ ...doc, body: body('The old wording.') }, 'manual', 'before')

    await putDocument({ ...doc, body: body('The new wording.') })
    const restored = await restoreVersion('doc-1', old.id)
    expect(restored).not.toBeNull()
    expect(JSON.stringify(restored?.body)).toContain('The old wording.')

    // The state restored AWAY from is itself in the list now, so the officer
    // can go back to it. That ordering is the whole meaning of
    // "restore creates a new version, never destructive".
    const versions = await listVersions('doc-1')
    const beforeRestore = versions.find((version) => version.reason === 'restore')
    expect(JSON.stringify(beforeRestore?.doc.body)).toContain('The new wording.')
  })

  it('skips a version whose stored document will not parse rather than throwing', async () => {
    const doc = make()
    await putDocument(doc)
    await snapshot(doc, 'manual', 'good')
    await db.docVersions.put({
      id: 'bad',
      docId: 'doc-1',
      at: '2026-09-02T00:00:00.000Z',
      reason: 'auto',
      label: '',
      doc: { nonsense: true },
    })
    const versions = await listVersions('doc-1')
    expect(versions.map((version) => version.label)).toEqual(['good'])
  })
})

describe('comments', () => {
  it('adds, resolves, reopens and deletes', async () => {
    const comment = await addComment('doc-1', 1, '2. Two.', 'check this')
    expect((await listComments('doc-1'))[0]?.resolved).toBe(false)

    await setCommentResolved(comment.id, true)
    expect((await listComments('doc-1'))[0]?.resolved).toBe(true)

    await setCommentResolved(comment.id, false)
    expect((await listComments('doc-1'))[0]?.resolved).toBe(false)

    await deleteComment(comment.id)
    expect(await listComments('doc-1')).toHaveLength(0)
  })

  it('orders by the block they are anchored to', async () => {
    await addComment('doc-1', 3, 'd', 'fourth')
    await addComment('doc-1', 0, 'a', 'first')
    expect((await listComments('doc-1')).map((comment) => comment.text)).toEqual(['first', 'fourth'])
  })
})

describe('the drafting profile and the address book', () => {
  it('returns a blank profile before one is saved, and never a half-parsed one', async () => {
    expect(await readProfile()).toMatchObject({ id: 'profile', name: { en: '', hi: '' } })
    await db.draftingProfile.put({ id: 'profile', updatedAt: 'x', name: 'not a bilingual pair' })
    expect(await readProfile()).toMatchObject({ name: { en: '', hi: '' } })
  })

  it('round-trips a saved profile', async () => {
    const profile = { ...emptyProfile('2026-09-01T00:00:00.000Z'), name: { en: 'A.B.C.', hi: 'ए.बी.सी.' } }
    await saveProfile(profile)
    expect((await readProfile()).name).toEqual({ en: 'A.B.C.', hi: 'ए.बी.सी.' })
  })

  it('deleting an addressee LEAVES every document that named them alone', async () => {
    const entry = { ...newAddressee(), name: { en: 'Shri X', hi: 'श्री एक्स' } }
    await putAddressee(entry)

    const doc = make('doc-with-addressee')
    doc.meta.to = [
      {
        id: 'to-1',
        bookId: entry.id,
        name: { en: 'Shri X', hi: 'श्री एक्स' },
        designation: { en: '', hi: '' },
        organisation: { en: '', hi: '' },
        address: [],
        phone: '',
        email: '',
      },
    ]
    await putDocument(doc)

    const result = await deleteAddressee(entry.id)
    expect(result.referencedBy).toBe(1)
    expect(await listAddressees()).toHaveLength(0)

    // The document is untouched, name and all: it holds a SNAPSHOT, and a
    // document already sent has to render tomorrow as it rendered the day it
    // went out (ADR-041 §5).
    const after = await getDocument('doc-with-addressee')
    if (!after.ok) throw new Error('lost the document')
    expect(after.doc.meta.to[0]?.name.en).toBe('Shri X')
    expect(after.doc.meta.to[0]?.bookId).toBe(entry.id)
  })
})

describe('issuing a number', () => {
  it('advances the sequence and records the issue', async () => {
    const pattern = {
      ...newPattern({ id: 'p1', at: '2026-09-01T00:00:00.000Z', year: 2026 }),
      pattern: 'A-11011/{SEQ}/{YEAR}-{SECTION}',
      section: 'Estt.',
    }
    await savePattern(pattern)

    const first = await issueNumber({ patternId: 'p1', docId: 'doc-1', type: 'O.M.', year: 2026 })
    expect(first?.number).toBe('A-11011/1/2026-Estt.')
    expect(first?.duplicates).toEqual([])

    const second = await issueNumber({ patternId: 'p1', docId: 'doc-2', type: 'O.M.', year: 2026 })
    expect(second?.number).toBe('A-11011/2/2026-Estt.')
    expect(await db.numberIssues.count()).toBe(2)
  })

  it('warns about a duplicate rather than refusing — a corrigendum carries the original number', async () => {
    await savePattern({
      ...newPattern({ id: 'p1', at: '2026-09-01T00:00:00.000Z', year: 2026 }),
      pattern: 'FIXED-{YEAR}',
    })
    await issueNumber({ patternId: 'p1', docId: 'doc-1', type: 'O.M.', year: 2026 })
    const second = await issueNumber({ patternId: 'p1', docId: 'doc-2', type: 'O.M.', year: 2026 })
    expect(second?.duplicates).toHaveLength(1)
    expect(await db.numberIssues.count()).toBe(2)
  })

  it('issues NOTHING when the pattern names a token this app does not know', async () => {
    await savePattern({
      ...newPattern({ id: 'p1', at: '2026-09-01T00:00:00.000Z', year: 2026 }),
      pattern: '{SEQNO}/{YEAR}',
    })
    const result = await issueNumber({ patternId: 'p1', docId: 'doc-1', type: 'O.M.', year: 2026 })
    expect(result?.unknownTokens).toEqual(['SEQNO'])
    // Nothing was written: the sequence did not move and no issue was recorded.
    expect(await db.numberIssues.count()).toBe(0)
    expect((await db.numberPatterns.get('p1'))?.seq).toBe(0)
  })

  it('restarts the serial in a new year', async () => {
    await savePattern({
      ...newPattern({ id: 'p1', at: '2026-09-01T00:00:00.000Z', year: 2026 }),
      pattern: '{SEQ}/{YEAR}',
      resetPolicy: 'yearly',
    })
    await issueNumber({ patternId: 'p1', docId: 'a', type: 'x', year: 2026 })
    await issueNumber({ patternId: 'p1', docId: 'b', type: 'x', year: 2026 })
    const next = await issueNumber({ patternId: 'p1', docId: 'c', type: 'x', year: 2027 })
    expect(next?.number).toBe('1/2027')
  })

  it('answers null for a pattern that does not exist', async () => {
    expect(await issueNumber({ patternId: 'nope', docId: 'a', type: 'x', year: 2026 })).toBeNull()
  })
})

describe('creating a document from a form', () => {
  it('snapshots the profile and instantiates the skeleton', async () => {
    const template = await loadTemplate('office-order')
    const profile = {
      ...emptyProfile('2026-09-01T00:00:00.000Z'),
      name: { en: 'A.B.C.', hi: 'ए.बी.सी.' },
      designation: { en: 'Under Secretary', hi: 'अवर सचिव' },
      place: 'New Delhi',
    }
    const doc = await createDocument({ template, profile })

    expect(doc.meta.from.name).toEqual({ en: 'A.B.C.', hi: 'ए.बी.सी.' })
    expect(doc.meta.signature.designation).toEqual({ en: 'Under Secretary', hi: 'अवर सचिव' })
    expect(doc.meta.place).toBe('New Delhi')
    // The variables are NOT seeded from their samples — the worked example is
    // something a caller asks for, never something a blank document starts as.
    expect(doc.vars.officerName).toBeUndefined()
    // …so the skeleton's placeholders survive as chips.
    expect(JSON.stringify(doc.body)).toContain('"placeholder"')
    expect(await db.documents.count()).toBe(1)
  })

  it('changing the profile afterwards leaves the document alone', async () => {
    const template = await loadTemplate('office-order')
    const profile = { ...emptyProfile('2026-09-01T00:00:00.000Z'), name: { en: 'A.B.C.', hi: 'ए.बी.सी.' } }
    const doc = await createDocument({ template, profile })
    await saveProfile({ ...profile, name: { en: 'Promoted Person', hi: 'पदोन्नत व्यक्ति' } })

    const after = await getDocument(doc.id)
    if (!after.ok) throw new Error('lost the document')
    expect(after.doc.meta.from.name.en).toBe('A.B.C.')
  })
})

describe('migrating the older drafts', () => {
  const draft = (id: string, templateId = 'office-memorandum') => ({
    id,
    templateId,
    title: 'An old draft',
    values: { paras: ['One.', 'Two.'], subject: 'From the old editor', fileNumber: 'A-9/2026' },
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  })

  it('copies each draft across and NEVER deletes the original', async () => {
    await db.drafts.bulkPut([draft('d1'), draft('d2')])
    expect(await pendingMigrationCount()).toBe(2)

    const report = await migrateAllDrafts()
    expect(report.migrated).toBe(2)
    expect(await db.drafts.count()).toBe(2)
    expect(await db.documents.count()).toBe(2)
    expect(await pendingMigrationCount()).toBe(0)
  })

  it('is idempotent — running it twice produces one document per draft', async () => {
    await db.drafts.put(draft('d1'))
    await migrateAllDrafts()
    const second = await migrateAllDrafts()
    expect(second.migrated).toBe(0)
    expect(second.skipped).toBe(1)
    expect(await db.documents.count()).toBe(1)
  })

  it('reports a draft whose form no longer exists rather than dropping or guessing', async () => {
    await db.drafts.put(draft('d1', 'a-form-that-was-removed'))
    const report = await migrateAllDrafts()
    expect(report.migrated).toBe(0)
    expect(report.failed).toEqual([
      { draftId: 'd1', templateId: 'a-form-that-was-removed', reason: 'unknown-template' },
    ])
    expect(await db.drafts.count()).toBe(1)
  })

  it('keeps the draft`s own updatedAt so the list opens in the order work was left in', async () => {
    await db.drafts.put(draft('d1'))
    await migrateAllDrafts()
    expect((await db.documents.get('d1'))?.updatedAt).toBe('2026-06-01T00:00:00.000Z')
  })
})

describe('the backup', () => {
  it('includes every one of the ten new tables, because it excludes by name', async () => {
    await putDocument(make())
    await snapshot(make(), 'manual', 'v')
    await addComment('doc-1', 0, 'a', 'note')
    await saveProfile(emptyProfile('2026-09-01T00:00:00.000Z'))
    await putAddressee(newAddressee())
    await savePattern(newPattern({ id: 'p1', at: '2026-09-01T00:00:00.000Z', year: 2026 }))

    const backup = (await buildBackup('0.1.0')) as unknown as { tables: Record<string, unknown[]> }
    for (const table of [
      'documents',
      'docVersions',
      'docComments',
      'draftingProfile',
      'addressBook',
      'numberPatterns',
    ]) {
      expect(backup.tables[table], table).toBeDefined()
      expect((backup.tables[table] ?? []).length, table).toBeGreaterThan(0)
    }
    // And the three that must never be exported still are not.
    for (const table of ['secrets', 'aiAnswers', 'aiUsage']) {
      expect(backup.tables[table], table).toBeUndefined()
    }
  })
})
