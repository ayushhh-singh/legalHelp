import type { StudyPhase } from '@/ai/agents/study'

/**
 * The plain-language label for each tool and each phase, as a LITERAL MAP.
 *
 * Both used to be built by interpolating into `t()` behind an `as` cast, and
 * the cast is exactly what the drafting panel's own comment warns against: it
 * silences the compiler, so a seventh `library`-scope tool would render its own
 * i18n key at the reader ("library.study.ask.tool.get_whatever") rather than
 * failing the build. With `fallbackLng: false` a missing key IS its own name.
 *
 * A map cannot make that a compile error on its own — a tool name is a string,
 * not a type — so `src/modules/library/study.edge.test.tsx` asserts these keys
 * against the registry's actual `library` scope, which is the mechanism
 * `src/ai/tools/registry.test.ts` already uses for the same problem.
 */
export const TOOL_LABELS = {
  get_unit: 'library.study.ask.tool.get_unit',
  get_study_aid: 'library.study.ask.tool.get_study_aid',
  get_definitions: 'library.study.ask.tool.get_definitions',
  retrieve: 'library.study.ask.tool.retrieve',
  get_related_cards: 'library.study.ask.tool.get_related_cards',
  get_my_notes: 'library.study.ask.tool.get_my_notes',
} as const

/** `Object.hasOwn`, never `in` — ADR-038's `isWorkId` lesson, in a new file. */
export const labelFor = (tool: string): (typeof TOOL_LABELS)[keyof typeof TOOL_LABELS] | null =>
  Object.hasOwn(TOOL_LABELS, tool) ? TOOL_LABELS[tool as keyof typeof TOOL_LABELS] : null

export const PHASE_LABELS = {
  screening: 'library.study.ask.step.screening',
  researching: 'library.study.ask.step.researching',
  reading: 'library.study.ask.step.reading',
  answering: 'library.study.ask.step.answering',
  verifying: 'library.study.ask.step.verifying',
  done: 'library.study.ask.step.done',
} as const satisfies Record<StudyPhase, string>
