/**
 * The one lever that turns the Drafting Studio's AI surface off in code.
 *
 * This file was written in Session 8 as a seam with nothing behind it —
 * `DRAFTING_AI_ENABLED = false`, a `DraftingAssistant` interface, and an
 * implementation that refused. Session 21 built the thing it described
 * (`src/ai/agents/drafting.ts`, `components/AiDraftPanel.tsx`, ADR-032), so the
 * interface and the refusing implementation are gone: two definitions of the
 * same feature, one of them dead, is worse than none.
 *
 * What survives is the flag, because the reasoning behind it survives.
 *
 * ### The five conditions Session 8 set, and where each one stands
 *
 *  1. **A code change, visible in review.** Still true. `DRAFTING_AI_ENABLED`
 *     is a literal here and is wired to no build flag, environment variable or
 *     setting. Turning the surface off is a one-line diff someone can see.
 *
 *  2. **The app-wide consent gate still governs, and this can only subtract.**
 *     Still true, and `draftingAiAvailable()` below is the `&&` that says so.
 *     `EditorPage` asks it before mounting the panel at all.
 *
 *  3. **Tier 0 first.** NOT met, and it is the condition ADR-032 supersedes
 *     rather than satisfies. Tier 0 does not exist in this build — `LocalProvider`
 *     is a stub that throws `not_installed` — so "Tier 0 first" would have meant
 *     "no drafting assistant at all". What replaces it is narrower rather than
 *     weaker: a deterministic refusal screen that runs BEFORE any provider call
 *     (`screenBrief`), a per-draft acknowledgement that the document contains
 *     nothing official, sensitive or classified, and the standing rule that no
 *     tool in this app can read the `drafts` table. Read ADR-032 before
 *     relaxing any of the three.
 *
 *  4. **Never applied silently.** Still true, and now real:
 *     `components/SuggestionDiff.tsx` is what a result arrives through, with
 *     accept and reject per change and per field.
 *
 *  5. **A classified-content warning before the first use, per draft.** Still
 *     true. It is an inline gate in the panel rather than the modal Session 8
 *     imagined — ADR-032 has the reasoning, which is that a dialog an officer
 *     meets every time they open a panel is a dialog they learn to dismiss.
 *
 * ### What is still deliberately impossible
 *
 * No tool registered in `src/ai/tools/drafting.ts` can reach the reader's
 * `drafts` rows. The agent is handed the values it works on as an argument by
 * the editor, from what is on screen. Adding a `list_my_drafts` tool would
 * convert every agent in the app into one that reads an officer's unfinished
 * work, and `src/ai/tools/drafting.test.ts` asserts it does not exist.
 */

/** The lever. See the note above before changing it. */
export const DRAFTING_AI_ENABLED = true as boolean

/**
 * What the editor asks before rendering any AI affordance. It takes the
 * app-wide consent state so the two conditions are read in one place and the
 * narrower one cannot be forgotten.
 */
export function draftingAiAvailable(consentGiven: boolean): boolean {
  return DRAFTING_AI_ENABLED && consentGiven
}
