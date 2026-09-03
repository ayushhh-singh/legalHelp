import { beforeEach, describe, expect, it, vi } from 'vitest'

import { isWorkId, loadCorpus, loadWork, resetLibraryCache } from './data'
import { estimateReadTime } from './readTime'
import { recordProgress } from './store'

import { db } from '@/db'
import type { LibraryWork } from '@/schemas/library'

/**
 * An edge-case pass over the Library, after the commit.
 *
 * Every test here was confirmed to FAIL against the committed code before its
 * fix was written — the discipline ADR-025, ADR-028, ADR-029, ADR-032, ADR-035
 * and ADR-037 each recorded in their own addendum.
 *
 * The pattern this project keeps rediscovering held again. The DATA was
 * obviously untrusted, so it is schema-validated twice, its pointers are
 * checked in both directions and its structure is asserted over every unit of
 * every work. The CODE AROUND IT was written as though code cannot fail: a
 * lookup that walks `Object.prototype`, a write to a database that can be
 * blocked, and a decorative read that the whole page waits for.
 */

beforeEach(() => {
  resetLibraryCache()
})

describe('a work id from the URL is untrusted input', () => {
  /**
   * `workId` comes out of `useParams`, which is to say out of the address bar.
   * `WORK_LOADERS` is an object literal, so `'constructor' in WORK_LOADERS` is
   * TRUE — `in` walks the prototype chain — and `WORK_LOADERS['toString']` is
   * a real function. `isWorkId` therefore accepted a handful of strings that
   * are not works at all, and `loadWork` called `Object.prototype.toString`
   * as though it were a dynamic import, reaching `JSON.parse(undefined)` and
   * failing with a SyntaxError that names nothing a reader or a maintainer
   * could act on.
   *
   * Nothing is exploitable here — there is no secret to reach and no network
   * to reach it over. It is wrong in the ordinary way: a guard that says yes
   * to something it was written to say no to.
   */
  it.each(['constructor', 'toString', 'hasOwnProperty', '__proto__', 'valueOf'])(
    'refuses %s, which lives on Object.prototype and not in the catalogue',
    (name) => {
      expect(isWorkId(name)).toBe(false)
    },
  )

  it.each(['constructor', 'toString', '__proto__'])(
    'rejects %s by name rather than failing inside a JSON parse',
    async (name) => {
      await expect(loadWork(name)).rejects.toThrow(/unknown library work/)
    },
  )

  it('refuses a prototype key as a corpus pointer too', async () => {
    const work = await loadWork('rti')
    const broken = { ...work, corpus: { kind: 'rules', file: 'toString' } } as unknown as LibraryWork
    await expect(loadCorpus(broken)).rejects.toThrow(/unknown corpus pointer/)
  })
})

describe('reading progress on a device whose storage refuses', () => {
  /**
   * "Store hydrates from it and tolerates blocked storage" is a property this
   * app states about itself. A reader in a private window, on a managed device
   * with site data blocked, or simply over quota, gets a rejected Dexie
   * promise — and `recordProgress` is called from an effect on every unit and
   * from a 30-second interval after that.
   *
   * Recording where somebody got to is a convenience. Failing to record it must
   * cost them nothing: not an unhandled rejection, and certainly not the rule
   * they were reading. It reports `false` so a caller that cares can tell —
   * which is the difference between swallowing an error and handling one.
   */
  it('resolves false rather than rejecting when the write fails', async () => {
    const put = vi.spyOn(db.libraryProgress, 'put').mockRejectedValue(new Error('QuotaExceededError'))
    try {
      await expect(recordProgress('rti', 'rti-8', 0)).resolves.toBe(false)
    } finally {
      put.mockRestore()
    }
  })

  it('resolves false when the whole transaction is refused', async () => {
    const transaction = vi
      .spyOn(db, 'transaction')
      .mockRejectedValue(new Error('DatabaseClosedError')) as unknown as { mockRestore: () => void }
    try {
      await expect(recordProgress('rti', 'rti-8', 30)).resolves.toBe(false)
    } finally {
      transaction.mockRestore()
    }
  })

  it('reports true on a device that accepts the write, so `false` means something', async () => {
    // Without this the two tests above pass just as happily against a function
    // that always returns false and never writes anything at all.
    await expect(recordProgress('rti', 'rti-8', 30)).resolves.toBe(true)
    expect((await db.libraryProgress.get('rti:rti-8'))?.secondsRead).toBe(30)
  })
})

describe('estimateReadTime', () => {
  /**
   * The committed version ended `Math.ceil(minutes || words.length / WPM[lang])`.
   * That fallback cannot fire: `minutes` is zero only when both word counts are
   * zero, which happens only when there are no words, which the guard above it
   * has already returned for. A branch that cannot be reached is a claim about
   * behaviour that nothing supports — and this one implied a language-dependent
   * answer the function does not actually have.
   *
   * The parameter went with it, for the same reason: it provably carried no
   * information, and a parameter that does nothing is the same lie the branch
   * was. What is kept is the property both were reaching for — the answer is a
   * property of the TEXT, arrived at per word by the script that word is
   * written in.
   */
  it('rates each word by its own script, so the answer is a property of the text', () => {
    // 180 English words and 140 Devanagari ones are each one minute, so a
    // string of both is two — a figure no single rate produces. That is the
    // claim the removed parameter was obscuring.
    const english = Array(180).fill('word').join(' ')
    const hindi = Array(140).fill('शब्द').join(' ')
    expect(estimateReadTime(english)).toBe(1)
    expect(estimateReadTime(hindi)).toBe(1)
    expect(estimateReadTime(`${english} ${hindi}`)).toBe(2)
  })

  it('is at least a minute for anything at all, and grows with length', () => {
    expect(estimateReadTime('')).toBe(1)
    expect(estimateReadTime('   ')).toBe(1)
    expect(estimateReadTime(Array(3600).fill('word').join(' '))).toBe(20)
  })
})
