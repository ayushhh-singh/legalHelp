import { describe, expect, it } from 'vitest'

import {
  clearRecents,
  isFavourite,
  listFavourites,
  listRecents,
  recordLookup,
  RECENT_LIMIT,
  toggleFavourite,
} from './favourites'
import type { GlossaryTerm } from './schema'

/**
 * Favourites and recent lookups. Both are IndexedDB, on the device, and
 * neither ever leaves it (master context, hard rule).
 *
 * `src/test/setup.ts` clears every table before each test, so each of these
 * starts from an empty device — the same arrangement `src/modules/law/
 * saved.test.ts` relies on.
 */

function term(id: string, overrides: Partial<GlossaryTerm> = {}): GlossaryTerm {
  return {
    id,
    category: 'designation',
    en: `Term ${id}`,
    hi: `शब्द ${id}`,
    source: { name: 'Test source', url: 'https://rajbhasha.gov.in/x' },
    fetchedAt: '2026-08-28T00:00:00Z',
    verify: true,
    ...overrides,
  }
}

describe('favourites', () => {
  it('starts empty', async () => {
    expect(await listFavourites()).toEqual([])
    expect(await isFavourite('avar-sachiv')).toBe(false)
  })

  it('toggles on then off, returning the state it settled on', async () => {
    const t = term('avar-sachiv', { en: 'Under Secretary', hi: 'अवर सचिव' })
    expect(await toggleFavourite(t)).toBe(true)
    expect(await isFavourite('avar-sachiv')).toBe(true)

    const list = await listFavourites()
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ termId: 'avar-sachiv', en: 'Under Secretary', hi: 'अवर सचिव' })

    expect(await toggleFavourite(t)).toBe(false)
    expect(await isFavourite('avar-sachiv')).toBe(false)
    expect(await listFavourites()).toEqual([])
  })

  it('lists newest favourite first', async () => {
    await toggleFavourite(term('a'))
    await toggleFavourite(term('b'))
    const list = await listFavourites()
    expect(list.map((row) => row.termId)).toEqual(['b', 'a'])
  })
})

describe('recent lookups', () => {
  it('starts empty', async () => {
    expect(await listRecents()).toEqual([])
  })

  it('re-recording a term moves it to the top rather than duplicating it', async () => {
    await recordLookup(term('a'))
    await recordLookup(term('b'))
    await recordLookup(term('a'))

    const recents = await listRecents()
    expect(recents.map((row) => row.termId)).toEqual(['a', 'b'])
  })

  it(`keeps at most ${RECENT_LIMIT} rows`, async () => {
    for (let i = 0; i < RECENT_LIMIT + 5; i += 1) {
      await recordLookup(term(`term-${i}`))
    }
    const recents = await listRecents()
    expect(recents).toHaveLength(RECENT_LIMIT)
    // Newest first, and the oldest five were trimmed.
    expect(recents[0]?.termId).toBe(`term-${RECENT_LIMIT + 4}`)
    expect(recents.some((row) => row.termId === 'term-0')).toBe(false)
  })

  it('clears', async () => {
    await recordLookup(term('a'))
    await clearRecents()
    expect(await listRecents()).toEqual([])
  })
})
