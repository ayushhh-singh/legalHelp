import { beforeEach, describe, expect, it } from 'vitest'

import {
  bookmarkMany,
  bulkApprove,
  decideCard,
  listBookmarks,
  listCardOverrides,
  listProposedCards,
  listReports,
  reportsToCsv,
  submitReport,
  toggleBookmark,
} from './store'

import { clearAllData, db } from '@/db'

beforeEach(async () => {
  await clearAllData()
})

describe('bookmarks', () => {
  it('toggles on then off', async () => {
    expect(await toggleBookmark('q1')).toBe(true)
    expect(await listBookmarks()).toHaveLength(1)

    expect(await toggleBookmark('q1')).toBe(false)
    expect(await listBookmarks()).toHaveLength(0)
  })
})

describe('bookmarkMany', () => {
  it('bookmarks every id, and never un-bookmarks one already set', async () => {
    await toggleBookmark('q1')
    await bookmarkMany(['q1', 'q2', 'q3'])
    const rows = await listBookmarks()
    expect(rows.map((row) => row.qId).sort()).toEqual(['q1', 'q2', 'q3'])
  })
})

describe('reports', () => {
  it('records a report and lists newest first', async () => {
    await submitReport('q1', 'wrong-answer', 'The key says B but the rule says C.')
    await new Promise((resolve) => setTimeout(resolve, 2))
    await submitReport('q2', 'unclear', '')

    const rows = await listReports()
    expect(rows.map((row) => row.qId)).toEqual(['q2', 'q1'])
  })

  it('exports to a CSV a reader could hand to an auditor', () => {
    const csv = reportsToCsv([
      { id: 'q1#1', qId: 'q1', reason: 'wrong-answer', note: 'Says "B"', createdAt: '2026-08-28T00:00:00.000Z' },
    ])
    expect(csv).toBe('id,qId,reason,note,createdAt\n"q1#1","q1","wrong-answer","Says ""B""","2026-08-28T00:00:00.000Z"')
  })
})

describe('review queue decisions', () => {
  it('records a single decision', async () => {
    await decideCard({ qId: 'q1', action: 'approved' })
    const [row] = await listCardOverrides()
    expect(row?.qId).toBe('q1')
    expect(row?.action).toBe('approved')
    expect(row?.patch).toBeNull()
    expect(typeof row?.decidedAt).toBe('string')
  })

  it('records a decision with a patch', async () => {
    await decideCard({ qId: 'q1', action: 'approved', patch: { front: { en: 'Fixed' } } })
    const [row] = await listCardOverrides()
    expect(row?.patch).toEqual({ front: { en: 'Fixed' } })
  })

  it('a later decision on the same card overwrites the earlier one', async () => {
    await decideCard({ qId: 'q1', action: 'approved' })
    await decideCard({ qId: 'q1', action: 'rejected' })
    const overrides = await listCardOverrides()
    expect(overrides).toHaveLength(1)
    expect(overrides[0]?.action).toBe('rejected')
  })

  it('bulk-approves every id given, in one write', async () => {
    await bulkApprove(['q1', 'q2', 'q3'])
    const overrides = await listCardOverrides()
    expect(overrides.map((row) => row.qId).sort()).toEqual(['q1', 'q2', 'q3'])
    expect(overrides.every((row) => row.action === 'approved')).toBe(true)
  })

  it('reads proposed cards written elsewhere (the AI tool)', async () => {
    await db.proposedCards.put({ id: 'ai-1', card: { id: 'ai-1' }, createdAt: '2026-08-28T00:00:00.000Z' })
    const rows = await listProposedCards()
    expect(rows.map((row) => row.id)).toEqual(['ai-1'])
  })
})
