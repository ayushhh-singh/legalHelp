import { readdirSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { AID_WORK_IDS } from '@/lib/library'
import { libraryAidsSchema, isAidServed, type LibraryAids, type StudyAid } from '@/schemas/library'
import type { LibraryWork } from '@/schemas/library'
import { fromRoot, readFromRoot } from '@/test/paths'

/**
 * The committed bytes of `data/library/aids`, read off disk — the arrangement
 * every other dataset suite in this repository uses.
 *
 * Two assertions carry the weight, and they are the two an aid can silently
 * fail. The first is the POINTER, the same claim `tests/library-data.test.ts`
 * makes about a work: an aid names a `unitId`, every id in `connects`, and
 * every id in `generationMeta.groundingUnitIds`, and each of those has to
 * resolve into the corpus the WORK points at. An aid attached to a rule that
 * no longer exists renders nothing and reports nothing.
 *
 * The second is that a SERVED aid is fully bilingual. `data/library/aids` is
 * this project's own writing rather than a transcription, so there is no
 * "the source publishes no Hindi" excuse available here: an aid whose Hindi
 * has not been written is `needs-hindi` and is not served, exactly as a
 * Trainer card is (`docs/AUTHORING.md`).
 */

const AIDS_DIR = 'data/library/aids'
const WORKS_DIR = 'data/library/works'

const readJson = <T>(path: string): T => JSON.parse(readFromRoot(path)) as T

const fileIds = readdirSync(fromRoot(AIDS_DIR))
  .filter((name) => name.endsWith('.json'))
  .map((name) => name.replace(/\.json$/, ''))
  .sort()

const files = new Map<string, LibraryAids>(
  fileIds.map((id) => [id, readJson<LibraryAids>(`${AIDS_DIR}/${id}.json`)]),
)

const allAids: StudyAid[] = fileIds.flatMap((id) => files.get(id)?.aids ?? [])
const served = allAids.filter(isAidServed)

/** Every unit id the corpus a work points at actually has. */
function corpusUnitIds(workId: string): Set<string> {
  const work = readJson<LibraryWork>(`${WORKS_DIR}/${workId}.json`)
  const raw = readJson<unknown>(`data/${work.corpus.file}`)
  if (work.corpus.kind === 'law') {
    return new Set(Object.keys((raw as { sections: Record<string, unknown> }).sections))
  }
  return new Set((raw as { rules: { id: string }[] }).rules.map((rule) => rule.id))
}

const DEVANAGARI = /[ऀ-ॿ]/

describe('data/library/aids', () => {
  it('is the set of files the loader map names, and nothing else', () => {
    // `AID_WORK_IDS` drives the `?raw` imports. A file on disk that the map
    // does not name reaches no reader; a name in the map with no file rejects
    // at parse time, which nothing in jsdom would surface.
    expect(fileIds).toEqual([...AID_WORK_IDS].sort())
  })

  it.each(fileIds)('%s validates against the zod schema', (id) => {
    expect(() => libraryAidsSchema.parse(files.get(id))).not.toThrow()
  })

  it.each(fileIds)('%s declares the work it belongs to', (id) => {
    expect(files.get(id)?.workId).toBe(id)
    for (const aid of files.get(id)?.aids ?? []) expect(aid.workId).toBe(id)
  })

  it('serves at least the 220 aids this session was asked for', () => {
    expect(served.length).toBeGreaterThanOrEqual(220)
  })

  it('gives every aid a unique id across every work', () => {
    const ids = allAids.map((aid) => aid.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('gives every unit at most one aid within a work', () => {
    for (const id of fileIds) {
      const units = (files.get(id)?.aids ?? []).map((aid) => aid.unitId)
      expect(new Set(units).size, `${id} has two aids for one unit`).toBe(units.length)
    }
  })

  // ---------------------------------------------------------------- pointers

  it.each(fileIds)('%s resolves every unit id into the pointed-at corpus', (id) => {
    const known = corpusUnitIds(id)
    for (const aid of files.get(id)?.aids ?? []) {
      expect(known.has(aid.unitId), `${aid.id}: unitId ${aid.unitId}`).toBe(true)
      for (const other of aid.connects) {
        expect(known.has(other), `${aid.id}: connects ${other}`).toBe(true)
      }
      for (const other of aid.generationMeta.groundingUnitIds) {
        expect(known.has(other), `${aid.id}: grounding ${other}`).toBe(true)
      }
    }
  })

  it('grounds every aid in its own unit first', () => {
    for (const aid of allAids) {
      expect(aid.generationMeta.groundingUnitIds[0], aid.id).toBe(aid.unitId)
    }
  })

  it('never connects an aid to its own unit', () => {
    for (const aid of allAids) expect(aid.connects, aid.id).not.toContain(aid.unitId)
  })

  // ------------------------------------------------------------- bilingual

  it('gives every served aid non-empty Devanagari Hindi on every string', () => {
    for (const aid of served) {
      for (const key of ['explanation', 'example', 'misconception', 'examRelevance', 'mnemonic'] as const) {
        const value = aid[key]
        if (!value) continue
        expect(value.en.trim(), `${aid.id}.${key}.en`).not.toBe('')
        expect(value.hi.trim(), `${aid.id}.${key}.hi`).not.toBe('')
        expect(DEVANAGARI.test(value.hi), `${aid.id}.${key}.hi is not Devanagari`).toBe(true)
        expect(value.hi, `${aid.id}.${key} is the same string twice`).not.toBe(value.en)
      }
    }
  })

  // ------------------------------------------------------------- provenance

  it('marks every aid as needing verification, without exception', () => {
    // An aid is Sahayak's own explanation. There is no version of one a
    // Ministry published, so `verify` is a literal `true` in the schema and
    // this asserts the data agrees.
    for (const aid of allAids) expect(aid.verify, aid.id).toBe(true)
  })

  it('carries the source of the work it explains', () => {
    for (const id of fileIds) {
      const file = files.get(id)
      expect(file?.source.url).toMatch(/^https?:\/\//)
      for (const aid of file?.aids ?? []) expect(aid.source.url).toMatch(/^https?:\/\//)
    }
  })

  it('records a four-stage review on every aid, and refuses a served one that failed a stage', () => {
    for (const aid of allAids) {
      const meta = aid.generationMeta
      expect(meta.promptVersion, aid.id).not.toBe('')
      expect(meta.batchId, aid.id).toContain(aid.workId)
      if (!isAidServed(aid)) continue
      expect(meta.critic.verdict, `${aid.id} is served with a rejecting critic`).toBe('approve')
      expect(meta.verify.grounded, `${aid.id} is served ungrounded`).toBe(true)
      expect(meta.dedup.verdict, `${aid.id} is served as a duplicate`).toBe('keep')
    }
  })

  it('keeps a rejected aid in the file with a reason, and never serves it', () => {
    const rejected = allAids.filter((aid) => aid.reviewState === 'rejected')
    // Two exist today: an omitted CCA rule and a repealed OSA section. The
    // count is not asserted — what is asserted is that a rejection carries its
    // audit trail, the way `docs/AUTHORING.md` requires of a card.
    for (const aid of rejected) {
      expect(aid.reviewNote, `${aid.id} is rejected with no reason`).toBeTruthy()
      expect(isAidServed(aid)).toBe(false)
    }
  })

  it('does not repeat an explanation across two aids', () => {
    const seen = new Map<string, string>()
    for (const aid of allAids) {
      const key = aid.explanation.en.slice(0, 160).toLowerCase()
      expect(seen.has(key), `${aid.id} repeats ${seen.get(key) ?? ''}`).toBe(false)
      seen.set(key, aid.id)
    }
  })

  // ------------------------------------------------------------ negative side

  it('rejects an aid whose Hindi is missing', () => {
    const file = structuredClone(files.get('rti')) as LibraryAids
    const first = file.aids[0]
    expect(first).toBeDefined()
    if (first) first.explanation = { ...first.explanation, hi: '' }
    expect(() => libraryAidsSchema.parse(file)).toThrow()
  })

  it('rejects an aid claiming it needs no verification', () => {
    const file = structuredClone(files.get('rti')) as LibraryAids
    const first = file.aids[0] as { verify: boolean } | undefined
    if (first) first.verify = false
    expect(() => libraryAidsSchema.parse(file)).toThrow()
  })

  it('rejects an unknown key, so a mistyped field cannot be silently dropped', () => {
    const file = structuredClone(files.get('rti')) as LibraryAids
    ;(file.aids[0] as unknown as Record<string, unknown>).explanationn = { en: 'x', hi: 'य' }
    expect(() => libraryAidsSchema.parse(file)).toThrow()
  })
})
