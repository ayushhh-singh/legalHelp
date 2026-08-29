/**
 * Raw turns an on-device model actually produces, as fixtures.
 *
 * Every string here is a shape a small quantised instruction model emits when
 * it is asked for the tool envelope in `src/ai/local/protocol.ts` — the fenced
 * block, the sentence of preamble it was told not to write, the OpenAI
 * function-calling shape it half-remembers from its instruction tuning, the
 * `<think>` block a reasoning-tuned checkpoint emits whether or not anyone
 * asked. They are collected here rather than inline in the test for the reason
 * `src/ai/fixtures/scripts.ts` gives: a fixture with a NAME is a claim about
 * the world that can be argued with, and an inline string is just a string.
 *
 * The two rules they are written to defend:
 *   - a turn is a tool call only when it names a tool. Nothing else about the
 *     call is decided here (`runAgent` validates the name and the arguments,
 *     once, with a recovery path);
 *   - anything that is not a recognisable envelope is the model's prose, and
 *     prose is handed on rather than discarded — the grounding rule decides
 *     whether it may be shown.
 */

export interface LocalTurnFixture {
  name: string
  raw: string
  /** What the parser must make of it, in `tools` mode. */
  expect:
    { kind: 'tool'; toolName: string; input: unknown } | { kind: 'text'; text: string } | { kind: 'empty' }
}

export const TOOL_CALL_FIXTURES: readonly LocalTurnFixture[] = [
  {
    name: 'the bare object, exactly as instructed',
    raw: '{"tool": "get_section", "input": {"act": "bns", "section": "103"}}',
    expect: { kind: 'tool', toolName: 'get_section', input: { act: 'bns', section: '103' } },
  },
  {
    name: 'wrapped in a markdown fence, which every chat-tuned model reaches for',
    raw: '```json\n{"tool": "get_section", "input": {"act": "bns", "section": "103"}}\n```',
    expect: { kind: 'tool', toolName: 'get_section', input: { act: 'bns', section: '103' } },
  },
  {
    name: 'an unclosed fence, which is what truncation at the token ceiling leaves',
    raw: '```json\n{"tool": "search_sections", "input": {"query": "theft"}}',
    expect: { kind: 'tool', toolName: 'search_sections', input: { query: 'theft' } },
  },
  {
    name: 'a sentence of preamble the model was told not to write',
    raw: 'Sure! I will look that up for you.\n{"tool": "get_section", "input": {"act": "bnss", "section": "35"}}',
    expect: { kind: 'tool', toolName: 'get_section', input: { act: 'bnss', section: '35' } },
  },
  {
    name: 'a <think> block, emitted whether or not anyone asked for one',
    raw: '<think>The user wants BNS 318. I should call get_section.</think>\n{"tool":"get_section","input":{"act":"bns","section":"318"}}',
    expect: { kind: 'tool', toolName: 'get_section', input: { act: 'bns', section: '318' } },
  },
  {
    name: 'an unterminated <think>, which is truncation mid-thought',
    raw: '<think>Let me consider whether the offence is bailable and',
    expect: { kind: 'empty' },
  },
  {
    name: 'the OpenAI function-calling shape, with arguments as a JSON STRING',
    raw: '{"tool_call": {"name": "get_classification", "arguments": "{\\"section\\": \\"318\\"}"}}',
    expect: { kind: 'tool', toolName: 'get_classification', input: { section: '318' } },
  },
  {
    name: 'the same shape unwrapped, with `name` and `parameters`',
    raw: '{"name": "compare_old_new", "parameters": {"act": "ipc", "section": "420"}}',
    expect: { kind: 'tool', toolName: 'compare_old_new', input: { act: 'ipc', section: '420' } },
  },
  {
    name: 'a call with no arguments at all',
    raw: '{"tool": "list_acts"}',
    expect: { kind: 'tool', toolName: 'list_acts', input: {} },
  },
  {
    name: 'a Devanagari argument containing a brace, which a naive scan truncates',
    raw: '{"tool": "search_sections", "input": {"query": "चोरी {धारा 303}"}}',
    expect: { kind: 'tool', toolName: 'search_sections', input: { query: 'चोरी {धारा 303}' } },
  },
  {
    name: 'an escaped quote inside a string argument',
    raw: '{"tool": "search_sections", "input": {"query": "the word \\"theft\\""}}',
    expect: { kind: 'tool', toolName: 'search_sections', input: { query: 'the word "theft"' } },
  },
  {
    name: 'arguments that are not an object — handed on so runAgent names the value',
    raw: '{"tool": "get_section", "input": "bns 103"}',
    expect: { kind: 'tool', toolName: 'get_section', input: 'bns 103' },
  },
]

export const ANSWER_FIXTURES: readonly LocalTurnFixture[] = [
  {
    name: 'the answer envelope',
    raw: '{"answer": "Section 103 of the BNS punishes murder. [T1]"}',
    expect: { kind: 'text', text: 'Section 103 of the BNS punishes murder. [T1]' },
  },
  {
    name: 'an answer that is ABOUT a tool, which a name-first parser misreads as a call',
    raw: '{"answer": "I checked with get_section. [T1]", "tool": "get_section"}',
    expect: { kind: 'text', text: 'I checked with get_section. [T1]' },
  },
  {
    name: 'plain prose — the model ignored the envelope but did answer',
    raw: 'Section 103 of the BNS punishes murder. [T1]',
    expect: { kind: 'text', text: 'Section 103 of the BNS punishes murder. [T1]' },
  },
  {
    name: 'JSON that is neither a call nor an answer, handed on as the text it is',
    raw: '{"thoughts": "not sure"}',
    expect: { kind: 'text', text: '{"thoughts": "not sure"}' },
  },
  {
    name: 'nothing at all',
    raw: '   \n  ',
    expect: { kind: 'empty' },
  },
]
