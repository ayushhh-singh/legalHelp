import type { DocTemplate } from './schema'
import type { DraftValues, Lang } from '@/lib/drafting/types'

/**
 * The seam an AI drafting assistant would arrive through — declared, disabled,
 * and rendering nothing.
 *
 * **Nothing in the Drafting Studio's UI reads this today.** It exists so that
 * the shape of the eventual feature is settled while the reasons are fresh,
 * rather than being improvised in the session that turns it on. The gating is
 * recorded in `docs/DECISIONS.md` (ADR-021); the short version:
 *
 *  1. `DRAFTING_AI_ENABLED` is `false` and is not wired to a build flag, an
 *     environment variable or a setting. Turning it on is a code change that
 *     shows up in a diff and in a review.
 *  2. Even once it is true, the app-wide AI consent gate still governs. That
 *     gate IS the feature flag for the AI layer (ADR-011); this constant can
 *     only ever subtract.
 *  3. A drafting suggestion would be **Tier 0 (on-device WebLLM) first**. A
 *     draft is the most sensitive thing this app holds — it may name a case, a
 *     colleague or a grievance — so the default assistant must be one that
 *     cannot make a request. Tier 1 and Tier 2 send the draft's text to a model
 *     endpoint, and neither may be the default for this surface even when they
 *     are the reader's default elsewhere.
 *  4. A suggestion is never applied silently. It arrives as a word-level diff
 *     with accept and reject per change — `components/SuggestionDiff.tsx`,
 *     which is built and tested now precisely so that the day this turns on is
 *     not also the day someone writes the review UI in a hurry.
 *  5. The classified-content warning shown before the first use is a modal, not
 *     a banner: an officer must have said "this draft contains nothing
 *     official, sensitive or classified" for *this* draft before its text is
 *     handed to any model, including an on-device one.
 *
 * Keeping the types here, rather than in the session that implements them,
 * also keeps `src/ai/tools/drafting.ts` honest: those tools are registered and
 * working today, and they are deliberately about *templates and rules*, never
 * about the reader's draft. Nothing an agent can call today reads a `drafts`
 * row.
 */

/** Hard off. See the note above before changing this. */
export const DRAFTING_AI_ENABLED = false as boolean

/** What the assistant would be asked to do. Deliberately a closed set. */
export type SuggestionKind =
  /** Tighten prose against CSMOP 9.2(i)-(ii) — no circumlocution, no superlatives. */
  | 'concise'
  /** Recast the body into the person the form requires (8.4(3), 9.5(i)). */
  | 'person'
  /** Produce the other language's version of a paragraph the officer has written. */
  | 'translate'
  /** Name a date where the draft asks for something by "immediately" (9.2(v)). */
  | 'replyDate'

export interface SuggestionRequest {
  templateId: string
  /** The field being rewritten. Never the whole draft. */
  field: string
  lang: Lang
  kind: SuggestionKind
  /** Exactly the text shown in the diff — nothing else may be sent. */
  text: string
}

export interface Suggestion {
  request: SuggestionRequest
  /** The proposed replacement, to be diffed against `request.text`. */
  text: string
  /** Which CSMOP paragraph the change is justified by, for the reader to check. */
  csmopRef?: string
}

export interface DraftingAssistant {
  suggest: (request: SuggestionRequest) => Promise<Suggestion>
}

/**
 * The only implementation there is: one that refuses.
 *
 * A stub that threw would be a stub someone silently caught. This resolves to
 * nothing and says why, so a caller written before the feature exists is
 * visibly a caller with no assistant rather than a caller with a broken one.
 */
export const disabledAssistant: DraftingAssistant = {
  suggest: () =>
    Promise.reject(
      new Error('The drafting assistant is not enabled. See src/modules/drafting/ai-seam.ts and ADR-021.'),
    ),
}

/**
 * What the UI asks before rendering any AI affordance. Takes the app-wide
 * consent state so that the two conditions are read in one place and the
 * narrower one cannot be forgotten.
 */
export function draftingAiAvailable(consentGiven: boolean): boolean {
  return DRAFTING_AI_ENABLED && consentGiven
}

/** Unused today; typed so the eventual caller cannot invent a wider payload. */
export type SuggestionContext = {
  template: DocTemplate
  values: DraftValues
}
