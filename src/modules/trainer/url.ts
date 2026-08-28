/**
 * A shareable link to one Trainer topic — an Act, in this module's own
 * vocabulary (`data/rules/index.json`'s `acts[]`).
 *
 * `/learn/review?act=<actId>` already existed informally before this file:
 * `HomePage.tsx`'s weak-area chips and `ReviewPage.tsx`'s own `useSearchParams`
 * read built exactly this shape without a shared helper. This formalises it
 * so the command palette's Trainer-topic results and a topic's own "Copy
 * link" button (`BrowsePage.tsx`) cannot drift from what the review session
 * actually reads.
 */
export function toTrainerTopicHref(actId: string): string {
  return `/learn/review?act=${encodeURIComponent(actId)}`
}
