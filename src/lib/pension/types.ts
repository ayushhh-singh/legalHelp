// Re-exported rather than redeclared: `src/modules/utils/pension/schema.ts`
// is the one definition, the zod counterpart `schemas/pension-facts.schema.json`
// validates against. This module stays import-type-only, so nothing in
// `src/lib/pension` pulls zod (or the dataset) into its own bundle.
export type { PensionFactsDataset as PensionFacts } from '@/modules/utils/pension/schema'

export type PensionScheme = 'nps' | 'ups'
