import type { LawDataset, LawIndex, LawIndexEntry, LawSection, OldActId } from './types'

/**
 * Lookups over the law datasets. Pure functions over already-parsed JSON: the
 * caller decides how the megabytes arrive (a fetch on the Law Converter route),
 * and these never reach for them.
 */

/**
 * `"318 (4)"`, `"318( 4 )"`, `"318(4)"` and `"498a"` are all the same reference.
 *
 * A section reference contains no whitespace, so every space goes -- which made
 * the four bracket-juggling passes this used to run provably redundant, one of
 * them a lookbehind. Lookbehind is a syntax error in Safari before 16.4, and a
 * syntax error is not caught at the call site: it takes down the whole chunk at
 * parse time. Dropping it costs nothing, which is the best reason to drop it.
 */
export function normaliseSectionRef(input: string): string {
  const bare = input.normalize('NFKC').replace(/\s+/g, '').replace(/\.$/, '')

  // Case is not uniform across a reference, and a blanket `.toUpperCase()` was
  // wrong: Indian drafting writes the section suffix upper (498A, 65B) and the
  // bracketed sub-parts lower (2(f), 65B(3)(a)). Uppercasing everything meant
  // "65B(3)(a)" normalised to "65B(3)(A)", missed its own entry, silently fell
  // back to the base section, and answered a question about clause (a) with the
  // whole of 65B.
  const parts = /^(\d{1,4})([A-Za-z]{0,2})(.*)$/.exec(bare)
  if (!parts) return bare
  const [, number, suffix = '', rest = ''] = parts
  return `${number}${suffix.toUpperCase()}${rest.toLowerCase()}`
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
  // `Object.hasOwn` rather than a bare index: `acts` and `entries` come straight
  // from JSON.parse, so they are plain objects with Object.prototype behind
  // them, and a reader who types "constructor" would otherwise reach a function
  // instead of undefined.
  if (!Object.hasOwn(index.acts, act)) return undefined
  const entries = index.acts[act]?.entries
  if (!entries) return undefined
  const ref = normaliseSectionRef(section)
  for (const key of [ref, sectionBase(ref)]) {
    if (Object.hasOwn(entries, key)) return entries[key]
  }
  return undefined
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
  for (const key of [normalised, sectionBase(normalised)]) {
    if (Object.hasOwn(dataset.sections, key)) return dataset.sections[key]
  }
  return undefined
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
