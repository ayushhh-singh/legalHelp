/**
 * The study layer — precomputed aids, active recall, the chapter revision deck,
 * sessions and the weekly review.
 *
 * Eight files, in one direction:
 *
 *   types.ts      the stored shapes and the vocabulary
 *   chapters.ts   the second FSRS deck, over `src/lib/srs`'s engine — pure
 *   quiz.ts       "test me on this chapter", over approved cards only — pure
 *   feynman.ts    the three prompts and the self-grade — pure
 *   sessions.ts   the timer, as wall-clock arithmetic — pure
 *   analytics.ts  the weekly review and the coverage heat-map — pure
 *   sheet.ts      the revision sheet, assembled from what already exists — pure
 *   store.ts      Dexie; the only file here that touches storage
 *
 * No React anywhere in it — `purity.test.ts` asserts that, and a hook over any
 * of this belongs in `src/modules/library` or `src/modules/trainer`. No dataset
 * import either: every function that needs to know what a card or a unit IS
 * takes it as an argument, so `data/rules` and `data/library` stay behind their
 * own routes' lazy imports.
 */

export * from './types'
export * from './chapters'
export * from './quiz'
export * from './feynman'
export * from './sessions'
export * from './analytics'
export * from './sheet'
export * from './store'
