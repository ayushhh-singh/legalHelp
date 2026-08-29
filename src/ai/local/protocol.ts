import type { ContentPart, Message, SystemBlock, ToolSpec } from '../types'

/**
 * How an on-device model is asked to call a tool, and how its answer is read
 * back.
 *
 * A small quantised model has no tool-calling wire format. What it has is the
 * ability to emit a JSON object when it is asked clearly enough and when the
 * decoder is constrained to JSON. So Tier 0 emulates the tool protocol in the
 * prompt: one object per turn, either a call or an answer, and this file turns
 * whatever comes back into the same `ContentPart[]` that Tiers 1 and 2 produce.
 * `runAgent` cannot tell the difference, which is the entire reason the
 * provider seam exists.
 *
 * THE PARSING IS STRICT ABOUT ONE THING AND ONE ONLY: a turn is a tool call if
 * and only if the object carries a NAME that is a non-empty string. Everything
 * else about the call — whether the tool exists, whether the arguments match
 * its schema — is already validated by `runAgent`, which has a recovery path
 * that feeds the model back the available tool list or the zod error exactly
 * once. Re-deciding those here would mean two validators disagreeing, and the
 * one further from the model would win silently.
 *
 * Being strict the other way — refusing a call whose arguments are not an
 * object — was tried and is worse: it turns a visible, correctable mistake
 * into prose the reader sees.
 */

/**
 * Two, and no more.
 *
 * `runAgent`'s own step cap is 4-8 depending on the agent, which is sized for a
 * frontier model that plans. A 1.5B model given six chances to call a tool
 * spends them: it re-reads the same section, it calls `search_sections` with
 * the words of its own last result, and the reader waits a minute per step on a
 * device generating perhaps twenty tokens a second. Two steps is one lookup and
 * one follow-up, which is what the grounded questions this app asks actually
 * need — and `src/ai/agents/law.ts#TIER_POLICIES.local` already assumed exactly
 * this shape.
 */
export const LOCAL_MAX_TOOL_STEPS = 2

export type LocalRole = 'system' | 'user' | 'assistant'

export interface LocalMessage {
  role: LocalRole
  content: string
}

/* ------------------------------------------------------------------ *
 * Prompt building
 * ------------------------------------------------------------------ */

/**
 * The cache breakpoints are dropped, deliberately and without regret: there is
 * no prompt cache on this device and no bill for the prefix. Empty blocks go
 * too, for the reason `wire.ts#systemToWire` drops them — an absent profile
 * segment would otherwise leave a blank line the model reads as a separator.
 */
export function flattenSystem(blocks: readonly SystemBlock[]): string {
  return blocks
    .map((block) => block.text.trim())
    .filter((text) => text.length > 0)
    .join('\n\n')
}

/** A compact one-line rendering of a tool, name first. */
function describeTool(tool: ToolSpec): string {
  return `- ${tool.name}: ${tool.description}\n  input: ${JSON.stringify(tool.inputSchema)}`
}

export interface ProtocolOptions {
  /** How many more lookups the model may make. Zero forces an answer. */
  stepsLeft: number
}

/**
 * The protocol block, appended to the system prompt.
 *
 * It is in English only, and that is the same decision `prompts.ts` already
 * made for tool descriptions: this text is machinery the model reads, never
 * something the reader sees, and a bilingual copy would double the prompt on a
 * device where the prompt is the slow part. What the reader sees is governed
 * by the persona's own language directive, which is unchanged.
 */
export function toolProtocolInstruction(tools: readonly ToolSpec[], options: ProtocolOptions): string {
  /*
    A run with NO tools at all never mentions a `[T…]` handle, and that is not a
    cosmetic distinction — it is the difference between an answer being shown
    and an answer being discarded.

    `src/ai/agents/{pay,tutor}.ts` call their tools in CODE before the model
    runs and then pass `tools: []`, so there are no tool results and there never
    will be; what the model is given is numbered PLATFORM CONTEXT, cited as
    `[1]`, `[2]`. `context.ts#CITATION_PATTERN` is `/\[(\d{1,3})\]/` and does not
    match `[T1]`, so a model that followed a `[T1]` instruction cites nothing as
    far as `validateCitations` is concerned — every provision number in the
    answer then lands in `unsupported`, and those problems are pushed REGARDLESS
    of `requireCitation`. A tutor "Explain" correctly saying "Rule 3 of the CCS
    (Conduct) Rules" would have ended the run with `invalid_citation` on every
    device, and the cause would have been this instruction rather than anything
    wrong with the answer.

    So the toolless form says only what this block uniquely knows — the JSON
    envelope — and leaves the citation rule to the persona and the context
    block, which are identical on every tier and are already right.
  */
  const envelopeOnly = [
    'REPLY FORMAT — this is not optional.',
    'Reply with exactly ONE JSON object and nothing else. No text before it, no text after it, no markdown fence.',
    '',
    '{"answer": "<your answer here>"}',
    '',
    'Follow the citation rules in the instructions above exactly as they are written there.',
    'Do not state a section number, rule number or figure that does not appear in the material you were given.',
  ].join('\n')

  const answerOnly = [
    'REPLY FORMAT — this is not optional.',
    'Reply with exactly ONE JSON object and nothing else. No text before it, no text after it, no markdown fence.',
    '',
    '{"answer": "<your answer here>"}',
    '',
    'Every section number, rule number and figure you state must appear in a lookup result above.',
    'Cite the result you took it from by its handle, in square brackets, like [T1]. An answer that cites nothing is discarded unread.',
  ].join('\n')

  if (tools.length === 0) return envelopeOnly
  if (options.stepsLeft <= 0) return answerOnly

  return [
    'TOOL PROTOCOL — this is not optional.',
    'You cannot call a function directly. Reply with exactly ONE JSON object and nothing else. No text before it, no text after it, no markdown fence.',
    '',
    'To look something up:',
    '{"tool": "<tool name>", "input": {<arguments>}}',
    '',
    'To give your final answer:',
    '{"answer": "<your answer here>"}',
    '',
    options.stepsLeft === 1
      ? 'You may look something up ONE more time. After that you must answer.'
      : `You may look things up at most ${options.stepsLeft} more times. After that you must answer.`,
    '',
    'Every section number, rule number and figure you state must appear in a lookup result.',
    'Cite the result you took it from by its handle, in square brackets, like [T1]. An answer that cites nothing is discarded unread.',
    '',
    'Available tools:',
    ...tools.map(describeTool),
  ].join('\n')
}

/**
 * How many emulated tool calls this conversation has already made.
 *
 * Counted from the transcript rather than held in a field on the provider,
 * because `runAgent` builds a fresh `messages` array per run and the provider
 * instance outlives it — a counter on the object would leak one run's budget
 * into the next.
 */
export function toolStepsUsed(messages: readonly Message[]): number {
  return messages.reduce(
    (total, message) => total + message.content.filter((part) => part.type === 'tool_use').length,
    0,
  )
}

/**
 * The transcript, rewritten as plain chat turns.
 *
 * An assistant `tool_use` becomes the JSON object the model was told to emit —
 * so its own previous turn reads back to it in the protocol it was taught,
 * rather than as a structure it has never seen. A `tool_result` becomes a user
 * turn carrying the handle the agent already prefixed (`[T1] …`), which is what
 * the citation instruction refers to.
 */
export function toPromptMessages(messages: readonly Message[]): LocalMessage[] {
  const out: LocalMessage[] = []

  for (const message of messages) {
    const rendered = message.content.map(renderPart).filter((text) => text.length > 0)
    if (rendered.length === 0) continue
    out.push({
      // A tool result is authored by the app, not by the assistant, and every
      // chat template in this catalogue alternates strictly — so it goes back
      // as a user turn, which is also how `runAgent` already stores it.
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: rendered.join('\n\n'),
    })
  }

  return out
}

function renderPart(part: ContentPart): string {
  switch (part.type) {
    case 'text':
      return part.text.trim()
    case 'tool_use':
      return JSON.stringify({ tool: part.name, input: part.input })
    case 'tool_result':
      return part.isError ? `Lookup failed: ${part.content}` : part.content
  }
}

/* ------------------------------------------------------------------ *
 * Reading the answer back
 * ------------------------------------------------------------------ */

export type LocalTurn =
  { kind: 'tool'; name: string; input: unknown } | { kind: 'text'; text: string } | { kind: 'empty' }

/**
 * `tools`  — a call or an answer envelope is expected.
 * `answer` — the lookups are spent; only an answer envelope is expected.
 * `raw`    — a schema-constrained final answer. The JSON IS the answer, so
 *            nothing is unwrapped: `runAgent` parses it against the schema the
 *            agent asked for. Unwrapping would be actively wrong here, because
 *            `src/ai/agents/law.ts`'s own answer schema has a field called
 *            `answer`.
 */
export type ParseMode = 'tools' | 'answer' | 'raw'

/**
 * Removes a reasoning preamble.
 *
 * Some instruction-tuned models emit `<think>…</think>` whether or not they
 * were asked to, and a run that hits the token ceiling mid-thought leaves the
 * tag unclosed — which is why an unterminated opener takes the rest of the
 * string with it rather than being left in the answer.
 */
export function stripThinking(text: string): string {
  return text
    .replace(/<(think|thinking|reasoning)>[\s\S]*?<\/\1>/gi, '')
    .replace(/<(think|thinking|reasoning)>[\s\S]*$/i, '')
    .trim()
}

/** Removes a ```json … ``` wrapper, opened or unclosed. */
export function stripFences(text: string): string {
  const fenced = /^```(?:json|JSON)?\s*\n?([\s\S]*?)(?:\n?```)?\s*$/.exec(text.trim())
  return (fenced?.[1] ?? text).trim()
}

/**
 * The first balanced `{…}` in the string.
 *
 * A brace inside a string literal does not count, and a brace escaped inside
 * one does not either — without both rules a perfectly good tool call whose
 * argument contains a `}` (a Devanagari citation, a regex, a rule heading)
 * would be truncated to invalid JSON and silently become prose.
 *
 * Returns undefined when nothing balances, which includes the common case of a
 * turn cut off by the token ceiling.
 */
export function firstJsonObject(text: string): string | undefined {
  const start = text.indexOf('{')
  if (start === -1) return undefined

  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < text.length; i += 1) {
    const char = text[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\') {
      if (inString) escaped = true
      continue
    }
    if (char === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (char === '{') depth += 1
    if (char === '}') {
      depth -= 1
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return undefined
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function firstString(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  }
  return undefined
}

/**
 * The aliases a small model actually produces.
 *
 * These are not a guess at what a model MIGHT say: `tool_call` and a
 * stringified `arguments` are the OpenAI function-calling shape, which is in
 * the instruction-tuning data of every model on this list, and `name` is what
 * a model reaches for when it half-remembers that shape. Accepting them costs
 * nothing — the shape is still unambiguous — and refusing them would spend a
 * whole agent step teaching the model a synonym.
 */
const NAME_KEYS = ['tool', 'tool_name', 'name', 'function'] as const
const INPUT_KEYS = ['input', 'arguments', 'parameters', 'args'] as const
const WRAPPER_KEYS = ['tool_call', 'function_call', 'tool_use'] as const

/** Unwraps one level of `{"tool_call": {...}}` and nothing deeper. */
function unwrap(record: Record<string, unknown>): Record<string, unknown> {
  for (const key of WRAPPER_KEYS) {
    const inner = record[key]
    if (isRecord(inner)) return inner
  }
  return record
}

function readInput(record: Record<string, unknown>): unknown {
  for (const key of INPUT_KEYS) {
    const value = record[key]
    if (value === undefined) continue
    if (typeof value === 'string') {
      // OpenAI serialises arguments as a JSON string. Anything that is not
      // JSON is handed on unchanged, so `runAgent`'s zod error names the value
      // the model actually sent.
      try {
        return JSON.parse(value)
      } catch {
        return value
      }
    }
    return value
  }
  return {}
}

export function parseLocalTurn(raw: string, mode: ParseMode): LocalTurn {
  const cleaned = stripFences(stripThinking(raw))
  if (!cleaned) return { kind: 'empty' }

  if (mode === 'raw') return { kind: 'text', text: cleaned }

  const candidate = firstJsonObject(cleaned)
  let parsed: unknown
  if (candidate) {
    try {
      parsed = JSON.parse(candidate)
    } catch {
      parsed = undefined
    }
  }

  if (isRecord(parsed)) {
    const record = unwrap(parsed)

    // Answer first: a well-formed answer envelope is never a tool call, and
    // checking the name first would misread an answer that happens to be ABOUT
    // a tool ({"answer": "...", "tool": "get_section"} does occur).
    const answer = firstString(record, ['answer'])
    if (answer) return { kind: 'text', text: answer }

    const name = firstString(record, NAME_KEYS)
    if (name) {
      if (mode === 'answer') {
        // The lookups are spent and the model tried to make another one. There
        // is no answer in this turn, and printing the JSON would show the
        // reader machinery. `runAgent` reports `empty`, which is exactly what
        // happened.
        return { kind: 'empty' }
      }
      return { kind: 'tool', name, input: readInput(record) }
    }
  }

  // Not JSON, or JSON with neither field. A model that simply answered in prose
  // has still answered, and `runAgent`'s grounding and citation checks are what
  // decide whether that answer may be shown.
  return { kind: 'text', text: cleaned }
}

/** The `ContentPart[]` a turn becomes, in the shape every provider returns. */
export function toContent(turn: LocalTurn, toolCallId: string): ContentPart[] {
  switch (turn.kind) {
    case 'tool':
      return [{ type: 'tool_use', id: toolCallId, name: turn.name, input: turn.input }]
    case 'text':
      return [{ type: 'text', text: turn.text }]
    case 'empty':
      return []
  }
}
