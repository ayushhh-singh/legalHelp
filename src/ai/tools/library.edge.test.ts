import { beforeEach, describe, expect, it } from 'vitest'

import { registerBuiltinTools } from './index'
import { resetLibraryToolCache } from './library'
import { listTools } from './registry'

import { db } from '@/db'
import { WORK_IDS } from '@/lib/library'
import { ACT_IDS } from '@/modules/trainer/data'

/**
 * An edge-case pass over the study agent's tools, after the commit.
 *
 * Every test here was confirmed to FAIL against the committed code before its
 * fix was written.
 */

const call = async (name: string, input: unknown) => {
  registerBuiltinTools()
  const tool = listTools('library').find((entry) => entry.def.name === name)
  expect(tool, `${name} is not registered`).toBeDefined()
  return tool!.def.handler(input as never, { language: 'en', signal: new AbortController().signal })
}

beforeEach(async () => {
  resetLibraryToolCache()
  await Promise.all([db.libraryNotes.clear(), db.libraryHighlights.clear()])
})

describe('get_my_notes — the one tool that reads what the officer wrote', () => {
  /**
   * Every other tool in this file guards on `isWorkId` and this one did not, so
   * an unknown work came back as a confident, empty
   * `{ personal: true, notes: [], highlights: [] }` — indistinguishable, to the
   * model reading it, from "this reader has written nothing here".
   */
  it('says it does not recognise a work rather than reporting no notes', async () => {
    const result = (await call('get_my_notes', { work: 'not-a-work' })) as Record<string, unknown>
    expect(result.error).toBe('unknown work')
  })

  it('still marks every row as the reader’s own', async () => {
    await db.libraryNotes.put({
      id: 'n1',
      workId: 'ccs-conduct',
      unitId: 'ccs-conduct-3',
      body: 'My own reading of this rule.',
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    })
    const result = (await call('get_my_notes', { work: 'ccs-conduct' })) as {
      personal: boolean
      notes: { personal: boolean }[]
    }
    expect(result.personal).toBe(true)
    expect(result.notes).toHaveLength(1)
    expect(result.notes[0]!.personal).toBe(true)
  })
})

describe('get_related_cards loads one act, not twelve', () => {
  /**
   * The handler used to call `loadAllCards` — 1.1 MB across twelve rule books —
   * to answer a question about one of them. It now loads the act whose id is
   * the work's, which only works because those ids are the same. If a future
   * work id stops matching its act id, this fails here rather than silently
   * returning no practice questions for that book.
   */
  it('every rule-book work id is also its Trainer act id', () => {
    const shared = WORK_IDS.filter((id) => ACT_IDS.includes(id))
    // The twelve rule books; the three Sanhitas have no cards.
    expect(shared).toHaveLength(12)
    for (const actId of ACT_IDS) {
      expect(WORK_IDS, `${actId} has no Library work`).toContain(actId)
    }
  })

  it('returns the cards that cite a unit', async () => {
    const result = (await call('get_related_cards', {
      work: 'ccs-conduct',
      unit: 'ccs-conduct-3',
    })) as { count: number; cards: { unit: string }[] }
    expect(result.count).toBeGreaterThan(0)
    for (const card of result.cards) expect(card.unit).toBe('ccs-conduct-3')
  })

  /** A work with no rule book behind it is empty, not an error. */
  it('is empty for a Sanhita rather than throwing', async () => {
    const result = (await call('get_related_cards', { work: 'bns', unit: '103' })) as { count: number }
    expect(result.count).toBe(0)
  })
})
