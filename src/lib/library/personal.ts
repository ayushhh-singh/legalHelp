import { estimateReadTime } from './readTime'

import { db, type LibraryPersonalWorkRow } from '@/db'
import type { LibraryCorpus, LibraryUnit } from './types'
import type { Bilingual, LibraryWork, LibrarySource, TocNode } from '@/schemas/library'

/**
 * The reader's own documents, and the one type that lets the reader render
 * them beside the fifteen this app ships.
 *
 * THREE PROMISES, and each is enforced somewhere in this file rather than
 * asserted in a comment:
 *
 * 1. **It never leaves the device.** A personal work is a Dexie row and
 *    nothing else. It is never written to `data/`, never uploaded, and the
 *    export below produces a file the reader saves themselves.
 * 2. **It is never presented as a source.** `ReaderWork.origin` is `personal`,
 *    `source` and `officialUrl` are `null`, and every surface that renders a
 *    citation, a source chip or a dataset version has to handle that — which is
 *    the point of making them nullable rather than filling them with something
 *    plausible.
 * 3. **Its id cannot collide with a dataset work's.** Every id starts `my-`,
 *    `isPersonalWorkId` is the one test, and the router asks it before it asks
 *    `isWorkId`.
 */

export const PERSONAL_PREFIX = 'my-'

export const isPersonalWorkId = (id: string): boolean => id.startsWith(PERSONAL_PREFIX)

const slugify = (title: string): string =>
  title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)

/**
 * A readable id where the title allows one, and a stable fallback where it does
 * not — a title written entirely in Devanagari slugifies to nothing, and this
 * app's readers write titles in Devanagari.
 */
export function personalWorkId(title: string, suffix = Date.now().toString(36)): string {
  const slug = slugify(title)
  return `${PERSONAL_PREFIX}${slug || 'work'}-${suffix}`
}

/** What one unit of a personal document is called, in both languages. */
export const UNIT_WORDS: Readonly<Record<LibraryPersonalWorkRow['unitWord'], Bilingual>> = {
  section: { en: 'Section', hi: 'धारा' },
  rule: { en: 'Rule', hi: 'नियम' },
  paragraph: { en: 'Paragraph', hi: 'पैरा' },
  item: { en: 'Item', hi: 'मद' },
}

/**
 * A work the reader page can render, from either origin.
 *
 * `LibraryWork` requires a publisher, an official URL and a source, because
 * every one of the fifteen bundled works has all three and a dataset that lost
 * one should fail validation. A personal document has none of them, and the
 * wrong fix would be to relax the dataset schema — that schema is what stops a
 * committed work shipping without a citation. So the READER takes a slightly
 * wider type, and the two adapters below are the only places that produce one.
 */
export interface ReaderWork extends Omit<LibraryWork, 'source' | 'officialUrl' | 'verify'> {
  origin: 'dataset' | 'personal'
  source: LibrarySource | null
  officialUrl: string | null
  verify: boolean
  /** Free text the reader wrote about where their own document came from. */
  originNote?: string
}

export const fromDataset = (work: LibraryWork): ReaderWork => ({
  ...work,
  origin: 'dataset',
  source: work.source,
  officialUrl: work.officialUrl,
  verify: work.verify ?? false,
})

const bilingual = (value: string): Bilingual => ({ en: value, hi: value })

/**
 * A table of contents for a personal document.
 *
 * Grouped by the CHAPTER or PART the splitter found, and flat when it found
 * none — the same three-way honesty `tocSource` records for the bundled works,
 * with `numbering` simply unreachable here because nothing infers a numbering
 * scheme for somebody else's document.
 */
function tocFor(row: LibraryPersonalWorkRow): { toc: TocNode[]; source: 'chapters' | 'flat' } {
  const leaf = (unit: LibraryPersonalWorkRow['units'][number]): TocNode => ({
    id: unit.id,
    number: unit.number,
    heading: { en: unit.heading, hi: unit.heading },
    ...(unit.heading ? {} : { excerpt: { en: unit.text.slice(0, 96), hi: unit.text.slice(0, 96) } }),
    unitIds: [unit.id],
  })

  if (row.divisions.length === 0) return { toc: row.units.map(leaf), source: 'flat' }

  const nodes: TocNode[] = []
  row.divisions.forEach((division, index) => {
    const next = row.divisions[index + 1]
    const children = row.units.slice(division.from, next ? next.from : row.units.length).map(leaf)
    if (children.length === 0) return
    nodes.push({
      id: `${row.id}-${division.label}`,
      number: division.label,
      heading: { en: division.title, hi: division.title },
      children,
      unitIds: children.flatMap((child) => child.unitIds),
    })
  })

  // Units before the first division would otherwise vanish from the contents,
  // which is exactly the "a rule nobody can navigate to" failure ADR-038's
  // both-directions test exists to catch.
  const before = row.units.slice(0, row.divisions[0]?.from ?? 0).map(leaf)
  if (before.length > 0) nodes.unshift(...before)

  return nodes.length > 0 ? { toc: nodes, source: 'chapters' } : { toc: row.units.map(leaf), source: 'flat' }
}

export function fromPersonal(row: LibraryPersonalWorkRow): ReaderWork {
  const { toc, source } = tocFor(row)
  const words = row.units.map((unit) => unit.text).join(' ')

  return {
    version: '1.0.0',
    generatedAt: row.createdAt.slice(0, 10),
    id: row.id,
    title: bilingual(row.title),
    shortTitle: bilingual(row.title.length > 40 ? `${row.title.slice(0, 38)}…` : row.title),
    category: 'other',
    description: bilingual(row.note),
    // Never loaded through `data.ts` — `loadCorpus` is not reached for a
    // personal work at all — but `corpus.kind` is what the reader reads to
    // decide whether a unit can carry a chapter, so it has to be honest.
    corpus: { kind: 'rules', file: 'personal' },
    unitLabel: UNIT_WORDS[row.unitWord],
    publisher: '',
    tocSource: source,
    toc,
    readingOrder: row.units.map((unit) => unit.id),
    estimatedMinutes: estimateReadTime(words),
    practiseCounts: {},
    examTags: [],
    // Nobody has amended the reader's own document, and if they had, this app
    // would have no way to know. An empty map rather than an absent key, the
    // same shape the dataset works carry.
    amendments: {},
    origin: 'personal',
    source: null,
    officialUrl: null,
    // Everything in a personal work is unverified BY CONSTRUCTION: nobody
    // checked it against a gazette, and this app has no idea what it is.
    verify: true,
    originNote: row.note,
    disclaimer: {
      en: 'Your own document. Not an official dataset, and not checked by this app.',
      hi: 'आपका अपना दस्तावेज़। यह कोई आधिकारिक डेटासेट नहीं है और इस ऐप द्वारा जाँचा नहीं गया है।',
    },
  }
}

/** A personal document's units, in the shape the reader already renders. */
export function buildPersonalCorpus(row: LibraryPersonalWorkRow): LibraryCorpus {
  const word = UNIT_WORDS[row.unitWord]
  const units = new Map<string, LibraryUnit>()

  for (const unit of row.units) {
    const empty = { en: '', hi: '' }
    const text = { ...empty, [row.language]: unit.text }
    const heading = { ...empty, [row.language]: unit.heading }

    units.set(unit.id, {
      id: unit.id,
      number: unit.number,
      heading,
      excerpt: unit.heading ? null : { ...empty, [row.language]: unit.text.slice(0, 96) },
      body: { en: splitParagraphs(text.en), hi: splitParagraphs(text.hi) },
      parts: [],
      chapter: null,
      citation: {
        en: `${word.en} ${unit.number}, ${row.title}`,
        hi: `${word.hi} ${unit.number}, ${row.title}`,
      },
      repealedRefs: [],
    })
  }

  return { workId: row.id, order: row.units.map((unit) => unit.id), units }
}

/**
 * A personal document keeps the line breaks it was pasted with.
 *
 * `paragraphs()` in `corpus.ts` exists because the twelve rule books store a
 * rule as one unbroken line with no breaks to keep. A document somebody pasted
 * has its own, and second-guessing them would split inside a sentence the
 * author deliberately kept together.
 */
const splitParagraphs = (text: string): string[] =>
  text
    .split(/\n+/)
    .map((part) => part.trim())
    .filter(Boolean)

// ------------------------------------------------------------- persistence

export const listPersonalWorks = (): Promise<LibraryPersonalWorkRow[]> =>
  db.libraryPersonalWorks.orderBy('updatedAt').reverse().toArray()

export const getPersonalWork = (id: string): Promise<LibraryPersonalWorkRow | undefined> =>
  db.libraryPersonalWorks.get(id)

export async function savePersonalWork(row: LibraryPersonalWorkRow): Promise<LibraryPersonalWorkRow> {
  await db.libraryPersonalWorks.put(row)
  return row
}

/**
 * Delete a document AND everything the reader wrote on it.
 *
 * The opposite of `deleteHighlight`'s reasoning, and deliberately: a note whose
 * highlight has gone is still a note about a rule that still exists, but a note
 * on a document that no longer exists can never be opened again. Leaving them
 * would put unreachable rows in My Study for ever.
 */
export async function deletePersonalWork(id: string): Promise<void> {
  await db.transaction(
    'rw',
    db.libraryPersonalWorks,
    db.libraryHighlights,
    db.libraryNotes,
    db.libraryBookmarks,
    db.libraryProgress,
    async () => {
      await db.libraryPersonalWorks.delete(id)
      await db.libraryHighlights.where('workId').equals(id).delete()
      await db.libraryNotes.where('workId').equals(id).delete()
      await db.libraryBookmarks.where('workId').equals(id).delete()
      await db.libraryProgress.where('workId').equals(id).delete()
    },
  )
}

// ------------------------------------------------------ export and import

export interface PersonalWorkFile {
  app: 'sahayak'
  kind: 'library-work'
  version: 1
  work: LibraryPersonalWorkRow
}

export const personalFileName = (row: LibraryPersonalWorkRow): string => `${row.id}.json`

export const toPersonalFile = (row: LibraryPersonalWorkRow): PersonalWorkFile => ({
  app: 'sahayak',
  kind: 'library-work',
  version: 1,
  work: row,
})

const isUnit = (value: unknown): boolean => {
  if (!value || typeof value !== 'object') return false
  const unit = value as Record<string, unknown>
  return (
    typeof unit.id === 'string' &&
    typeof unit.number === 'string' &&
    typeof unit.heading === 'string' &&
    typeof unit.text === 'string'
  )
}

/**
 * Read a shared personal work back.
 *
 * Validated field by field rather than cast, for the reason every other
 * import in this app gives: a file that came from somewhere else is untrusted
 * input, and this one is explicitly meant to be passed between people. A file
 * that does not parse returns `null` and the screen says so, rather than
 * producing a work whose units are `undefined`.
 *
 * The id is ALWAYS reissued. Two officers who both added the same PDF have two
 * documents with the same derived id, and importing one must not overwrite the
 * other's — along with every highlight and note keyed to it.
 */
export function parsePersonalFile(value: unknown, now = new Date()): LibraryPersonalWorkRow | null {
  if (!value || typeof value !== 'object') return null
  const file = value as Record<string, unknown>
  if (file.app !== 'sahayak' || file.kind !== 'library-work') return null

  const work = file.work as Record<string, unknown> | undefined
  if (!work || typeof work !== 'object') return null
  if (typeof work.title !== 'string' || !work.title.trim()) return null
  if (!Array.isArray(work.units) || work.units.length === 0 || !work.units.every(isUnit)) return null

  const language = work.language === 'hi' ? 'hi' : 'en'
  const unitWord = ['section', 'rule', 'paragraph', 'item'].includes(String(work.unitWord))
    ? (work.unitWord as LibraryPersonalWorkRow['unitWord'])
    : 'item'

  const id = personalWorkId(work.title)
  const units = (work.units as Array<Record<string, unknown>>).map((unit, index) => ({
    // Re-keyed under the new work id, so a unit id cannot point at the
    // document this file was exported from.
    id: `${id}-${index + 1}`,
    number: String(unit.number),
    heading: String(unit.heading),
    text: String(unit.text),
    division: typeof unit.division === 'string' ? unit.division : null,
  }))

  const divisions = Array.isArray(work.divisions)
    ? (work.divisions as Array<Record<string, unknown>>)
        .filter((division) => typeof division.label === 'string' && typeof division.from === 'number')
        .map((division) => ({
          label: String(division.label),
          title: typeof division.title === 'string' ? division.title : '',
          from: Math.max(0, Math.min(units.length, Number(division.from))),
        }))
    : []

  return {
    id,
    title: work.title.trim(),
    language,
    note: typeof work.note === 'string' ? work.note : '',
    unitWord,
    units,
    divisions,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  }
}
