import { readFromRoot } from './paths'

import type { PayTables } from '@/lib/pay/tables'
import type {
  Allowances,
  Cpc8,
  DaHistory,
  HraCities,
  Jobs,
  PayMatrix,
  PayScheme,
  TaxYear,
} from '@/modules/pay/schema'

/**
 * The committed pay datasets, read off disk.
 *
 * Same arrangement as `tests/pay-data.test.ts` and the law suites: reading the
 * bytes rather than importing them means the engine suite tests the artefact
 * that ships, and keeps 1.2 MB of JSON out of whatever imports this helper.
 */
const load = <T>(file: string): T => JSON.parse(readFromRoot('data/pay', file)) as T

let cached: PayTables | null = null

export function loadPayTables(): PayTables {
  cached ??= {
    matrix: load<PayMatrix>('matrix.json'),
    da: load<DaHistory>('da-history.json'),
    cities: load<HraCities>('cities.json'),
    allowances: load<Allowances>('allowances.json'),
    jobs: load<Jobs>('jobs.json'),
    cghs: load<PayScheme>('cghs.json'),
    cgegis: load<PayScheme>('cgegis.json'),
    nps: load<PayScheme>('nps.json'),
    ups: load<PayScheme>('ups.json'),
    tax: load<TaxYear>('tax.json'),
    cpc8: load<Cpc8>('cpc8.json'),
  }
  return cached
}
