/**
 * The quick actions and the phase list, in a module of their own.
 *
 * ### Why this file exists at all
 *
 * `ModifyPanel` needs two VALUES from the modify agent — `QUICK_ACTIONS` for
 * the preset buttons and, through `AiProgress`, the phase labels — while the
 * whole point of `useModifyAi`'s dynamic `import('@/ai/agents/modify')` is that
 * a reader who never presses the button never downloads the agent. A static
 * import of one constant undoes that: rolldown said so in as many words —
 * `INEFFECTIVE_DYNAMIC_IMPORT: src/ai/agents/modify.ts is dynamically imported
 * by useModifyAi.ts but also statically imported by ModifyPanel.tsx, dynamic
 * import will not move module into another chunk` — and the 100 KB the agent
 * drags behind it (`renderDoc`, `checklist`, `proposal`, `instructions`, zod)
 * would have landed in the editor's chunk for everybody.
 *
 * `docs/AI.md` is explicit that laziness in `src/ai` is a PRIVACY property
 * rather than a performance one, so this is not a size optimisation. Types are
 * erased and may still be imported from the agent directly; values may not.
 *
 * If you add a value the panel needs, add it here — and read the build output
 * rather than trusting that you did, because that warning is the only thing
 * that says the property has been lost.
 */

/**
 * The presets, as INSTRUCTIONS rather than as modes.
 *
 * Each one expands to a sentence the officer could have typed, which is what
 * keeps the agent's input one shape. A preset that took a different code path
 * would be a second feature to test, and the officer would have no way to see
 * what it was actually going to ask for.
 *
 * The English text is what is sent; `src/i18n` carries what the BUTTON says in
 * each language. Sending the officer's interface language into the instruction
 * would make the same button ask for two different things.
 */
export const QUICK_ACTIONS = {
  formal: 'Raise the register to the formal official style CSMOP prescribes, without changing any fact.',
  shorter:
    'Shorten the document. Keep every fact, every figure and every citation; cut repetition and courtesy padding.',
  plainer:
    'Say the same thing in plainer language. Do not drop a citation or a condition to make a sentence simpler.',
  hindi:
    'Produce the Hindi issue of this document in Central Secretariat administrative Hindi. Keep file numbers, section numbers, proper names and citations in their original form.',
  english:
    'Produce the English issue of this document in the formal official register. Keep file numbers, section numbers, proper names and citations in their original form.',
  closing: 'Add the closing paragraph this form takes, and nothing else.',
  renumber:
    'Renumber the references so each one is quoted in full the first time and by its number afterwards. Change no other wording.',
} as const

export type QuickAction = keyof typeof QUICK_ACTIONS

export const MODIFY_PHASES = ['screening', 'reading', 'changing', 'checking', 'done'] as const
export type ModifyPhase = (typeof MODIFY_PHASES)[number]

export interface ModifyStep {
  phase: ModifyPhase
  tool?: string
}
