import { describe, expect, it } from 'vitest'

import { defaultScenario, normaliseScenario, scenarioForJob } from './scenario'

import { loadPayTables } from '@/test/payTables'

const tables = loadPayTables()

/**
 * `normaliseScenario` is the one place a `PayScenario` from an UNTRUSTED
 * source — a shared URL, a restored `payScenarios` row, an agent tool patch —
 * is clamped back into the current datasets before anything reads it. It
 * already does this for `level` and `cityId`; `jobId` was the one field it
 * let through unchecked, which is the same class of gap `level`/`cityId`
 * guard against and not a hypothetical one: `payScenarios` rows persist
 * across dataset updates, so a post retired or renamed in a later
 * `data/pay/jobs.json` leaves an old saved scenario's `jobId` pointing at
 * nothing. The Job picker (`Combobox`'s `selectedLabel`) resolves that id
 * against the CURRENT table, so an unclamped stale id renders as a blank,
 * unclearable box — indistinguishable from "nothing was ever picked" but
 * silently NOT the same state.
 */
describe('normaliseScenario', () => {
  it('clears a jobId that names no post in the current tables, the same way it clears a bad cityId', () => {
    const stale = { ...defaultScenario(tables), jobId: 'a-post-removed-from-a-later-dataset' }
    expect(normaliseScenario(stale, tables).jobId).toBeNull()
  })

  it('keeps a jobId that still resolves', () => {
    const scenario = scenarioForJob('ib-acio-ii-executive', tables)
    expect(normaliseScenario(scenario, tables).jobId).toBe('ib-acio-ii-executive')
  })

  it('leaves a scenario with no post picked alone', () => {
    expect(normaliseScenario(defaultScenario(tables), tables).jobId).toBeNull()
  })
})
