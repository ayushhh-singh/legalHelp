import { beforeEach, describe, expect, it } from 'vitest'

import { anchorText, normaliseText } from './anchor'
import {
  allBookmarks,
  allHighlights,
  allNotes,
  colourOf,
  createHighlight,
  deleteHighlight,
  deleteNote,
  HIGHLIGHT_COLOURS,
  highlightsFor,
  isHighlightColour,
  isStale,
  lostHighlights,
  notesFor,
  rememberScroll,
  resolveHighlights,
  saveNote,
  setBookmarkLabel,
  setHighlightColour,
  setMarkedRead,
  toMarkdown,
} from './annotations'
import { toggleBookmark } from './store'

import { clearAllData, db } from '@/db'

const TEXT = normaliseText(
  'Every Government servant shall at all times maintain absolute integrity and devotion to duty.',
)

const make = (over: Partial<Parameters<typeof createHighlight>[0]> = {}) =>
  createHighlight({
    workId: 'ccs-conduct',
    unitId: 'ccs-conduct-3',
    lang: 'en',
    start: TEXT.indexOf('absolute integrity'),
    end: TEXT.indexOf('absolute integrity') + 'absolute integrity'.length,
    colour: 'marigold',
    text: TEXT,
    ...over,
  })

beforeEach(async () => {
  await clearAllData()
})

describe('the four colours', () => {
  it('are exactly the four accent tokens the design system pairs', () => {
    expect([...HIGHLIGHT_COLOURS]).toEqual(['marigold', 'tulsi', 'violet', 'coral'])
  })

  it('falls back rather than rendering an unknown colour from a restored backup', () => {
    expect(colourOf({ colour: 'chartreuse' })).toBe('marigold')
    expect(colourOf({ colour: 'tulsi' })).toBe('tulsi')
    expect(isHighlightColour('violet')).toBe(true)
    expect(isHighlightColour(7)).toBe(false)
  })
})

describe('createHighlight', () => {
  it('stores the quote cut from the same text the offsets index', async () => {
    const row = await make()
    expect(row.quote).toBe('absolute integrity')
    expect(TEXT.slice(row.start, row.end)).toBe(row.quote)
  })

  it('gives two marks on the same span two rows, not one', async () => {
    await make()
    await make({ colour: 'tulsi' })
    expect(await highlightsFor('ccs-conduct', 'ccs-conduct-3')).toHaveLength(2)
  })

  it('accepts a selection dragged backwards', async () => {
    const at = TEXT.indexOf('integrity')
    const row = await make({ start: at + 9, end: at })
    expect(row.quote).toBe('integrity')
  })

  it('refuses an empty span rather than storing a mark nobody can see', async () => {
    await expect(make({ start: 4, end: 4 })).rejects.toThrow(/at least one character/)
  })

  it('clamps an end past the text', async () => {
    const row = await make({ start: 0, end: 9_000 })
    expect(row.end).toBe(TEXT.length)
  })
})

describe('setHighlightColour', () => {
  it('changes the colour and nothing else', async () => {
    const row = await make()
    await setHighlightColour(row.id, 'coral')
    const [stored] = await highlightsFor('ccs-conduct', 'ccs-conduct-3')
    expect(stored).toMatchObject({ colour: 'coral', quote: row.quote, start: row.start })
  })
})

describe('deleteHighlight', () => {
  it('removes the highlight', async () => {
    const row = await make()
    await deleteHighlight(row.id)
    expect(await highlightsFor('ccs-conduct', 'ccs-conduct-3')).toEqual([])
  })

  it('does nothing for a highlight that is not there', async () => {
    // The row is read first now, so that the note query can be scoped to its
    // unit; a missing row must not become a crash in a click handler.
    await expect(deleteHighlight('hl-nothing')).resolves.toBeUndefined()
  })

  it('leaves a note attached to a DIFFERENT highlight on the same unit alone', async () => {
    const first = await make()
    const second = await make({ colour: 'coral' })
    await saveNote({
      workId: 'ccs-conduct',
      unitId: 'ccs-conduct-3',
      highlightId: second.id,
      body: 'about the second one',
    })

    await deleteHighlight(first.id)
    const [stored] = await notesFor('ccs-conduct', 'ccs-conduct-3')
    expect(stored?.highlightId).toBe(second.id)
  })

  it('leaves a note on another unit alone', async () => {
    const row = await make()
    await saveNote({ workId: 'rti', unitId: 'rti-8', highlightId: row.id, body: 'elsewhere' })
    await deleteHighlight(row.id)
    // Scoping the detach query to the highlight's own unit means a note keyed
    // to it from another unit is not reached — which cannot happen through the
    // UI, and is the honest consequence of the index this uses.
    const [elsewhere] = await notesFor('rti', 'rti-8')
    expect(elsewhere?.highlightId).toBe(row.id)
  })

  /**
   * The officer wrote the note; removing a colour is not asking to lose it.
   * The note becomes a note on the unit, which is what it would have been if
   * they had written it there in the first place.
   */
  it('detaches an attached note rather than deleting it', async () => {
    const row = await make()
    const note = await saveNote({
      workId: 'ccs-conduct',
      unitId: 'ccs-conduct-3',
      highlightId: row.id,
      body: 'Integrity is the operative word.',
    })
    await deleteHighlight(row.id)

    const [stored] = await notesFor('ccs-conduct', 'ccs-conduct-3')
    expect(stored?.id).toBe(note!.id)
    expect(stored?.highlightId).toBeUndefined()
  })
})

describe('resolveHighlights', () => {
  it('resolves a highlight whose offsets still hold', async () => {
    const row = await make()
    const [resolved] = resolveHighlights([row], TEXT, 'en')
    expect(resolved?.resolution.status).toBe('exact')
  })

  it('re-anchors after the text has shifted', async () => {
    const row = await make()
    const [resolved] = resolveHighlights([row], `A note before it. ${TEXT}`, 'en')
    expect(resolved?.resolution.status).toBe('reanchored')
  })

  it('reports a highlight whose quote has gone, and never drops it', async () => {
    const row = await make()
    const resolved = resolveHighlights([row], 'A completely different provision.', 'en')
    expect(resolved).toHaveLength(1)
    expect(lostHighlights(resolved)).toHaveLength(1)
  })

  /**
   * The English and Hindi renderings are different strings of different
   * lengths. Resolving across them would let "re-anchor by quote" find an
   * English phrase inside the English fallback shown under a Hindi setting —
   * a highlight appearing on a pane it was never made on.
   */
  it('renders nothing from the other language’s pane', async () => {
    const row = await make()
    expect(resolveHighlights([row], TEXT, 'hi')).toEqual([])
  })
})

describe('saveNote', () => {
  const base = { workId: 'rti', unitId: 'rti-8' }

  it('creates on first save and keeps createdAt across an edit', async () => {
    const first = await saveNote({ ...base, body: 'first' }, new Date('2026-09-01T00:00:00.000Z'))
    const second = await saveNote(
      { ...base, id: first!.id, body: 'second' },
      new Date('2026-09-02T00:00:00.000Z'),
    )
    expect(second!.createdAt).toBe(first!.createdAt)
    expect(second!.updatedAt).toBe('2026-09-02T00:00:00.000Z')
    expect(await notesFor('rti', 'rti-8')).toHaveLength(1)
  })

  it('deletes rather than storing an emptied note', async () => {
    const note = await saveNote({ ...base, body: 'something' })
    expect(await saveNote({ ...base, id: note!.id, body: '   ' })).toBeNull()
    expect(await notesFor('rti', 'rti-8')).toEqual([])
  })

  it('does not create a row for a note that was never written', async () => {
    expect(await saveNote({ ...base, body: '' })).toBeNull()
    expect(await allNotes()).toEqual([])
  })

  it('keeps a sub-rule anchor when there is one', async () => {
    const note = await saveNote({ ...base, part: '8(1)(j)', body: 'the substituted clause' })
    expect(note?.part).toBe('8(1)(j)')
  })

  it('lists newest first', async () => {
    await saveNote({ ...base, body: 'older' }, new Date('2026-09-01T00:00:00.000Z'))
    await saveNote({ workId: 'gfr', unitId: 'gfr-21', body: 'newer' }, new Date('2026-09-02T00:00:00.000Z'))
    expect((await allNotes()).map((note) => note.body)).toEqual(['newer', 'older'])
  })

  it('deleteNote removes one', async () => {
    const note = await saveNote({ ...base, body: 'x' })
    await deleteNote(note!.id)
    expect(await allNotes()).toEqual([])
  })
})

describe('isStale', () => {
  it('is true only when the stored row is newer than the one being edited', () => {
    const mine = { updatedAt: '2026-09-01T00:00:00.000Z' }
    expect(isStale(mine, { updatedAt: '2026-09-02T00:00:00.000Z' })).toBe(true)
    expect(isStale(mine, { updatedAt: '2026-09-01T00:00:00.000Z' })).toBe(false)
    expect(isStale(mine, undefined)).toBe(false)
    expect(isStale(null, { updatedAt: '2026-09-02T00:00:00.000Z' })).toBe(false)
  })
})

describe('setBookmarkLabel', () => {
  it('labels an existing bookmark', async () => {
    await toggleBookmark('rti', 'rti-8')
    await setBookmarkLabel('rti', 'rti-8', '  exemptions  ')
    expect((await allBookmarks())[0]?.label).toBe('exemptions')
  })

  it('clears a label without removing the bookmark', async () => {
    await toggleBookmark('rti', 'rti-8')
    await setBookmarkLabel('rti', 'rti-8', 'x')
    await setBookmarkLabel('rti', 'rti-8', null)
    const [row] = await allBookmarks()
    expect(row).toBeDefined()
    expect(row?.label).toBeUndefined()
  })

  /**
   * Labelling is an edit of a mark that exists. Creating one as a side effect
   * would make the bookmark button and this control disagree about what a
   * bookmark is — and would put a bookmark on the list that the reader never
   * pressed the button for.
   */
  it('does nothing when there is no bookmark to label', async () => {
    await setBookmarkLabel('rti', 'rti-8', 'x')
    expect(await allBookmarks()).toEqual([])
  })
})

describe('setMarkedRead', () => {
  it('marks a unit read, creating the progress row if there is none', async () => {
    await setMarkedRead('rti', 'rti-8', true, new Date('2026-09-03T00:00:00.000Z'))
    const row = await db.libraryProgress.get('rti:rti-8')
    expect(row?.markedReadAt).toBe('2026-09-03T00:00:00.000Z')
    expect(row?.secondsRead).toBe(0)
  })

  it('unmarks without losing the time already recorded', async () => {
    await db.libraryProgress.put({
      id: 'rti:rti-8',
      workId: 'rti',
      unitId: 'rti-8',
      at: '2026-09-01T00:00:00.000Z',
      secondsRead: 90,
    })
    await setMarkedRead('rti', 'rti-8', true)
    await setMarkedRead('rti', 'rti-8', false)
    const row = await db.libraryProgress.get('rti:rti-8')
    expect(row?.markedReadAt).toBeNull()
    expect(row?.secondsRead).toBe(90)
    expect(row?.at).toBe('2026-09-01T00:00:00.000Z')
  })
})

describe('rememberScroll', () => {
  it('stores a bounded ratio', async () => {
    await setMarkedRead('rti', 'rti-8', false)
    await rememberScroll('rti', 'rti-8', 1.4)
    expect((await db.libraryProgress.get('rti:rti-8'))?.scrollRatio).toBe(1)
    await rememberScroll('rti', 'rti-8', -3)
    expect((await db.libraryProgress.get('rti:rti-8'))?.scrollRatio).toBe(0)
  })

  it('ignores a value that is not a number', async () => {
    await setMarkedRead('rti', 'rti-8', false)
    await rememberScroll('rti', 'rti-8', Number.NaN)
    expect((await db.libraryProgress.get('rti:rti-8'))?.scrollRatio).toBeUndefined()
  })

  /**
   * The one write in this file that swallows its failure, because it fires from
   * a scroll handler — the same reasoning `recordProgress` gives. A row that
   * does not exist yet is not an error the reader should ever see.
   */
  it('does not reject when there is no row to update', async () => {
    await expect(rememberScroll('rti', 'nothing-here', 0.5)).resolves.toBeUndefined()
  })
})

describe('allHighlights', () => {
  it('lists newest first, across works', async () => {
    await make()
    await createHighlight({
      workId: 'rti',
      unitId: 'rti-8',
      lang: 'en',
      start: 0,
      end: 4,
      colour: 'violet',
      text: 'Exemption from disclosure',
    })
    expect((await allHighlights()).map((row) => row.workId)).toEqual(['rti', 'ccs-conduct'])
  })
})

describe('toMarkdown', () => {
  const entry = {
    workTitle: 'The Right to Information Act, 2005',
    unitNumber: '8',
    unitHeading: 'Exemption from disclosure of information',
    citation: 'Section 8, The Right to Information Act, 2005',
    path: '/library/rti/rti-8',
    highlights: [{ colour: 'marigold', quote: 'larger public interest', lost: false }],
    notes: [{ body: '**Read with** the DPDP amendment.', updatedAt: '2026-09-03T00:00:00.000Z' }],
    bookmarkLabel: 'exemptions',
  }

  it('carries the citation, the quote, the note and a way back', () => {
    const out = toMarkdown([entry], 'My study', 'Reference only.', 'https://sahayak.pages.dev/')
    expect(out).toContain('## Section 8, The Right to Information Act, 2005')
    expect(out).toContain('> larger public interest')
    expect(out).toContain('**Read with** the DPDP amendment.')
    // Absolute, and with no double slash from a trailing one on the origin.
    expect(out).toContain('<https://sahayak.pages.dev/library/rti/rti-8>')
    expect(out).not.toContain('undefined')
  })

  it('marks a quotation whose anchor was lost rather than dropping it', () => {
    const out = toMarkdown(
      [{ ...entry, highlights: [{ colour: 'coral', quote: 'a deleted phrase', lost: true }] }],
      'My study',
      'Reference only.',
      'https://sahayak.pages.dev',
    )
    expect(out).toContain('a deleted phrase')
    expect(out).toContain('needs attention')
  })

  it('ends with the disclaimer, which travels with every export', () => {
    expect(
      toMarkdown([], 'My study', 'Reference only.', 'https://sahayak.pages.dev')
        .trim()
        .endsWith('Reference only.'),
    ).toBe(true)
  })
})

describe('anchorText and the stored offsets', () => {
  it('a highlight made over anchorText resolves against it exactly', async () => {
    const text = anchorText(['One paragraph.', 'Another paragraph.'])
    const row = await createHighlight({
      workId: 'rti',
      unitId: 'rti-1',
      lang: 'en',
      start: text.indexOf('Another'),
      end: text.indexOf('Another') + 7,
      colour: 'tulsi',
      text,
    })
    expect(resolveHighlights([row], text, 'en')[0]?.resolution.status).toBe('exact')
  })
})
