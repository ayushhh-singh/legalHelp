import type {
  Allowance,
  AllowanceRate,
  Allowances,
  Cpc8,
  DaHistory,
  DaRate,
  HraCities,
  HraCity,
  Job,
  Jobs,
  PayMatrix,
  PayMatrixLevel,
  PayScheme,
  TaxYear,
} from '@/modules/pay/schema'

/**
 * The eleven pay datasets, and the lookups every calculation starts from.
 *
 * Nothing in `src/lib/pay` imports a JSON file. The tables are handed in, which
 * is what lets `engine.ts` stay a pure function of its inputs: the unit suite
 * reads the committed bytes off disk (`tests/`-style `readFromRoot`), the UI
 * hands it the lazily-imported chunks from `src/modules/pay/data.ts`, and an
 * agent tool hands it the same ones. One implementation, three callers, no
 * module-level state to reset between them.
 */

export interface Bilingual {
  en: string
  hi: string
}

export interface PaySource {
  name: string
  url: string
  reference?: string
  dated?: string
  note?: Bilingual
}

export interface PayTables {
  matrix: PayMatrix
  da: DaHistory
  cities: HraCities
  allowances: Allowances
  jobs: Jobs
  cghs: PayScheme
  cgegis: PayScheme
  nps: PayScheme
  ups: PayScheme
  tax: TaxYear
  cpc8: Cpc8
}

/** `'1'` … `'18'`, plus the interpolated `'13A'`. Strings, because of 13A. */
export type PayLevelId = string

export type CityClass = 'X' | 'Y' | 'Z'
export type PensionScheme = 'nps' | 'ups' | 'gpf'
export type Group = 'A' | 'B' | 'C'
export type Regime = 'old' | 'new'

/**
 * Level order for comparisons. `'13A'` sits between 13 and 14, and a plain
 * `Number('13A')` is `NaN` — which would silently sort it below Level 1 and
 * give a Director-rank officer a Level-1 Transport Allowance.
 */
export function levelRank(level: PayLevelId): number {
  if (level === '13A') return 13.5
  const n = Number(level)
  return Number.isFinite(n) ? n : Number.NaN
}

export const LEVEL_IDS = (matrix: PayMatrix): PayLevelId[] =>
  [...matrix.levels].sort((a, b) => levelRank(a.level) - levelRank(b.level)).map((l) => l.level)

export function levelFor(matrix: PayMatrix, level: PayLevelId): PayMatrixLevel | undefined {
  return matrix.levels.find((entry) => entry.level === level)
}

/**
 * The pay in a cell. `cellIndex` is ZERO-BASED internally and one-based
 * everywhere a reader sees it — the matrix prints "Level 7, cell 1" for the
 * entry pay, and an off-by-one here is a wrong salary rather than a wrong pixel.
 */
export function cellPay(matrix: PayMatrix, level: PayLevelId, cellIndex: number): number | undefined {
  return levelFor(matrix, level)?.cells[cellIndex]
}

/** Clamp a cell index into the level, so a level change never lands off the end. */
export function clampCell(matrix: PayMatrix, level: PayLevelId, cellIndex: number): number {
  const cells = levelFor(matrix, level)?.cells.length ?? 1
  if (!Number.isFinite(cellIndex)) return 0
  return Math.min(Math.max(Math.trunc(cellIndex), 0), cells - 1)
}

/**
 * The first cell of `level` at or above `pay` — FR 22(I)(a)(1) fixation, and
 * also what a MACP upgrade does. Returns the last cell if `pay` is above the
 * whole level, which is the honest answer rather than a wrap to cell 1.
 */
export function cellAtOrAbove(matrix: PayMatrix, level: PayLevelId, pay: number): number {
  const cells = levelFor(matrix, level)?.cells ?? []
  const found = cells.findIndex((cell) => cell >= pay)
  return found === -1 ? Math.max(cells.length - 1, 0) : found
}

export function cityFor(cities: HraCities, cityId: string | null | undefined): HraCity | undefined {
  if (!cityId) return undefined
  return cities.cities.find((city) => city.id === cityId)
}

/**
 * The class that decides the HRA rate.
 *
 * Two things make this more than a field read. Z IS NOT A LIST — the annexure
 * names X and Y and says the rest is Z, so an unknown city is Z rather than
 * "not found" (`cities.fallbackClass` says as much in the data). And four towns
 * around Delhi are classified Y but paid at Delhi's X rate by the special
 * orders continued in para 6 of the 2017 order; `delhiRateProtected` is that
 * fact, and ignoring it under-pays every reader posted in Noida.
 */
export function hraClassFor(city: HraCity | undefined): CityClass {
  if (!city) return 'Z'
  if (city.delhiRateProtected) return 'X'
  return city.class
}

/**
 * Whether the city is one the Transport Allowance annexure names.
 *
 * It is the SAME annexure that classifies cities X and Y for House Rent
 * Allowance — the Transport Allowance order says so in terms, and
 * `allowances.json` carries that sentence as a condition on the record. So a
 * city classified X or Y draws the higher rate and everything else draws the
 * lower one. The `delhiRateProtected` towns are named in the annexure as Y, so
 * they qualify on their own class, not on the Delhi protection.
 */
export function inTaAnnexure(city: HraCity | undefined): boolean {
  return Boolean(city)
}

export function allowanceFor(allowances: Allowances, id: string): Allowance | undefined {
  return allowances.allowances.find((allowance) => allowance.id === id)
}

export function rateFor(allowance: Allowance, key: string | undefined): AllowanceRate | undefined {
  if (key === undefined) return allowance.rates[0]
  return allowance.rates.find((rate) => rate.key === key)
}

export function jobFor(jobs: Jobs, id: string | null | undefined): Job | undefined {
  if (!id) return undefined
  return jobs.jobs.find((job) => job.id === id)
}

/**
 * The Dearness Allowance rate in force on a date.
 *
 * Three rules, each of which the series would otherwise get wrong:
 *
 *  - A `frozen` instalment was announced and never paid, so it is not a rate in
 *    force and is skipped.
 *  - 01.07.2021 has two rows: 28 per cent, which restored the frozen
 *    instalments, and 31 per cent, which superseded it from the same date three
 *    months later. `supersededBy` on the first is what picks the second.
 *  - A `projected` row is not a notified rate. It is returned only when the
 *    caller asks for one, because a calculator that silently pays 63 per cent
 *    because the tab was open in July 2026 is stating a figure no order carries.
 */
export function daRateOn(
  history: DaHistory,
  date: string,
  { includeProjected = false } = {},
): DaRate | undefined {
  const eligible = history.rates
    .filter((rate) => rate.status !== 'frozen')
    .filter((rate) => (includeProjected ? true : rate.status !== 'projected'))
    .filter((rate) => !rate.supersededBy)
    .filter((rate) => rate.effectiveFrom <= date)
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))
  return eligible[eligible.length - 1]
}

/** The latest NOTIFIED rate, whatever today is. What the form pre-fills with. */
export function latestNotifiedDa(history: DaHistory): DaRate | undefined {
  const notified = history.rates
    .filter((rate) => rate.status === 'notified' && !rate.supersededBy)
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))
  return notified[notified.length - 1]
}

/** The single projection, if the dataset carries one. Never a rate — a label. */
export function projectedDa(history: DaHistory): DaRate | undefined {
  return history.rates.find((rate) => rate.status === 'projected')
}

/** The CGHS contribution for a Level, from the scheme's own slab table. */
export function cghsFor(
  scheme: PayScheme,
  level: PayLevelId,
): { amount: number; label: Bilingual } | undefined {
  const slab = scheme.scheme.slabs.find((entry) => entry.appliesToLevels?.includes(level))
  if (!slab || slab.value == null) return undefined
  return { amount: slab.value, label: slab.label }
}

/** The CGEGIS subscription for a Group. */
export function cgegisFor(scheme: PayScheme, group: Group): { amount: number; label: Bilingual } | undefined {
  const slab = scheme.scheme.slabs.find((entry) => entry.key === `group-${group.toLowerCase()}`)
  if (!slab || slab.value == null) return undefined
  return { amount: slab.value, label: slab.label }
}

/** A named contribution percentage out of a scheme record. */
export function contributionRate(scheme: PayScheme, key: string): number | undefined {
  const entry = scheme.scheme.contributions.find((item) => item.key === key)
  return entry?.value ?? undefined
}
