import { normaliseText, quoteAt, resolveAnchor, type AnchorResolution } from './anchor'

import { db, type LibraryBookmarkRow, type LibraryHighlightRow, type LibraryNoteRow } from '@/db'

/**
 * Highlights, margin notes and the reader's deliberate marks.
 *
 * This is the second file in `src/lib/library` that opens the database.
 * `store.ts` records what HAPPENED — the reader arrived at a unit, and dwelt on
 * it for thirty seconds — and is allowed to fail silently, because remembering
 * where somebody got to is a convenience. This file records what the reader
 * DID, and must not: a highlight an officer made and a note they wrote are
 * theirs, and a write that quietly failed would be discovered days later with
 * the work gone. So everything here rejects on failure and every call site
 * surfaces it, which is the opposite rule from the one next door and is the
 * reason the two are not one file.
 */

/**
 * The four highlight colours.
 *
 * Each is an accent token that already exists with a paired `-foreground`,
 * already has a dark value, and is already swept by the 85 contrast assertions
 * in `src/styles/tokens.test.ts`. Nothing was added to the palette for this:
 * a highlight renders as `bg-<colour>/15` with `text-<colour>-foreground`, which
 * is the pairing rule the design system states, and the raw token is never used
 * as text or icon colour.
 */
export const HIGHLIGHT_COLOURS = ['marigold', 'tulsi', 'violet', 'coral'] as const

export type HighlightColour = (typeof HIGHLIGHT_COLOURS)[number]

export const isHighlightColour = (value: unknown): value is HighlightColour =>
  typeof value === 'string' && (HIGHLIGHT_COLOURS as readonly string[]).includes(value)

/** A stored row is untrusted input; a colour this build does not know falls back. */
export const colourOf = (row: { colour: string }): HighlightColour =>
  isHighlightColour(row.colour) ? row.colour : 'marigold'

/**
 * Ids are random, not derived.
 *
 * Every other table in this app keys on something meaningful, because a second
 * write of the same thing should overwrite. A highlight is the opposite: two
 * marks on the same unit in the same colour are two marks, and the reader
 * expects both.
 */
const newId = (prefix: string): string => {
  const random = globalThis.crypto?.randomUUID?.()
  // `randomUUID` needs a secure context; an app served over plain http on a
  // LAN is a real way this project gets used, and a highlight must still save.
  return random
    ? `${prefix}-${random}`
    : `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export interface NewHighlight {
  workId: string
  unitId: string
  lang: 'en' | 'hi'
  start: number
  end: number
  colour: HighlightColour
  /** The unit's normalised text, so the quote is taken from the same string the offsets index. */
  text: string
}

/**
 * Mark a span. Returns the row, so the caller need not re-read to render it.
 *
 * The quote is cut from the text that was passed in rather than supplied
 * separately, which is what stops the two disagreeing — a quote that does not
 * match its own offsets would make every future resolution a re-anchor.
 */
export async function createHighlight(input: NewHighlight, now = new Date()): Promise<LibraryHighlightRow> {
  const start = Math.max(0, Math.min(input.start, input.end))
  const end = Math.min(input.text.length, Math.max(input.start, input.end))
  if (end <= start) throw new Error('a highlight must cover at least one character')

  const row: LibraryHighlightRow = {
    id: newId('hl'),
    workId: input.workId,
    unitId: input.unitId,
    lang: input.lang,
    start,
    end,
    quote: quoteAt(input.text, start, end),
    colour: input.colour,
    createdAt: now.toISOString(),
  }
  await db.libraryHighlights.put(row)
  return row
}

export async function setHighlightColour(id: string, colour: HighlightColour): Promise<void> {
  await db.libraryHighlights.update(id, { colour })
}

/**
 * Remove a highlight, and DETACH any note that was attached to it.
 *
 * The note is not deleted with it. An officer who wrote three sentences about a
 * clause and then tidied the colour away has not asked to lose the three
 * sentences; the note becomes a note on the unit, which is what it would have
 * been if they had written it there.
 */
export async function deleteHighlight(id: string): Promise<void> {
  await db.transaction('rw', db.libraryHighlights, db.libraryNotes, async () => {
    const attached = await db.libraryNotes.where('id').notEqual('').toArray()
    await Promise.all(
      attached
        .filter((note) => note.highlightId === id)
        .map((note) => db.libraryNotes.update(note.id, { highlightId: undefined })),
    )
    await db.libraryHighlights.delete(id)
  })
}

export const highlightsFor = (workId: string, unitId: string): Promise<LibraryHighlightRow[]> =>
  db.libraryHighlights.where('[workId+unitId]').equals([workId, unitId]).toArray()

export const allHighlights = (): Promise<LibraryHighlightRow[]> =>
  db.libraryHighlights.orderBy('createdAt').reverse().toArray()

export interface ResolvedHighlight {
  row: LibraryHighlightRow
  resolution: AnchorResolution
}

/**
 * Where each highlight sits in the text as it is NOW, in one language.
 *
 * Rows for the other language are dropped rather than resolved: an offset into
 * the English rendering means nothing against the Hindi one, and "re-anchor by
 * quote" would cheerfully find an English phrase inside an English fallback
 * being shown under a Hindi setting. A highlight made in English renders on the
 * English pane and nowhere else.
 */
export function resolveHighlights(
  rows: readonly LibraryHighlightRow[],
  text: string,
  lang: 'en' | 'hi',
): ResolvedHighlight[] {
  return rows
    .filter((row) => row.lang === lang)
    .map((row) => ({
      row,
      resolution: resolveAnchor(text, { start: row.start, end: row.end, quote: row.quote }),
    }))
}

/** The ones My Study lists under "needs attention" — found by neither offset nor quote. */
export const lostHighlights = (resolved: readonly ResolvedHighlight[]): LibraryHighlightRow[] =>
  resolved.filter((entry) => entry.resolution.status === 'lost').map((entry) => entry.row)

// ----------------------------------------------------------------- notes

export interface NoteInput {
  id?: string
  workId: string
  unitId: string
  highlightId?: string
  part?: string
  body: string
}

/**
 * Write a note, creating it on first save.
 *
 * `createdAt` is preserved across an edit and `updatedAt` moves — which is what
 * makes "last written" a real sort in My Study, and what the "saved" indicator
 * in the editor reads back.
 *
 * A note saved empty is DELETED rather than kept as a blank row. An empty note
 * is how a reader removes one, and a list full of empty rows is the alternative.
 */
export async function saveNote(input: NoteInput, now = new Date()): Promise<LibraryNoteRow | null> {
  const body = input.body.trim()
  const id = input.id ?? newId('note')

  if (!body) {
    if (input.id) await db.libraryNotes.delete(input.id)
    return null
  }

  const existing = input.id ? await db.libraryNotes.get(input.id) : undefined
  const row: LibraryNoteRow = {
    id,
    workId: input.workId,
    unitId: input.unitId,
    ...(input.highlightId ? { highlightId: input.highlightId } : {}),
    ...(input.part ? { part: input.part } : {}),
    body,
    createdAt: existing?.createdAt ?? now.toISOString(),
    updatedAt: now.toISOString(),
  }
  await db.libraryNotes.put(row)
  return row
}

export const notesFor = (workId: string, unitId: string): Promise<LibraryNoteRow[]> =>
  db.libraryNotes.where('[workId+unitId]').equals([workId, unitId]).toArray()

export const allNotes = (): Promise<LibraryNoteRow[]> =>
  db.libraryNotes.orderBy('updatedAt').reverse().toArray()

export const deleteNote = (id: string): Promise<void> => db.libraryNotes.delete(id)

/**
 * Whether the row in the database is newer than the one this tab is editing.
 *
 * Two tabs open on the same unit is not a rare case — it is how an officer
 * compares two rules. Both autosave, and the later write wins, which is the
 * only resolution available without a merge UI nobody asked for. What this
 * makes possible is TELLING the reader it happened, so the tab that lost can
 * say so rather than silently showing text that is no longer stored.
 */
export const isStale = (
  mine: { updatedAt: string } | null,
  stored: { updatedAt: string } | undefined,
): boolean => Boolean(mine && stored && stored.updatedAt > mine.updatedAt)

// ------------------------------------------------------- deliberate marks

/**
 * A bookmark's label. `null` clears it and leaves the bookmark.
 *
 * Does nothing when there is no bookmark to label: labelling is an edit of an
 * existing mark, and creating one as a side effect of naming it would make the
 * bookmark button and this control disagree about what a bookmark is.
 */
export async function setBookmarkLabel(workId: string, unitId: string, label: string | null): Promise<void> {
  const id = `${workId}:${unitId}`
  const existing = await db.libraryBookmarks.get(id)
  if (!existing) return
  const trimmed = label?.trim()
  await db.libraryBookmarks.put(trimmed ? { ...existing, label: trimmed } : { ...existing, label: undefined })
}

export const allBookmarks = (): Promise<LibraryBookmarkRow[]> =>
  db.libraryBookmarks.orderBy('createdAt').reverse().toArray()

/**
 * "I have read this" — a deliberate tick, distinct from having opened the unit.
 *
 * Written onto the progress row rather than into a table of its own, because a
 * unit that has been marked read has necessarily been opened, and two rows
 * saying overlapping things about one unit is how they come to disagree.
 */
export async function setMarkedRead(
  workId: string,
  unitId: string,
  read: boolean,
  now = new Date(),
): Promise<void> {
  const id = `${workId}:${unitId}`
  await db.transaction('rw', db.libraryProgress, async () => {
    const existing = await db.libraryProgress.get(id)
    await db.libraryProgress.put({
      id,
      workId,
      unitId,
      at: existing?.at ?? now.toISOString(),
      secondsRead: existing?.secondsRead ?? 0,
      ...existing,
      markedReadAt: read ? now.toISOString() : null,
    })
  })
}

/**
 * How far down the unit the reader had got, 0-1.
 *
 * Deliberately a RATIO rather than a pixel offset: the reader can change the
 * text size, the typeface and the line spacing, and a pixel offset stored under
 * one of those settings lands somewhere else under another.
 *
 * This one write DOES swallow its failure, unlike everything else in this file,
 * because it fires from a scroll handler — the same reasoning `recordProgress`
 * gives, and the same consequence if it were not: an unhandled rejection per
 * scroll on a device whose storage is refused.
 */
export async function rememberScroll(workId: string, unitId: string, ratio: number): Promise<void> {
  if (!Number.isFinite(ratio)) return
  const bounded = Math.min(1, Math.max(0, ratio))
  try {
    await db.libraryProgress.update(`${workId}:${unitId}`, { scrollRatio: bounded })
  } catch {
    // Nothing to tell the reader: they did not ask for this.
  }
}

// -------------------------------------------------------------- exporting

export interface ExportableAnnotation {
  workTitle: string
  unitNumber: string
  unitHeading: string
  citation: string
  /** The in-app route, e.g. `/library/rti/rti-8`. Made absolute below. */
  path: string
  highlights: { colour: string; quote: string; lost: boolean }[]
  notes: { body: string; updatedAt: string }[]
  bookmarkLabel: string | null
}

/**
 * My Study's Markdown export.
 *
 * Every entry carries its CITATION, not just its number — the export leaves
 * this app and an officer reading it a month later has no way back to what
 * "Rule 11" meant otherwise. The disclaimer travels with it for the same
 * reason the Law Converter's copied answer carries one.
 *
 * THE ORIGIN IS AN ARGUMENT AND THE LINK IS BUILT HERE, rather than the caller
 * passing a finished href. A relative path is what every route helper in this
 * app produces and is meaningless the moment the file is opened outside it —
 * so leaving it to the caller means the export is silently broken by the
 * obvious call. It is passed in rather than read from `window` because this
 * file is pure.
 */
export function toMarkdown(
  entries: readonly ExportableAnnotation[],
  heading: string,
  disclaimer: string,
  origin: string,
): string {
  const lines: string[] = [`# ${heading}`, '']

  for (const entry of entries) {
    lines.push(`## ${entry.citation}`)
    if (entry.unitHeading) lines.push(`*${entry.unitHeading}*`, '')
    if (entry.bookmarkLabel) lines.push(`**Bookmark:** ${entry.bookmarkLabel}`, '')

    for (const highlight of entry.highlights) {
      // A quotation whose anchor was lost is still quoted, and marked. Dropping
      // it would lose the officer's own words to a dataset refresh.
      lines.push(`> ${highlight.quote}${highlight.lost ? ' _(needs attention)_' : ''}`, '')
    }
    for (const note of entry.notes) lines.push(note.body, '')

    lines.push(`<${origin.replace(/\/$/, '')}${entry.path}>`, '')
  }

  lines.push('---', disclaimer, '')
  return lines.join('\n')
}

/** Text as it will be quoted — the same normalisation the offsets index into. */
export const quoteText = (text: string): string => normaliseText(text)
