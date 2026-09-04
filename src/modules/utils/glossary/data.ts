import type { Glossary } from './schema'

/**
 * Loading `data/glossary.json` — one `?raw` dynamic import, never a `fetch`.
 *
 * Same arrangement as the law, pay and drafting datasets (ADR-013): this keeps
 * `src/ai/providers/wire.ts` the only module in the app allowed to call
 * `fetch`, and it is what makes the glossary work offline on a device that has
 * never opened `/tools/glossary` online — the service worker precaches the
 * chunk through the ordinary JavaScript glob. `useGlossary(enabled)` gates the
 * request behind the reader actually opening the glossary or the drafting
 * editor's toolbar sheet, the same lever `useLawEngine(enabled)` and
 * `useStructureTerms(enabled)` pull — a single JSON file of ~1,500 entries is
 * not something every reader of `/tools` should download to see a hub page.
 */

const parse = <T>(raw: string): T => JSON.parse(raw) as T

let cached: Promise<Glossary> | null = null

export function loadGlossary(): Promise<Glossary> {
  if (cached) return cached
  const pending = import('../../../../data/glossary.json?raw')
    .then((module) => parse<Glossary>(module.default))
    .catch((error: unknown) => {
      // A failed load is never cached: an offline first visit must be able to
      // succeed on the next attempt rather than being stuck for the tab's life.
      cached = null
      throw error
    })
  cached = pending
  return pending
}

/** Test seam. Production never needs to drop what it has parsed. */
export function resetGlossaryCache(): void {
  cached = null
}
