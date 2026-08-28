import { useEffect, useState } from 'react'

import { loadDraftingIndex } from '@/modules/drafting/data'
import type { DraftingIndex } from '@/modules/drafting/schema'
import { loadCorpus } from '@/modules/law/data'
import { buildEngine, type LawSearchEngine } from '@/modules/law/search'
import { loadPayTables } from '@/modules/pay/data'
import { buildJobIndex, type JobIndex } from '@/modules/pay/pick'
import { loadRulesIndex } from '@/modules/trainer/data'
import type { RulesIndex } from '@/modules/trainer/schema'
import { loadGlossary } from '@/modules/utils/glossary/data'
import { buildGlossaryIndex, type GlossaryIndex } from '@/modules/utils/glossary/search'
import { loadPortals } from '@/modules/utils/portals/data'
import type { PortalsDataset } from '@/modules/utils/portals/schema'

/**
 * Every dataset the command palette searches, loaded the first time the
 * reader actually types a query into it — not the first time the palette
 * opens, and not the first time the app loads.
 *
 * `enabled` is `open && query.trim().length > 0` at the call site, the same
 * lever `useLawEngine(enabled)` pulls for `/law` itself: opening the palette
 * with Ctrl+K and closing it again without typing anything downloads nothing.
 * Every loader here is the module's OWN loader (`loadCorpus`, `loadPayTables`,
 * `loadGlossary`, …), each already memoised at module scope, so a second
 * palette session in the same tab — or opening `/law` after using the palette,
 * or the other way round — reuses what is already in memory rather than
 * paying for it twice. The three datasets that need an index BUILT over them
 * (law's Fuse index, the job-post index, the glossary's Fuse index) cache that
 * build the same way, module-scope, because the palette can mount and unmount
 * every time the reader opens and closes it.
 */

let lawEngineCache: LawSearchEngine | null = null
let jobIndexCache: JobIndex | null = null
let glossaryIndexCache: GlossaryIndex | null = null

export interface PaletteData {
  law: LawSearchEngine | null
  jobs: JobIndex | null
  glossary: GlossaryIndex | null
  drafting: DraftingIndex | null
  trainer: RulesIndex | null
  portals: PortalsDataset | null
}

const EMPTY: PaletteData = {
  law: null,
  jobs: null,
  glossary: null,
  drafting: null,
  trainer: null,
  portals: null,
}

export function usePaletteData(enabled: boolean): PaletteData {
  const [state, setState] = useState<PaletteData>(() =>
    enabled
      ? { ...EMPTY, law: lawEngineCache, jobs: jobIndexCache, glossary: glossaryIndexCache }
      : EMPTY,
  )

  useEffect(() => {
    if (!enabled) return
    let cancelled = false

    // Every loader below is already memoised at module scope (its own `once`/
    // `pending` cache), so calling it again when the dataset is already
    // loaded resolves on the next microtask rather than re-parsing anything —
    // cheap enough that there is no separate synchronous "already cached"
    // branch here, which would set state during the effect body itself.
    void loadCorpus()
      .then((corpus) => {
        lawEngineCache ??= buildEngine(corpus)
        if (!cancelled) setState((s) => ({ ...s, law: lawEngineCache }))
      })
      .catch(() => {
        // A section search that never loaded is a quiet miss, not a crash —
        // the reader can still reach /law directly, and retrying is just
        // opening the palette again.
      })

    void loadPayTables()
      .then((tables) => {
        jobIndexCache ??= buildJobIndex(tables.jobs)
        if (!cancelled) setState((s) => ({ ...s, jobs: jobIndexCache }))
      })
      .catch(() => {})

    void loadGlossary()
      .then((glossary) => {
        glossaryIndexCache ??= buildGlossaryIndex(glossary)
        if (!cancelled) setState((s) => ({ ...s, glossary: glossaryIndexCache }))
      })
      .catch(() => {})

    void loadDraftingIndex()
      .then((index) => {
        if (!cancelled) setState((s) => ({ ...s, drafting: index }))
      })
      .catch(() => {})

    void loadRulesIndex()
      .then((index) => {
        if (!cancelled) setState((s) => ({ ...s, trainer: index }))
      })
      .catch(() => {})

    void loadPortals()
      .then((dataset) => {
        if (!cancelled) setState((s) => ({ ...s, portals: dataset }))
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [enabled])

  return state
}

/** Test seam. */
export function resetPaletteDataCache(): void {
  lawEngineCache = null
  jobIndexCache = null
  glossaryIndexCache = null
}
