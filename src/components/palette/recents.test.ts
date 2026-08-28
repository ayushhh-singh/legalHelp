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
})
