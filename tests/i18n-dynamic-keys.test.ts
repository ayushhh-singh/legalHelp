import { describe, expect, it } from 'vitest'

import { LAW_CODES } from '@/modules/law/data'
import type { LawDataset } from '@/modules/law/types'
import { WHATS_NEW_GROUPS } from '@/modules/law/whatsNew'
import { readFromRoot } from '@/test/paths'

/**
 * Translation keys the UI builds from DATA rather than writing out.
 *
 * `pnpm i18n:check` proves en.json and hi.json hold the same keys, and a
 * separate check finds literal `t('...')` calls with no key behind them.
 * Neither can see a key assembled at runtime — `law.status.${record.status}`
 * resolves to whatever the dataset happens to say, and with
 * `fallbackLng: false` a value nobody wrote a string for renders as the key
 * itself: a reader sees "law.value.compoundable-by-court" on the card.
 *
 * This matters because `data/law` is regenerated weekly by the NCRB ingest
 * (`.github/workflows/ingest-law.yml`), which opens a pull request against the
 * committed JSON. A First Schedule that starts saying something new is exactly
 * how an unwritten key would arrive, and it would arrive without anyone
 * touching `src/`. So the assertion runs over the committed bytes, not over
 * the TypeScript unions — the unions are what the ingest would also have to
 * widen, and this test is meant to fail first.
 */

const en = JSON.parse(readFromRoot('src/i18n/en.json')) as Record<string, unknown>
const hi = JSON.parse(readFromRoot('src/i18n/hi.json')) as Record<string, unknown>

const has = (bundle: Record<string, unknown>, key: string): boolean =>
  key.split('.').reduce<unknown>((node, part) => {
    if (node === null || typeof node !== 'object') return undefined
    return (node as Record<string, unknown>)[part]
  }, bundle) !== undefined

/** Every distinct value the committed datasets actually use. */
const used = {
  status: new Set<string>(),
  cognizable: new Set<string>(),
  bailable: new Set<string>(),
  compoundable: new Set<string>(),
}

for (const code of LAW_CODES) {
  const dataset = JSON.parse(readFromRoot('data/law', `${code}.json`)) as LawDataset
  for (const record of Object.values(dataset.sections)) {
    used.status.add(record.status)
    for (const row of record.classification) {
      used.cognizable.add(row.cognizable)
      used.bailable.add(row.bailable)
      used.compoundable.add(row.compoundable)
    }
  }
}

const keys = [
  ...[...used.status].map((value) => `law.status.${value}`),
  ...[...used.cognizable, ...used.bailable, ...used.compoundable].map((value) => `law.value.${value}`),
  ...LAW_CODES.map((code) => `law.code.${code}`),
  ...WHATS_NEW_GROUPS.map((group) => `law.whatsNew.groups.${group}`),
].sort()

describe('translation keys built from the datasets', () => {
  it('covers every value the committed data uses', () => {
    // Named, not counted: a diff on this list says which value appeared.
    expect(keys.length).toBeGreaterThan(0)
    expect(keys.filter((key) => !has(en, key))).toEqual([])
    expect(keys.filter((key) => !has(hi, key))).toEqual([])
  })

  it('reaches every code, so a new Act cannot be added without its label', () => {
    expect(LAW_CODES).toHaveLength(3)
  })
})
