import Fuse, { type IFuseOptions } from 'fuse.js'

import { isPersonalQuery, normaliseQuestion } from './heuristics'
import { PROMPT_VERSIONS } from './prompts'
import type { AgentId } from './models'
import type { AiOutputMeta } from './types'

import { db, type AiAnswerRow } from '@/db'
import type { Language } from '@/i18n'
import { DATA_VERSION } from '@/lib/dataVersion'

/**
 * A local, semantic-ish answer cache.
 *
 * It exists for one reason: a BYOK reader pays for every token, and "what does
 * BNS 103 correspond to" asked twice in a week should cost once. It is not a
 * performance feature.
 *
 * FOUR THINGS MUST MATCH before a stored answer is served, and each rules out a
 * way the cache could be wrong rather than merely stale:
 *
 *   agent id      — the same question means different things to different agents
 *   language      — an English answer is not a Hindi answer
 *   prompt version — a prompt edit changes what the answer would have been
 *   data version  — the bundled tables the answer was grounded in have not moved
 *
 * And one thing must NOT be true: the question must not be personal. Personal
 * questions ("my leave balance", "मेरा वेतन") are never cached at all — they are
 * not reusable, and a cache of them is the one place in this app where one
 * session's figures could surface in another.
 *
 * The reader always sees that an answer came from the cache. A quietly replayed
 * answer that the reader believes is fresh is a worse failure than a slow one.
 */

/**
 * Fuse's `score` is a distance: 0 is an exact match. `1 - score` is therefore a
 * similarity, and 0.92 is deliberately tight — this is a "you asked the same
 * thing again" cache, not a "close enough" one.
 */
export const SIMILARITY_THRESHOLD = 0.92

/**
 * `ignoreLocation` is required, not cosmetic: without it Fuse weights matches by
 * how near the start of the string they fall, so "DA rate for level 7" and
 * "level 7 DA rate" score very differently. Word order is not meaning here.
 */
const FUSE_OPTIONS: IFuseOptions<AiAnswerRow> = {
  keys: ['normalised'],
  includeScore: true,
  ignoreLocation: true,
  threshold: 0.4,
  minMatchCharLength: 3,
}

export interface AnswerCacheKey {
  agentId: AgentId
  question: string
  language: Language
}

export interface CachedAnswer {
  row: AiAnswerRow
  similarity: number
  /** True when the normalised text was identical, not merely similar. */
  exact: boolean
}

const rowId = (key: AnswerCacheKey, normalised: string): string =>
  `${key.agentId}:${key.language}:${normalised}`

/** True when this question may be cached at all. */
export function isCacheable(question: string): boolean {
  return !isPersonalQuery(question)
}

export async function lookupAnswer(key: AnswerCacheKey): Promise<CachedAnswer | null> {
  if (!isCacheable(key.question)) return null

  const normalised = normaliseQuestion(key.question)
  if (!normalised) return null

  const candidates = (await db.aiAnswers.where('agentId').equals(key.agentId).toArray()).filter(
    (row) =>
      row.language === key.language &&
      row.dataVersion === DATA_VERSION &&
      row.promptVersion === PROMPT_VERSIONS[key.agentId],
  )
  if (candidates.length === 0) return null

  const exact = candidates.find((row) => row.normalised === normalised)
  if (exact) return { row: exact, similarity: 1, exact: true }

  const [best] = new Fuse(candidates, FUSE_OPTIONS).search(normalised, { limit: 1 })
  if (!best) return null

  const similarity = 1 - (best.score ?? 1)
  if (similarity < SIMILARITY_THRESHOLD) return null
  return { row: best.item, similarity, exact: false }
}

export interface StoreAnswerParams extends AnswerCacheKey {
  answer: string
  json?: unknown
  meta: AiOutputMeta
}

/** No-ops for a personal question rather than throwing — the caller need not ask. */
export async function storeAnswer(params: StoreAnswerParams): Promise<void> {
  if (!isCacheable(params.question)) return

  const normalised = normaliseQuestion(params.question)
  if (!normalised) return

  await db.aiAnswers.put({
    id: rowId(params, normalised),
    agentId: params.agentId,
    language: params.language,
    dataVersion: DATA_VERSION,
    promptVersion: PROMPT_VERSIONS[params.agentId],
    normalised,
    question: params.question,
    answer: params.answer,
    ...(params.json !== undefined ? { json: params.json } : {}),
    meta: params.meta,
    createdAt: params.meta.at,
  })
}

/**
 * The meta a cached answer is presented under. `cached: true` is what the UI
 * reads to draw the "from cache · answer fresh" affordance, so it is set here
 * rather than left to each call site to remember.
 */
export function cachedMeta(row: AiAnswerRow): AiOutputMeta | null {
  const meta = row.meta
  if (typeof meta !== 'object' || meta === null) return null
  return { ...(meta as AiOutputMeta), cached: true }
}

/**
 * Drops every answer that was grounded in a dataset version this build no
 * longer ships. Called once at AI start-up; a version bump in
 * data/_meta/versions.json therefore empties the cache without any migration.
 */
export async function pruneStaleAnswers(): Promise<number> {
  const stale = await db.aiAnswers.filter((row) => row.dataVersion !== DATA_VERSION).toArray()
  if (stale.length === 0) return 0
  await db.aiAnswers.bulkDelete(stale.map((row) => row.id))
  return stale.length
}

export async function clearAnswerCache(): Promise<void> {
  await db.aiAnswers.clear()
}

export async function answerCacheSize(): Promise<number> {
  return db.aiAnswers.count()
}
