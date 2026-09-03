import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { getDocument, putDocument } from './documents'
import { useOfficialDoc } from './useOfficialDoc'

import { db } from '@/db'
import { emptyMeta, newDoc, type BodyDoc, type OfficialDoc } from '@/lib/drafting/model'

/**
 * `useOfficialDoc`, and the two-tab conflict in particular.
 *
 * The conflict path is the hardest thing in this hook to be sure about, because
 * every way of getting it wrong loses somebody's paragraphs silently. What is
 * asserted here is the whole contract: a conflict is detected rather than
 * clobbered, BOTH answers keep both versions recoverable, and choosing the
 * other tab's version is not quietly undone a moment later by a write that was
 * already in flight.
 */

const body = (...paras: string[]): BodyDoc => ({
  type: 'doc',
  content: paras.map((text) => ({
    type: 'numberedPara',
    attrs: { level: 1 },
    content: [{ type: 'text', text }],
  })),
})

const make = (text: string): OfficialDoc =>
  newDoc({
    id: 'doc-1',
    templateId: 'office-memorandum',
    lang: 'en',
    at: '2026-09-01T00:00:00.000Z',
    meta: { ...emptyMeta(), number: 'A-1/2026' },
    body: body(text),
  })

/** What another tab did: a newer row, written behind this hook's back. */
async function otherTabSaves(text: string): Promise<void> {
  await db.documents.put({
    id: 'doc-1',
    templateId: 'office-memorandum',
    title: '',
    status: 'draft',
    createdAt: '2026-09-01T00:00:00.000Z',
    // Far enough ahead that the string comparison cannot tie.
    updatedAt: '2099-01-01T00:00:00.000Z',
    doc: { ...make(text), updatedAt: '2099-01-01T00:00:00.000Z' },
  })
}

const textOf = (doc: OfficialDoc | null): string => JSON.stringify(doc?.body ?? {})

describe('two-tab conflict', () => {
  it('reports a conflict instead of overwriting the other tab', async () => {
    await putDocument(make('the original'))
    const { result } = renderHook(() => useOfficialDoc('doc-1'))
    await waitFor(() => expect(result.current.status).toBe('ready'))

    await otherTabSaves('the other tab wrote this')

    await act(async () => {
      result.current.update({ ...make('what I typed'), updatedAt: '2026-09-02T00:00:00.000Z' })
      await result.current.flush()
    })

    await waitFor(() => expect(result.current.save.kind).toBe('conflict'))
    const stored = await getDocument('doc-1')
    if (!stored.ok) throw new Error('lost the document')
    expect(textOf(stored.doc)).toContain('the other tab wrote this')
  })

  it("taking the other tab's version is not undone by a write already queued", async () => {
    // The defect this test was written for: `resolveConflict('theirs')` set the
    // document and cleared the banner but left the debounce timer armed, so a
    // keystroke typed WHILE the banner was on screen landed 700 ms later and
    // wrote the officer's text over the version they had just chosen to take.
    // Reachable in the app because the editor stays editable under the banner.
    await putDocument(make('the original'))
    const { result } = renderHook(() => useOfficialDoc('doc-1'))
    await waitFor(() => expect(result.current.status).toBe('ready'))

    await otherTabSaves('theirs')
    await act(async () => {
      result.current.update(make('mine'))
      await result.current.flush()
    })
    await waitFor(() => expect(result.current.save.kind).toBe('conflict'))

    // The officer goes on typing under the banner, then takes theirs.
    act(() => {
      result.current.update(make('mine, still typing'))
    })
    await act(async () => {
      await result.current.resolveConflict('theirs')
    })

    // Give the debounce longer than its own window to do its worst.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1200))
    })

    const stored = await getDocument('doc-1')
    if (!stored.ok) throw new Error('lost the document')
    expect(textOf(stored.doc)).toContain('theirs')
    expect(textOf(stored.doc)).not.toContain('still typing')
    expect(textOf(result.current.doc)).toContain('theirs')
  })

  it('keeping mine snapshots theirs first, so neither is lost', async () => {
    await putDocument(make('the original'))
    const { result } = renderHook(() => useOfficialDoc('doc-1'))
    await waitFor(() => expect(result.current.status).toBe('ready'))

    await otherTabSaves('theirs')
    await act(async () => {
      result.current.update(make('mine'))
      await result.current.flush()
    })
    await waitFor(() => expect(result.current.save.kind).toBe('conflict'))

    await act(async () => {
      await result.current.resolveConflict('mine')
    })

    const stored = await getDocument('doc-1')
    if (!stored.ok) throw new Error('lost the document')
    expect(textOf(stored.doc)).toContain('mine')
    const versions = await db.docVersions.where('docId').equals('doc-1').toArray()
    expect(JSON.stringify(versions)).toContain('theirs')
  })
})

describe('reading a document', () => {
  it('reports a document written by a newer build without rendering it', async () => {
    await db.documents.put({
      id: 'doc-1',
      templateId: 'office-memorandum',
      title: '',
      status: 'draft',
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
      doc: { ...make('from the future'), docModelVersion: 99 },
    })
    const { result } = renderHook(() => useOfficialDoc('doc-1'))
    await waitFor(() => expect(result.current.status).toBe('too-new'))
    expect(result.current.storedVersion).toBe(99)
    expect(result.current.doc).toBeNull()
  })

  it('reports a document that is not there', async () => {
    const { result } = renderHook(() => useOfficialDoc('nope'))
    await waitFor(() => expect(result.current.status).toBe('missing'))
  })
})
