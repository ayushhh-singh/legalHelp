import 'fake-indexeddb/auto'

import { beforeEach, describe, expect, it } from 'vitest'

import {
  asScenario,
  deleteScenario,
  listScenarios,
  MAX_SCENARIOS,
  readLastScenario,
  saveScenario,
  scenarioId,
  writeLastScenario,
} from './scenarios'

import { db } from '@/db'
import { defaultScenario } from '@/lib/pay/scenario'
import { loadPayTables } from '@/test/payTables'

const tables = loadPayTables()
const base = defaultScenario(tables)

beforeEach(async () => {
  await Promise.all(db.tables.map((table) => table.clear()))
})

describe('named scenarios', () => {
  it('saves, lists newest first, and deletes', async () => {
    await saveScenario('Delhi posting', { ...base, cityId: 'delhi' })
    await saveScenario('Home town', { ...base, cityId: null })

    const rows = await listScenarios()
    expect(rows.map((row) => row.name)).toEqual(['Home town', 'Delhi posting'])

    await deleteScenario(rows[0]!.id)
    expect((await listScenarios()).map((row) => row.name)).toEqual(['Delhi posting'])
  })

  it('overwrites a scenario saved under the same name rather than duplicating it', async () => {
    await saveScenario('My pay', { ...base, level: '7' })
    await saveScenario('My pay', { ...base, level: '8' })

    const rows = await listScenarios()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.level).toBe('8')
    expect(scenarioId('My pay')).toBe(scenarioId('  my   pay  '))
  })

  it('refuses an eleventh rather than deleting one the reader saved', async () => {
    for (let i = 0; i < MAX_SCENARIOS; i += 1) {
      expect((await saveScenario(`Scenario ${i}`, base)).ok).toBe(true)
    }
    const overflow = await saveScenario('One too many', base)
    expect(overflow).toEqual({ ok: false, reason: 'full' })
    expect(await db.payScenarios.count()).toBe(MAX_SCENARIOS)

    // Updating one that already exists still works at the limit.
    expect((await saveScenario('Scenario 0', { ...base, level: '9' })).ok).toBe(true)
  })

  it('refuses an empty name', async () => {
    expect(await saveScenario('   ', base)).toEqual({ ok: false, reason: 'empty-name' })
  })

  it('keeps a name written in Hindi', async () => {
    const saved = await saveScenario('दिल्ली पोस्टिंग', base)
    expect(saved.ok).toBe(true)
    expect((await listScenarios())[0]?.name).toBe('दिल्ली पोस्टिंग')
  })
})

describe('the last scenario', () => {
  it('round-trips through settings', async () => {
    await writeLastScenario({ ...base, level: '7', cityId: 'delhi' })
    const back = await readLastScenario()
    expect(back?.level).toBe('7')
    expect(back?.cityId).toBe('delhi')
  })

  it('drops a row that does not look like a scenario', () => {
    expect(asScenario(null)).toBeNull()
    expect(asScenario('7')).toBeNull()
    expect(asScenario({ level: 7 })).toBeNull()
    expect(asScenario({ level: '7', daRate: 60 })).toBeNull()
    expect(asScenario({ level: '7', daRate: 60, allowances: [] })).not.toBeNull()
  })

  it('drops a row whose allowance entries are not allowances', () => {
    // The array being an array was not enough: a `null` inside it reached the
    // engine and threw, which on this route is a white screen.
    const shell = { level: '7', daRate: 60 }
    expect(asScenario({ ...shell, allowances: [null] })).toBeNull()
    expect(asScenario({ ...shell, allowances: ['house-rent-allowance'] })).toBeNull()
    expect(asScenario({ ...shell, allowances: [{ enabled: true }] })).toBeNull()
    expect(asScenario({ ...shell, allowances: [{ id: 'x', enabled: true }] })).not.toBeNull()
  })

  it('keeps the matras in a name written in Hindi', () => {
    // Devanagari vowel signs are combining MARKS, not letters, so a
    // letters-and-digits-only slug reduced "दिल्ली पोस्टिंग" to "द-ल-ल-प-स-ट-ग".
    expect(scenarioId('दिल्ली पोस्टिंग')).toBe('दिल्ली-पोस्टिंग')
    expect(scenarioId('दिल्ली')).not.toBe(scenarioId('दलील'))
  })
})
