import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  clampRate,
  noLocalVoiceReason,
  platformHint,
  ReadAloudController,
  sentenceRanges,
  splitSentences,
  usableVoices,
  type SynthLike,
  type UtteranceLike,
  type VoiceLike,
} from './tts'

/**
 * The read-aloud controller against a mock synthesiser.
 *
 * `speechSynthesis` does not exist in jsdom and behaves differently in every
 * browser that does have it, so the controller takes one as an argument and
 * everything below drives a fake. The two behaviours that matter most are the
 * ones a real browser makes hardest to see: that `cancel()` provokes an `onend`
 * which must NOT advance the queue, and that a rate change lands on the current
 * sentence rather than the next one.
 */

const voice = (partial: Partial<VoiceLike> & { name: string }): VoiceLike => ({
  lang: 'en-IN',
  voiceURI: partial.name,
  localService: true,
  ...partial,
})

class FakeSynth implements SynthLike {
  spoken: UtteranceLike[] = []
  cancelled = 0
  paused = 0
  resumed = 0
  private voices: VoiceLike[] = []

  constructor(voices: VoiceLike[] = []) {
    this.voices = voices
  }

  speak(utterance: UtteranceLike): void {
    this.spoken.push(utterance)
  }

  /**
   * Real browsers fire `onend` for the utterance they cancelled. The fake does
   * too, because a fake that is politer than the thing it stands for tests
   * nothing.
   */
  cancel(): void {
    this.cancelled += 1
    const last = this.spoken.at(-1)
    last?.onend?.()
  }

  pause(): void {
    this.paused += 1
  }

  resume(): void {
    this.resumed += 1
  }

  getVoices(): VoiceLike[] {
    return this.voices
  }

  finishCurrent(): void {
    this.spoken.at(-1)?.onend?.()
  }

  failCurrent(): void {
    this.spoken.at(-1)?.onerror?.()
  }
}

const createUtterance = (text: string): UtteranceLike => ({
  text,
  rate: 1,
  lang: 'en',
  voice: null,
  onend: null,
  onerror: null,
})

describe('splitSentences', () => {
  it('splits on a full stop followed by a space', () => {
    expect(splitSentences('One thing. Another thing.')).toEqual(['One thing.', 'Another thing.'])
  })

  /**
   * The danda is the only sentence terminator most Hindi prose has. A splitter
   * that knows only `.` reads a Hindi paragraph as one enormous sentence and
   * highlights the whole thing at once — the Devanagari half of a
   * symmetric-looking feature, silently missing.
   */
  it('splits on the danda', () => {
    expect(splitSentences('पहला वाक्य। दूसरा वाक्य।')).toEqual(['पहला वाक्य।', 'दूसरा वाक्य।'])
  })

  it.each([
    ['a rupee figure', 'A fee of Rs. 500 is payable.'],
    ['a file number', 'See No. 11013 of 2016.'],
    ['a clause reference', 'Read with cl. (b) of that rule.'],
    ['an initial', 'Signed by A. Kumar today.'],
  ])('does not split inside %s', (_label, text) => {
    expect(splitSentences(text)).toHaveLength(1)
  })

  it('does not split inside a sub-section reference', () => {
    expect(splitSentences('See section 8(1)(j) and paragraph 4.7 below.')).toHaveLength(1)
  })

  it('keeps a trailing fragment with no terminator', () => {
    expect(splitSentences('One. Two')).toEqual(['One.', 'Two'])
  })

  it('is empty for empty text', () => {
    expect(splitSentences('   ')).toEqual([])
  })
})

describe('clampRate', () => {
  it.each([
    [0.5, 0.8],
    [0.8, 0.8],
    [1, 1],
    [1.5, 1.5],
    [3, 1.5],
    [Number.NaN, 1],
  ])('clamps %s to %s', (input, expected) => {
    expect(clampRate(input)).toBe(expected)
  })
})

describe('usableVoices', () => {
  const voices = [
    voice({ name: 'Google हिन्दी', lang: 'hi-IN', localService: false }),
    voice({ name: 'Lekha', lang: 'hi-IN' }),
    voice({ name: 'Daniel', lang: 'en-GB' }),
    voice({ name: 'Rishi', lang: 'en-IN' }),
  ]

  /**
   * The hard rule, asserted rather than commented: a voice that synthesises on
   * somebody else's computer would post the statute being read to a third
   * party, so it is not offered at all. Ranking it last is not enough — a
   * picker that lists one is a picker somebody chooses from.
   */
  it('drops a remote voice entirely', () => {
    expect(usableVoices(voices, 'hi').map((entry) => entry.name)).toEqual(['Lekha'])
  })

  it('puts the Indian-locale voice first', () => {
    expect(usableVoices(voices, 'en').map((entry) => entry.name)).toEqual(['Rishi', 'Daniel'])
  })

  it('is empty for a language with nothing installed', () => {
    expect(usableVoices([voice({ name: 'Daniel', lang: 'en-GB' })], 'hi')).toEqual([])
  })
})

describe('noLocalVoiceReason', () => {
  it('is null when there is something to speak with', () => {
    expect(noLocalVoiceReason([voice({ name: 'Lekha', lang: 'hi-IN' })], 'hi')).toBeNull()
  })

  it('tells a device with no voices at all apart from one with the wrong ones', () => {
    expect(noLocalVoiceReason([], 'hi')).toBe('none-at-all')
    expect(noLocalVoiceReason([voice({ name: 'Rishi', lang: 'en-IN' })], 'hi')).toBe('none-for-language')
  })

  it('says when the only Hindi voice available is a remote one', () => {
    expect(noLocalVoiceReason([voice({ name: 'G', lang: 'hi-IN', localService: false })], 'hi')).toBe(
      'remote-only',
    )
  })
})

describe('platformHint', () => {
  it.each([
    ['Mozilla/5.0 (Linux; Android 14)', 'android'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)', 'ios'],
    ['Mozilla/5.0 (Windows NT 10.0)', 'windows'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)', 'macos'],
    ['Mozilla/5.0 (X11; Linux x86_64)', 'other'],
  ])('reads %s as %s', (agent, expected) => {
    expect(platformHint(agent)).toBe(expected)
  })
})

describe('ReadAloudController', () => {
  let synth: FakeSynth
  let controller: ReadAloudController
  let finished: () => void

  beforeEach(() => {
    synth = new FakeSynth()
    finished = vi.fn()
    controller = new ReadAloudController({ synth, createUtterance, onFinished: finished })
    controller.load(['One.', 'Two.', 'Three.'], 'en')
  })

  it('starts idle and reports how much there is to read', () => {
    expect(controller.snapshot()).toMatchObject({ state: 'idle', index: -1, total: 3 })
  })

  it('speaks one sentence at a time and advances on end', () => {
    controller.play()
    expect(synth.spoken.at(-1)?.text).toBe('One.')
    expect(controller.snapshot()).toMatchObject({ state: 'speaking', index: 0 })

    synth.finishCurrent()
    expect(synth.spoken.at(-1)?.text).toBe('Two.')
    expect(controller.snapshot().index).toBe(1)
  })

  it('calls onFinished after the last sentence and returns to idle', () => {
    controller.play()
    synth.finishCurrent()
    synth.finishCurrent()
    synth.finishCurrent()
    expect(finished).toHaveBeenCalledTimes(1)
    expect(controller.snapshot()).toMatchObject({ state: 'idle', index: -1 })
  })

  /**
   * The single most common bug in a Web Speech integration: `cancel()` fires
   * `onend`, that callback advances the queue, and pressing Stop starts the
   * next sentence. The generation counter is what makes the stale callback a
   * no-op, and this is the test that would catch its removal.
   */
  it('does not advance when stop provokes onend', () => {
    controller.play()
    const spokenBefore = synth.spoken.length
    controller.stop()
    expect(synth.spoken.length).toBe(spokenBefore)
    expect(controller.snapshot()).toMatchObject({ state: 'idle', index: -1 })
    expect(finished).not.toHaveBeenCalled()
  })

  it('pauses and resumes without re-speaking', () => {
    controller.play()
    controller.pause()
    expect(synth.paused).toBe(1)
    expect(controller.snapshot().state).toBe('paused')

    controller.play() // Play while paused means resume, not restart.
    expect(synth.resumed).toBe(1)
    expect(controller.snapshot().state).toBe('speaking')
    expect(synth.spoken).toHaveLength(1)
  })

  it('ignores pause when nothing is being spoken', () => {
    controller.pause()
    expect(synth.paused).toBe(0)
    expect(controller.snapshot().state).toBe('idle')
  })

  it('ignores resume when it is not paused', () => {
    controller.resume()
    expect(synth.resumed).toBe(0)
  })

  it('applies a rate change to the sentence being read, not the next one', () => {
    controller.play()
    synth.finishCurrent() // now on "Two."
    controller.setRate(1.4)
    expect(synth.spoken.at(-1)?.text).toBe('Two.')
    expect(synth.spoken.at(-1)?.rate).toBe(1.4)
    expect(controller.snapshot()).toMatchObject({ index: 1, rate: 1.4, state: 'speaking' })
  })

  it('stores a rate change made while idle without speaking anything', () => {
    controller.setRate(0.9)
    expect(synth.spoken).toHaveLength(0)
    expect(controller.snapshot().rate).toBe(0.9)
  })

  it('re-speaks the current sentence in the newly chosen voice', () => {
    const lekha = voice({ name: 'Lekha', lang: 'hi-IN' })
    controller.play()
    controller.setVoice(lekha)
    expect(synth.spoken.at(-1)?.voice).toBe(lekha)
    expect(synth.spoken.at(-1)?.lang).toBe('hi-IN')
  })

  it('falls back to an Indian locale when no voice has been chosen', () => {
    controller.load(['एक।'], 'hi')
    controller.play()
    expect(synth.spoken.at(-1)?.lang).toBe('hi-IN')
  })

  it('stops rather than skipping ahead when a voice fails', () => {
    controller.play()
    synth.failCurrent()
    expect(controller.snapshot().state).toBe('idle')
    expect(finished).not.toHaveBeenCalled()
  })

  it('plays from a chosen sentence, clamped to what exists', () => {
    controller.play(2)
    expect(synth.spoken.at(-1)?.text).toBe('Three.')
    controller.stop()
    controller.play(99)
    expect(synth.spoken.at(-1)?.text).toBe('Three.')
  })

  it('does nothing with nothing loaded', () => {
    const empty = new ReadAloudController({ synth, createUtterance })
    empty.play()
    expect(synth.spoken).toHaveLength(0)
  })

  it('loading a new unit stops whatever was being read', () => {
    controller.play()
    controller.load(['New.'], 'en')
    expect(synth.cancelled).toBeGreaterThan(0)
    expect(controller.snapshot()).toMatchObject({ state: 'idle', total: 1 })
  })

  it('takes a replacement finish callback after construction', () => {
    // The hook that owns a controller builds it once and swaps this on every
    // unit, because auto-continue navigates.
    const second = vi.fn()
    controller.setOnFinished(second)
    controller.play()
    synth.finishCurrent()
    synth.finishCurrent()
    synth.finishCurrent()
    expect(second).toHaveBeenCalledTimes(1)
    expect(finished).not.toHaveBeenCalled()
  })

  it('notifies a subscriber immediately and on every change, until it unsubscribes', () => {
    const seen: string[] = []
    const off = controller.subscribe((snapshot) => seen.push(snapshot.state))
    expect(seen).toEqual(['idle'])
    controller.play()
    expect(seen).toEqual(['idle', 'speaking'])
    off()
    controller.stop()
    expect(seen).toEqual(['idle', 'speaking'])
  })
})

describe('sentenceRanges', () => {
  it('gives offsets that slice back to the sentence', () => {
    const text = 'One thing. Another thing. A third.'
    for (const range of sentenceRanges(text)) {
      expect(text.slice(range.start, range.end)).toBe(range.text)
    }
  })

  /**
   * A rule that repeats a sentence verbatim is ordinary — CCS (Leave) Rule 39
   * has three identical provisos. Scanning from zero would point every repeat
   * at the first one and the reading marker would jump backwards mid-read.
   */
  it('advances past a repeated sentence rather than pointing at the first one', () => {
    const text = 'Provided that. Something else. Provided that.'
    const ranges = sentenceRanges(text)
    expect(ranges).toHaveLength(3)
    expect(ranges[2]!.start).toBeGreaterThan(ranges[0]!.start)
    expect(text.slice(ranges[2]!.start, ranges[2]!.end)).toBe('Provided that.')
  })

  it('is empty for empty text', () => {
    expect(sentenceRanges('  ')).toEqual([])
  })

  it('covers the Devanagari danda', () => {
    const text = 'पहला वाक्य। दूसरा वाक्य।'
    expect(sentenceRanges(text).map((range) => text.slice(range.start, range.end))).toEqual([
      'पहला वाक्य।',
      'दूसरा वाक्य।',
    ])
  })
})
