import type { LawDataset, LawIndex, LawIndexEntry, LawSection, OldActId } from './types'

/**
 * Lookups over the law datasets. Pure functions over already-parsed JSON: the
 * caller decides how the megabytes arrive (a fetch on the Law Converter route),
 * and these never reach for them.
 */

/** `"318 (4)"`, `"318( 4 )"` and `"318(4)"` are the same reference. */
export function normaliseSectionRef(input: string): string {
  return input
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\(\s*/g, '(')
    .replace(/\s*\)/g, ')')
    .replace(/(?<=[0-9A-Za-z])\s+\(/g, '(')
    .replace(/\)\s+(?=\()/g, ')')
    .replace(/\s+/g, '')
    .replace(/\.$/, '')
    .toUpperCase()
}

/** `"318(4)"` -> `"318"`. The dataset is keyed by the section number alone. */
export function sectionBase(ref: string): string {
  const match = /^(\d{1,4}[A-Z]{0,2})/.exec(normaliseSectionRef(ref))
  return match?.[1] ?? normaliseSectionRef(ref)
}

/**
 * Look up a repealed-Act section.
 *
 * Returns `null` when the provision has no counterpart at all — IPC 309, 377 and
 * 497 among them. That is a real answer, not a miss, so callers must tell the
 * two apart: `resolveOldSection` returns `null` for both, and
 * `lookupOldSection` returns the entry (with its `note`) so the UI can say
 * *why* there is nothing to show.
 */
export function lookupOldSection(index: LawIndex, act: OldActId, section: string): LawIndexEntry | undefined {
  const entries = index.acts[act]?.entries
  if (!entries) return undefined
  const ref = normaliseSectionRef(section)
  return entries[ref] ?? entries[sectionBase(ref)]
}

/** The sections of the new Act a repealed-Act section maps to, or `null` if none. */
export function resolveOldSection(
  index: LawIndex,
  act: OldActId,
  section: string,
): { entry: LawIndexEntry; newSections: string[] } | null {
  const entry = lookupOldSection(index, act, section)
  if (!entry || entry.newSections.length === 0) return null
  return { entry, newSections: entry.newSections }
}

/** The section record a reference points at, following sub-parts to their parent. */
export function getSection(dataset: LawDataset, ref: string): LawSection | undefined {
  const normalised = normaliseSectionRef(ref)
  return dataset.sections[normalised] ?? dataset.sections[sectionBase(normalised)]
}

/** Every new-Act section record a repealed-Act section resolves to. */
export function forwardSections(
  index: LawIndex,
  dataset: LawDataset,
  act: OldActId,
  section: string,
): LawSection[] {
  const resolved = resolveOldSection(index, act, section)
  if (!resolved) return []
  const seen = new Set<string>()
  const out: LawSection[] = []
  for (const ref of resolved.newSections) {
    const record = getSection(dataset, ref)
    if (record && !seen.has(record.section)) {
      seen.add(record.section)
      out.push(record)
    }
  }
  return out
}
