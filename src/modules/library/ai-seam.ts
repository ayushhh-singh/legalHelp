/**
 * The Library's AI seam, built to the shape `src/modules/law/ai-seam.ts` and
 * `src/modules/drafting/ai-seam.ts` settled.
 *
 * Two conditions, read in one place so the narrower one cannot be forgotten:
 *
 *  1. `STUDY_AI_ENABLED` is a LITERAL wired to no build flag, environment
 *     variable or setting. Turning the surface off is a one-line diff somebody
 *     can see in review, not a deployment someone has to be told about.
 *  2. The app-wide consent gate still governs, and this can only subtract.
 *
 * ### The ordering rule this seam exists to protect
 *
 * The session that built this module put the AI last on purpose, and the rail
 * renders in that order: the precomputed study aid first (zero cost, no key, no
 * network, works offline on every device), then the reader's own explanation,
 * then a quiz drawn from approved cards, and only then Ask. Everything above
 * Ask is complete on its own. If this constant were ever flipped to `false`,
 * the module would lose one affordance out of five rather than becoming
 * useless — which is the test of whether the ordering was real.
 *
 * There is **no per-question acknowledgement gate**, for the reason ADR-035
 * gives: a question is typed fresh every time, so the gate would be a dialog
 * before every question, which is a dialog nobody reads. What replaces it is
 * deterministic and in code — `screenStudyQuestion()` refuses a departmental
 * record before the provider is constructed, and reading the reader's own notes
 * is a checkbox that is OFF until it is ticked.
 */
export const STUDY_AI_ENABLED = true

/** What the Library asks before rendering any AI affordance. */
export function studyAiAvailable(consentGiven: boolean): boolean {
  return STUDY_AI_ENABLED && consentGiven
}
