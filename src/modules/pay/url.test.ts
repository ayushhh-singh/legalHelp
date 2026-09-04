import { describe, expect, it } from 'vitest'

import { paramsFromView, parsePayParams, scenarioFromParams, toPayHref } from './url'

import { DEFAULT_PRIVATE_INPUT } from '@/lib/pay/compare'
import { defaultScenario, scenarioForJob, withAllowance } from '@/lib/pay/scenario'
import { loadPayTables } from '@/test/payTables'

const tables = loadPayTables()

const roundTrip = (view: Parameters<typeof paramsFromView>[0]) =>
  scenarioFromParams(parsePayParams(paramsFromView(view, tables)), tables)

describe('parsePayParams', () => {
  it('reads the link the brief specifies', () => {
    const params = parsePayParams(
      new URLSearchParams('job=ib-acio-ii-executive&level=7&cell=1&city=delhi&da=60'),
    )
    expect(params.jobId).toBe('ib-acio-ii-executive')
    expect(params.level).toBe('7')
    expect(params.cell).toBe(1)
    expect(params.cityId).toBe('delhi')
    expect(params.daRate).toBe(60)

    const scenario = scenarioFromParams(params, tables)
    expect(scenario.cellIndex).toBe(0) // the URL is one-based, the engine is not
    expect(scenario.group).toBe('B')
  })

  it('needs no datasets, so the route can read it on the first frame', () => {
    // parsePayParams takes no tables. If that ever changes, /pay would have to
    // download 1.2 MB before it could render an empty form.
    expect(parsePayParams(new URLSearchParams('da=60')).daRate).toBe(60)
  })

  it('treats a deep link as untrusted input', () => {
    const params = parsePayParams(
      new URLSearchParams(
        'job=DROP%20TABLES&level=99&cell=-4&da=9999&pension=drop-tables&group=Z&regime=free&city=%3Cscript%3E',
      ),
    )
    expect(params.jobId).toBeNull()
    expect(params.level).toBeNull()
    expect(params.cell).toBe(1)
    expect(params.daRate).toBe(300)
    expect(params.pensionScheme).toBeNull()
    expect(params.group).toBeNull()
    expect(params.regime).toBeNull()
    expect(params.cityId).toBeNull()

    const scenario = scenarioFromParams(params, tables)
    expect(scenario.level).toBe('1')
    expect(scenario.cityId).toBeNull()
  })

  it('clamps a cell past the end of a Level rather than reading past the array', () => {
    const scenario = scenarioFromParams(parsePayParams(new URLSearchParams('level=17&cell=40')), tables)
    expect(scenario.cellIndex).toBe(0) // Level 17 has exactly one cell
  })
})

describe('paramsFromView', () => {
  const view = (scenario: ReturnType<typeof defaultScenario>) => ({
    scenario,
    tab: 'calculator' as const,
    compare: null,
    private: null,
  })

  it('writes only what differs from the post’s own defaults', () => {
    const scenario = scenarioForJob('ib-acio-ii-executive', tables, { daRate: 60, cityId: 'delhi' })
    const params = paramsFromView(view(scenario), tables)
    expect(params.get('job')).toBe('ib-acio-ii-executive')
    expect(params.get('city')).toBe('delhi')
    expect(params.get('da')).toBe('60')
    // The post supplies the Level, the Group and the allowance list, so none of
    // them is repeated in the link.
    expect(params.get('level')).toBeNull()
    expect(params.get('group')).toBeNull()
    expect(params.get('on')).toBeNull()
    expect(params.get('off')).toBeNull()
  })

  it('records a departure from the defaults in both directions', () => {
    const picked = scenarioForJob('ib-acio-ii-executive', tables, { daRate: 60 })
    const changed = withAllowance(
      withAllowance(picked, 'special-security-allowance-ib', { enabled: false }),
      'tough-location-allowance',
      { enabled: true, rateKey: 'tla-2' },
    )
    const params = paramsFromView(view(changed), tables)
    expect(params.get('off')).toBe('special-security-allowance-ib')
    expect(params.get('on')).toBe('tough-location-allowance')
    expect(params.get('rk')).toBe('tough-location-allowance:tla-2')

    const back = roundTrip(view(changed))
    const ssa = back.allowances.find((choice) => choice.id === 'special-security-allowance-ib')
    const tla = back.allowances.find((choice) => choice.id === 'tough-location-allowance')
    expect(ssa?.enabled).toBe(false)
    expect(tla).toEqual({ id: 'tough-location-allowance', enabled: true, rateKey: 'tla-2' })
  })

  it('round-trips a scenario with no post at all', () => {
    const custom = withAllowance(
      { ...defaultScenario(tables), level: '13A', cellIndex: 3, group: 'A', npa: true, daRate: 60 },
      'deputation-duty-allowance',
      { enabled: true, rateKey: 'different-station' },
    )
    const back = roundTrip(view(custom))
    expect(back.level).toBe('13A')
    expect(back.cellIndex).toBe(3)
    expect(back.group).toBe('A')
    expect(back.npa).toBe(true)
    expect(back.allowances).toContainEqual({
      id: 'deputation-duty-allowance',
      enabled: true,
      rateKey: 'different-station',
    })
  })

  it('carries the second post of a comparison under its own prefix', () => {
    const a = scenarioForJob('aso-css', tables, { daRate: 60, cityId: 'delhi' })
    const b = scenarioForJob('inspector-income-tax', tables, { daRate: 60, cityId: 'kolkata' })
    const params = paramsFromView({ scenario: a, tab: 'compare', compare: b, private: null }, tables)
    expect(params.get('tab')).toBe('compare')
    expect(params.get('job')).toBe('aso-css')
    expect(params.get('b_job')).toBe('inspector-income-tax')
    expect(params.get('b_city')).toBe('kolkata')

    const parsed = parsePayParams(params)
    expect(parsed.compare).not.toBeNull()
    expect(scenarioFromParams(parsed.compare!, tables).cityId).toBe('kolkata')
  })

  it('carries the private package, and reads no comparison when there is none', () => {
    const a = defaultScenario(tables)
    const params = paramsFromView(
      {
        scenario: a,
        tab: 'private',
        compare: null,
        private: { ...DEFAULT_PRIVATE_INPUT, annualCtc: 1_800_000, cityId: 'pune', basicShare: 50 },
      },
      tables,
    )
    expect(params.get('pctc')).toBe('1800000')
    expect(params.get('pbasic')).toBe('50')
    expect(params.get('phra')).toBeNull() // left at its default

    const parsed = parsePayParams(params)
    expect(parsed.compare).toBeNull()
    expect(parsed.private?.annualCtc).toBe(1_800_000)
    expect(parsed.private?.basicShare).toBe(50)
    expect(parsed.private?.hraShare).toBe(DEFAULT_PRIVATE_INPUT.hraShare)
  })
})

describe('toPayHref', () => {
  it('builds a shareable link', () => {
    const scenario = scenarioForJob('ib-acio-ii-executive', tables, { daRate: 60, cityId: 'delhi' })
    const href = toPayHref({ scenario, tab: 'calculator', compare: null, private: null }, tables)
    expect(href.startsWith('/tools/salary?')).toBe(true)
    expect(href).toContain('job=ib-acio-ii-executive')
  })
})

describe('parsePayParams — links that were not built by this app', () => {
  const at = (query: string) => scenarioFromParams(parsePayParams(new URLSearchParams(query)), tables)

  it('reads an empty value as absent, not as zero', () => {
    // `Number('')` is 0, so `?da=` used to produce a slip with no Dearness
    // Allowance at all — ₹26,940 missing from a Level 7 month, from a link that
    // had merely been truncated.
    expect(parsePayParams(new URLSearchParams('da=')).daRate).toBeNull()
    expect(at('job=ib-acio-ii-executive&da=').daRate).toBe(60)
    expect(at('basic=').basic).toBeNull()
    expect(at('cell=').cellIndex).toBe(0)
  })

  it('accepts the interpolated Level in either case', () => {
    // The Level is the one URL value whose canonical form has a capital in it.
    // Lower-cased, it used to fall back silently to Level 1 — a ₹1,31,100 basic
    // pay reported as ₹18,000.
    expect(at('level=13a').level).toBe('13A')
    expect(at('level=13A').level).toBe('13A')
    expect(at('level=13').level).toBe('13')
    expect(at('level=19').level).toBe('1')
  })

  it('lets `off` beat the enable that `rk` implies', () => {
    const scenario = at(
      'job=ib-acio-ii-executive&off=children-education-allowance&rk=children-education-allowance:divyang',
    )
    expect(scenario.allowances.find((choice) => choice.id === 'children-education-allowance')).toEqual({
      id: 'children-education-allowance',
      enabled: false,
      rateKey: 'divyang',
    })
  })

  it('carries a repeated id once', () => {
    const scenario = at('job=ib-acio-ii-executive&on=tough-location-allowance,tough-location-allowance')
    expect(scenario.allowances.filter((choice) => choice.id === 'tough-location-allowance')).toHaveLength(1)
  })

  it('keeps the rest of a link whose post does not exist', () => {
    // The post is dropped, not the posting or the rate: a link to a post that a
    // later dataset renamed should still answer the question it was asked.
    const scenario = at('job=not-a-post&level=9&city=delhi&da=60')
    expect(scenario.jobId).toBeNull()
    expect(scenario.level).toBe('9')
    expect(scenario.cityId).toBe('delhi')
    expect(scenario.daRate).toBe(60)
  })
})
