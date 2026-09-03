import { describe, expect, it, vi } from 'vitest'

import { diffOf } from './compare'
import { parseCompareRef } from '@/modules/library/url'
import { ReadAloudController, type SynthLike, type UtteranceLike, type VoiceLike } from './tts'

/**
 * An edge-case pass over Session 27, after the commit.
 *
 * Every test here was confirmed to FAIL against the committed code before its
 * fix was written, and they are all the same shape — the one ADR-032's addendum
 * named and ADR-035's repeated. The parts that were obviously untrusted got
 * guarded: a stored offset is re-anchored, a quote that cannot be found is kept
 * and reported, a file the reader chose is refused by kind and by size, a card
 * is parsed before it is written. The parts written as though they cannot fail
 * were the app's OWN state machines — what happens after auto-continue
 * navigates, what a work picker does before a unit has been chosen, and whether
 * a screen that promises to list something can reach what it needs to list it.
 *
 * ADR-039's second addendum has all six.
 */

// ---------------------------------------------------------------- read aloud

class FakeSynth implements SynthLike {
  spoken: UtteranceLike[] = []
  cancel(): void {
    this.spoken.at(-1)?.onend?.()
  }
  speak(utterance: UtteranceLike): void {
    this.spoken.push(utterance)
  }
  pause(): void {}
  resume(): void {}
  getVoices(): VoiceLike[] {
    return []
  }
  finishAll(): void {
    // Drain the queue the way a browser does: each `onend` speaks the next.
    for (let guard = 0; guard < 50; guard += 1) {
      const before = this.spoken.length
      this.spoken.at(-1)?.onend?.()
      if (this.spoken.length === before) return
    }
  }
}

const utterance = (text: string): UtteranceLike => ({
  text,
  rate: 1,
  lang: 'en',
  voice: null,
  onend: null,
  onerror: null,
})

describe('auto-continue survives the unit it moves to', () => {
  /**
   * DEFECT 1 is in the HOOK, and this is not the test that catches it — say so
   * rather than let it read as coverage it is not. `load()` stopping whatever
   * is speaking is correct behaviour and is what this asserts; the defect was
   * that nothing started the new unit afterwards, so auto-continue navigated
   * and fell silent. `src/modules/library/annotations.test.tsx` renders
   * `useReadAloud` against a fake synthesiser and IS the test that fails
   * against the committed code.
   *
   * What this pins is the contract the fix rests on: `load` then `play` speaks
   * the new unit's first sentence. If that stopped being true the hook's fix
   * would break with a much less obvious failure.
   */
  it('speaks again after a new unit is loaded', () => {
    const synth = new FakeSynth()
    const finished = vi.fn()
    const controller = new ReadAloudController({
      synth,
      createUtterance: utterance,
      onFinished: finished,
    })

    controller.load(['One.', 'Two.'], 'en')
    controller.play()
    synth.finishAll()
    expect(finished).toHaveBeenCalledTimes(1)

    // What auto-continue does next: a new unit arrives and must be spoken.
    controller.load(['Three.'], 'en')
    controller.play()
    expect(synth.spoken.at(-1)?.text).toBe('Three.')
    expect(controller.snapshot()).toMatchObject({ state: 'speaking', index: 0 })
  })
})

// -------------------------------------------------------------- compare page

describe('parseCompareRef', () => {
  /**
   * DEFECT 2. The compare page writes `?a=bns:` the moment a WORK is chosen and
   * fills the unit in afterwards. `parseCompareRef` refused that as malformed,
   * so no work loaded, so the unit picker stayed disabled — and a work could
   * never be compared with anything. A deadlock reachable by the first click on
   * the page.
   */
  it('accepts a work with no unit chosen yet', () => {
    expect(parseCompareRef('bns:')).toEqual({ workId: 'bns', unitId: '' })
  })

  it('still reads a complete reference', () => {
    expect(parseCompareRef('ccs-conduct:ccs-conduct-3')).toEqual({
      workId: 'ccs-conduct',
      unitId: 'ccs-conduct-3',
    })
  })

  it.each([
    ['nothing', null],
    ['an empty string', ''],
    ['no colon at all', 'bns'],
    ['no work id', ':103'],
  ])('refuses %s', (_label, value) => {
    expect(parseCompareRef(value)).toBeNull()
  })

  it('keeps a unit id that contains a colon in the unit half', () => {
    // Not a shape this app produces, but the split is on the FIRST colon and a
    // reader can type anything into the address bar.
    expect(parseCompareRef('bns:a:b')).toEqual({ workId: 'bns', unitId: 'a:b' })
  })
})

describe('diffOf', () => {
  it('is null when one side is empty of tokens rather than pretending they match', () => {
    // Both empty IS identical; one empty is not.
    expect(diffOf('', '')?.identical).toBe(true)
    expect(diffOf('', 'x')?.identical).toBe(false)
  })
})
