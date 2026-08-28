import versions from '../../data/_meta/versions.json'

/**
 * data/_meta/versions.json, typed, plus a single fingerprint over every bundled
 * dataset.
 *
 * The fingerprint is what invalidates the AI answer cache: an answer grounded
 * in the section tables of one release must not be replayed after those tables
 * change, and the cheapest correct rule is "any dataset moved → drop the lot".
 */

export interface Dataset {
  version: string
  updated: string
  label: Record<string, string>
}

export const DATASETS = versions.datasets as Record<string, Dataset | undefined>

export const DATA_GENERATED_AT: string = versions.generatedAt

/** Deterministic: sorted, so the same content always yields the same string. */
export const DATA_VERSION: string = Object.entries(DATASETS)
  .filter((entry): entry is [string, Dataset] => Boolean(entry[1]))
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([name, dataset]) => `${name}@${dataset.version}`)
  .join('|')
