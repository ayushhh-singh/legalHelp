import { z } from 'zod'

import {
  AiError,
  type AnyToolDef,
  type JsonSchema,
  type ToolContext,
  type ToolDef,
  type ToolScope,
  type ToolSpec,
} from '../types'

/**
 * The tool registry.
 *
 * Two rules hold for every tool in here, and both are load-bearing:
 *
 *  1. A tool is a PURE FUNCTION OVER LOCAL DATA — bundled JSON in /data, or the
 *     reader's own IndexedDB rows. It never fetches the network. That is what
 *     lets the app keep the master context's hard rule while an agent runs.
 *  2. Zod is the single source of truth for a tool's input. The JSON Schema the
 *     model sees is derived from the zod schema at registration, so the shape
 *     the model is told about and the shape the handler validates can never
 *     drift apart.
 *
 * The registry is also the seam for a future MCP server: `exportToolManifest()`
 * emits the same definitions as plain JSON, so the same tools can be served to
 * an external client without a second definition living anywhere.
 */

const registry = new Map<string, RegisteredTool>()

export interface RegisteredTool {
  def: AnyToolDef
  /** Derived from `def.inputSchema` once, at registration. */
  jsonSchema: JsonSchema
}

/** Anthropic accepts `^[a-zA-Z0-9_-]{1,64}$`; be stricter and stay readable. */
const NAME_PATTERN = /^[a-z][a-z0-9_]{2,47}$/

/**
 * Strips the dialect declaration zod emits. `input_schema` is a schema
 * fragment, not a document, and `$schema` there is noise the model pays for on
 * every request.
 */
export function toJsonSchema(schema: z.ZodType): JsonSchema {
  const generated = { ...(z.toJSONSchema(schema, { target: 'draft-2020-12' }) as JsonSchema) }
  delete generated.$schema
  return generated
}

export function registerTool<I>(def: ToolDef<I>): void {
  if (!NAME_PATTERN.test(def.name)) {
    throw new AiError('not_configured', `Tool name "${def.name}" must be lower_snake_case, 3-48 characters.`)
  }
  if (registry.has(def.name)) {
    throw new AiError('not_configured', `Tool "${def.name}" is already registered.`)
  }
  if (!def.description.en || !def.description.hi) {
    // Same rule as every data record in this app: a missing Hindi string is a
    // defect, never a silent fallback to English.
    throw new AiError('not_configured', `Tool "${def.name}" needs both an en and a hi description.`)
  }

  registry.set(def.name, {
    def: def as unknown as AnyToolDef,
    jsonSchema: toJsonSchema(def.inputSchema),
  })
}

export function getTool(name: string): RegisteredTool | undefined {
  return registry.get(name)
}

/** Every tool, or only those a given surface is allowed to reach. */
export function listTools(scope?: ToolScope | readonly ToolScope[]): RegisteredTool[] {
  const all = [...registry.values()].sort((a, b) => a.def.name.localeCompare(b.def.name))
  if (!scope) return all
  const scopes = new Set<ToolScope>(typeof scope === 'string' ? [scope] : scope)
  // `common` tools are available to every surface that asks for any scope.
  scopes.add('common')
  return all.filter((tool) => scopes.has(tool.def.scope))
}

/**
 * The wire form. Descriptions go out in ENGLISH ONLY, in every language:
 * tool definitions sit inside the cached prompt prefix, and swapping them when
 * the reader toggles language would throw the prompt cache away on every
 * toggle. The Hindi description is for the UI that names which tool ran.
 *
 * The list is sorted by name so the prefix is byte-identical between requests —
 * an unstable tool order is the classic silent cache invalidator.
 */
export function toolSpecs(scope?: ToolScope | readonly ToolScope[]): ToolSpec[] {
  return toSpecs(listTools(scope))
}

/**
 * The wire form of an arbitrary set of tools, sorted by name with ONE cache
 * breakpoint on the last entry.
 *
 * The agent uses this rather than filtering `toolSpecs()` down to the tools it
 * was handed: filtering can drop the entry that carried the breakpoint, which
 * would silently disable caching for the tool block — the largest stable prefix
 * in the request — and would also drop a tool that is not in the global
 * registry instead of sending it.
 */
export function toSpecs(tools: readonly RegisteredTool[]): ToolSpec[] {
  const sorted = [...tools].sort((a, b) => a.def.name.localeCompare(b.def.name))
  return sorted.map((tool, index) => ({
    name: tool.def.name,
    description: tool.def.description.en,
    inputSchema: tool.jsonSchema,
    cache: index === sorted.length - 1,
  }))
}

/**
 * The same definitions as plain JSON, for an MCP server to serve later. It
 * carries both languages because an MCP client is not inside this app's prompt
 * cache and can afford to show the reader's own language.
 */
export function exportToolManifest(scope?: ToolScope | readonly ToolScope[]): string {
  const manifest = listTools(scope).map((tool) => ({
    name: tool.def.name,
    description: tool.def.description,
    scope: tool.def.scope,
    inputSchema: tool.jsonSchema,
  }))
  return JSON.stringify({ version: 1, tools: manifest }, null, 2)
}

export interface ValidationOk {
  ok: true
  value: unknown
}
export interface ValidationFailure {
  ok: false
  /** Fed back to the model verbatim, once, so it can correct the call. */
  message: string
}

/**
 * Validates a model-produced argument object. The failure message is written to
 * be read by the model, not by a person: it names the failing path and what was
 * expected, which is what a retry needs.
 */
export function validateToolInput(tool: RegisteredTool, input: unknown): ValidationOk | ValidationFailure {
  const parsed = tool.def.inputSchema.safeParse(input)
  if (parsed.success) return { ok: true, value: parsed.data }

  const problems = parsed.error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ')
  return { ok: false, message: `Invalid arguments for ${tool.def.name} — ${problems}` }
}

/**
 * Calls one registered tool directly, without a model or a `runAgent` loop in
 * the middle — the same validation a model-issued call gets, for an agent
 * file that reads a tool itself before the model runs (`src/ai/agents/tutor.ts`,
 * `pay.ts`; `drafting.ts` calls `render_draft`/`check_draft` the same way for
 * a different reason — see ADR-032 point 1).
 *
 * `callerLabel` names the caller in the "needs this tool" message only; it
 * changes no behaviour.
 */
export async function callToolDirectly(
  tools: readonly RegisteredTool[],
  name: string,
  input: unknown,
  options: { signal?: AbortSignal; callerLabel: string },
): Promise<unknown> {
  const tool = tools.find((entry) => entry.def.name === name)
  if (!tool) throw new AiError('unknown_tool', `The ${options.callerLabel} needs the "${name}" tool.`)
  const validation = validateToolInput(tool, input)
  if (!validation.ok) throw new AiError('invalid_args', validation.message)
  const handler = tool.def.handler as (value: unknown, ctx: ToolContext) => Promise<unknown>
  return handler(validation.value, {
    language: 'en',
    signal: options.signal ?? new AbortController().signal,
  })
}

/** Test seam. Production code registers once, at module load. */
export function clearRegistry(): void {
  registry.clear()
}

export function registeredToolNames(): string[] {
  return [...registry.keys()].sort()
}
