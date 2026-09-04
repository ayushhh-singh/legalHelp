import { examIndexSchema, examProfileSchema, type ExamIndex, type ExamProfile } from '@/schemas/exam'

/**
 * Loading `data/exams`, only when an exam screen is actually open.
 *
 * Same arrangement as every other dataset in this app (ADR-013): a `?raw`
 * dynamic import, never a `fetch` of `/data/*.json`. That is what keeps
 * `src/ai/providers/wire.ts` the only module allowed to call `fetch`, and what
 * makes exam mode work offline on a device that has never opened `/learn/exam`
 * online — the service worker precaches the chunks through the ordinary
 * JavaScript glob.
 *
 * The specifiers are written out one per profile for the reason
 * `src/modules/drafting/data.ts` and `src/modules/trainer/data.ts` both record:
 * a bundler can only chunk a specifier it can see, so a computed path would put
 * every profile into every chunk.
 *
 * The index is 2 KB and draws the picker; a profile is 8-12 KB and is fetched
 * only once one has been chosen.
 *
 * **Both are parsed through the zod schema rather than cast.** A profile is
 * what the readiness figure, the plan and the mock paper are all computed from,
 * and `strictObject` refusing an unexpected key here is the same guarantee the
 * Python side gets from `additionalProperties: false`.
 */

const PROFILE_LOADERS: Record<string, () => Promise<{ default: string }>> = {
  'css-so-ldce': () => import('../../../../data/exams/profiles/css-so-ldce.json?raw'),
  'ib-so-ldce': () => import('../../../../data/exams/profiles/ib-so-ldce.json?raw'),
  'railway-so-ldce': () => import('../../../../data/exams/profiles/railway-so-ldce.json?raw'),
}

/** Every profile id this build can load. */
export const EXAM_PROFILE_IDS = Object.keys(PROFILE_LOADERS)

/**
 * `Object.hasOwn`, never `in` and never a bare bracket lookup.
 *
 * A profile id comes out of `useParams` or out of a stored row, which is to say
 * out of the address bar. A bare `PROFILE_LOADERS[id]` walks
 * `Object.prototype`, so `constructor` resolves to a FUNCTION, passes a
 * `if (!loader)` guard and is then called as a loader — which is what the first
 * version of `loadExamProfile` below did, and what `data.test.ts` caught. It is
 * the same trap `src/lib/library/data.ts#isWorkId` records costing the Library
 * an edge-case pass.
 */
export const isExamProfileId = (value: string): boolean => Object.hasOwn(PROFILE_LOADERS, value)

const cache = new Map<string, Promise<unknown>>()

function once<T>(key: string, load: () => Promise<T>): Promise<T> {
  const existing = cache.get(key) as Promise<T> | undefined
  if (existing) return existing
  const pending = load().catch((error: unknown) => {
    // A failed load is never cached: an offline first visit must be able to
    // succeed on the next attempt rather than being stuck for the tab's life.
    cache.delete(key)
    throw error
  })
  cache.set(key, pending)
  return pending
}

export function loadExamIndex(): Promise<ExamIndex> {
  return once('exam-index', async () => {
    const module = await import('../../../../data/exams/index.json?raw')
    return examIndexSchema.parse(JSON.parse(module.default))
  })
}

export function loadExamProfile(profileId: string): Promise<ExamProfile> {
  if (!isExamProfileId(profileId)) {
    return Promise.reject(new Error(`unknown exam profile: ${profileId}`))
  }
  const loader = PROFILE_LOADERS[profileId]
  if (!loader) return Promise.reject(new Error(`unknown exam profile: ${profileId}`))
  return once(`exam:${profileId}`, async () => examProfileSchema.parse(JSON.parse((await loader()).default)))
}

/** Test seam. Production never needs to drop what it has parsed. */
export function resetExamCache(): void {
  cache.clear()
}
