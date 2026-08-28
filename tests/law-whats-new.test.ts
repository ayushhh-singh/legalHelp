import { describe, expect, it } from 'vitest'

import { resolveWhatsNew, WHATS_NEW, WHATS_NEW_GROUPS } from '@/modules/law/whatsNew'
import { lookupOldSection } from '@/modules/law/resolve'
import type { LawCorpus, LawDataset, LawIndex } from '@/modules/law/types'
import { readFromRoot } from '@/test/paths'

/**
 * `/law/whats-new` is a list of POINTERS into the datasets, not a page of
 * summaries. This is what makes that structure worth having: every bullet is
 * checked against the committed `data/law/*.json`, so a section that moves under
 * one fails the build rather than rendering a citation with nothing behind it.
 *
 * The bullets are also read as CLAIMS here — that BNS 111 really is new, that
 * IPC 124A really has no counterpart — rather than only as valid references. A
 * pointer that resolves to a section saying the opposite of its bullet would be
 * worse than a broken link.
 */
const load = <T>(file: string): T => JSON.parse(readFromRoot('data/law', file)) as T

const corpus: LawCorpus = {
  index: load<LawIndex>('index.json'),
  datasets: {
    bns: load<LawDataset>('bns.json'),
    bnss: load<LawDataset>('bnss.json'),
    bsa: load<LawDataset>('bsa.json'),
  },
}

const resolved = resolveWhatsNew(corpus)

describe("what's new", () => {
  it('resolves every single bullet', () => {
    const unresolved = WHATS_NEW.filter(
      (point) => !resolved.some((entry) => entry.point.id === point.id),
    ).map((point) => point.id)
    expect(unresolved).toEqual([])
    expect(resolved).toHaveLength(WHATS_NEW.length)
  })

  it('gives every bullet a source to cite', () => {
    const uncited = resolved.filter((entry) => !entry.source?.url).map((entry) => entry.point.id)
    expect(uncited).toEqual([])
  })

  it('writes every bullet in both languages', () => {
    // The equal-bilingual rule. A missing Hindi sentence is a CI failure here
    // for the same reason it is in scripts/i18n-check.mjs.
    for (const point of WHATS_NEW) {
      expect(point.why.en.trim(), point.id).not.toBe('')
      expect(point.why.hi.trim(), point.id).not.toBe('')
      // A Hindi line that is really English is the failure this catches.
      expect(point.why.hi, point.id).toMatch(/[ऀ-ॿ]/)
    }
  })

  it('uses only groups the page can render', () => {
    for (const point of WHATS_NEW) {
      expect(WHATS_NEW_GROUPS, point.id).toContain(point.group)
    }
  })

  it('gives every bullet a unique id', () => {
    const ids = WHATS_NEW.map((point) => point.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('fills every group the page offers', () => {
    for (const group of WHATS_NEW_GROUPS) {
      expect(
        WHATS_NEW.some((point) => point.group === group),
        group,
      ).toBe(true)
    }
  })
})

describe('the claims the bullets make', () => {
  it('marks as new only sections the dataset records as new', () => {
    for (const entry of resolved) {
      if (entry.point.group !== 'new-offences') continue
      if (entry.point.kind !== 'section') continue
      // BNS 4 (community service) and 103(2) (mob lynching) are additions
      // INSIDE a section that already existed, so `status` is "changed" there —
      // the claim is about the sub-section, not the section.
      if (entry.point.clause || entry.point.section === '4') continue
      expect(entry.record?.status, entry.point.id).toBe('new')
    }
  })

  it('marks as dropped only provisions the datasets say were dropped', () => {
    // Two shapes count, and the difference is deliberate in the data (ADR-012):
    //
    //  - `newSections: []` — NCRB marks the row "Deleted" and nothing replaces
    //    it. IPC 309, 377 and 497.
    //  - `newSections: ['152']` with a curated note — IPC 124A. The overlay
    //    signposts the NEAREST provision so a reader arriving at "124A" is not
    //    left with a blank page, and the note says in terms that BNS 152 is a
    //    new offence rather than a renumbering. Requiring an empty list here
    //    would have forced that signpost out of the data.
    for (const point of WHATS_NEW) {
      if (point.kind !== 'dropped') continue
      const entry = lookupOldSection(corpus.index, point.oldAct, point.section)
      expect(entry, `${point.oldAct} ${point.section}`).toBeDefined()

      if (entry?.newSections.length) {
        expect(entry.note?.en, point.id).toMatch(/no (corresponding|sedition)|Deleted/i)
        expect(entry.warnings?.length, point.id).toBeGreaterThan(0)
      } else {
        expect(entry?.newSections, point.id).toEqual([])
      }
    }
  })

  it('points every renumbering bullet at a section that replaced something', () => {
    for (const entry of resolved) {
      if (entry.point.group !== 'renumbering') continue
      expect(
        entry.record?.mappings.some((mapping) => mapping.old.length > 0),
        entry.point.id,
      ).toBe(true)
    }
  })

  it('points at the sub-section where the bullet is about one', () => {
    for (const point of WHATS_NEW) {
      if (point.kind !== 'section' || !point.clause) continue
      const record = corpus.datasets[point.code].sections[point.section]
      // The clause has to be a real sub-section of that section, or the
      // citation on the page names a provision that does not exist.
      expect(point.clause.startsWith(point.section), point.id).toBe(true)
      expect(record, point.id).toBeDefined()
    }
  })

  it('names the Act each bullet belongs to', () => {
    for (const entry of resolved) {
      expect(entry.actName.en.trim(), entry.point.id).not.toBe('')
      expect(entry.actName.hi.trim(), entry.point.id).not.toBe('')
    }
  })
})

describe('the specific traps the page exists to warn about', () => {
  it('says 124A is repealed rather than renumbered to 152', () => {
    const entry = resolved.find((point) => point.point.id === 'sedition-124a')
    expect(entry?.point.kind).toBe('dropped')
    expect(entry?.point.why.en).toContain('152')

    // The index signposts BNS 152 as the nearest provision. The forward dataset
    // is what settles the question: BNS 152 replaces nothing and is marked new,
    // so it is not 124A under another number, and the bullet must not say it is.
    const bns152 = corpus.datasets.bns.sections['152']
    expect(bns152?.status).toBe('new')
    expect(bns152?.mappings.every((mapping) => mapping.old.length === 0)).toBe(true)
    expect(entry?.point.why.en).toMatch(/not a renumbering/i)
  })

  it('names the sub-section for "420"', () => {
    const entry = WHATS_NEW.find((point) => point.id === 'cheating-318')
    expect(entry?.kind === 'section' && entry.clause).toBe('318(4)')
  })

  it('covers both halves of the 438/482 swap', () => {
    expect(WHATS_NEW.some((point) => point.id === 'anticipatory-bail-482')).toBe(true)
    expect(WHATS_NEW.some((point) => point.id === 'inherent-powers-528')).toBe(true)
  })
})
