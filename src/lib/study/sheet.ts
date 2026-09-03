import type { Chapter } from './types'

import type { LibraryHighlightRow, LibraryNoteRow } from '@/db'
import type { Language } from '@/i18n'
import { unitLabel, type LibraryUnit } from '@/lib/library'
import type { QuickRefRecord, StudyAid } from '@/schemas/library'

/**
 * The revision sheet — one printable page per chapter, assembled from things
 * that already exist.
 *
 * NOTHING HERE IS NEW WRITING. A sheet is the chapter's aids, the reader's own
 * highlights and notes, and the quick-reference rows extracted from the same
 * text — arranged so a chapter can be revised from one page. That is why this
 * file is in `src/lib/study` rather than in the module: assembling it is
 * arithmetic over rows, and only the printing is a component's job.
 *
 * ### 24-hour mode
 *
 * The brief asks for a second mode that shows only misconceptions, limits and
 * the reader's own notes. It is not a shorter sheet — it is a DIFFERENT one,
 * and `sheetFor` takes the mode rather than a `compact` flag, because what
 * drops out in that mode is the explanation and the example, which are the two
 * things a full sheet is mostly made of. What survives is what an officer with
 * one evening left actually needs: the trap, the number, and what they
 * themselves wrote down when they first read it.
 */

export type SheetMode = 'full' | 'twentyFourHour'

export interface SheetEntry {
  unitId: string
  number: string
  /** What to print above the entry, in the reader's language. */
  heading: string
  /** True where `heading` fell back to a quoted excerpt (`unitLabel`). */
  headingIsExcerpt: boolean
  /** The language `heading` actually came out in — for the `lang` attribute. */
  headingLang: Language
  aid: StudyAid | null
  highlights: LibraryHighlightRow[]
  notes: LibraryNoteRow[]
  quickRef: QuickRefRecord[]
  /** True when this entry would print nothing at all in the chosen mode. */
  empty: boolean
}

export interface Sheet {
  chapter: Chapter
  mode: SheetMode
  entries: SheetEntry[]
  /** Entries that would print nothing are dropped; this is how many. */
  skipped: number
  counts: { aids: number; highlights: number; notes: number; quickRef: number }
}

export interface SheetInput {
  chapter: Chapter
  units: ReadonlyMap<string, LibraryUnit>
  aids: readonly StudyAid[]
  highlights: readonly LibraryHighlightRow[]
  notes: readonly LibraryNoteRow[]
  quickRef: readonly QuickRefRecord[]
  language: Language
  mode?: SheetMode
}

const byUnit = <T extends { unitId: string }>(rows: readonly T[]): Map<string, T[]> => {
  const out = new Map<string, T[]>()
  for (const row of rows) {
    const bucket = out.get(row.unitId)
    if (bucket) bucket.push(row)
    else out.set(row.unitId, [row])
  }
  return out
}

/**
 * In 24-hour mode a quick-reference row is kept only where it is a LIMIT — a
 * time period or a monetary figure. A named authority is a fact about who acts,
 * which is worth reading once and is not what an officer forgets the night
 * before.
 */
const isLimit = (row: QuickRefRecord): boolean => row.kind === 'time' || row.kind === 'money'

export function sheetFor(input: SheetInput): Sheet {
  const mode = input.mode ?? 'full'
  const aids = new Map(input.aids.map((aid) => [aid.unitId, aid]))
  const highlights = byUnit(input.highlights)
  const notes = byUnit(input.notes)
  const quickRef = byUnit(input.quickRef)

  const entries: SheetEntry[] = []
  let skipped = 0

  for (const unitId of input.chapter.unitIds) {
    const unit = input.units.get(unitId)
    if (!unit) continue

    const aid = aids.get(unitId) ?? null
    const shown = unitLabel(unit.heading, unit.excerpt, input.language)
    const rows = quickRef.get(unitId) ?? []

    const entry: SheetEntry = {
      unitId,
      number: unit.number,
      heading: shown.text,
      headingIsExcerpt: shown.isExcerpt,
      headingLang: shown.lang,
      aid,
      highlights: highlights.get(unitId) ?? [],
      notes: notes.get(unitId) ?? [],
      quickRef: mode === 'full' ? rows : rows.filter(isLimit),
      empty: false,
    }

    // In 24-hour mode an aid with no misconception contributes nothing, so the
    // entry is judged on what will ACTUALLY print rather than on what it holds.
    const printsAid = mode === 'full' ? Boolean(aid) : Boolean(aid?.misconception)
    entry.empty =
      !printsAid && entry.highlights.length === 0 && entry.notes.length === 0 && entry.quickRef.length === 0

    if (entry.empty) skipped += 1
    else entries.push(entry)
  }

  return {
    chapter: input.chapter,
    mode,
    entries,
    skipped,
    counts: {
      aids: entries.filter((entry) => entry.aid).length,
      highlights: entries.reduce((total, entry) => total + entry.highlights.length, 0),
      notes: entries.reduce((total, entry) => total + entry.notes.length, 0),
      quickRef: entries.reduce((total, entry) => total + entry.quickRef.length, 0),
    },
  }
}

/**
 * Whether a sheet is worth offering at all.
 *
 * A chapter with no aids, no annotations and no quick-reference rows produces a
 * page with the chapter's name on it and nothing else. Offering it and printing
 * blank paper is worse than saying there is nothing to print yet.
 */
export const hasContent = (sheet: Sheet): boolean => sheet.entries.length > 0
