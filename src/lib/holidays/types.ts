// Re-exported rather than redeclared: `src/modules/utils/holidays/schema.ts`
// is the one definition, the zod counterpart `schemas/holidays.schema.json`
// validates against. This module stays import-type-only, so nothing in
// `src/lib/holidays` pulls zod (or the dataset) into its own bundle.
export type { Holiday, HolidaysDataset } from '@/modules/utils/holidays/schema'

/** A DoPT circular for Delhi/New Delhi lets an employee choose this many restricted holidays. */
export const MAX_RESTRICTED_PICKS = 2
