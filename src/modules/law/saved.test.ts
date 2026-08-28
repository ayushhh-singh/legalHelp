import { describe, expect, it } from 'vitest'

import {
  addFavourite,
  clearRecents,
  isFavourite,
  listFavourites,
  listRecents,
  recordLookup,
  removeFavouriteById,
  RECENT_LIMIT,
  rowId,
  toggleFavourite,
} from './saved'
import type { LawCode, LawSection } from './types'

import { db } from '@/db'

/**
 * Saved sections and recent lookups. Both are IndexedDB, on the device, and
 * neither ever leaves it (master context, hard rule).
 *
 * `src/test/setup.ts` clears every table before each test, so each of these
 * starts from an empty device.
 */

function record(section: string, overrides: Partial<LawSection> = {}): LawSection {
  return {
    section,
    act: 'BNS',
    heading: { en: `Heading ${section}`, hi: `शीर्षक ${section}` },
    status: 'changed',
    chapter: { number: 'I', title: { en: '', hi: '' } },
    mappings: [],
    repeals: [],
    text: { en: '', hi: '' },
    classification: [],
    punishment: { en: '', hi: '' },
    keywords: { en: [], hi: [], roman: [] },
    notes: [],
    sources: ['ncrb-sankalan-table'],
    verify: false,
    ...overrides,
  }
}

const BNS: LawCode = 'bns'

describe('favourites', () => {
  it('starts empty', async () => {
    expect(await listFavourites()).toEqual([])
    expect(await isFavourite(BNS, '103')).toBe(false)
  })

  it('saves a section and reports it as saved', async () => {
    await addFavourite(BNS, record('103'))
    expect(await isFavourite(BNS, '103')).toBe(true)
    expect((await listFavourites()).map((row) => row.id)).toEqual(['bns:103'])
  })

  it('stores a heading snapshot, so the saved list renders with no data loaded', async () => {
    // The saved page must work before 3.9 MB of section text has parsed —
    // that is the whole reason the row carries a heading at all.
    await addFavourite(BNS, record('103'))
    const [row] = await listFavourites()
    expect(row?.heading).toEqual({ en: 'Heading 103', hi: 'शीर्षक 103' })
    expect(row?.act).toBe('BNS')
  })

  it('saving the same section twice keeps one row', async () => {
    await addFavourite(BNS, record('103'))
    await addFavourite(BNS, record('103'))
    expect(await listFavourites()).toHaveLength(1)
  })

  it('lists the newest first', async () => {
    await addFavourite(BNS, record('103'))
    await new Promise((resolve) => setTimeout(resolve, 2))
    await addFavourite(BNS, record('318'))
    expect((await listFavourites()).map((row) => row.section)).toEqual(['318', '103'])
  })

  it('toggles off and reports the state it settled on', async () => {
    expect(await toggleFavourite(BNS, record('103'))).toBe(true)
    expect(await toggleFavourite(BNS, record('103'))).toBe(false)
    expect(await isFavourite(BNS, '103')).toBe(false)
  })

  it('removes by the row’s own key', async () => {
    await addFavourite(BNS, record('103'))
    await removeFavouriteById(rowId(BNS, '103'))
    expect(await listFavourites()).toEqual([])
  })

  it('keeps the same section in two different codes apart', async () => {
    // BNS 103 and BNSS 103 are different provisions with the same number.
    await addFavourite('bns', record('103'))
    await addFavourite('bnss', record('103', { act: 'BNSS' }))
    expect(await listFavourites()).toHaveLength(2)
    expect(await isFavourite('bns', '103')).toBe(true)
  })
})

describe('recent lookups', () => {
  it('records a section that was opened', async () => {
    await recordLookup(BNS, record('103'), '302')
    const [row] = await listRecents()
    expect(row?.section).toBe('103')
    expect(row?.query).toBe('302')
  })

  it('moves a re-opened section to the top rather than duplicating it', async () => {
    await recordLookup(BNS, record('103'), '302')
    await recordLookup(BNS, record('318'), '420')
    await new Promise((resolve) => setTimeout(resolve, 2))
    await recordLookup(BNS, record('103'), 'murder')

    const recents = await listRecents()
    expect(recents).toHaveLength(2)
    expect(recents[0]?.section).toBe('103')
    expect(recents[0]?.query).toBe('murder')
  })

  it(`keeps only the last ${RECENT_LIMIT}`, async () => {
    for (let i = 1; i <= RECENT_LIMIT + 5; i += 1) {
      await recordLookup(BNS, record(String(i)), String(i))
    }
    // The trim is what stops an unbounded table: IndexedDB's failure mode at
    // quota is that some unrelated write starts throwing.
    expect(await db.lawRecents.count()).toBe(RECENT_LIMIT)

    const sections = (await listRecents()).map((row) => row.section)
    expect(sections).toHaveLength(RECENT_LIMIT)
    expect(sections).not.toContain('1')
    expect(sections).toContain(String(RECENT_LIMIT + 5))
  })

  it('trims the OLDEST, not an arbitrary row', async () => {
    for (let i = 1; i <= RECENT_LIMIT; i += 1) {
      await recordLookup(BNS, record(String(i)), String(i))
    }
    await recordLookup(BNS, record('999'), '999')

    const sections = (await listRecents()).map((row) => row.section)
    expect(sections).toContain('999')
    expect(sections).not.toContain('1')
    expect(sections).toContain('2')
  })

  it('is cleared on request', async () => {
    await recordLookup(BNS, record('103'), '302')
    await clearRecents()
    expect(await listRecents()).toEqual([])
  })

  it('does not touch the favourites when recents are cleared', async () => {
    await addFavourite(BNS, record('103'))
    await recordLookup(BNS, record('103'), '302')
    await clearRecents()
    expect(await listFavourites()).toHaveLength(1)
  })
})
