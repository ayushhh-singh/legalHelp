/**
 * The Rules Trainer's spaced repetition, over `ts-fsrs` with the schedule kept
 * in IndexedDB.
 *
 * Five files, in one direction:
 *
 *   types.ts    the stored shape, and the vocabulary
 *   day.ts      IST day boundaries and the streak
 *   engine.ts   ts-fsrs, and nothing else — pure
 *   queue.ts    what to ask next — pure
 *   stats.ts    what the reader is told — pure
 *   transfer.ts backup, restore, and the merge — pure
 *   store.ts    Dexie; the only file here that touches storage
 *
 * No React anywhere in it — `purity.test.ts` asserts that, and a hook over any
 * of this belongs in `src/modules/trainer`. No dataset import either: every
 * function that needs to know what a card *is* takes the catalogue as an
 * argument, so the 4 MB of `data/rules` stays behind the Trainer route's own
 * lazy import.
 */

export * from './types'
export * from './day'
export * from './engine'
export * from './queue'
export * from './stats'
export * from './transfer'
export * from './store'
