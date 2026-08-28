import type { AllowanceChoice } from '@/lib/pay/engine'
import { defaultScenario, normaliseScenario, scenarioForJob, type PayScenario } from '@/lib/pay/scenario'
import type { Group, PayTables, PensionScheme, Regime } from '@/lib/pay/tables'
import { DEFAULT_PRIVATE_INPUT, type PrivateInput } from '@/lib/pay/compare'

/**
 * The whole calculator in the URL.
 *
 * `/pay?job=ib-acio-ii-executive&city=delhi&da=60` restores the exact pay slip,
 * and that is what "Share" links to. It matters here for the same reason it
 * does in the Law Converter: a figure sent to a colleague is worthless if the
 * link lands them on an empty form, and the assumptions behind a pay slip —
 * which city, which DA rate, which allowances — are part of the answer.
 *
 * Parsing is in TWO steps, and deliberately so. `parsePayParams` needs no
 * datasets, so the route can read the URL on the first frame, before the 1.2 MB
 * of `data/pay` has been imported. `scenarioFromParams` then applies the picked
 * post's defaults and the reader's departures from them, once the tables are
 * there. A single-step parse would have meant either loading the datasets on
 * every visit to `/pay` or holding the URL in a second piece of state.
 *
 * Every value is validated on the way in. A deep link is untrusted input:
 * `pension=drop-tables` must produce the default form, not a broken one.
 */

/** What the URL says, before any dataset has been consulted. */
export interface PayParams {
  jobId: string | null
  level: string | null
  /** One-based in the URL, as the printed matrix numbers its cells. */
  cell: number | null
  basic: number | null
  cityId: string | null
  daRate: number | null
  daProjected: boolean
  quarters: boolean
  pensionScheme: PensionScheme | null
  gpfRate: number | null
  group: Group | null
  regime: Regime | 'auto' | null
  children: number | null
  hostellers: number | null
  npa: boolean
  runningStaff: boolean
  otherDeductions: number | null
  /** Allowances switched on over and above the post's own defaults. */
  on: string[]
  /** Allowances switched off that the post would have switched on. */
  off: string[]
  /** `id:rateKey` pairs — which rate of an allowance the reader chose. */
  rates: Record<string, string>
  oldRegime: {
    rent: number | null
    c80: number | null
    c80ccd1b: number | null
    d80: number | null
    loan: number | null
  }
  tab: PayTab
  /** The second post in the comparison, where there is one. */
  compare: PayParams | null
  private: PrivateInput | null
}

export const PAY_TABS = ['calculator', 'simulate', 'compare', 'private'] as const
export type PayTab = (typeof PAY_TABS)[number]

const isTab = (value: unknown): value is PayTab =>
  typeof value === 'string' && (PAY_TABS as readonly string[]).includes(value)

const PENSION_SCHEMES: readonly PensionScheme[] = ['nps', 'ups', 'gpf']
const GROUPS: readonly Group[] = ['A', 'B', 'C']

const slug = /^[a-z0-9-]+$/
const levelPattern = /^(1[0-8]|[1-9]|13A)$/

const asSlug = (value: string | null): string | null => (value && slug.test(value) ? value : null)

function asNumber(value: string | null, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}): number | null {
  if (value === null) return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return null
  return Math.min(Math.max(parsed, min), max)
}

const asList = (value: string | null): string[] =>
  (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => slug.test(entry))

function asRates(value: string | null): Record<string, string> {
  const out: Record<string, string> = {}
  for (const pair of (value ?? '').split(',')) {
    const [id, key] = pair.split(':')
    if (id && key && slug.test(id) && /^[a-zA-Z0-9:._-]+$/.test(key)) out[id] = key
  }
  return out
}

const P = (prefix: string, name: string) => `${prefix}${name}`

function parseOne(params: URLSearchParams, prefix: string): PayParams {
  const level = params.get(P(prefix, 'level'))
  const pension = params.get(P(prefix, 'pension'))
  const group = params.get(P(prefix, 'group'))?.toUpperCase()
  const regime = params.get(P(prefix, 'regime'))

  return {
    jobId: asSlug(params.get(P(prefix, 'job'))),
    level: level && levelPattern.test(level) ? level : null,
    cell: asNumber(params.get(P(prefix, 'cell')), { min: 1, max: 40 }),
    basic: asNumber(params.get(P(prefix, 'basic')), { min: 0, max: 1_000_000 }),
    cityId: asSlug(params.get(P(prefix, 'city'))),
    daRate: asNumber(params.get(P(prefix, 'da')), { min: 0, max: 300 }),
    daProjected: params.get(P(prefix, 'dap')) === '1',
    quarters: params.get(P(prefix, 'quarters')) === '1',
    pensionScheme: PENSION_SCHEMES.find((scheme) => scheme === pension) ?? null,
    gpfRate: asNumber(params.get(P(prefix, 'gpf')), { min: 0, max: 100 }),
    group: GROUPS.find((entry) => entry === group) ?? null,
    regime: regime === 'old' || regime === 'new' || regime === 'auto' ? regime : null,
    children: asNumber(params.get(P(prefix, 'children')), { min: 0, max: 10 }),
    hostellers: asNumber(params.get(P(prefix, 'hostel')), { min: 0, max: 10 }),
    npa: params.get(P(prefix, 'npa')) === '1',
    runningStaff: params.get(P(prefix, 'running')) === '1',
    otherDeductions: asNumber(params.get(P(prefix, 'other')), { min: 0, max: 10_000_000 }),
    on: asList(params.get(P(prefix, 'on'))),
    off: asList(params.get(P(prefix, 'off'))),
    rates: asRates(params.get(P(prefix, 'rk'))),
    oldRegime: {
      rent: asNumber(params.get(P(prefix, 'rent')), { min: 0, max: 10_000_000 }),
      c80: asNumber(params.get(P(prefix, 's80c')), { min: 0, max: 10_000_000 }),
      c80ccd1b: asNumber(params.get(P(prefix, 's80ccd1b')), { min: 0, max: 10_000_000 }),
      d80: asNumber(params.get(P(prefix, 's80d')), { min: 0, max: 10_000_000 }),
      loan: asNumber(params.get(P(prefix, 'loan')), { min: 0, max: 10_000_000 }),
    },
    tab: 'calculator',
    compare: null,
    private: null,
  }
}

export function parsePayParams(params: URLSearchParams): PayParams {
  const primary = parseOne(params, '')
  const tab = params.get('tab')
  const hasCompare = [...params.keys()].some((key) => key.startsWith('b_'))

  return {
    ...primary,
    tab: isTab(tab) ? tab : 'calculator',
    compare: hasCompare ? parseOne(params, 'b_') : null,
    private: parsePrivate(params),
  }
}

function parsePrivate(params: URLSearchParams): PrivateInput | null {
  const ctc = asNumber(params.get('pctc'), { min: 0, max: 1_000_000_000 })
  if (ctc === null) return null
  const regime = params.get('pregime')
  return {
    ...DEFAULT_PRIVATE_INPUT,
    annualCtc: ctc,
    basicShare: asNumber(params.get('pbasic'), { min: 1, max: 100 }) ?? DEFAULT_PRIVATE_INPUT.basicShare,
    hraShare: asNumber(params.get('phra'), { min: 0, max: 100 }) ?? DEFAULT_PRIVATE_INPUT.hraShare,
    ctcIncludesEmployerContributions: params.get('pgross') !== '1',
    cityId: asSlug(params.get('pcity')),
    rentPaidMonthly: asNumber(params.get('prent'), { min: 0, max: 10_000_000 }) ?? 0,
    regime: regime === 'old' || regime === 'new' ? regime : 'auto',
    professionalTaxMonthly: asNumber(params.get('ptax'), { min: 0, max: 100_000 }) ?? 0,
  }
}

/**
 * The scenario the URL describes, once the datasets are available.
 *
 * A picked post supplies the defaults; `on`, `off` and `rk` are the reader's
 * departures from them. Storing the departures rather than the whole allowance
 * list is what keeps a shared link readable, and it means a post whose default
 * allowances change in a later dataset release still opens with the reader's
 * actual choices rather than a frozen copy of last month's defaults.
 */
export function scenarioFromParams(params: PayParams, tables: PayTables): PayScenario {
  const base = params.jobId
    ? scenarioForJob(params.jobId, tables)
    : { ...defaultScenario(tables), level: params.level ?? '1' }

  const allowances = new Map<string, AllowanceChoice>(
    base.allowances.map((choice) => [choice.id, { ...choice }]),
  )
  for (const id of params.on) allowances.set(id, { ...allowances.get(id), id, enabled: true })
  for (const id of params.off) allowances.set(id, { ...allowances.get(id), id, enabled: false })
  for (const [id, rateKey] of Object.entries(params.rates)) {
    allowances.set(id, { enabled: true, ...allowances.get(id), id, rateKey })
  }

  return normaliseScenario(
    {
      ...base,
      level: params.level ?? base.level,
      cellIndex: params.cell === null ? base.cellIndex : params.cell - 1,
      basic: params.basic,
      cityId: params.cityId,
      daRate: params.daRate ?? base.daRate,
      daProjected: params.daProjected,
      quarters: params.quarters,
      pensionScheme: params.pensionScheme ?? base.pensionScheme,
      gpfRate: params.gpfRate ?? base.gpfRate,
      group: params.group ?? base.group,
      regime: params.regime ?? base.regime,
      children: params.children ?? 0,
      hostellers: params.hostellers ?? 0,
      npa: params.npa,
      runningStaff: params.runningStaff || base.runningStaff,
      otherDeductions: params.otherDeductions ?? 0,
      allowances: [...allowances.values()],
      oldRegime: {
        ...(params.oldRegime.rent === null ? {} : { rentPaidMonthly: params.oldRegime.rent }),
        ...(params.oldRegime.c80 === null ? {} : { section80c: params.oldRegime.c80 }),
        ...(params.oldRegime.c80ccd1b === null ? {} : { section80ccd1b: params.oldRegime.c80ccd1b }),
        ...(params.oldRegime.d80 === null ? {} : { section80d: params.oldRegime.d80 }),
        ...(params.oldRegime.loan === null ? {} : { homeLoanInterest: params.oldRegime.loan }),
      },
    },
    tables,
  )
}

/* ------------------------------------------------------------------ *
 * Writing
 * ------------------------------------------------------------------ */

function writeOne(out: URLSearchParams, prefix: string, scenario: PayScenario, tables: PayTables): void {
  const set = (name: string, value: string) => out.set(P(prefix, name), value)
  const reference = scenario.jobId ? scenarioForJob(scenario.jobId, tables) : defaultScenario(tables)

  if (scenario.jobId) set('job', scenario.jobId)
  if (scenario.level !== reference.level) set('level', scenario.level)
  if (scenario.cellIndex !== 0) set('cell', String(scenario.cellIndex + 1))
  if (scenario.basic) set('basic', String(scenario.basic))
  if (scenario.cityId) set('city', scenario.cityId)
  set('da', String(scenario.daRate))
  if (scenario.daProjected) set('dap', '1')
  if (scenario.quarters) set('quarters', '1')
  if (scenario.pensionScheme !== reference.pensionScheme) set('pension', scenario.pensionScheme)
  if (scenario.pensionScheme === 'gpf' && scenario.gpfRate !== reference.gpfRate)
    set('gpf', String(scenario.gpfRate))
  if (scenario.group !== reference.group) set('group', scenario.group)
  if (scenario.regime !== reference.regime) set('regime', scenario.regime)
  if (scenario.children > 0) set('children', String(scenario.children))
  if (scenario.hostellers > 0) set('hostel', String(scenario.hostellers))
  if (scenario.npa) set('npa', '1')
  if (scenario.runningStaff && !reference.runningStaff) set('running', '1')
  if (scenario.otherDeductions > 0) set('other', String(scenario.otherDeductions))

  const wasOn = new Set(reference.allowances.filter((choice) => choice.enabled).map((choice) => choice.id))
  const on: string[] = []
  const off: string[] = []
  const rates: string[] = []
  for (const choice of scenario.allowances) {
    if (choice.enabled && !wasOn.has(choice.id)) on.push(choice.id)
    if (!choice.enabled && wasOn.has(choice.id)) off.push(choice.id)
    if (choice.rateKey) rates.push(`${choice.id}:${choice.rateKey}`)
  }
  if (on.length > 0) set('on', on.join(','))
  if (off.length > 0) set('off', off.join(','))
  if (rates.length > 0) set('rk', rates.join(','))

  const old = scenario.oldRegime
  if (old.rentPaidMonthly) set('rent', String(old.rentPaidMonthly))
  if (old.section80c) set('s80c', String(old.section80c))
  if (old.section80ccd1b) set('s80ccd1b', String(old.section80ccd1b))
  if (old.section80d) set('s80d', String(old.section80d))
  if (old.homeLoanInterest) set('loan', String(old.homeLoanInterest))
}

export interface PayView {
  scenario: PayScenario
  tab: PayTab
  compare: PayScenario | null
  private: PrivateInput | null
}

/** Only what differs from the defaults is written, so a link stays readable. */
export function paramsFromView(view: PayView, tables: PayTables): URLSearchParams {
  const out = new URLSearchParams()
  writeOne(out, '', view.scenario, tables)
  if (view.tab !== 'calculator') out.set('tab', view.tab)
  if (view.compare) writeOne(out, 'b_', view.compare, tables)
  if (view.private && view.private.annualCtc > 0) {
    const p = view.private
    out.set('pctc', String(p.annualCtc))
    if (p.basicShare !== DEFAULT_PRIVATE_INPUT.basicShare) out.set('pbasic', String(p.basicShare))
    if (p.hraShare !== DEFAULT_PRIVATE_INPUT.hraShare) out.set('phra', String(p.hraShare))
    if (!p.ctcIncludesEmployerContributions) out.set('pgross', '1')
    if (p.cityId) out.set('pcity', p.cityId)
    if (p.rentPaidMonthly) out.set('prent', String(p.rentPaidMonthly))
    if (p.regime !== 'auto') out.set('pregime', p.regime)
    if (p.professionalTaxMonthly) out.set('ptax', String(p.professionalTaxMonthly))
  }
  return out
}

/** `"/pay?job=…"`. Used by share links and by the saved-scenario list. */
export function toPayHref(view: PayView, tables: PayTables, pathname = '/pay'): string {
  const query = paramsFromView(view, tables).toString()
  return query ? `${pathname}?${query}` : pathname
}
