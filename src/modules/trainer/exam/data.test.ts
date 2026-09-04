import { beforeEach, describe, expect, it } from 'vitest'

import { EXAM_PROFILE_IDS, isExamProfileId, loadExamIndex, loadExamProfile, resetExamCache } from './data'

import { examIndexSchema, examProfileSchema } from '@/schemas/exam'

/**
 * The loader map, exercised through the REAL `?raw` specifiers.
 *
 * `src/lib/library/data.test.ts` exists for exactly this reason and states it:
 * a mistyped path in that map is a profile that opens onto an error, and
 * nothing that reads the same files with `node:fs` would ever see it —
 * `tests/exam-data.test.ts` reads them off disk and would pass with every
 * specifier in this module wrong.
 */

beforeEach(() => {
  resetExamCache()
})

describe('the loaders', () => {
  it('loads the index through its own specifier', async () => {
    const index = await loadExamIndex()
    expect(() => examIndexSchema.parse(index)).not.toThrow()
    expect(index.profiles.length).toBeGreaterThanOrEqual(3)
  })

  it('loads every profile the map declares, and each knows its own id', async () => {
    for (const id of EXAM_PROFILE_IDS) {
      const profile = await loadExamProfile(id)
      expect(() => examProfileSchema.parse(profile)).not.toThrow()
      expect(profile.id, id).toBe(id)
    }
  })

  it('declares a loader for every profile the index lists, and no more', async () => {
    // Both directions. A profile in `data/exams` with no loader is unreachable
    // from the app; a loader for a profile the index does not list is a card
    // the picker will never draw.
    const index = await loadExamIndex()
    expect([...EXAM_PROFILE_IDS].sort()).toEqual(index.profiles.map((entry) => entry.id).sort())
  })

  it('refuses an id out of the address bar rather than reaching for it', async () => {
    // `Object.hasOwn`, never `in` — `src/lib/library/data.ts` records why: a
    // bare `in` walks `Object.prototype`, so `constructor` and `toString` would
    // be accepted as profile ids.
    for (const bad of ['constructor', 'toString', '__proto__', 'not-a-profile', '']) {
      expect(isExamProfileId(bad), bad).toBe(false)
    }
    await expect(loadExamProfile('constructor')).rejects.toThrow(/unknown exam profile/)
  })

  it('caches a success and never caches a failure', async () => {
    const first = await loadExamProfile('css-so-ldce')
    expect(await loadExamProfile('css-so-ldce')).toBe(first)
    // An offline first visit must be able to succeed on the next attempt rather
    // than being stuck for the tab's life.
    await expect(loadExamProfile('nope')).rejects.toThrow()
    await expect(loadExamProfile('nope')).rejects.toThrow()
  })
})
