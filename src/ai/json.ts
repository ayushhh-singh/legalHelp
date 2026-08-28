/**
 * Narrowing helpers for values that arrive as `unknown` — an SSE frame, a
 * stored row, a tool's return value.
 *
 * `JSON.parse` is typed `any`, and `any` flowing through this layer would
 * silently disable every type check between the network and the UI. Everything
 * here takes `unknown` and hands back something narrowed or `undefined`.
 */

export function parseJson(text: string): unknown {
  return JSON.parse(text) as unknown
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

export function asArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined
}

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** Missing or non-numeric counts as zero — usage fields are often omitted. */
export function numberOr(value: unknown, fallback: number): number {
  return asNumber(value) ?? fallback
}

/**
 * A tool result has to reach the model as text. Strings pass through unchanged
 * so a handler that already formatted its answer is not double-quoted.
 */
export function stringifyToolOutput(output: unknown): string {
  if (typeof output === 'string') return output
  if (output === undefined) return 'null'
  try {
    return JSON.stringify(output) ?? 'null'
  } catch {
    // A circular structure, or a BigInt. Say so rather than sending the model
    // "[object Object]", which it would confidently read as data.
    return '[tool output could not be serialised]'
  }
}

/** Message text for anything thrown, without assuming it is an Error. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return typeof error === 'string' ? error : 'Unknown error'
}
