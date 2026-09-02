import type { Language } from '@/i18n'

/**
 * Words per minute, per script.
 *
 * The same two figures `scripts/ingest/library_seed.py` uses for a work's
 * `estimatedMinutes`, so a work's total and the sum of its units' estimates do
 * not disagree by construction. Devanagari is slower per word because a
 * Devanagari word carries more of a sentence than an English one does; both are
 * estimates and every surface that shows one says "about".
 */
export const WPM: Readonly<Record<Language, number>> = { en: 180, hi: 140 }

/**
 * Any Devanagari character, by Unicode script property rather than by code
 * range.
 *
 * A literal `[ऀ-ॿ]` class is what `no-misleading-character-class` exists to
 * catch, and escaping it to `[\u0900-\u097F]` does not help: the range really
 * does span combining marks, so the rule is right either way. The script
 * property says what is actually meant, and it covers Devanagari Extended
 * without a second range to keep in step.
 */
const DEVANAGARI = /\p{Script=Devanagari}/u

/**
 * Reading time in whole minutes, never less than one.
 *
 * `lang` is the reader's language, not the text's: a Hindi reader reading the
 * English text of a rule (which is every rule in this corpus — no Ministry
 * publishes a readable Hindi text layer) is still reading English words, so the
 * script of each WORD is what picks the rate, and `lang` only breaks the tie
 * for a string with no words in either script.
 */
export function estimateReadTime(text: string, lang: Language = 'en'): number {
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length === 0) return 1

  let devanagari = 0
  for (const word of words) if (DEVANAGARI.test(word)) devanagari += 1
  const latin = words.length - devanagari

  const minutes = latin / WPM.en + devanagari / WPM.hi
  // A string of pure punctuation counts as no words in either script; the
  // reader's own language is what settles the rate then, and the floor of one
  // minute makes the answer the same either way.
  return Math.max(1, Math.ceil(minutes || words.length / WPM[lang]))
}
