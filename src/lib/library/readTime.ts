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
 * TAKES NO LANGUAGE, deliberately — the session brief's own signature was
 * `estimateReadTime(text, lang)` and measurement said the parameter carries no
 * information. The rate is picked per WORD by the script that word is written
 * in, because a Hindi reader reading the English text of a rule (which is every
 * rule in this corpus — no Ministry publishes a readable Hindi text layer) is
 * still reading English words. The only string the reader's own language could
 * have broken a tie for is one with no words in either script, and that
 * returns the one-minute floor either way.
 *
 * The first version kept `lang` and ended `Math.ceil(minutes || words.length /
 * WPM[lang])`, which looked like it used it. That branch could not fire:
 * `minutes` is zero only when there are no words, which the guard below has
 * already returned for. A parameter that provably does nothing and a branch
 * nothing can reach are the same lie told twice; `library.edge.test.ts` holds
 * the property instead.
 */
export function estimateReadTime(text: string): number {
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length === 0) return 1

  let devanagari = 0
  for (const word of words) if (DEVANAGARI.test(word)) devanagari += 1
  const latin = words.length - devanagari

  // No `|| words.length / WPM[lang]` fallback. The committed version had one,
  // and it could not fire: `minutes` is zero only when both counts are zero,
  // which happens only when there are no words, which the guard above has
  // already returned for. A branch nothing can reach is a claim about
  // behaviour that nothing supports — and that one implied a
  // language-dependent answer this function does not have. `lang` remains a
  // parameter because a caller reasonably passes it and a future script might
  // need it; `library.edge.test.ts` holds the property it was reaching for.
  return Math.max(1, Math.ceil(latin / WPM.en + devanagari / WPM.hi))
}
