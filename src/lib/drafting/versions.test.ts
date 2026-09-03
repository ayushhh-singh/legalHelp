import { describe, expect, it } from 'vitest'

import { emptyMeta, newDoc, type BodyDoc, type OfficialDoc } from './model'
import {
  AUTO_SNAPSHOT_EVERY,
  VERSION_CAP,
  commentIsAnchored,
  diffDocuments,
  prune,
  restoreInto,
  shouldAutoSnapshot,
  type DocComment,
  type DocVersion,
} from './versions'

const body = (...paras: string[]): BodyDoc => ({
  type: 'doc',
  content: paras.map((text) => ({
    type: 'numberedPara',
    attrs: { level: 1 },
    content: [{ type: 'text', text }],
  })),
})

const doc = (over: { body?: BodyDoc; meta?: Partial<OfficialDoc['meta']> } = {}): OfficialDoc =>
  newDoc({
    id: 'd1',
    templateId: 'office-memorandum',
    lang: 'en',
    at: '2026-09-01T00:00:00.000Z',
    meta: { ...emptyMeta(), number: 'A-1/2026', subject: { en: 'A subject', hi: 'एक विषय' }, ...over.meta },
    body: over.body ?? body('One.', 'Two.', 'Three.'),
  })

const version = (id: string, at: string, reason: DocVersion['reason'] = 'auto'): DocVersion => ({
  id,
  docId: 'd1',
  at,
  reason,
  label: '',
  doc: doc(),
})

describe('snapshot policy', () => {
  it('fires on every twentieth edit and not in between', () => {
    expect(shouldAutoSnapshot(0)).toBe(false)
    expect(shouldAutoSnapshot(19)).toBe(false)
    expect(shouldAutoSnapshot(AUTO_SNAPSHOT_EVERY)).toBe(true)
    expect(shouldAutoSnapshot(AUTO_SNAPSHOT_EVERY * 2)).toBe(true)
    expect(shouldAutoSnapshot(AUTO_SNAPSHOT_EVERY + 1)).toBe(false)
  })

  it('keeps thirty, newest first, and prunes the oldest', () => {
    const many = Array.from({ length: 40 }, (_, index) =>
      version(`v${index}`, `2026-09-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`),
    )
    const kept = prune(many)
    expect(kept).toHaveLength(VERSION_CAP)
    expect(kept[0]?.id).toBe('v39')
    expect(kept.at(-1)?.id).toBe('v10')
  })

  it('does NOT protect a labelled version from the cap', () => {
    // Deliberate: protecting one would make the cap unbounded in exactly the
    // case where an officer has been diligent about saving versions.
    const many = [
      { ...version('old', '2026-01-01T00:00:00.000Z', 'manual'), label: 'important' },
      ...Array.from({ length: 40 }, (_, index) =>
        version(`v${index}`, `2026-09-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`),
      ),
    ]
    expect(prune(many).some((entry) => entry.id === 'old')).toBe(false)
  })
})

describe('diffDocuments', () => {
  it('says nothing changed for two identical documents', () => {
    const result = diffDocuments(doc(), doc())
    expect(result.changed).toBe(false)
    expect(result.blocks.every((block) => block.kind === 'unchanged')).toBe(true)
  })

  it('reports an inserted paragraph as an addition and leaves the rest alone', () => {
    const result = diffDocuments(doc(), doc({ body: body('One.', 'One and a half.', 'Two.', 'Three.') }))
    expect(result.blocks.map((block) => block.kind)).toEqual(['unchanged', 'added', 'unchanged', 'unchanged'])
    expect(result.changed).toBe(true)
  })

  it('reports a deleted paragraph as a removal', () => {
    const result = diffDocuments(doc(), doc({ body: body('One.', 'Three.') }))
    expect(result.blocks.map((block) => block.kind)).toEqual(['unchanged', 'removed', 'unchanged'])
  })

  it('diffs a changed paragraph word by word, EXACTLY', () => {
    const result = diffDocuments(doc(), doc({ body: body('One.', 'Two, amended.', 'Three.') }))
    const changed = result.blocks.find((block) => block.kind === 'changed')
    expect(changed).toBeDefined()
    if (changed?.kind !== 'changed') throw new Error('expected a changed block')
    expect(changed.before).toContain('Two.')
    expect(changed.after).toContain('Two, amended.')
    // `exact: true` — a capital letter or a comma IS a change when what you are
    // looking at is two versions of your own document (ADR-032's lesson about
    // `diffWords`'s default folding).
    expect(changed.words?.some((part) => part.op !== 'equal')).toBe(true)
  })

  it('reports changed meta fields with both sides', () => {
    const result = diffDocuments(doc(), doc({ meta: { number: 'A-2/2026' } }))
    expect(result.meta).toEqual([{ field: 'number', before: 'A-1/2026', after: 'A-2/2026' }])
    expect(result.changed).toBe(true)
  })

  it('diffs the Hindi side when asked', () => {
    const hindi = doc()
    hindi.bodyHi = body('एक।')
    const other = doc()
    other.bodyHi = body('दो।')
    const result = diffDocuments(hindi, other, 'hi')
    expect(result.changed).toBe(true)
    expect(result.blocks.some((block) => block.kind === 'changed')).toBe(true)
  })

  it('reports a very long paragraph as changed with `words: null` rather than freezing', () => {
    const long = (word: string) => Array.from({ length: 3000 }, () => word).join(' ')
    const result = diffDocuments(doc({ body: body(long('a')) }), doc({ body: body(long('b')) }))
    const changed = result.blocks.find((block) => block.kind === 'changed')
    if (changed?.kind !== 'changed') throw new Error('expected a changed block')
    expect(changed.words).toBeNull()
  })
})

describe('restoreInto', () => {
  it('keeps the live identity and moves updatedAt', () => {
    const live = { ...doc(), id: 'live', createdAt: '2026-01-01T00:00:00.000Z', status: 'final' as const }
    const restored = restoreInto(live, version('v1', '2026-05-01T00:00:00.000Z'), '2026-09-03T12:00:00.000Z')
    expect(restored.id).toBe('live')
    expect(restored.createdAt).toBe('2026-01-01T00:00:00.000Z')
    expect(restored.updatedAt).toBe('2026-09-03T12:00:00.000Z')
    // A document restored to an earlier state is not the thing that was final.
    expect(restored.status).toBe('draft')
  })

  it('leaves a SENT document sent — restoring does not un-send anything', () => {
    const live = { ...doc(), status: 'sent' as const }
    expect(
      restoreInto(live, version('v1', '2026-05-01T00:00:00.000Z'), '2026-09-03T12:00:00.000Z').status,
    ).toBe('sent')
  })

  it("takes the version's content", () => {
    const old = { ...version('v1', '2026-05-01T00:00:00.000Z'), doc: doc({ body: body('The old wording.') }) }
    const restored = restoreInto(doc(), old, '2026-09-03T12:00:00.000Z')
    expect(JSON.stringify(restored.body)).toContain('The old wording.')
  })
})

describe('commentIsAnchored', () => {
  const comment = (over: Partial<DocComment> = {}): DocComment => ({
    id: 'c1',
    docId: 'd1',
    blockIndex: 1,
    blockText: '2. Two.',
    text: 'check this',
    resolved: false,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...over,
  })

  it('is anchored while the paragraph still says what it said', () => {
    expect(commentIsAnchored(comment(), body('One.', 'Two.', 'Three.'))).toBe(true)
  })

  it('is NOT anchored once the paragraph at that index has changed', () => {
    expect(commentIsAnchored(comment(), body('One.', 'Two, amended.', 'Three.'))).toBe(false)
  })

  it('is not anchored when the paragraph has gone', () => {
    expect(commentIsAnchored(comment(), body('One.'))).toBe(false)
  })
})
