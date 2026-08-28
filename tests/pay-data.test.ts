import { describe, expect, it } from 'vitest'

import {
  allowancesSchema,
  citiesSchema,
  cpc8Schema,
  daHistorySchema,
  jobsSchema,
  payMatrixSchema,
  schemeSchema,
  taxSchema,
} from '@/modules/pay/schema'
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
import { readFromRoot } from '@/test/paths'

/**
 * The pay datasets, read off disk rather than imported — the same arrangement
 * `tests/law-data.test.ts` uses and for the same two reasons. Importing them
 * here would bundle 1.2 MB into whatever imports this module, and reading from
 * disk means this suite tests the committed bytes rather than a transformed
 * copy of them.
 */
const load = <T>(file: string): T => JSON.parse(readFromRoot('data/pay', file)) as T

const matrix = load<PayMatrix>('matrix.json')
const da = load<DaHistory>('da-history.json')
const cities = load<HraCities>('cities.json')
const allowances = load<Allowances>('allowances.json')
const jobs = load<Jobs>('jobs.json')
const cghs = load<PayScheme>('cghs.json')
const cgegis = load<PayScheme>('cgegis.json')
const nps = load<PayScheme>('nps.json')
const ups = load<PayScheme>('ups.json')
const tax = load<TaxYear>('tax.json')
const cpc8 = load<Cpc8>('cpc8.json')

const SCHEMAS = [
  { name: 'matrix.json', schema: payMatrixSchema, data: matrix },
  { name: 'da-history.json', schema: daHistorySchema, data: da },
  { name: 'cities.json', schema: citiesSchema, data: cities },
  { name: 'allowances.json', schema: allowancesSchema, data: allowances },
  { name: 'jobs.json', schema: jobsSchema, data: jobs },
  { name: 'cghs.json', schema: schemeSchema, data: cghs },
  { name: 'cgegis.json', schema: schemeSchema, data: cgegis },
  { name: 'nps.json', schema: schemeSchema, data: nps },
  { name: 'ups.json', schema: schemeSchema, data: ups },
  { name: 'tax.json', schema: taxSchema, data: tax },
  { name: 'cpc8.json', schema: cpc8Schema, data: cpc8 },
] as const

describe('pay datasets', () => {
  it.each(SCHEMAS)('$name matches the dataset schema', ({ schema, data }) => {
    // Same contract schemas/pay-*.schema.json enforces on the Python side
    // (scripts/ingest/validate_data.py). Both must pass for a dataset to ship.
    expect(schema.safeParse(data).error?.issues.slice(0, 5)).toBeUndefined()
  })

  it.each(SCHEMAS)('$name carries both languages everywhere it claims to', ({ data }) => {
    // The hard rule: a missing Hindi string is a CI failure, not a fallback.
    // The zod schemas already require min(1) on both members of every
    // bilingual object; this catches the other half — a Hindi field that is
    // just the English one copied across, which passes min(1) and helps nobody.
    const copied: string[] = []
    const walk = (value: unknown, path: string) => {
      if (Array.isArray(value)) {
        value.forEach((item, index) => walk(item, `${path}[${index}]`))
        return
      }
      if (value === null || typeof value !== 'object') return
      const record = value as Record<string, unknown>
      if (typeof record.en === 'string' && typeof record.hi === 'string') {
        // Identical is only defensible where there is nothing to translate:
        // a bare code, a number, an abbreviation that is not localised.
        if (record.en === record.hi && record.en.length > 4) copied.push(`${path}: ${record.en}`)
        return
      }
      for (const [key, item] of Object.entries(record)) walk(item, `${path}.${key}`)
    }
    walk(data, '$')

    expect(copied).toEqual([])
  })
})

describe('pay matrix', () => {
  const byLevel = new Map(matrix.levels.map((level) => [level.level, level]))

  it('carries all 19 levels, 1 to 18 including 13A', () => {
    const expected = [
      '1', '2', '3', '4', '5', '6', '7', '8', '9', '10',
      '11', '12', '13', '13A', '14', '15', '16', '17', '18',
    ]
    expect(matrix.levels.map((level) => level.level)).toEqual(expected)
  })

  it('maps grade pay to level exactly as the master context does', () => {
    // The one table an officer checks a calculator against. Levels 15-18 have
    // no grade pay: they are the HAG, HAG+, Apex and Cabinet Secretary scales.
    const expected: Record<string, number | null> = {
      '1': 1800, '2': 1900, '3': 2000, '4': 2400, '5': 2800,
      '6': 4200, '7': 4600, '8': 4800, '9': 5400, '10': 5400,
      '11': 6600, '12': 7600, '13': 8700, '13A': 8900, '14': 10000,
      '15': null, '16': null, '17': null, '18': null,
    }
    const actual = Object.fromEntries(matrix.levels.map((l) => [l.level, l.gradePay ?? null]))
    expect(actual).toEqual(expected)
  })

  it('distinguishes grade pay 5400 in PB-2 from grade pay 5400 in PB-3', () => {
    // Both are 5400, and they are Level 9 and Level 10. A calculator that keys
    // on grade pay alone silently puts an Assistant Section Officer's promotion
    // post in the wrong level.
    expect(byLevel.get('9')?.payBand.name).toBe('PB-2')
    expect(byLevel.get('10')?.payBand.name).toBe('PB-3')
    expect(byLevel.get('9')?.entryPay).toBe(53100)
    expect(byLevel.get('10')?.entryPay).toBe(56100)
  })

  it('builds every cell from the previous one by the Commission’s own rule', () => {
    // Cell n = round(cell n-1 x 1.03) to the nearest 100. This is the whole
    // construction of the matrix (7th CPC report, Chapter 5.1), and it is what
    // makes 540 generated numbers checkable without transcribing them.
    const offenders: string[] = []
    for (const level of matrix.levels) {
      for (let index = 1; index < level.cells.length; index += 1) {
        const previous = level.cells[index - 1] as number
        const expected = Math.round((previous * 1.03) / 100) * 100
        if (level.cells[index] !== expected) {
          offenders.push(`L${level.level} cell ${index + 1}: ${level.cells[index]} != ${expected}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('starts every level at its entry pay and never leaves a rupee off a hundred', () => {
    for (const level of matrix.levels) {
      expect(level.cells[0], `L${level.level} cell 1`).toBe(level.entryPay)
      expect(level.cells.every((cell) => cell % 100 === 0), `L${level.level}`).toBe(true)
      const ascending = level.cells.every(
        (cell, index) => index === 0 || cell > (level.cells[index - 1] as number),
      )
      expect(ascending, `L${level.level} cells ascend`).toBe(true)
    }
  })

  it('ends each level on the cell the gazette prints', () => {
    // Read off the scanned Schedule to the CCS (Revised Pay) Rules, 2016, and
    // for Level 13 off the 2017 amendment OM, which states it in words.
    const terminal: Record<string, number> = {
      '1': 56900, '2': 63200, '3': 69100, '4': 81100, '5': 92300,
      '6': 112400, '7': 142400, '8': 151100, '9': 167800, '10': 177500,
      '11': 208700, '12': 209200, '13': 215900, '13A': 216600, '14': 218200,
      '15': 224100, '16': 224400, '17': 225000, '18': 250000,
    }
    const actual = Object.fromEntries(matrix.levels.map((l) => [l.level, l.cells.at(-1)]))
    expect(actual).toEqual(terminal)
  })

  it('ships the amended Level 13, not the one the 2016 gazette printed', () => {
    // The CCS (Revised Pay) (Amendment) Rules, 2017 replaced Level 13 with
    // effect from 01.01.2016, and DoE OM 4-6/2017-IC of 28.09.2017 records the
    // earlier level as "non-existent ab-initio". Shipping 118500 would be
    // shipping a level that legally never existed.
    const level13 = byLevel.get('13')
    expect(level13?.entryPay).toBe(123100)
    expect(level13?.cells).toHaveLength(20)
    expect(level13?.indexOfRationalisation).toBe(2.67)
    expect(level13?.source.dated).toBe('2017-09-28')
  })

  it('never exceeds the Cabinet Secretary’s pay', () => {
    const highest = Math.max(...matrix.levels.flatMap((level) => level.cells))
    expect(highest).toBe(250000)
  })

  it('records where each level came from and whether it needs checking', () => {
    for (const level of matrix.levels) {
      expect(level.source.url, `L${level.level}`).toMatch(/^https?:\/\//)
      expect(level.verify, `L${level.level} is read from the gazette`).toBe(false)
    }
  })
})

describe('dearness allowance history', () => {
  it('starts at nil on the 7th CPC base date', () => {
    expect(da.rates[0]?.effectiveFrom).toBe('2016-01-01')
    expect(da.rates[0]?.rate).toBe(0)
  })

  it('runs in date order', () => {
    const dates = da.rates.map((rate) => rate.effectiveFrom)
    expect([...dates].sort()).toEqual(dates)
  })

  it('carries every rate the master context lists', () => {
    expect(da.rates.map((rate) => rate.rate)).toEqual([
      0, 2, 4, 5, 7, 9, 12, 17, 21, 24, 28, 31, 34, 38, 42, 46, 50, 53, 55, 58, 60, 63,
    ])
  })

  it('marks the three frozen instalments as never paid', () => {
    const frozen = da.rates.filter((rate) => rate.status === 'frozen')
    expect(frozen.map((rate) => rate.rate)).toEqual([21, 24])
    for (const rate of frozen) expect(rate.supersededBy).toBe('2021-07-01')
    // The 28% restoration is a notified rate that was itself superseded from
    // the same date by 31%. Both are recorded; only one is payable.
    const july2021 = da.rates.filter((rate) => rate.effectiveFrom === '2021-07-01')
    expect(july2021.map((rate) => rate.rate)).toEqual([28, 31])
    expect(july2021.filter((rate) => !rate.supersededBy).map((rate) => rate.rate)).toEqual([31])
  })

  it('has exactly one projection, and it is the last entry', () => {
    const projected = da.rates.filter((rate) => rate.status === 'projected')
    expect(projected).toHaveLength(1)
    expect(projected[0]).toBe(da.rates.at(-1))
    expect(projected[0]?.effectiveFrom).toBe('2026-07-01')
    // A projection that is not flagged for verification is a rate pretending
    // to be a fact.
    expect(projected[0]?.verify).toBe(true)
    expect(projected[0]?.range).toBeDefined()
  })

  it('has the notified rate in force on 01.01.2026 at 60 per cent', () => {
    const current = da.rates.filter((rate) => rate.status === 'notified').at(-1)
    expect(current?.rate).toBe(60)
    expect(current?.effectiveFrom).toBe('2026-01-01')
    expect(current?.source.reference).toContain('1/1(i)/2026-E.II(B)')
    expect(current?.verify).toBe(false)
  })

  it('cites a source for every rate', () => {
    for (const rate of da.rates) {
      expect(rate.source.name, rate.effectiveFrom).toBeTruthy()
      expect(rate.source.url, rate.effectiveFrom).toMatch(/^https?:\/\//)
    }
  })
})

describe('HRA city classification', () => {
  const byId = new Map(cities.cities.map((city) => [city.id, city]))

  it('classifies exactly the eight X cities the annexure names', () => {
    const x = cities.cities.filter((city) => city.class === 'X').map((city) => city.id)
    expect(x.sort()).toEqual([
      'ahmedabad', 'bengaluru', 'chennai', 'delhi', 'greater-mumbai', 'hyderabad', 'kolkata', 'pune',
    ])
  })

  it('protects the four Delhi-rate towns, and only those four', () => {
    const protectedTowns = cities.cities
      .filter((city) => city.delhiRateProtected)
      .map((city) => city.id)
      .sort()
    expect(protectedTowns).toEqual(['faridabad', 'ghaziabad', 'gurugram', 'noida'])
    // They draw Delhi rates on the basis of dependency but are not 'X'.
    for (const id of protectedTowns) expect(byId.get(id)?.class).toBe('Y')
  })

  it('says in terms that Z is everything else', () => {
    expect(cities.fallbackClass).toBe('Z')
    expect(cities.cities.some((city) => (city.class as string) === 'Z')).toBe(false)
    expect(cities.classes.map((klass) => klass.id)).toEqual(['X', 'Y', 'Z'])
  })

  it('carries the aliases a reader would actually type', () => {
    const aliasOf = (id: string) => byId.get(id)?.aliases ?? []
    expect(aliasOf('bengaluru')).toContain('Bangalore')
    expect(aliasOf('prayagraj')).toContain('Allahabad')
    expect(aliasOf('gurugram')).toContain('Gurgaon')
    expect(aliasOf('greater-mumbai')).toContain('Mumbai')
    expect(aliasOf('chhatrapati-sambhajinagar')).toContain('Aurangabad')
  })

  it('gives every city a distinct id and both names', () => {
    const ids = cities.cities.map((city) => city.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const city of cities.cities) {
      expect(city.name.hi, city.id).not.toBe('')
      expect(city.state.hi, city.id).not.toBe('')
    }
  })
})

describe('allowances', () => {
  const byId = new Map(allowances.allowances.map((allowance) => [allowance.id, allowance]))

  it('carries at least the 25 the brief asks for, each with a distinct id', () => {
    expect(allowances.allowances.length).toBeGreaterThanOrEqual(25)
    expect(byId.size).toBe(allowances.allowances.length)
  })

  it('cites a source for every allowance', () => {
    for (const allowance of allowances.allowances) {
      expect(allowance.source.name, allowance.id).toBeTruthy()
      expect(allowance.source.url, allowance.id).toMatch(/^https?:\/\//)
    }
  })

  it('records a tax position for every allowance', () => {
    // "Taxable?" is the second question anyone asks about an allowance, and an
    // absent answer reads as "no" on a screen.
    for (const allowance of allowances.allowances) {
      expect(typeof allowance.taxable, allowance.id).toBe('boolean')
      const exempt = !allowance.taxable
      if (exempt) expect(allowance.taxSection, allowance.id).toBeTruthy()
    }
  })

  it('gives HRA the notified rates and the notified floors', () => {
    const hra = byId.get('house-rent-allowance')
    expect(hra?.rates.map((rate) => [rate.key, rate.value, rate.floor])).toEqual([
      ['X', 30, 5400],
      ['Y', 20, 3600],
      ['Z', 10, 1800],
    ])
  })

  it('gives Transport Allowance the level-and-city slabs, with DA on top', () => {
    const ta = byId.get('transport-allowance')
    const rate = (key: string) => ta?.rates.find((entry) => entry.key === key)?.value
    expect(rate('level-9-and-above:annexure-cities')).toBe(7200)
    expect(rate('level-9-and-above:other')).toBe(3600)
    expect(rate('level-3-to-8:annexure-cities')).toBe(3600)
    expect(rate('level-3-to-8:other')).toBe(1800)
    expect(rate('level-1-to-2:annexure-cities')).toBe(1350)
    expect(rate('level-1-to-2:other')).toBe(900)
    // DA is payable on Transport Allowance — the order says "plus D.A. thereon"
    // at every rate, and a calculator that omits it is 60% low.
    expect(ta?.daLinked.kind).toBe('fully-indexed')
  })

  it('carries the whole Risk and Hardship Matrix, and keeps it symmetrical', () => {
    const rh = byId.get('risk-and-hardship-allowance')
    const rate = (key: string) => rh?.rates.find((entry) => entry.key === key)?.value
    expect(rate('r1h1:level-9-and-above')).toBe(25000)
    expect(rate('r1h1:level-8-and-below')).toBe(17300)
    expect(rate('r3h3:level-9-and-above')).toBe(1200)
    expect(rate('r3h3:level-8-and-below')).toBe(1000)
    // The Commission gave risk and hardship equal weight, so the matrix is
    // symmetrical about the diagonal. A transcription error breaks that first.
    for (const [a, b] of [['r1h2', 'r2h1'], ['r1h3', 'r3h1'], ['r2h3', 'r3h2']]) {
      for (const band of ['level-9-and-above', 'level-8-and-below']) {
        expect(rate(`${a}:${band}`), `${a} vs ${b} at ${band}`).toBe(rate(`${b}:${band}`))
      }
    }
  })

  it('marks the allowances that go up by 25% every time DA crosses 50%', () => {
    // These figures are the rate the order states, not the rate payable today.
    const semiIndexed = allowances.allowances.filter(
      (allowance) => allowance.daLinked.kind === 'quarter-per-fifty',
    )
    expect(semiIndexed.length).toBeGreaterThan(5)
    for (const allowance of semiIndexed) {
      // DA reached 50% on 01.01.2024 and has not fallen back, so exactly one
      // enhancement has happened.
      expect(allowance.daLinked.timesApplied, allowance.id).toBe(1)
      expect(allowance.daLinked.since, allowance.id).toBe('2024-01-01')
    }
    expect(semiIndexed.map((allowance) => allowance.id)).toContain('children-education-allowance')
    expect(semiIndexed.map((allowance) => allowance.id)).toContain('dress-allowance')
  })

  it('carries the Children Education Allowance figures the brief names', () => {
    const cea = byId.get('children-education-allowance')
    expect(cea?.rates.find((rate) => rate.key === 'standard')?.value).toBe(2250)
    expect(cea?.rates.find((rate) => rate.key === 'divyang')?.value).toBe(4500)
    const hostel = byId.get('hostel-subsidy')
    expect(hostel?.rates.find((rate) => rate.key === 'standard')?.value).toBe(6750)
    expect(hostel?.rates.find((rate) => rate.key === 'divyang')?.value).toBe(13500)
  })

  it('caps the Deputation (Duty) Allowance rather than only stating a percentage', () => {
    const deputation = byId.get('deputation-duty-allowance')
    expect(deputation?.rates.map((rate) => [rate.value, rate.ceiling])).toEqual([
      [5, 4500],
      [10, 9000],
    ])
  })

  it('points every subsumed allowance at the one that replaced it', () => {
    for (const allowance of allowances.allowances) {
      if (allowance.status !== 'subsumed') continue
      expect(allowance.subsumedInto, allowance.id).toBeTruthy()
      expect(byId.has(allowance.subsumedInto as string), allowance.id).toBe(true)
      // A subsumed allowance must not also carry rates: showing a figure for an
      // allowance nobody can draw is worse than showing nothing.
      expect(allowance.rates, allowance.id).toEqual([])
    }
  })
})

describe('jobs', () => {
  const allowanceIds = new Set(allowances.allowances.map((allowance) => allowance.id))
  const levels = new Set(matrix.levels.map((level) => level.level))
  const byId = new Map(jobs.jobs.map((job) => [job.id, job]))

  it('carries at least the 55 posts the brief asks for', () => {
    expect(jobs.jobs.length).toBeGreaterThanOrEqual(55)
    expect(byId.size).toBe(jobs.jobs.length)
  })

  it('resolves every allowance id against allowances.json', () => {
    // The acceptance check. A job that references an allowance nobody defines
    // renders as a blank row in the calculator.
    const dangling: string[] = []
    for (const job of jobs.jobs) {
      for (const allowance of job.allowances) {
        if (!allowanceIds.has(allowance.id)) dangling.push(`${job.id} -> ${allowance.id}`)
      }
    }
    expect(dangling).toEqual([])
  })

  it('resolves every organisation, exam and promotion level', () => {
    for (const job of jobs.jobs) {
      expect(jobs.organisations[job.organisation], job.id).toBeDefined()
      if (job.recruitment.exam) expect(jobs.exams[job.recruitment.exam], job.id).toBeDefined()
      expect(levels.has(job.entryLevel), `${job.id} entry level`).toBe(true)
      for (const step of job.promotionPath) {
        expect(levels.has(step.level), `${job.id} -> ${step.title.en}`).toBe(true)
      }
    }
  })

  it('puts every post in the level that matches its grade pay', () => {
    // Level 9 and Level 10 both carry grade pay 5400, so that pair is checked
    // by level rather than by grade pay.
    const gradePayOf = new Map(matrix.levels.map((level) => [level.level, level.gradePay ?? null]))
    const mismatched: string[] = []
    for (const job of jobs.jobs) {
      const expected = gradePayOf.get(job.entryLevel)
      if (job.gradePay !== expected) {
        mismatched.push(`${job.id}: L${job.entryLevel} has GP ${expected}, job says ${job.gradePay}`)
      }
    }
    expect(mismatched).toEqual([])
  })

  it('resolves IB ACIO-II to Level 7, grade pay 4600, with the Special Security Allowance on', () => {
    // The one worked example in the master context, and the only post in this
    // dataset whose Level was confirmed against a published source.
    const acio = byId.get('ib-acio-ii-executive')
    expect(acio).toBeDefined()
    expect(acio?.entryLevel).toBe('7')
    expect(acio?.gradePay).toBe(4600)
    expect(acio?.organisation).toBe('ib')
    expect(acio?.verify).toBe(false)

    const ssa = acio?.allowances.find((entry) => entry.id === 'special-security-allowance-ib')
    expect(ssa, 'IB ACIO-II carries the Special Security Allowance').toBeDefined()
    expect(ssa?.enabledByDefault, 'and it is automatic for the post').toBe(true)

    const rate = allowances.allowances.find(
      (allowance) => allowance.id === 'special-security-allowance-ib',
    )
    expect(rate?.rates[0]?.measure).toBe('percent-of-basic-pay')
    expect(rate?.rates[0]?.value).toBe(20)

    const level7 = matrix.levels.find((level) => level.level === '7')
    expect(level7?.entryPay).toBe(44900)
  })

  it('switches on by default only what is automatic for the post', () => {
    // enabledByDefault is a claim that the allowance follows the post, not the
    // posting. Anything that depends on where an officer is sent, or on an
    // option they exercise, must be off.
    const neverDefault = new Set([
      'special-duty-allowance-ne',
      'tough-location-allowance',
      'hard-area-allowance',
      'island-special-duty-allowance',
      'risk-and-hardship-allowance',
      'detachment-allowance',
      'deputation-duty-allowance',
      'hostel-subsidy',
      'night-duty-allowance',
      'uniform-allowance-police',
      'kit-maintenance-allowance',
    ])
    const offenders: string[] = []
    for (const job of jobs.jobs) {
      for (const allowance of job.allowances) {
        if (allowance.enabledByDefault && neverDefault.has(allowance.id)) {
          offenders.push(`${job.id} -> ${allowance.id}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('gives every post Dearness Allowance, and never lists an allowance twice', () => {
    for (const job of jobs.jobs) {
      const ids = job.allowances.map((allowance) => allowance.id)
      expect(new Set(ids).size, `${job.id} lists an allowance twice`).toBe(ids.length)
      expect(ids, job.id).toContain('dearness-allowance')
    }
  })

  it('gives every post a source', () => {
    for (const job of jobs.jobs) {
      expect(job.source.name, job.id).toBeTruthy()
      expect(job.source.url, job.id).toMatch(/^https?:\/\//)
    }
  })
})

describe('schemes', () => {
  it('sets the CGHS contribution by Level, covering all 19 of them exactly once', () => {
    const covered = cghs.scheme.slabs.flatMap((slab) => slab.appliesToLevels ?? [])
    expect(new Set(covered).size).toBe(covered.length)
    expect(covered.length).toBe(matrix.levels.length)
    const rate = (key: string) => cghs.scheme.slabs.find((slab) => slab.key === key)?.value
    expect(rate('level-1-to-5')).toBe(250)
    expect(rate('level-6')).toBe(450)
    expect(rate('level-7-to-11')).toBe(650)
    expect(rate('level-12-and-above')).toBe(1000)
  })

  it('keeps the CGEGIS subscription at the units the scheme actually charges', () => {
    const rate = (key: string) => cgegis.scheme.slabs.find((slab) => slab.key === key)?.value
    expect(rate('group-a')).toBe(120)
    expect(rate('group-b')).toBe(60)
    expect(rate('group-c')).toBe(30)
  })

  it('has NPS at 10 and 14 per cent', () => {
    const share = (key: string) =>
      nps.scheme.contributions.find((entry) => entry.key === key)?.value
    expect(share('employee')).toBe(10)
    expect(share('government')).toBe(14)
  })

  it('has UPS at 10 and 18.5 per cent, with the assured payout rules', () => {
    const share = (key: string) =>
      ups.scheme.contributions.find((entry) => entry.key === key)?.value
    expect(share('employee')).toBe(10)
    expect(share('government-total')).toBe(18.5)
    // The pool contribution is what the 18.5 buys that NPS's 14 does not.
    expect(
      (share('government-individual-corpus') ?? 0) + (share('government-pool-corpus') ?? 0),
    ).toBe(18.5)

    expect(ups.scheme.effectiveFrom).toBe('2025-04-01')
    const slab = (key: string) => ups.scheme.slabs.find((entry) => entry.key === key)
    expect(slab('full-payout')?.value).toBe(50)
    expect(slab('minimum-payout')?.value).toBe(10000)
    expect(slab('family-payout')?.value).toBe(60)
    expect(slab('proportionate-payout')?.expression).toContain('25 years')
  })
})

describe('income tax', () => {
  const regime = (id: 'old' | 'new') => tax.regimes.find((entry) => entry.id === id)

  it('is for the year the pay calculator is being used in', () => {
    expect(tax.financialYear).toBe('2026-27')
  })

  it('makes the new regime the default and gives it the standard deduction', () => {
    expect(regime('new')?.isDefault).toBe(true)
    expect(regime('old')?.isDefault).toBe(false)
    expect(regime('new')?.standardDeduction).toBe(75000)
    expect(regime('old')?.standardDeduction).toBe(50000)
  })

  it('has slabs that start at zero and run to an open top band', () => {
    for (const entry of tax.regimes) {
      const bands = entry.slabs.filter((slab) => !slab.ageBand || slab.ageBand === 'below-60')
      expect(bands[0]?.from, entry.id).toBe(0)
      expect(bands.at(-1)?.to, entry.id).toBeNull()
      for (let index = 1; index < bands.length; index += 1) {
        expect(bands[index]?.from, `${entry.id} band ${index}`).toBe(bands[index - 1]?.to)
      }
    }
  })

  it('carries the ₹12 lakh rebate under the new regime', () => {
    expect(regime('new')?.rebate.incomeCeiling).toBe(1200000)
    expect(regime('new')?.rebate.maxRebate).toBe(60000)
    expect(regime('old')?.rebate.incomeCeiling).toBe(500000)
  })

  it('gives the old regime its age-based exemption limits', () => {
    const bands = regime('old')?.slabs ?? []
    const firstOf = (age: string) => bands.find((slab) => slab.ageBand === age)?.to
    expect(firstOf('below-60')).toBe(250000)
    expect(firstOf('60-to-80')).toBe(300000)
    expect(firstOf('80-and-above')).toBe(500000)
  })

  it('names both the 1961 and the 2025 section for the deductions officers ask about', () => {
    const find = (id: string) => tax.deductions.find((entry) => entry.id === id)
    expect(find('80c')?.limit).toBe(150000)
    expect(find('80c')?.section2025).toBe('123')
    expect(find('80ccd1b')?.limit).toBe(50000)
    expect(find('80ccd1b')?.section2025).toBe('124')
    // The employer's NPS contribution is the one substantial deduction that
    // survives in the new regime.
    expect(find('80ccd2')?.regimes.sort()).toEqual(['new', 'old'])
    expect(find('80c')?.regimes).toEqual(['old'])
  })

  it('carries the HRA exemption rule and the 10(14) exempt allowances', () => {
    const hra = tax.exemptions.find((entry) => entry.id === '10-13a-hra')
    expect(hra?.section1961).toContain('10(13A)')
    expect(hra?.regimes).toEqual(['old'])
    const under1014 = tax.exemptions.filter((entry) => entry.section1961.startsWith('10(14)'))
    expect(under1014.length).toBeGreaterThanOrEqual(5)
    // The differently abled employee's transport allowance is the 10(14)
    // exemption that survives in the new regime.
    const transport = under1014.find((entry) => entry.id === '10-14-transport-disabled')
    expect(transport?.limit).toBe(3200)
    expect(transport?.regimes.sort()).toEqual(['new', 'old'])
  })

  it('caps surcharge at 25 per cent under the new regime', () => {
    const newRegimeTop = tax.surcharge.bands
      .filter((band) => band.regimes.includes('new'))
      .map((band) => band.rate)
    expect(Math.max(...newRegimeTop)).toBe(25)
    const oldRegimeTop = tax.surcharge.bands
      .filter((band) => band.regimes.includes('old'))
      .map((band) => band.rate)
    expect(Math.max(...oldRegimeTop)).toBe(37)
    expect(tax.cess.rate).toBe(4)
  })
})

describe('8th CPC', () => {
  it('records the constitution as fact and nothing else as fact', () => {
    expect(cpc8.status).toBe('constituted')
    expect(cpc8.commission.constitutedOn).toBe('2025-11-03')
    expect(cpc8.commission.members[0]?.name.en).toContain('Ranjana Prakash Desai')
    expect(cpc8.commission.reportDue.withinMonths).toBe(18)
    // Read from the gazette resolution itself, so this is the one part that is
    // not flagged for verification.
    expect(cpc8.commission.verify).toBe(false)
  })

  it('marks every fitment factor as projected, never as a rate', () => {
    expect(cpc8.fitmentFactorsDiscussed.length).toBeGreaterThanOrEqual(2)
    for (const factor of cpc8.fitmentFactorsDiscussed) {
      expect(factor.status, String(factor.value)).toBe('projected')
    }
    const values = cpc8.fitmentFactorsDiscussed.map((factor) => factor.value)
    expect(Math.min(...values)).toBe(1.92)
    expect(Math.max(...values)).toBe(2.86)
  })

  it('carries no pay matrix', () => {
    // The brief says status facts only. If a matrix ever appears here it will
    // be somebody's arithmetic on a guess, rendered as if it were the gazette.
    expect(Object.keys(cpc8)).not.toContain('matrix')
    expect(Object.keys(cpc8)).not.toContain('levels')
    expect(cpc8.whatIsNotKnown.length).toBeGreaterThanOrEqual(3)
  })
})

describe('dataset versions', () => {
  const versions = JSON.parse(readFromRoot('data/_meta/versions.json')) as {
    datasets: Record<
      string,
      { version: string; rows?: number; sha256?: string; label: Record<string, string> }
    >
  }

  const PAY_DATASETS = [
    'pay-matrix', 'pay-da-history', 'pay-cities', 'pay-allowances', 'pay-jobs',
    'pay-cghs', 'pay-cgegis', 'pay-nps', 'pay-ups', 'pay-tax', 'pay-cpc8',
  ]

  it.each(PAY_DATASETS)('records %s', (key) => {
    const entry = versions.datasets[key]
    expect(entry).toBeDefined()
    expect(entry?.label.en).toBeTruthy()
    expect(entry?.label.hi).toBeTruthy()
    expect(entry?.sha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('records the row count each dataset actually has', () => {
    expect(versions.datasets['pay-matrix']?.rows).toBe(matrix.levels.length)
    expect(versions.datasets['pay-da-history']?.rows).toBe(da.rates.length)
    expect(versions.datasets['pay-cities']?.rows).toBe(cities.cities.length)
    expect(versions.datasets['pay-allowances']?.rows).toBe(allowances.allowances.length)
    expect(versions.datasets['pay-jobs']?.rows).toBe(jobs.jobs.length)
  })

  it('leaves the law and shell entries the earlier sessions wrote', () => {
    for (const key of ['app', 'law-bns', 'law-bnss', 'law-bsa', 'law-index']) {
      expect(versions.datasets[key], key).toBeDefined()
    }
  })
})
