import type { AllowanceChoice, OldRegimeDeclarations, PayInput } from './engine'
import {
  cityFor,
  jobFor,
  latestNotifiedDa,
  levelFor,
  type CityClass,
  type Group,
  type PayLevelId,
  type PayTables,
  type PensionScheme,
  type Regime,
} from './tables'

/**
 * A scenario is the serialisable form of a pay slip: everything the reader
 * chose, and nothing that was derived from it.
 *
 * It is the ONE shape that travels — into the URL (`src/modules/pay/url.ts`),
 * into Dexie (`payScenarios`), into the compare panel and into an agent tool.
 * Deriving a `PayInput` from it is a pure function, so a link, a saved row and
 * a tool call that carry the same scenario cannot produce different pay.
 */
export interface PayScenario {
  /** The post picked in the job picker, or null for "custom / no post". */
  jobId: string | null
  level: PayLevelId
  /** Zero-based, as in the engine. */
  cellIndex: number
  /** Set only where the reader typed a basic pay instead of picking a cell. */
  basic: number | null
  cityId: string | null
  daRate: number
  /** The chosen rate is the projection, not a notified one. */
  daProjected: boolean
  quarters: boolean
  pensionScheme: PensionScheme
  gpfRate: number
  group: Group
  regime: Regime | 'auto'
  children: number
  hostellers: number
  npa: boolean
  runningStaff: boolean
  otherDeductions: number
  allowances: AllowanceChoice[]
  oldRegime: OldRegimeDeclarations
}

/** Railways is the only organisation whose staff draw a running-allowance pay element. */
const RUNNING_ALLOWANCE_ID = 'running-allowance-railways'

export function defaultScenario(tables: PayTables): PayScenario {
  const da = latestNotifiedDa(tables.da)
  return {
    jobId: null,
    level: '1',
    cellIndex: 0,
    basic: null,
    cityId: null,
    daRate: da?.rate ?? 0,
    daProjected: false,
    quarters: false,
    pensionScheme: 'nps',
    gpfRate: 6,
    group: 'C',
    regime: 'auto',
    children: 0,
    hostellers: 0,
    npa: false,
    runningStaff: false,
    otherDeductions: 0,
    allowances: [],
    oldRegime: {},
  }
}

/**
 * The scenario a post starts from.
 *
 * `enabledByDefault` is the load-bearing field and it is a claim the dataset
 * makes carefully: true only where the allowance follows the POST — the
 * Intelligence Bureau's Special Security Allowance, a uniformed post's Dress
 * Allowance, Ration Money for personnel below officer rank. Anything that turns
 * on where an officer is posted, or on an option they exercise, is false and
 * stays off until the reader switches it on.
 *
 * A picked post is a starting point for a form, never an authority:
 * `data/pay/jobs.json` is almost entirely `verify: true` (ADR-016), and the UI
 * says so on the card.
 */
export function scenarioForJob(
  jobId: string,
  tables: PayTables,
  previous?: Partial<PayScenario>,
): PayScenario {
  const base = { ...defaultScenario(tables), ...previous }
  const job = jobFor(tables.jobs, jobId)
  if (!job) return { ...base, jobId: null }

  const allowances: AllowanceChoice[] = job.allowances.map((entry) => ({
    id: entry.id,
    enabled: entry.enabledByDefault,
  }))

  return {
    ...base,
    jobId: job.id,
    level: job.entryLevel,
    cellIndex: 0,
    basic: null,
    group: job.group,
    runningStaff: job.allowances.some((entry) => entry.id === RUNNING_ALLOWANCE_ID && entry.enabledByDefault),
    allowances,
  }
}

/** Clamp a scenario back into the datasets after a level or city change. */
export function normaliseScenario(scenario: PayScenario, tables: PayTables): PayScenario {
  const level = levelFor(tables.matrix, scenario.level) ? scenario.level : '1'
  const cells = levelFor(tables.matrix, level)?.cells.length ?? 1
  return {
    ...scenario,
    jobId: jobFor(tables.jobs, scenario.jobId) ? scenario.jobId : null,
    level,
    cellIndex: Math.min(Math.max(0, Math.trunc(scenario.cellIndex)), cells - 1),
    cityId: cityFor(tables.cities, scenario.cityId) ? scenario.cityId : null,
    children: Math.max(0, Math.trunc(scenario.children)),
    hostellers: Math.max(0, Math.trunc(scenario.hostellers)),
    otherDeductions: Math.max(0, Math.round(scenario.otherDeductions)),
  }
}

export function toPayInput(scenario: PayScenario, cityClass?: CityClass): PayInput {
  return {
    level: scenario.level,
    cellIndex: scenario.cellIndex,
    ...(scenario.basic ? { basic: scenario.basic } : {}),
    cityId: scenario.cityId,
    ...(cityClass ? { cityClass } : {}),
    daRate: scenario.daRate,
    quarters: scenario.quarters,
    allowances: scenario.allowances,
    pensionScheme: scenario.pensionScheme,
    gpfRate: scenario.gpfRate,
    group: scenario.group,
    dependents: { children: scenario.children, hostellers: scenario.hostellers },
    regime: scenario.regime,
    otherDeductions: scenario.otherDeductions,
    npa: scenario.npa,
    runningStaff: scenario.runningStaff,
    oldRegime: scenario.oldRegime,
  }
}

/** Turn an allowance on or off without disturbing the rest of the list. */
export function withAllowance(
  scenario: PayScenario,
  id: string,
  patch: Partial<AllowanceChoice>,
): PayScenario {
  const existing = scenario.allowances.find((choice) => choice.id === id)
  const allowances = existing
    ? scenario.allowances.map((choice) => (choice.id === id ? { ...choice, ...patch } : choice))
    : [...scenario.allowances, { id, enabled: true, ...patch }]
  return { ...scenario, allowances }
}
