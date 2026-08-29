import { describe, expect, it } from 'vitest'

import { isCustomisedScenario, overridesFromScenario } from './aiOverrides'

import { loadPayTables } from '@/test/payTables'
import { scenarioForJob } from '@/lib/pay/scenario'

const tables = loadPayTables()
const JOB = 'ib-acio-ii-executive'

describe('isCustomisedScenario', () => {
  it('is false at the post’s own standard entry point', () => {
    const scenario = scenarioForJob(JOB, tables, { daRate: 60 })
    expect(isCustomisedScenario(scenario, tables)).toBe(false)
  })

  it('is true once the reader moves off the entry cell, Level or city', () => {
    const base = scenarioForJob(JOB, tables, { daRate: 60 })
    expect(isCustomisedScenario({ ...base, cellIndex: 2 }, tables)).toBe(true)
    expect(isCustomisedScenario({ ...base, level: '8' }, tables)).toBe(true)
    expect(isCustomisedScenario({ ...base, cityId: 'delhi' }, tables)).toBe(true)
  })

  it('is false for a scenario with no post picked — there is no default to have moved away from', () => {
    const base = scenarioForJob(JOB, tables, { daRate: 60 })
    expect(isCustomisedScenario({ ...base, jobId: null }, tables)).toBe(false)
  })
})

describe('overridesFromScenario', () => {
  it('carries the scenario’s own level, cell and rate through to the tool shape', () => {
    const scenario = { ...scenarioForJob(JOB, tables, { daRate: 60 }), cellIndex: 2 }
    const overrides = overridesFromScenario(scenario)
    expect(overrides).toMatchObject({ level: scenario.level, cell: 3, daRate: 60 })
  })
})
