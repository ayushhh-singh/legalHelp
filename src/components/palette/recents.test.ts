import { describe, expect, it } from 'vitest'

import { listCommandRecents, recordCommandRecent, RECENT_LIMIT } from './recents'
import type { PaletteItem } from './types'

/**
 * The palette's recent-jumps list. `src/test/setup.ts` clears every table
 * before each test, the same arrangement `glossary/favourites.test.ts` relies
 * on for its own recents half.
 */

function item(id: string, overrides: Partial<PaletteItem> = {}): PaletteItem {
  return { id, en: `Item ${id}`, hi: `मद ${id}`, to: `/law?q=${id}`, ...overrides }
}

describe('command palette recents', () => {
  it('starts empty', async () => {
    expect(await listCommandRecents()).toEqual([])
  })

  it('re-recording an item moves it to the top rather than duplicating it', async () => {
    await recordCommandRecent(item('a'), 'law')
    await recordCommandRecent(item('b'), 'pay')
    await recordCommandRecent(item('a'), 'law')

    const recents = await listCommandRecents()
    expect(recents.map((entry) => entry.id)).toEqual(['a', 'b'])
  })

  it('carries the item’s own text and destination through', async () => {
    await recordCommandRecent(item('a', { en: 'Punishment for murder', hi: 'हत्या के लिए दंड' }), 'law')
    const [recent] = await listCommandRecents()
    expect(recent).toMatchObject({ id: 'a', en: 'Punishment for murder', hi: 'हत्या के लिए दंड', to: '/law?q=a' })
  })

  it(`keeps at most ${RECENT_LIMIT} rows`, async () => {
    for (let i = 0; i < RECENT_LIMIT + 5; i += 1) {
      await recordCommandRecent(item(`item-${i}`), 'law')
    }
    const recents = await listCommandRecents()
    expect(recents).toHaveLength(RECENT_LIMIT)
    expect(recents[0]?.id).toBe(`item-${RECENT_LIMIT + 4}`)
    expect(recents.some((entry) => entry.id === 'item-0')).toBe(false)
  })

  it('marks every row `recordRecent: true`, so re-selecting one FROM the list re-stamps it', async () => {
    await recordCommandRecent(item('a'), 'law')
    await recordCommandRecent(item('b'), 'pay')

    // `CommandPalette.tsx#go` only calls `recordCommandRecent` when the
    // selected item's own `recordRecent` is truthy — a row read back out of
    // `listCommandRecents()` has to carry that flag itself, or clicking an
    // already-"Recent" item silently does nothing and it never moves back to
    // the top on a later visit.
    const recents = await listCommandRecents()
    expect(recents.every((entry) => entry.recordRecent === true)).toBe(true)

    // Simulate selecting "a" (currently rank 2) FROM the recents list: the
    // real code re-records it with the id and section this list already
    // carries (`item.hint` holds the original section — see the CommandPalette
    // call site).
    const a = recents.find((entry) => entry.id === 'a')
    if (!a) throw new Error('expected "a" in recents')
    await recordCommandRecent(a, a.hint ?? 'recent')

    const after = await listCommandRecents()
    expect(after.map((entry) => entry.id)).toEqual(['a', 'b'])
    // And the section survived the round trip rather than being overwritten
    // with a generic "recent" label.
    expect(after.find((entry) => entry.id === 'a')?.hint).toBe('law')
  })
})
