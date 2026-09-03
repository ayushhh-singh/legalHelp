/**
 * ONE constants module for model ids, per-task defaults and prices.
 *
 * Ported from Neev (apps/api/src/services/mentor): a model id or an effort
 * level written inline at a call site is a model id nobody can audit. Every
 * request in this app names a constant from here.
 */

export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export type Effort = (typeof EFFORT_LEVELS)[number]

export interface ModelPricing {
  /** USD per million tokens. */
  input: number
  output: number
  cacheWrite: number
  cacheRead: number
}

export interface ModelInfo {
  id: string
  /** Shown in the model picker. Not translated — these are proper names. */
  label: string
  maxContext: number
  maxOutput: number
  pricing: ModelPricing
  /**
   * `thinking: { type: 'adaptive' }`. Absent on pre-4.6 models, which take a
   * `budget_tokens` this app has no use for — we simply omit thinking there.
   */
  adaptiveThinking: boolean
  /** Which `output_config.effort` values the model accepts. */
  effortLevels: readonly Effort[]
  /** `output_config.format` — structured final answers. */
  structuredOutput: boolean
}

/**
 * Prices are the Anthropic first-party rates and are used only to show the
 * reader an estimate. They are not authoritative: the app never sees a bill,
 * and a BYOK reader's real cost is whatever Anthropic charges them.
 */
export const AI_MODELS: readonly ModelInfo[] = [
  {
    id: 'claude-sonnet-4-6',
    label: 'Claude Sonnet 4.6',
    maxContext: 1_000_000,
    maxOutput: 64_000,
    pricing: { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
    adaptiveThinking: true,
    effortLevels: ['low', 'medium', 'high', 'max'],
    structuredOutput: true,
  },
  {
    id: 'claude-opus-5',
    label: 'Claude Opus 5',
    maxContext: 1_000_000,
    maxOutput: 64_000,
    pricing: { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
    adaptiveThinking: true,
    effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
    structuredOutput: true,
  },
  {
    id: 'claude-haiku-4-5',
    label: 'Claude Haiku 4.5',
    maxContext: 200_000,
    maxOutput: 32_000,
    pricing: { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
    // Pre-4.6: adaptive thinking is not available and `effort` is rejected.
    adaptiveThinking: false,
    effortLevels: [],
    structuredOutput: true,
  },
] as const

/**
 * Sahayak's default. Deliberately not the most capable model: a BYOK reader
 * pays for every token, the agents here are grounded lookups over bundled
 * JSON rather than open reasoning, and Sonnet answers them. The picker offers
 * Claude Opus 5 for readers who want it.
 */
export const DEFAULT_MODEL = 'claude-sonnet-4-6'

export function findModel(id: string): ModelInfo | undefined {
  return AI_MODELS.find((model) => model.id === id)
}

/** Unknown ids fall back to the default rather than producing a 404 request. */
export function resolveModel(id: string | undefined): ModelInfo {
  const known = id ? findModel(id) : undefined
  if (known) return known
  const fallback = findModel(DEFAULT_MODEL)
  // AI_MODELS is a literal that contains DEFAULT_MODEL; this is unreachable.
  if (!fallback) throw new Error(`DEFAULT_MODEL ${DEFAULT_MODEL} is missing from AI_MODELS`)
  return fallback
}

/** Clamps to something the model actually accepts; undefined means "omit". */
export function resolveEffort(model: ModelInfo, effort: Effort): Effort | undefined {
  if (model.effortLevels.length === 0) return undefined
  if (model.effortLevels.includes(effort)) return effort
  return model.effortLevels[model.effortLevels.length - 1]
}

/* ------------------------------------------------------------------ *
 * Per-task defaults
 * ------------------------------------------------------------------ */

/**
 * Every agent this app will ever run is named here, with the model and effort
 * it runs at. Adding an agent means adding a row — there is no default row on
 * purpose, so a new agent cannot inherit an effort nobody chose for it.
 */
export const AGENT_IDS = [
  'law-explain',
  'pay-explain',
  'draft-assist',
  'trainer-coach',
  'study-explain',
] as const
export type AgentId = (typeof AGENT_IDS)[number]

export interface TaskDefaults {
  model: string
  effort: Effort
  maxSteps: number
  /** Grounded agents must cite a tool result or the run fails closed. */
  groundedRequired: boolean
}

export const TASK_DEFAULTS: Record<AgentId, TaskDefaults> = {
  // Reads section tables and states what they say. Nothing may be inferred.
  'law-explain': { model: DEFAULT_MODEL, effort: 'medium', maxSteps: 6, groundedRequired: true },
  // Reads computed pay lines. A number with no tool behind it is a wrong number.
  'pay-explain': { model: DEFAULT_MODEL, effort: 'medium', maxSteps: 6, groundedRequired: true },
  // Fills a CSMOP template; the template itself is the tool result it cites.
  'draft-assist': { model: DEFAULT_MODEL, effort: 'medium', maxSteps: 8, groundedRequired: true },
  // Explains why an answer was wrong, citing the rule text behind the card.
  'trainer-coach': { model: DEFAULT_MODEL, effort: 'low', maxSteps: 4, groundedRequired: true },
  // Reads a provision, its precomputed aid and what retrieval found, and
  // explains it. Six steps because the research pass may legitimately want a
  // unit, its aid and a retrieval over the work before it can answer
  // "the difference between Rule X and Rule Y".
  'study-explain': { model: DEFAULT_MODEL, effort: 'medium', maxSteps: 6, groundedRequired: true },
}

/**
 * Analytical questions ("why", "compare", "difference") get one step up the
 * effort ladder — see src/ai/heuristics.ts.
 */
export function raiseEffort(effort: Effort, model: ModelInfo): Effort | undefined {
  const ladder = model.effortLevels
  const index = ladder.indexOf(effort)
  if (index < 0) return resolveEffort(model, effort)
  return ladder[Math.min(index + 1, ladder.length - 1)]
}
