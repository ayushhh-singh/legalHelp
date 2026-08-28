import type { PayTables } from '@/lib/pay/tables'
import type { Allowances, Cpc8, DaHistory, HraCities, Jobs, PayMatrix, PayScheme, TaxYear } from './schema'

/**
 * Loading the eleven pay datasets — 1.2 MB — without putting a byte of them on
 * any other route.
 *
 * Same arrangement as the Law Converter (ADR-013), and for the same reasons:
 * a `?raw` dynamic import becomes a content-hashed chunk that the service
 * worker precaches through the ordinary JavaScript glob, so a pay calculation
 * works offline on a first visit; `fetch('/data/pay/*.json')` would only be in
 * the cache once someone had opened this route online, and would need a second
 * exception to the `no-restricted-globals: fetch` rule in `eslint.config.js`.
 * `?raw` also hands us a string, so this is one `JSON.parse` of a compact
 * string rather than eleven megabyte-scale object literals for the engine to
 * construct field by field — and TypeScript types them as `string` instead of
 * inferring a type over 540 matrix cells on every `pnpm typecheck`.
 *
 * The specifiers are written out one per file rather than built from a
 * template: a bundler can only make a chunk for a specifier it can see, and
 * `import(`../../../data/pay/${name}.json?raw`)` would put every file in the
 * directory into every chunk.
 */

let pending: Promise<PayTables> | null = null

const parse = <T>(raw: string): T => JSON.parse(raw) as T

async function loadAll(): Promise<PayTables> {
  const [matrix, da, cities, allowances, jobs, cghs, cgegis, nps, ups, tax, cpc8] = await Promise.all([
    import('../../../data/pay/matrix.json?raw'),
    import('../../../data/pay/da-history.json?raw'),
    import('../../../data/pay/cities.json?raw'),
    import('../../../data/pay/allowances.json?raw'),
    import('../../../data/pay/jobs.json?raw'),
    import('../../../data/pay/cghs.json?raw'),
    import('../../../data/pay/cgegis.json?raw'),
    import('../../../data/pay/nps.json?raw'),
    import('../../../data/pay/ups.json?raw'),
    import('../../../data/pay/tax.json?raw'),
    import('../../../data/pay/cpc8.json?raw'),
  ])

  return {
    matrix: parse<PayMatrix>(matrix.default),
    da: parse<DaHistory>(da.default),
    cities: parse<HraCities>(cities.default),
    allowances: parse<Allowances>(allowances.default),
    jobs: parse<Jobs>(jobs.default),
    cghs: parse<PayScheme>(cghs.default),
    cgegis: parse<PayScheme>(cgegis.default),
    nps: parse<PayScheme>(nps.default),
    ups: parse<PayScheme>(ups.default),
    tax: parse<TaxYear>(tax.default),
    cpc8: parse<Cpc8>(cpc8.default),
  }
}

/**
 * One in-flight promise for the life of the tab. Two panels mounting at once
 * must not start two parses of the same megabyte, and a completed parse must
 * survive the route unmounting — a reader moving between the calculator, the
 * comparison and the simulations would otherwise pay for it three times.
 */
export function loadPayTables(): Promise<PayTables> {
  pending ??= loadAll().catch((error: unknown) => {
    // A failed load is never cached: an offline first visit must be able to
    // succeed on the next attempt rather than being stuck for the tab's life.
    pending = null
    throw error
  })
  return pending
}

/** Test seam. Production never needs to drop the parsed tables. */
export function resetPayTablesCache(): void {
  pending = null
}
