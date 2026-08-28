import { pensionFactsSchema } from './schema'
import { schemeSchema } from '@/modules/pay/schema'

import type { PensionFactsDataset } from './schema'
import type { PayScheme } from '@/modules/pay/schema'

export interface PensionTables {
  facts: PensionFactsDataset
  nps: PayScheme
  ups: PayScheme
}

/**
 * `data/pension/pension-facts.json` plus the two NPS/UPS scheme files the Pay
 * module already carries — reused rather than duplicated, both as `?raw`
 * dynamic imports (see `src/modules/utils/holidays/data.ts` for why).
 */
let pending: Promise<PensionTables> | null = null

export async function loadPensionTables(): Promise<PensionTables> {
  if (pending) return pending
  pending = Promise.all([
    import('../../../../data/pension/pension-facts.json?raw'),
    import('../../../../data/pay/nps.json?raw'),
    import('../../../../data/pay/ups.json?raw'),
  ])
    .then(([facts, nps, ups]) => ({
      facts: pensionFactsSchema.parse(JSON.parse(facts.default)),
      nps: schemeSchema.parse(JSON.parse(nps.default)),
      ups: schemeSchema.parse(JSON.parse(ups.default)),
    }))
    .catch((error: unknown) => {
      pending = null
      throw error
    })
  return pending
}

export function resetPensionCache(): void {
  pending = null
}
