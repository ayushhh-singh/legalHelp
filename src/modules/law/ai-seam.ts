/**
 * The one lever that turns the Law Converter's "Ask" surface off in code.
 *
 * The same shape `src/modules/drafting/ai-seam.ts` carries, and for the same
 * two reasons:
 *
 *  1. **A code change, visible in review.** `LAW_AI_ENABLED` is a literal here,
 *     wired to no build flag, environment variable or setting. Turning the
 *     surface off is a one-line diff somebody can see, not a deployment
 *     someone has to be told about.
 *  2. **The app-wide consent gate still governs, and this can only subtract.**
 *     `lawAiAvailable()` is the `&&` that says so, and `ConverterPage` asks it
 *     before mounting the panel at all.
 *
 * ### What is deliberately different from the Drafting Studio's seam
 *
 * There is **no per-question acknowledgement gate** here, and that is a
 * decision rather than an omission (ADR-035). The drafting gate asserts a fact
 * about a DOCUMENT — "this draft contains nothing official, sensitive or
 * classified" — which is true or false once per draft and stays true while the
 * officer works on it. A question is typed fresh every time, so the same gate
 * would be a dialog before every question, which is a dialog nobody reads.
 *
 * What replaces it is narrower and deterministic: `<AiBanner/>` is permanent
 * above the input, `screenLawQuestion()` refuses a question naming a
 * departmental record BEFORE the provider is constructed, and
 * `caseAdviceSteer()` keeps an answer on the general rule. None of the three
 * depends on the reader having read anything.
 *
 * ### What is still impossible
 *
 * No tool in `src/ai/tools/law.ts` can reach the reader's saved sections or
 * their recent lookups — the five of them are pure functions over
 * `data/law/*.json`. The agent takes the question and the offence date as
 * arguments from what is on screen and reads no Dexie row of its own.
 */

/** The lever. See the note above before changing it. */
export const LAW_AI_ENABLED = true as boolean

/**
 * What the converter asks before rendering any AI affordance. It takes the
 * app-wide consent state so the two conditions are read in one place and the
 * narrower one cannot be forgotten.
 */
export function lawAiAvailable(consentGiven: boolean): boolean {
  return LAW_AI_ENABLED && consentGiven
}
