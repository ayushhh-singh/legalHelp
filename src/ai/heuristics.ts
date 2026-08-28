/**
 * Two cheap classifications that change how a question is handled, ported from
 * Neev (apps/api/src/services/mentor). Both are regex over the raw question —
 * no model call, no latency, and unit-tested in both languages.
 *
 *   isPersonalQuery   → the question is about THIS reader (their leave balance,
 *                       their pay, their progress). Such answers are NEVER put
 *                       in the answer cache: they are not reusable, and caching
 *                       them would be the one place this app could serve one
 *                       person's figures to another session.
 *
 *   isAnalyticalQuery → the question asks for comparison or reasoning rather
 *                       than a lookup. These get one step up the effort ladder,
 *                       because the failure mode of a cheap answer here is a
 *                       confident wrong comparison rather than a missing fact.
 *
 * Both err towards the safe answer: a lookup misread as personal only loses a
 * cache hit, whereas a personal question misread as general leaks.
 */

/**
 * First person in both languages, plus the possessive postpositions Hindi uses
 * where English uses "my". `मेरा/मेरी/मेरे`, `मुझे`, `मुझको`, `हमारा` and the
 * English "my/mine/I/me/our" carry almost all of it.
 *
 * The English forms are word-bounded so that "army" and "iota" do not match.
 */
const PERSONAL_PATTERNS: readonly RegExp[] = [
  /\b(my|mine|i'm|i am|i have|me|myself|our|ours)\b/i,
  /\bhow much (?:do|will|can) i\b/i,
  /\b(am i|can i|do i|should i|will i)\b/i,
  /(मेरा|मेरी|मेरे|मुझे|मुझको|मुझसे|मैंने|मैं|हमारा|हमारी|हमारे|हमें)/,
  /(अपना|अपनी|अपने)\s+(वेतन|छुट्टी|अवकाश|पेंशन|प्रगति|खाता)/,
]

/**
 * "I" alone is ambiguous in this domain — "level I", "Annexure I", roman
 * numerals in a rule citation. It is matched only with a following verb, above.
 */
export function isPersonalQuery(text: string): boolean {
  const question = text.trim()
  if (!question) return false
  return PERSONAL_PATTERNS.some((pattern) => pattern.test(question))
}

const ANALYTICAL_PATTERNS: readonly RegExp[] = [
  /\b(compare|comparison|versus|vs\.?|difference|differs?|better|worse|trade-?off|which one)\b/i,
  /\b(why|how come|what happens if|what if|implication|consequence|reason)\b/i,
  /\b(explain|analyse|analyze|justify|evaluate|assess)\b/i,
  /(तुलना|अंतर|फ़र्क|फर्क|बेहतर|कौन[\s-]?सा बेहतर)/,
  /(क्यों|क्योंकि|कारण|यदि.*तो|अगर.*तो|परिणाम|प्रभाव)/,
  /(समझाइ?ए|समझाएँ|व्याख्या|विश्लेषण|मूल्यांकन)/,
]

export function isAnalyticalQuery(text: string): boolean {
  const question = text.trim()
  if (!question) return false
  return ANALYTICAL_PATTERNS.some((pattern) => pattern.test(question))
}

/**
 * Normalised question text: what the answer cache indexes and compares.
 *
 * Devanagari danda and Latin punctuation both go; digits stay, because "Level 7"
 * and "Level 8" must not normalise to the same string.
 *
 * `\p{M}` is not optional. Devanagari matras and the virama are combining marks,
 * not letters, so a `\p{L}\p{N}` filter alone strips them and turns
 * "धारा 302 क्या है" into "ध र 302 क य ह" — every Hindi question would then
 * normalise to roughly the same consonant skeleton and the answer cache would
 * serve the wrong answer.
 */
export function normaliseQuestion(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[।॥]/g, ' ')
    .replace(/[^\p{L}\p{N}\p{M}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
