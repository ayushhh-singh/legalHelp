import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { ReaderPrefs } from './useLibrary'

import {
  noLocalVoiceReason,
  ReadAloudController,
  sentenceRanges,
  usableVoices,
  type NoVoiceReason,
  type ReadAloudSnapshot,
  type SentenceRange,
  type SynthLike,
  type UtteranceLike,
  type VoiceLike,
} from '@/lib/library'

/**
 * The browser's speech synthesiser, wired to one unit's sentences.
 *
 * Everything decidable is decided in `src/lib/library/tts.ts`, which is pure
 * and tested against a mock — this is the part that cannot be: constructing a
 * `SpeechSynthesisUtterance`, waiting for `voiceschanged` (Chrome returns an
 * empty voice list on the first call, every time), and stopping the voice when
 * the reader navigates away.
 *
 * `speechSynthesis` does not exist in jsdom at all, so every entry point here
 * is guarded on the feature rather than assumed — and `supported: false` is a
 * state the bar renders, not an error it throws.
 */

interface SpeechWindow {
  speechSynthesis?: SpeechSynthesis
  SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance
}

const speech = (): SpeechWindow => globalThis

export interface ReadAloud {
  supported: boolean
  snapshot: ReadAloudSnapshot
  /** Where the sentence being spoken sits, in whole-unit offsets, or null. */
  speaking: { start: number; end: number } | null
  voices: VoiceLike[]
  /** Why it cannot run, when it cannot. */
  reason: NoVoiceReason | null
  play: () => void
  pause: () => void
  resume: () => void
  stop: () => void
  setRate: (rate: number) => void
  setVoice: (uri: string | null) => void
}

const IDLE: ReadAloudSnapshot = { state: 'idle', index: -1, total: 0, rate: 1, voiceURI: null }

export function useReadAloud(
  text: string,
  lang: 'en' | 'hi',
  prefs: ReaderPrefs,
  onFinished: () => void,
): ReadAloud {
  const supported = Boolean(speech().speechSynthesis && speech().SpeechSynthesisUtterance)
  const [snapshot, setSnapshot] = useState<ReadAloudSnapshot>(IDLE)
  const [allVoices, setAllVoices] = useState<VoiceLike[]>([])
  const sentences: SentenceRange[] = useMemo(() => sentenceRanges(text), [text])

  /**
   * Built once, by a lazy `useState` initialiser rather than a ref.
   *
   * `react-hooks/refs` refuses a ref written during render, and it is right:
   * this has to happen before the first effect (the subscription below reads
   * it) and a ref assigned in the render body tears under concurrent
   * rendering. A state value with a lazy initialiser is the sanctioned shape
   * for "construct this exactly once" and needs no suppression.
   */
  const [controller] = useState<ReadAloudController | null>(() => {
    const synth = speech().speechSynthesis
    const Utterance = speech().SpeechSynthesisUtterance
    if (!synth || !Utterance) return null
    return new ReadAloudController({
      synth: synth as unknown as SynthLike,
      createUtterance: (value: string) => new Utterance(value) as unknown as UtteranceLike,
    })
  })

  /**
   * Set when the READ finished on its own, so the next unit knows to start.
   *
   * `load()` stops whatever is speaking, which is right when the reader
   * navigates and was also what happened when auto-continue navigated: the page
   * moved and the voice went quiet, which is the one thing the toggle exists to
   * prevent. A ref rather than state because nothing renders from it and
   * because it is written inside a callback and read inside an effect — never
   * during render.
   */
  const continuing = useRef(false)

  /**
   * The finish callback is SET on the controller, not passed to it.
   *
   * Auto-continue navigates, so `onFinished` changes on every unit — and a
   * controller rebuilt for that would cancel the voice mid-sentence at the
   * moment it is meant to carry on. Reading it through a ref inside the
   * constructor is the other obvious shape and is a ref read during render,
   * which `react-hooks/refs` refuses.
   */
  useEffect(() => {
    controller?.setOnFinished(() => {
      continuing.current = prefs.autoContinue
      onFinished()
    })
  }, [controller, onFinished, prefs.autoContinue])

  useEffect(() => {
    if (!controller) return
    return controller.subscribe(setSnapshot)
  }, [controller])

  // Chrome answers `getVoices()` with an empty list until it has loaded them,
  // and then fires `voiceschanged` — a picker built from the first answer is
  // permanently empty on that browser.
  useEffect(() => {
    const synth = speech().speechSynthesis
    if (!synth) return
    const read = () => setAllVoices(synth.getVoices())
    read()
    synth.addEventListener?.('voiceschanged', read)
    return () => synth.removeEventListener?.('voiceschanged', read)
  }, [])

  const voices = useMemo(() => usableVoices(allVoices, lang), [allVoices, lang])
  const reason = useMemo(() => noLocalVoiceReason(allVoices, lang), [allVoices, lang])

  // A new unit, or a language switch, is a new read. `load` stops whatever was
  // in flight, which is also what makes navigating away silence the voice —
  // and is why auto-continue has to say, explicitly, that this move was its
  // own doing.
  useEffect(() => {
    if (!controller) return
    controller.load(
      sentences.map((sentence) => sentence.text),
      lang,
    )
    if (continuing.current) {
      continuing.current = false
      // Only when the previous unit finished ON ITS OWN with the toggle on.
      // Arriving at a unit any other way is silent.
      if (sentences.length > 0) controller.play()
    }
  }, [controller, sentences, lang])

  useEffect(() => () => controller?.stop(), [controller])

  // The stored rate and voice are applied to the controller, never re-derived
  // from it: the preference row is the one place either lives.
  useEffect(() => {
    controller?.setRate(prefs.rate)
  }, [controller, prefs.rate])

  useEffect(() => {
    const chosen = voices.find((voice) => voice.voiceURI === prefs.voiceURI) ?? voices[0] ?? null
    controller?.setVoice(chosen)
  }, [controller, voices, prefs.voiceURI])

  const speaking = useMemo(() => {
    const sentence = snapshot.index >= 0 ? sentences[snapshot.index] : undefined
    return sentence ? { start: sentence.start, end: sentence.end } : null
  }, [snapshot.index, sentences])

  return {
    supported,
    snapshot,
    speaking,
    voices,
    reason,
    play: useCallback(() => controller?.play(), [controller]),
    pause: useCallback(() => controller?.pause(), [controller]),
    resume: useCallback(() => controller?.resume(), [controller]),
    stop: useCallback(() => controller?.stop(), [controller]),
    setRate: useCallback((rate: number) => controller?.setRate(rate), [controller]),
    setVoice: useCallback(
      (uri: string | null) => controller?.setVoice(voices.find((voice) => voice.voiceURI === uri) ?? null),
      [controller, voices],
    ),
  }
}
