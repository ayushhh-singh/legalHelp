import type { MockScript } from '../providers/mock'

/**
 * Scripted provider responses, one per behaviour the agent loop has to get
 * right. Kept in a fixture file rather than inline in the tests so that the
 * same sequences can back a Storybook-style demo of the AI surfaces later
 * without a key.
 *
 * Convention: the agent labels tool results `T1`, `T2`, … in execution order,
 * so a grounded final answer here cites `[T1]`.
 */

const usage = { inputTokens: 900, outputTokens: 120, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }

/** Happy path: one tool call, then an answer that cites its result. */
export const GROUNDED_LOOKUP: MockScript = {
  id: 'grounded-lookup',
  turns: [
    {
      stopReason: 'tool_use',
      usage,
      content: [
        { type: 'text', text: 'Checking the bundled datasets.' },
        { type: 'tool_use', id: 'toolu_01', name: 'dataset_versions', input: {} },
      ],
    },
    {
      stopReason: 'end_turn',
      usage,
      content: [
        {
          type: 'text',
          text: 'The application dataset on this device is version 0.1.0 [T1]. Verify with your DDO.',
        },
      ],
    },
  ],
}

/** The failure the grounding rule exists for: an answer with nothing behind it. */
export const UNGROUNDED_FINAL: MockScript = {
  id: 'ungrounded-final',
  turns: [
    {
      stopReason: 'tool_use',
      usage,
      content: [{ type: 'tool_use', id: 'toolu_01', name: 'dataset_versions', input: {} }],
    },
    {
      stopReason: 'end_turn',
      usage,
      content: [{ type: 'text', text: 'The dataset is version 9.9.9 and was updated last week.' }],
    },
  ],
}

/** Answers immediately, calling nothing. Cannot be grounded, so must fail. */
export const NO_TOOL_AT_ALL: MockScript = {
  id: 'no-tool-at-all',
  turns: [
    {
      stopReason: 'end_turn',
      usage,
      content: [{ type: 'text', text: 'Section 302 IPC maps to BNS 103.' }],
    },
  ],
}

/**
 * Bad arguments first, then the corrected call. The agent must feed the
 * validation error back exactly once and let the model recover.
 */
export const INVALID_THEN_VALID: MockScript = {
  id: 'invalid-then-valid',
  turns: [
    {
      stopReason: 'tool_use',
      usage,
      content: [{ type: 'tool_use', id: 'toolu_01', name: 'echo_note', input: { not_a_field: 12 } }],
    },
    {
      stopReason: 'tool_use',
      usage,
      content: [{ type: 'tool_use', id: 'toolu_02', name: 'echo_note', input: { note: 'hello' } }],
    },
    {
      stopReason: 'end_turn',
      usage,
      // T1, not T2: handles are numbered per RESULT, and the rejected call
      // produced no result. Numbering by call would let the model cite a step
      // that never ran.
      content: [{ type: 'text', text: 'The note reads “hello” [T1].' }],
    },
  ],
}

/** Never stops calling tools. Exists to prove the step cap actually caps. */
export const NEVER_STOPS: MockScript = {
  id: 'never-stops',
  repeatLast: true,
  turns: [
    {
      stopReason: 'tool_use',
      usage,
      content: [{ type: 'tool_use', id: 'toolu_loop', name: 'dataset_versions', input: {} }],
    },
  ],
}

/** Slow enough that a test can abort it mid-turn. */
export const SLOW_FIRST_TURN: MockScript = {
  id: 'slow-first-turn',
  turns: [
    {
      stopReason: 'end_turn',
      delayMs: 5_000,
      usage,
      content: [{ type: 'text', text: 'Too late.' }],
    },
  ],
}

/** A structured final answer, for the jsonSchema path. */
export const JSON_FINAL: MockScript = {
  id: 'json-final',
  turns: [
    {
      stopReason: 'tool_use',
      usage,
      content: [{ type: 'tool_use', id: 'toolu_01', name: 'dataset_versions', input: {} }],
    },
    {
      stopReason: 'end_turn',
      usage,
      content: [{ type: 'text', text: '{"dataset":"app","version":"0.1.0","source":"[T1]"}' }],
    },
  ],
}

/** The provider itself fails — a 429, a dropped connection. */
export const PROVIDER_ERROR: MockScript = {
  id: 'provider-error',
  turns: [
    { stopReason: 'end_turn', content: [], throwError: { code: 'rate_limited', message: 'Slow down.' } },
  ],
}

/** A tool that hangs, to exercise the per-tool timeout. */
export const CALLS_SLOW_TOOL: MockScript = {
  id: 'calls-slow-tool',
  turns: [
    {
      stopReason: 'tool_use',
      usage,
      content: [{ type: 'tool_use', id: 'toolu_01', name: 'slow_tool', input: {} }],
    },
    {
      stopReason: 'end_turn',
      usage,
      content: [{ type: 'text', text: 'The tool did not answer in time [T1].' }],
    },
  ],
}
