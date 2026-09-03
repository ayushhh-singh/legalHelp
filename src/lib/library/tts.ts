/**
 * Read aloud — the browser's own speech synthesiser, and nothing else.
 *
 * ONE RULE SHAPES ALL OF THIS: the text of a provision must never leave the
 * device. `speechSynthesis` does not guarantee that on its own — Chrome ships
 * "Google" voices that synthesise on a server, and choosing one would post the
 * statute an officer is reading to a third party. `SpeechSynthesisVoice`
 * reports which kind it is, so `usableVoices()` keeps only `localService`
 * voices and `noLocalVoiceReason()` says plainly when a device has none rather
 * than quietly falling back to a remote one. That is the same shape every other
 * refusal in this app takes: disabled with a reason, never silently degraded.
 *
 * The controller is a state machine over an INJECTED synthesiser, so the whole
 * of it is testable against a mock — which matters more here than usual,
 * because `speechSynthesis` does not exist in jsdom at all and its real
 * behaviour across browsers is famously uneven.
 */

export type ReadAloudState = 'idle' | 'speaking' | 'paused'

export const RATE_MIN = 0.8
export const RATE_MAX = 1.5
export const RATE_STEP = 0.1
export const DEFAULT_RATE = 1

export const clampRate = (rate: number): number =>
  Number.isFinite(rate) ? Math.min(RATE_MAX, Math.max(RATE_MIN, Math.round(rate * 10) / 10)) : DEFAULT_RATE

/** The parts of `SpeechSynthesisVoice` this app reads. */
export interface VoiceLike {
  name: string
  lang: string
  voiceURI: string
  /** False for a voice that synthesises on somebody else's computer. */
  localService: boolean
  default?: boolean
}

/** The parts of `SpeechSynthesisUtterance` this app writes. */
export interface UtteranceLike {
  text: string
  rate: number
  lang: string
  voice: VoiceLike | null
  onend: (() => void) | null
  onerror: (() => void) | null
}

export interface SynthLike {
  speak(utterance: UtteranceLike): void
  cancel(): void
  pause(): void
  resume(): void
  getVoices(): VoiceLike[]
}

/**
 * Abbreviations that end in a full stop and do not end a sentence.
 *
 * Statutory prose is full of them — "Rs. 1,000", "No. 11013/1/2016", "S.O.
 * 3606(E)", "cl. (b)" — and splitting there makes the reader stop mid-figure.
 */
const ABBREVIATION =
  /(?:\b(?:Rs|No|Nos|Sr|Sec|cl|Cl|para|Para|vide|viz|etc|Govt|Dept|Ex|Art|Sch|Mr|Mrs|Dr|Smt|Shri|S\.O|G\.S\.R|F\.R|S\.R|i\.e|e\.g)|\s[A-Z])\.$/

/**
 * Sentences, for highlighting one at a time.
 *
 * The danda `।` is a full stop and is the only sentence terminator most Hindi
 * text has — a splitter that knows only `.` reads a Hindi paragraph as one
 * enormous sentence and highlights the whole thing at once.
 */
export function splitSentences(text: string): string[] {
  const source = text.replace(/\s+/gu, ' ').trim()
  if (!source) return []

  const out: string[] = []
  let sentence = ''
  for (let at = 0; at < source.length; at += 1) {
    const character = source[at] ?? ''
    sentence += character
    if (!/[.?!।॥]/.test(character)) continue
    // A terminator only ends a sentence if whitespace (or the end) follows it;
    // "8(1)(j)" and "4.7" contain full stops that do not.
    const next = source[at + 1]
    if (next !== undefined && next !== ' ') continue
    if (ABBREVIATION.test(sentence)) continue
    out.push(sentence.trim())
    sentence = ''
  }
  if (sentence.trim()) out.push(sentence.trim())
  return out
}

export interface SentenceRange {
  text: string
  start: number
  end: number
}

/**
 * Sentences WITH their offsets into the text they came from.
 *
 * The offsets are what lets the sentence being spoken be highlighted in place,
 * in the same whole-unit coordinates a highlight uses — so the reading marker
 * and the reader's own marks are drawn by one segmentation pass rather than two
 * that can disagree about where a sentence ends.
 *
 * Found by scanning forward from the previous sentence's end rather than by
 * `indexOf` from zero: a rule that repeats a sentence ("Provided that nothing
 * in this rule shall apply.") would otherwise point every repeat at the first
 * one, and the marker would jump backwards mid-read.
 */
export function sentenceRanges(text: string): SentenceRange[] {
  const out: SentenceRange[] = []
  let cursor = 0
  for (const sentence of splitSentences(text)) {
    const at = text.indexOf(sentence, cursor)
    if (at < 0) continue
    out.push({ text: sentence, start: at, end: at + sentence.length })
    cursor = at + sentence.length
  }
  return out
}

/**
 * The voices this app is willing to use, best first.
 *
 * Remote voices are dropped, not ranked last: a picker that offers one is a
 * picker somebody will choose from. Within what is left, an Indian-locale voice
 * comes first — `hi-IN` for Hindi, `en-IN` for English, which reads a
 * Devanagari-inflected English text better than `en-US` does.
 */
export function usableVoices(voices: readonly VoiceLike[], language: 'en' | 'hi'): VoiceLike[] {
  const wanted = voices.filter((voice) => voice.localService && voice.lang.toLowerCase().startsWith(language))
  return [...wanted].sort((a, b) => {
    const indian = (voice: VoiceLike) =>
      voice.lang.toLowerCase().replace('_', '-') === `${language}-in` ? 0 : 1
    return indian(a) - indian(b) || Number(b.default ?? false) - Number(a.default ?? false)
  })
}

export type NoVoiceReason = 'none-at-all' | 'remote-only' | 'none-for-language'

/**
 * Why read aloud cannot run, if it cannot — three different answers that call
 * for three different sentences on screen.
 */
export function noLocalVoiceReason(
  voices: readonly VoiceLike[],
  language: 'en' | 'hi',
): NoVoiceReason | null {
  if (usableVoices(voices, language).length > 0) return null
  if (voices.length === 0) return 'none-at-all'
  if (voices.some((voice) => voice.lang.toLowerCase().startsWith(language))) return 'remote-only'
  return 'none-for-language'
}

/** Which one-line "how to install a voice" hint to show. */
export function platformHint(userAgent: string): 'android' | 'windows' | 'macos' | 'ios' | 'other' {
  const agent = userAgent.toLowerCase()
  if (agent.includes('android')) return 'android'
  if (/iphone|ipad|ipod/.test(agent)) return 'ios'
  if (agent.includes('windows')) return 'windows'
  if (agent.includes('mac os')) return 'macos'
  return 'other'
}

export interface ReadAloudSnapshot {
  state: ReadAloudState
  /** Which sentence is being spoken. -1 when idle. */
  index: number
  total: number
  rate: number
  voiceURI: string | null
}

export interface ReadAloudOptions {
  synth: SynthLike
  createUtterance: (text: string) => UtteranceLike
  /**
   * Called when the last sentence finishes — what auto-continue hangs off.
   *
   * Also settable after construction (`setOnFinished`), because the React hook
   * that owns a controller has to build it exactly once and the callback it
   * wants to run changes on every unit: auto-continue navigates. Passing a ref
   * through the constructor would mean reading a ref during render, which
   * `react-hooks/refs` refuses and which tears under concurrent rendering.
   */
  onFinished?: () => void
}

/**
 * One sentence at a time, so the page can show where the voice is.
 *
 * Speaking the whole unit as one utterance is one call and no state, and it is
 * what every naive implementation does — but then `onend` fires once, at the
 * end, and there is nothing to highlight in between. `onboundary` is the other
 * option and is not implemented consistently enough to build on. So the
 * controller queues sentence by sentence, which also makes pause, stop and a
 * rate change land within a sentence rather than at the end of a unit.
 */
export class ReadAloudController {
  private readonly synth: SynthLike
  private readonly createUtterance: (text: string) => UtteranceLike
  private onFinished: (() => void) | undefined
  private readonly listeners = new Set<(snapshot: ReadAloudSnapshot) => void>()

  private sentences: readonly string[] = []
  private state: ReadAloudState = 'idle'
  private index = -1
  private rate = DEFAULT_RATE
  private voice: VoiceLike | null = null
  private lang = 'en'
  /**
   * Each utterance's `onend` is checked against this before it advances.
   *
   * `synth.cancel()` fires `onend` for the utterance it cancelled in most
   * browsers, and without a generation counter that callback advances to the
   * next sentence — so pressing Stop starts the following sentence, which is
   * the single most common bug in a Web Speech integration.
   */
  private generation = 0

  constructor(options: ReadAloudOptions) {
    this.synth = options.synth
    this.createUtterance = options.createUtterance
    this.onFinished = options.onFinished
  }

  /** Replace what runs when the last sentence ends. See `ReadAloudOptions`. */
  setOnFinished(onFinished: (() => void) | undefined): void {
    this.onFinished = onFinished
  }

  subscribe(listener: (snapshot: ReadAloudSnapshot) => void): () => void {
    this.listeners.add(listener)
    listener(this.snapshot())
    return () => this.listeners.delete(listener)
  }

  snapshot(): ReadAloudSnapshot {
    return {
      state: this.state,
      index: this.index,
      total: this.sentences.length,
      rate: this.rate,
      voiceURI: this.voice?.voiceURI ?? null,
    }
  }

  private emit(): void {
    const snapshot = this.snapshot()
    for (const listener of this.listeners) listener(snapshot)
  }

  /** Replace what is queued. Stops anything in flight — a new unit is a new read. */
  load(sentences: readonly string[], lang: 'en' | 'hi'): void {
    this.stop()
    this.sentences = sentences
    this.lang = lang
  }

  setRate(rate: number): void {
    this.rate = clampRate(rate)
    // A rate change takes effect from the CURRENT sentence, not the next one:
    // an officer who finds the voice too fast should not have to wait out the
    // sentence that made them reach for the control.
    if (this.state === 'speaking') this.speakFrom(this.index)
    else this.emit()
  }

  setVoice(voice: VoiceLike | null): void {
    this.voice = voice
    if (this.state === 'speaking') this.speakFrom(this.index)
    else this.emit()
  }

  play(from = 0): void {
    if (this.sentences.length === 0) return
    if (this.state === 'paused') {
      this.resume()
      return
    }
    this.speakFrom(Math.max(0, Math.min(from, this.sentences.length - 1)))
  }

  private speakFrom(index: number): void {
    this.generation += 1
    const generation = this.generation
    this.synth.cancel()

    const sentence = this.sentences[index]
    if (sentence === undefined) {
      this.finish()
      return
    }

    this.index = index
    this.state = 'speaking'
    this.emit()

    const utterance = this.createUtterance(sentence)
    utterance.rate = this.rate
    utterance.lang = this.voice?.lang ?? (this.lang === 'hi' ? 'hi-IN' : 'en-IN')
    utterance.voice = this.voice
    utterance.onend = () => {
      if (generation !== this.generation) return
      if (index + 1 >= this.sentences.length) this.finish()
      else this.speakFrom(index + 1)
    }
    utterance.onerror = () => {
      if (generation !== this.generation) return
      // A voice that fails mid-unit stops the read rather than skipping ahead
      // silently: the reader asked for this passage, not for the rest of it.
      this.stop()
    }
    this.synth.speak(utterance)
  }

  private finish(): void {
    this.generation += 1
    this.state = 'idle'
    this.index = -1
    this.emit()
    this.onFinished?.()
  }

  pause(): void {
    if (this.state !== 'speaking') return
    this.state = 'paused'
    this.synth.pause()
    this.emit()
  }

  resume(): void {
    if (this.state !== 'paused') return
    this.state = 'speaking'
    this.synth.resume()
    this.emit()
  }

  stop(): void {
    // The generation bumps BEFORE cancel, so the `onend` that cancel provokes
    // is already stale by the time it arrives.
    this.generation += 1
    this.synth.cancel()
    this.state = 'idle'
    this.index = -1
    this.emit()
  }
}
