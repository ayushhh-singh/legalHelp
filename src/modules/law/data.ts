import type { LawCode, LawCorpus, LawDataset, LawIndex, OldActId } from './types'

/**
 * Loading `data/law/*.json` — 3.9 MB of section text — without putting a byte
 * of it on the initial route.
 *
 * **Why `?raw` and a dynamic import rather than `fetch`.** `docs/DATA-GAPS.md`
 * #21 assumed a fetch on this route. Three things argued the other way:
 *
 *  1. `eslint.config.js` restricts `fetch` to `src/ai/providers/wire.ts`, so
 *     "what in this app can talk to the network?" is answerable from one file.
 *     A loader here would need a second exception, for data that is not on the
 *     network at all.
 *  2. A dynamic import becomes a content-hashed chunk, so the service worker
 *     precaches it through the existing JS glob pattern, and an unchanged dataset
 *     keeps its hash across a release. A fetched `/data/*.json` would only be
 *     in the cache once someone had opened this route online first — which is
 *     not what "offline-first" promises.
 *  3. `?raw` hands us a string, so this stays one `JSON.parse` of a compact
 *     string rather than a megabyte-scale object literal for the JS engine to
 *     construct field by field — and TypeScript types it as `string` instead of
 *     inferring a type over 1,059 sections on every `pnpm typecheck`.
 *
 * See ADR-013.
 */

/** Every code pair, in the order the chips show them. */
export const LAW_CODES: readonly LawCode[] = ['bns', 'bnss', 'bsa'] as const

export const OLD_ACT_FOR: Readonly<Record<LawCode, OldActId>> = {
  bns: 'IPC',
  bnss: 'CrPC',
  bsa: 'IEA',
}

export const CODE_FOR_OLD_ACT: Readonly<Record<OldActId, LawCode>> = {
  IPC: 'bns',
  CrPC: 'bnss',
  IEA: 'bsa',
}

export const isLawCode = (value: unknown): value is LawCode =>
  typeof value === 'string' && (LAW_CODES as readonly string[]).includes(value)

/**
 * One in-flight promise per file, kept for the life of the tab. Two components
 * mounting at once must not start two parses of the same megabyte, and a
 * completed parse must not be thrown away when the route unmounts — a reader
 * moving between the converter and the saved list would otherwise pay for it
 * twice.
 */
const pending = new Map<string, Promise<unknown>>()

function once<T>(key: string, load: () => Promise<T>): Promise<T> {
  const existing = pending.get(key) as Promise<T> | undefined
  if (existing) return existing
  const started = load().catch((error: unknown) => {
    // A failed load must not be cached: an offline first-visit should be able
    // to succeed on the next attempt rather than being stuck forever.
    pending.delete(key)
    throw error
  })
  pending.set(key, started)
  return started
}

/**
 * The import specifiers are written out one per code rather than built from a
 * template, because a bundler can only create a chunk for a specifier it can
 * see. `import(`../../../data/law/${code}.json?raw`)` would make Rollup include
 * every file in that directory in every chunk.
 */
async function loadRaw(code: LawCode): Promise<string> {
  switch (code) {
    case 'bns':
      return (await import('../../../data/law/bns.json?raw')).default
    case 'bnss':
      return (await import('../../../data/law/bnss.json?raw')).default
    case 'bsa':
      return (await import('../../../data/law/bsa.json?raw')).default
  }
}

export function loadDataset(code: LawCode): Promise<LawDataset> {
  return once(`dataset:${code}`, async () => JSON.parse(await loadRaw(code)) as LawDataset)
}

export function loadIndex(): Promise<LawIndex> {
  return once('index', async () => {
    const raw = (await import('../../../data/law/index.json?raw')).default
    return JSON.parse(raw) as LawIndex
  })
}

/**
 * Everything the converter needs, loaded in parallel.
 *
 * All three codes are loaded even when a code chip is selected: the chip is a
 * filter on results, and a reader who types "154" with BNSS selected still has
 * to be told that BNS 154 exists. Selecting a chip and then having to wait
 * again would also make every chip press feel like a page load.
 */
export function loadCorpus(): Promise<LawCorpus> {
  return once('corpus', async () => {
    const [index, bns, bnss, bsa] = await Promise.all([
      loadIndex(),
      loadDataset('bns'),
      loadDataset('bnss'),
      loadDataset('bsa'),
    ])
    return { index, datasets: { bns, bnss, bsa } }
  })
}

/** Test seam. Production never needs to drop a parsed dataset. */
export function resetCorpusCache(): void {
  pending.clear()
}
