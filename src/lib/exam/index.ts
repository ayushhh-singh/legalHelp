/**
 * Departmental examination mode: profiles, a plan, weighted mocks and a
 * readiness figure that admits what it is measuring.
 *
 * Six files, in one direction:
 *
 *   types.ts      the vocabulary, and the profile → unit walk
 *   coverage.ts   resolving a syllabus unit on to cards — pure
 *   readiness.ts  mastery × coverage, and the next three actions — pure
 *   plan.ts       the day-by-day plan — pure, deterministic, never stored
 *   mock.ts       the weighted draw, the answer sheet and the marking — pure
 *   checklist.ts  the exam-day list, as ids rather than as copy — pure
 *   store.ts      Dexie; the only file here that touches storage
 *
 * No React anywhere in it — `purity.test.ts` asserts that, and a hook over any
 * of this belongs in `src/modules/trainer/exam`. No dataset import either:
 * every function that needs to know what a card IS takes the catalogue as an
 * argument, so `data/rules`'s 4 MB stays behind the Trainer route's own lazy
 * import and `data/exams` behind the exam screens' own.
 *
 * ## The boundary, once, where the whole module can see it
 *
 * A profile encodes PUBLIC syllabus structure over PUBLIC law: which acts, what
 * weight, what pattern, read off a public recruitment rule or notification and
 * cited. No question paper, no departmental manual, no internally circulated
 * material, nothing about any organisation's operations. A syllabus head this
 * app holds nothing for is `{ external: true }` — named, weighted and left
 * empty — and `coverage.ts#mappedMarksShare` is what stops the readiness figure
 * quietly speaking for the whole examination when it is speaking for a fifth
 * of it.
 */

export * from './types'
export * from './coverage'
export * from './readiness'
export * from './plan'
export * from './mock'
export * from './checklist'
export * from './store'
