import { beforeEach, describe, expect, it } from 'vitest'

import {
  buildPersonalCorpus,
  deletePersonalWork,
  fromDataset,
  fromPersonal,
  getPersonalWork,
  isPersonalWorkId,
  listPersonalWorks,
  parsePersonalFile,
  personalFileName,
  personalWorkId,
  savePersonalWork,
  toPersonalFile,
  UNIT_WORDS,
} from './personal'
import { splitDocument } from './split'
import { createHighlight, saveNote } from './annotations'
import { WORK_IDS } from './data'

import { clearAllData, db, type LibraryPersonalWorkRow } from '@/db'
import { libraryWorkSchema } from '@/schemas/library'
import { readFromRoot } from '@/test/paths'

const row = (over: Partial<LibraryPersonalWorkRow> = {}): LibraryPersonalWorkRow => ({
  id: 'my-office-order-abc',
  title: 'Office order on flexible hours',
  language: 'en',
  note: 'Circulated by the administration wing, March 2026.',
  unitWord: 'paragraph',
  units: [
    {
      id: 'my-office-order-abc-1',
      number: '1',
      heading: 'Application',
      text: 'This order applies to all staff.',
      division: null,
    },
    {
      id: 'my-office-order-abc-2',
      number: '2',
      heading: '',
      text: 'Working hours are 9 to 5.30.',
      division: null,
    },
  ],
  divisions: [],
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  ...over,
})

beforeEach(async () => {
  await clearAllData()
})

describe('personalWorkId', () => {
  it('is readable where the title allows it', () => {
    expect(personalWorkId('Office Order on Flexible Hours', 'x1')).toBe(
      'my-office-order-on-flexible-hours-x1',
    )
  })

  /**
   * A title written entirely in Devanagari slugifies to nothing, and readers of
   * this app write titles in Devanagari. Without the fallback the id would be
   * `my--x1` for every one of them, which is one id for every such document.
   */
  it('falls back to a stable name for a Devanagari title', () => {
    expect(personalWorkId('कार्यालय आदेश', 'x1')).toBe('my-work-x1')
  })

  /**
   * The one guarantee that keeps a reader's own document out of the dataset
   * namespace. `WORK_IDS` is the real list, so this cannot pass by agreeing
   * with a copy of it.
   */
  it('can never collide with a bundled work id', () => {
    for (const id of WORK_IDS) expect(isPersonalWorkId(id)).toBe(false)
    expect(isPersonalWorkId(personalWorkId('rti'))).toBe(true)
  })
})

describe('fromPersonal', () => {
  it('is marked as the reader’s own, with no source and no official text', () => {
    const work = fromPersonal(row())
    expect(work.origin).toBe('personal')
    expect(work.source).toBeNull()
    expect(work.officialUrl).toBeNull()
    // Nobody checked it against a gazette and this app has no idea what it is.
    expect(work.verify).toBe(true)
  })

  it('uses the unit word the reader chose', () => {
    expect(fromPersonal(row()).unitLabel).toEqual(UNIT_WORDS.paragraph)
    expect(fromPersonal(row({ unitWord: 'rule' })).unitLabel).toEqual(UNIT_WORDS.rule)
  })

  it('builds a flat contents list when the document has no divisions', () => {
    const work = fromPersonal(row())
    expect(work.tocSource).toBe('flat')
    expect(work.toc).toHaveLength(2)
    expect(work.readingOrder).toEqual(['my-office-order-abc-1', 'my-office-order-abc-2'])
  })

  it('quotes the opening for a unit with no heading, and nothing for one with', () => {
    const [first, second] = fromPersonal(row()).toc
    expect(first?.excerpt).toBeUndefined()
    expect(second?.excerpt?.en).toContain('Working hours')
  })

  it('groups by division and covers every unit', () => {
    const work = fromPersonal(
      row({
        divisions: [{ label: 'PART I', title: 'Preliminary', from: 0 }],
      }),
    )
    expect(work.tocSource).toBe('chapters')
    expect(work.toc[0]?.unitIds).toEqual(work.readingOrder)
  })

  /**
   * ADR-038's both-directions rule, applied to a document this app did not
   * write: a unit missing from the contents is a unit nobody can navigate to.
   * Units sitting before the first division are exactly where that happens.
   */
  it('keeps a unit that falls before the first division', () => {
    const work = fromPersonal(row({ divisions: [{ label: 'PART I', title: '', from: 1 }] }))
    const inToc = work.toc.flatMap((node) => node.unitIds)
    expect([...inToc].sort()).toEqual([...work.readingOrder].sort())
  })
})

describe('fromDataset', () => {
  it('marks a bundled work as a dataset and keeps its citation', () => {
    const rti = libraryWorkSchema.parse(JSON.parse(readFromRoot('data/library/works/rti.json')))
    const work = fromDataset(rti)
    expect(work.origin).toBe('dataset')
    expect(work.source?.url).toMatch(/^https:\/\//)
    expect(work.officialUrl).toMatch(/^https:\/\//)
  })
})

describe('buildPersonalCorpus', () => {
  it('puts the text in the document’s own language and leaves the other empty', () => {
    const corpus = buildPersonalCorpus(
      row({
        language: 'hi',
        units: [{ id: 'u1', number: '1', heading: 'शीर्षक', text: 'यह आदेश सब पर लागू है।', division: null }],
      }),
    )
    const unit = corpus.units.get('u1')!
    expect(unit.body.hi).toEqual(['यह आदेश सब पर लागू है।'])
    // Empty, so the reader shows its "not available" notice rather than
    // silently rendering the other language — the same rule the bundled works
    // are held to.
    expect(unit.body.en).toEqual([])
  })

  it('keeps the line breaks the document was pasted with', () => {
    const corpus = buildPersonalCorpus(
      row({
        units: [{ id: 'u1', number: '1', heading: '', text: 'One line.\n\nAnother line.', division: null }],
      }),
    )
    expect(corpus.units.get('u1')?.body.en).toEqual(['One line.', 'Another line.'])
  })

  it('cites with the reader’s own unit word and title', () => {
    const corpus = buildPersonalCorpus(row())
    expect(corpus.units.get('my-office-order-abc-1')?.citation.en).toBe(
      'Paragraph 1, Office order on flexible hours',
    )
  })

  it('renders no sub-rule parts, because nothing re-segmented them', () => {
    expect(buildPersonalCorpus(row()).units.get('my-office-order-abc-1')?.parts).toEqual([])
  })
})

describe('persistence', () => {
  it('saves, reads back and lists newest first', async () => {
    await savePersonalWork(row())
    await savePersonalWork(row({ id: 'my-second-x', title: 'Second', updatedAt: '2026-09-02T00:00:00.000Z' }))
    expect((await listPersonalWorks()).map((work) => work.id)).toEqual(['my-second-x', 'my-office-order-abc'])
    expect((await getPersonalWork('my-office-order-abc'))?.title).toBe('Office order on flexible hours')
  })

  /**
   * The opposite of `deleteHighlight`'s reasoning, deliberately: a note whose
   * highlight is gone is still about a rule that exists, but a note on a
   * document that no longer exists can never be opened again.
   */
  it('deleting a document takes everything written on it', async () => {
    await savePersonalWork(row())
    await createHighlight({
      workId: 'my-office-order-abc',
      unitId: 'my-office-order-abc-1',
      lang: 'en',
      start: 0,
      end: 4,
      colour: 'tulsi',
      text: 'This order applies to all staff.',
    })
    await saveNote({ workId: 'my-office-order-abc', unitId: 'my-office-order-abc-1', body: 'note' })
    await db.libraryBookmarks.put({
      id: 'my-office-order-abc:my-office-order-abc-1',
      workId: 'my-office-order-abc',
      unitId: 'my-office-order-abc-1',
      createdAt: '2026-09-01T00:00:00.000Z',
    })
    await db.libraryProgress.put({
      id: 'my-office-order-abc:my-office-order-abc-1',
      workId: 'my-office-order-abc',
      unitId: 'my-office-order-abc-1',
      at: '2026-09-01T00:00:00.000Z',
      secondsRead: 5,
    })

    await deletePersonalWork('my-office-order-abc')

    expect(await listPersonalWorks()).toEqual([])
    expect(await db.libraryHighlights.count()).toBe(0)
    expect(await db.libraryNotes.count()).toBe(0)
    expect(await db.libraryBookmarks.count()).toBe(0)
    expect(await db.libraryProgress.count()).toBe(0)
  })

  it('leaves another document’s annotations alone', async () => {
    await savePersonalWork(row())
    await saveNote({ workId: 'rti', unitId: 'rti-8', body: 'about a bundled work' })
    await deletePersonalWork('my-office-order-abc')
    expect(await db.libraryNotes.count()).toBe(1)
  })
})

describe('export and import', () => {
  it('round-trips a document', () => {
    const file = toPersonalFile(row())
    const parsed = parsePersonalFile(JSON.parse(JSON.stringify(file)))
    expect(parsed?.title).toBe('Office order on flexible hours')
    expect(parsed?.units).toHaveLength(2)
    expect(parsed?.unitWord).toBe('paragraph')
    expect(personalFileName(row())).toBe('my-office-order-abc.json')
  })

  /**
   * Two officers who both added the same PDF have two documents with the same
   * derived id. Importing one must not overwrite the other's — along with every
   * highlight and note keyed to it.
   */
  it('reissues the id and re-keys every unit', () => {
    const parsed = parsePersonalFile(toPersonalFile(row()), new Date('2026-09-05T00:00:00.000Z'))
    expect(parsed?.id).not.toBe('my-office-order-abc')
    expect(parsed?.units.every((unit) => unit.id.startsWith(parsed.id))).toBe(true)
  })

  it.each([
    ['null', null],
    ['a string', 'not a file'],
    ['another app', { app: 'somebody-else', kind: 'library-work', work: {} }],
    ['another kind', { app: 'sahayak', kind: 'backup', work: {} }],
    ['no work', { app: 'sahayak', kind: 'library-work' }],
    ['no title', { app: 'sahayak', kind: 'library-work', work: { units: [] } }],
    ['no units', { app: 'sahayak', kind: 'library-work', work: { title: 'x', units: [] } }],
    [
      'a unit that is not a unit',
      { app: 'sahayak', kind: 'library-work', work: { title: 'x', units: [{ number: 1 }] } },
    ],
  ])('refuses %s', (_label, value) => {
    expect(parsePersonalFile(value)).toBeNull()
  })

  it('falls back to a safe unit word rather than trusting the file', () => {
    const file = toPersonalFile(row())
    const tampered = { ...file, work: { ...file.work, unitWord: 'constitution' } }
    expect(parsePersonalFile(tampered)?.unitWord).toBe('item')
  })

  it('clamps a division index that points past the end', () => {
    const file = toPersonalFile(row({ divisions: [{ label: 'PART I', title: '', from: 900 }] }))
    expect(parsePersonalFile(file)?.divisions[0]?.from).toBe(2)
  })
})

describe('a split document becomes a personal work', () => {
  it('carries the splitter’s divisions and units through unchanged', () => {
    const result = splitDocument(
      'CHAPTER I\nPRELIMINARY\n\n1. Short title.—These rules apply.\n\n2. Scope.—To all.',
    )
    const id = personalWorkId('Model rules', 'z')
    const work = fromPersonal(
      row({
        id,
        units: result.units.map((unit, index) => ({ ...unit, id: `${id}-${index + 1}` })),
        divisions: result.divisions,
      }),
    )
    expect(work.tocSource).toBe('chapters')
    expect(work.toc[0]?.number).toBe('CHAPTER I')
    expect(work.readingOrder).toHaveLength(result.units.length)
  })
})
