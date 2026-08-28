import { diffWords, hasChanges, type DiffPart } from './diff'
import { lookupOldSection } from './resolve'
import type { Bilingual, LawIndex, LawSection, OldSectionRef, SectionNote, SectionStatus } from './types'

/**
 * "What changed", assembled from what the datasets actually record.
 *
 * There is no `changeNotes` field to read: `data/law/*.json` states the change
 * as structure rather than prose — a `status`, a `changed` flag per clause, an
 * `isNewProvision` flag, the repealed provisions a section absorbed, and the
 * hand-curated `notes` from `data/law/overlays/`. This turns that structure
 * into the sentences a reader needs, and nothing in it is invented: every field
 * below traces to a value in the dataset or to a diff of two texts that are
 * both in it.
 *
 * The word-level diff runs on the HEADINGS, because that is what both sides
 * have. NCRB publishes the section text of the three new Acts and only the
 * headings of the repealed ones (`docs/DATA-GAPS.md` #17), so a body-text diff
 * has nothing to compare against. Where a future overlay supplies the old text,
 * `oldText` below is the seam it plugs into.
 */

export interface ChangeSummary {
  status: SectionStatus
  /** Every repealed provision this section absorbed, with its own heading. */
  absorbed: OldSectionRef[]
  /** Sub-sections the new Act added outright, e.g. `"103(2)"`. */
  newClauses: string[]
  /** Sub-sections NCRB marks "(Change)" — the substance moved, not just the number. */
  changedClauses: string[]
  /** Curated warnings, from the section record and from the reverse index. */
  notes: SectionNote[]
  /** A word-level diff of the old heading against the new one, when both exist. */
  headingDiff: DiffPart[] | null
  /** The pair the diff was computed over, for the side-by-side view. */
  headingPair: { old: string; next: string } | null
  /** True when nothing but the number changed. */
  numberOnly: boolean
}

/**
 * De-duplicate notes by their English title. The same trap is attached to both
 * the section record and the reverse-index entry it answers — the overlay is
 * merged into both on purpose, so that a lookup from either direction sees it —
 * and a reader must not be told about "302" twice on one card.
 */
function mergeNotes(...groups: ReadonlyArray<readonly SectionNote[] | undefined>): SectionNote[] {
  const seen = new Set<string>()
  const out: SectionNote[] = []
  for (const group of groups) {
    for (const note of group ?? []) {
      if (seen.has(note.title.en)) continue
      seen.add(note.title.en)
      out.push(note)
    }
  }
  return out
}

export function summariseChanges(record: LawSection, index: LawIndex, oldText?: Bilingual): ChangeSummary {
  const absorbed: OldSectionRef[] = []
  const seen = new Set<string>()
  const newClauses: string[] = []
  const changedClauses: string[] = []

  for (const mapping of record.mappings) {
    if (mapping.isNewProvision) newClauses.push(mapping.clause)
    if (mapping.changed) changedClauses.push(mapping.clause)
    for (const old of mapping.old) {
      const key = `${old.act}:${old.section}`
      if (seen.has(key)) continue
      seen.add(key)
      absorbed.push(old)
    }
  }

  // Warnings attached to the repealed sections this one replaced: "302 is now
  // 103", "420 is now 318(4)". They live on the index entry, not on the
  // section record, because they are about the number a reader arrives with.
  const indexWarnings = absorbed.flatMap(
    (old) => lookupOldSection(index, old.act, old.section)?.warnings ?? [],
  )

  // A single predecessor is the only case where a heading diff means anything.
  // With several, the "old heading" would be a concatenation nobody wrote.
  const single = absorbed.length === 1 ? absorbed[0] : undefined
  const before = oldText?.en ?? single?.heading.en ?? ''
  const after = oldText ? record.text.en : record.heading.en
  const headingDiff = before && after ? diffWords(before, after) : null

  return {
    status: record.status,
    absorbed,
    newClauses,
    changedClauses,
    notes: mergeNotes(record.notes, indexWarnings),
    headingDiff,
    headingPair: before && after ? { old: before, next: after } : null,
    numberOnly: record.status === 'renumbered' && changedClauses.length === 0 && !hasChanges(headingDiff),
  }
}

/** The four statuses, as the pill reads them. */
export const STATUS_TONE: Readonly<Record<SectionStatus, 'neutral' | 'warning' | 'success' | 'info'>> = {
  unchanged: 'neutral',
  renumbered: 'info',
  changed: 'warning',
  new: 'success',
}
