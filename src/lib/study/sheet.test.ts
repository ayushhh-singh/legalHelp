import { describe, expect, it } from 'vitest'

import { hasContent, sheetFor, type SheetInput } from './sheet'
import type { Chapter } from './types'

import type { LibraryHighlightRow, LibraryNoteRow } from '@/db'
import type { LibraryUnit } from '@/lib/library'
import type { QuickRefRecord, StudyAid } from '@/schemas/library'

const bi = (en: string) => ({ en, hi: `${en} (हिंदी)` })

const unit = (id: string, number: string, heading = `Heading ${number}`): LibraryUnit => ({
  id,
  number,
  heading: { en: heading, hi: `${heading} हिंदी` },
  excerpt: null,
  body: { en: [`Body of ${number}.`], hi: [] },
  parts: [],
  chapter: null,
  citation: bi(`Rule ${number}`),
  repealedRefs: [],
})

const aid = (unitId: string, over: Partial<StudyAid> = {}): StudyAid => ({
  id: `aid-${unitId}`,
  workId: 'w',
  unitId,
  explanation: bi('What it requires.'),
  example: bi('A situation.'),
  connects: [],
  reviewed: true,
  reviewState: 'approved',
  generationMeta: {
    promptVersion: 'v1',
    batchId: 'b',
    stageA: { index: 1, angle: 'a' },
    critic: { verdict: 'approve', reason: 'ok' },
    verify: { grounded: true, note: 'ok' },
    dedup: { maxScore: 0, verdict: 'keep' },
    groundingUnitIds: [unitId],
  },
  source: { name: 'Src', url: 'https://example.gov.in/x' },
  verify: true,
  ...over,
})

const chapter: Chapter = {
  id: 'w:ch',
  workId: 'w',
  nodeId: 'ch',
  number: 'I',
  heading: bi('Chapter one'),
  unitIds: ['u1', 'u2', 'u3'],
}

const units = new Map([
  ['u1', unit('u1', '1')],
  ['u2', unit('u2', '2')],
  ['u3', unit('u3', '3')],
])

const highlight = (unitId: string): LibraryHighlightRow => ({
  id: `h-${unitId}`,
  workId: 'w',
  unitId,
  lang: 'en',
  start: 0,
  end: 4,
  quote: 'Body',
  colour: 'marigold',
  createdAt: '2026-09-03T00:00:00.000Z',
})

const note = (unitId: string): LibraryNoteRow => ({
  id: `n-${unitId}`,
  workId: 'w',
  unitId,
  body: 'my note',
  createdAt: '2026-09-03T00:00:00.000Z',
  updatedAt: '2026-09-03T00:00:00.000Z',
})

const quickRef = (unitId: string, kind: QuickRefRecord['kind']): QuickRefRecord => ({
  unitId,
  unitNumber: '1',
  kind,
  value: kind === 'time' ? '30 days' : kind === 'money' ? 'Rs. 25,000' : 'the prescribed authority',
  sortKey: kind === 'authority' ? 'a' : 30,
  quote: 'quoted',
  verify: false,
})

const input = (over: Partial<SheetInput> = {}): SheetInput => ({
  chapter,
  units,
  aids: [],
  highlights: [],
  notes: [],
  quickRef: [],
  language: 'en',
  ...over,
})

describe('sheetFor — the full sheet', () => {
  it('assembles aids, annotations and quick-reference rows per unit', () => {
    const sheet = sheetFor(
      input({
        aids: [aid('u1')],
        highlights: [highlight('u2')],
        notes: [note('u3')],
        quickRef: [quickRef('u1', 'time')],
      }),
    )
    expect(sheet.entries.map((entry) => entry.unitId)).toEqual(['u1', 'u2', 'u3'])
    expect(sheet.entries[0]?.aid?.unitId).toBe('u1')
    expect(sheet.entries[1]?.highlights).toHaveLength(1)
    expect(sheet.entries[2]?.notes).toHaveLength(1)
    expect(sheet.counts).toEqual({ aids: 1, highlights: 1, notes: 1, quickRef: 1 })
  })

  it('keeps the chapter’s own unit order', () => {
    const sheet = sheetFor(input({ aids: [aid('u3'), aid('u1'), aid('u2')] }))
    expect(sheet.entries.map((entry) => entry.unitId)).toEqual(['u1', 'u2', 'u3'])
  })

  it('drops a unit that would print nothing, and says how many', () => {
    const sheet = sheetFor(input({ aids: [aid('u2')] }))
    expect(sheet.entries.map((entry) => entry.unitId)).toEqual(['u2'])
    expect(sheet.skipped).toBe(2)
  })

  it('skips a unit the corpus does not have without counting it as skipped', () => {
    const sheet = sheetFor(input({ chapter: { ...chapter, unitIds: ['u1', 'gone'] }, aids: [aid('u1')] }))
    expect(sheet.entries).toHaveLength(1)
    expect(sheet.skipped).toBe(0)
  })

  it('labels a unit through unitLabel, and reports the language it got back', () => {
    const noHeading = { ...unit('u1', '1'), heading: { en: '', hi: '' }, excerpt: bi('An opening quotation') }
    const sheet = sheetFor(
      input({
        units: new Map([['u1', noHeading]]),
        chapter: { ...chapter, unitIds: ['u1'] },
        aids: [aid('u1')],
      }),
    )
    expect(sheet.entries[0]?.headingIsExcerpt).toBe(true)
    expect(sheet.entries[0]?.headingLang).toBe('en')
  })

  it('takes the reader’s language for the heading', () => {
    const sheet = sheetFor(input({ language: 'hi', aids: [aid('u1')] }))
    expect(sheet.entries[0]?.heading).toContain('हिंदी')
  })
})

describe('sheetFor — 24-hour mode', () => {
  it('drops an aid with no misconception, because nothing of it would print', () => {
    const sheet = sheetFor(input({ aids: [aid('u1')], mode: 'twentyFourHour' }))
    expect(sheet.entries).toEqual([])
    expect(sheet.skipped).toBe(3)
  })

  it('keeps an aid that has one', () => {
    const withTrap = aid('u1', { misconception: bi('The trap.') })
    const sheet = sheetFor(input({ aids: [withTrap], mode: 'twentyFourHour' }))
    expect(sheet.entries).toHaveLength(1)
    expect(sheet.entries[0]?.aid?.misconception).toBeDefined()
  })

  it('keeps limits and drops named authorities', () => {
    const sheet = sheetFor(
      input({
        quickRef: [quickRef('u1', 'time'), quickRef('u1', 'money'), quickRef('u1', 'authority')],
        mode: 'twentyFourHour',
      }),
    )
    expect(sheet.entries[0]?.quickRef.map((row) => row.kind)).toEqual(['time', 'money'])
  })

  it('keeps the reader’s own notes and highlights', () => {
    const sheet = sheetFor(
      input({ notes: [note('u2')], highlights: [highlight('u3')], mode: 'twentyFourHour' }),
    )
    expect(sheet.entries.map((entry) => entry.unitId)).toEqual(['u2', 'u3'])
  })

  it('reports its own mode back', () => {
    expect(sheetFor(input({ mode: 'twentyFourHour' })).mode).toBe('twentyFourHour')
    expect(sheetFor(input()).mode).toBe('full')
  })
})

describe('hasContent', () => {
  it('is false for a chapter with nothing to print', () => {
    expect(hasContent(sheetFor(input()))).toBe(false)
  })

  it('is true once there is anything at all', () => {
    expect(hasContent(sheetFor(input({ notes: [note('u1')] })))).toBe(true)
  })
})
