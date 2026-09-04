import { describe, expect, it } from 'vitest'

import { lawDatasetSchema, lawIndexSchema } from '@/modules/law/schema'
import {
  forwardSections,
  getSection,
  lookupOldSection,
  normaliseSectionRef,
  resolveOldSection,
  sectionBase,
} from '@/modules/law/resolve'
import type { LawDataset, LawIndex, OldActId } from '@/modules/law/types'
import { readFromRoot } from '@/test/paths'

/**
 * The law datasets, read off disk rather than imported.
 *
 * `data/law/*.json` is ~4 MB of section text. Importing it here would bundle it
 * into whatever imports this module, and the point of keeping it in `/data` is
 * that the Law Converter route fetches it and nothing else pays for it. Reading
 * from disk also means this suite tests the committed bytes — the artefact the
 * cron opens a pull request against — not a transformed copy of them.
 */
const load = <T>(file: string): T => JSON.parse(readFromRoot('data/law', file)) as T

const bns = load<LawDataset>('bns.json')
const bnss = load<LawDataset>('bnss.json')
const bsa = load<LawDataset>('bsa.json')
const index = load<LawIndex>('index.json')

const CODES = [
  { name: 'BNS', dataset: bns, sections: 358, oldAct: 'IPC' as OldActId },
  { name: 'BNSS', dataset: bnss, sections: 531, oldAct: 'CrPC' as OldActId },
  { name: 'BSA', dataset: bsa, sections: 170, oldAct: 'IEA' as OldActId },
]

describe('law datasets', () => {
  describe.each(CODES)('$name', ({ dataset, sections, oldAct }) => {
    it('matches the dataset schema', () => {
      // Same contract the Python ingest validates against before it writes
      // (schemas/law-mapping.schema.json). Both must pass for a dataset to ship.
      expect(lawDatasetSchema.safeParse(dataset).error?.issues.slice(0, 5)).toBeUndefined()
    })

    it(`carries every section from 1 to ${sections}`, () => {
      const missing: string[] = []
      for (let n = 1; n <= sections; n += 1) {
        if (!dataset.sections[String(n)]) missing.push(String(n))
      }
      expect(missing).toEqual([])
    })

    it('carries no section beyond the end of the Act', () => {
      const strays = Object.keys(dataset.sections).filter((key) => {
        const n = Number.parseInt(key, 10)
        return !Number.isInteger(n) || n < 1 || n > sections
      })
      expect(strays).toEqual([])
    })

    it('gives every section an English heading', () => {
      const blank = Object.values(dataset.sections)
        .filter((section) => !section.heading.en.trim())
        .map((section) => section.section)
      expect(blank).toEqual([])
    })

    it('stores both languages on every heading, text and punishment', () => {
      // The hard rule is the *shape*: `{ en, hi }`, never a flat string. An
      // empty `hi` is a recorded gap (docs/DATA-GAPS.md); a missing `hi` key
      // is a bug that would crash a language toggle.
      for (const section of Object.values(dataset.sections)) {
        for (const field of [section.heading, section.text, section.punishment]) {
          expect(Object.keys(field).sort()).toEqual(['en', 'hi'])
        }
      }
    })

    it('names the repealed Act it maps back to', () => {
      expect(dataset.oldAct.id).toBe(oldAct)
      expect(dataset.commencement.date).toBe('2024-07-01')
    })

    it('cites a source for every section', () => {
      const known = new Set(dataset.sources.map((source) => source.id))
      const unknown = new Set<string>()
      for (const section of Object.values(dataset.sections)) {
        expect(section.sources.length).toBeGreaterThan(0)
        for (const id of section.sources) if (!known.has(id)) unknown.add(id)
      }
      expect([...unknown]).toEqual([])
    })
  })

  it('records the parse path it actually took', () => {
    for (const { dataset } of CODES) {
      expect(['inline-html', 'pdf']).toContain(dataset.counts.parsePath)
    }
  })
})

describe('reverse index', () => {
  it('matches the index schema', () => {
    expect(lawIndexSchema.safeParse(index).error?.issues.slice(0, 5)).toBeUndefined()
  })

  // The numbers an officer already knows by heart, and the ones this module
  // exists to answer. Each is the section a search box will actually receive.
  const RESOLVES: ReadonlyArray<[OldActId, string, string]> = [
    ['IPC', '302', '103'],
    ['IPC', '420', '318'],
    ['IPC', '498A', '85'],
    ['IPC', '376', '64'],
    ['IPC', '124A', '152'],
    ['CrPC', '154', '173'],
    ['CrPC', '438', '482'],
    ['CrPC', '482', '528'],
    ['IEA', '65B', '63'],
  ]

  it.each(RESOLVES)('resolves %s %s to %s', (act, oldSection, expected) => {
    const resolved = resolveOldSection(index, act, oldSection)
    expect(resolved).not.toBeNull()
    expect(resolved?.newSections.map(sectionBase)).toContain(expected)
  })

  it('resolves IPC 420 to the sub-section, not just the section', () => {
    // BNS 318 absorbs IPC 415, 417, 418 and 420, and the sub-sections differ on
    // punishment, cognizability and bail. "318" alone is not an answer.
    expect(resolveOldSection(index, 'IPC', '420')?.newSections).toContain('318(4)')
  })

  it.each([
    ['IPC', '302'],
    ['IPC', ' 302 '],
    ['IPC', '302.'],
    ['IPC', '498a'],
    ['IPC', '498 A'],
    ['IEA', '65B'],
    ['IEA', '65 b'],
    ['CrPC', '438.'],
  ] as const)('finds %s when it is typed as "%s"', (act, typed) => {
    // Whatever a reader types into a search box has to land on the same entry:
    // stray spaces, a trailing full stop, a lower-case suffix.
    expect(lookupOldSection(index, act, typed)).toBeDefined()
  })

  it('returns undefined for keys that live on Object.prototype', () => {
    // `acts` and `entries` come from JSON.parse, so they carry Object.prototype.
    // A bare index lookup would hand back a function for "constructor".
    for (const typed of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(lookupOldSection(index, 'IPC', typed)).toBeUndefined()
      expect(getSection(bns, typed)).toBeUndefined()
    }
  })

  it('normalises a reference the same way the ingest does', () => {
    expect(normaliseSectionRef('318 (4)')).toBe('318(4)')
    expect(normaliseSectionRef('350( 1 )')).toBe('350(1)')
    expect(sectionBase('318(4)')).toBe('318')
    expect(sectionBase('498a')).toBe('498A')
  })

  it('upper-cases the section suffix and lower-cases the sub-clause', () => {
    // Indian drafting writes 498A and 65B upper, and 2(f) and 65B(3)(a) lower.
    // Uppercasing the whole reference made a sub-clause miss its own entry and
    // silently answer with the parent section instead.
    expect(normaliseSectionRef('498a')).toBe('498A')
    expect(normaliseSectionRef('65 b')).toBe('65B')
    expect(normaliseSectionRef('2(F)')).toBe('2(f)')
    expect(normaliseSectionRef('61(2) (A)')).toBe('61(2)(a)')
    expect(normaliseSectionRef('65b(3)(A)')).toBe('65B(3)(a)')
  })

  it('answers about the sub-clause asked for, not its parent section', () => {
    // CrPC 2 maps to BNSS 2, but its definitions 2(f), 2(k), 2(q) and 2(t) were
    // dropped. Asking about 2(t) must not be answered with the whole of 2.
    const clause = lookupOldSection(index, 'CrPC', '2(t)')
    const parent = lookupOldSection(index, 'CrPC', '2')
    expect(clause?.status).toBe('omitted')
    expect(parent?.status).toBe('mapped')
    expect(clause).not.toBe(parent)
    expect(resolveOldSection(index, 'CrPC', '2(t)')).toBeNull()
    expect(resolveOldSection(index, 'CrPC', '2')).not.toBeNull()
  })

  it('still falls back to the parent when the sub-clause has no entry of its own', () => {
    // Most sub-clauses are not listed separately; "302(1)" should answer with
    // 302 rather than nothing.
    expect(lookupOldSection(index, 'IPC', '302(1)')?.newSections).toContain('103')
  })

  // Provisions the new Acts do not carry forward at all.
  const OMITTED: ReadonlyArray<[OldActId, string]> = [
    ['IPC', '309'],
    ['IPC', '377'],
    ['IPC', '497'],
  ]

  it('never says a section maps to nothing while also mapping it somewhere', () => {
    // IEA 65B is the case that made this necessary. Only sub-clauses
    // 65B(3)(a)-(d) are marked "Deleted", but the note landed on the base
    // entry, so 65B resolved to BSA 63 *and* claimed to have no counterpart.
    // One of the acceptance sections, telling a reader two opposite things.
    const contradictions: string[] = []
    for (const [act, bucket] of Object.entries(index.acts)) {
      for (const [section, entry] of Object.entries(bucket.entries)) {
        const claimsNothing = entry.note?.en.includes('has no corresponding provision') ?? false
        if (entry.newSections.length > 0 && claimsNothing) contradictions.push(`${act} ${section}`)
        if (entry.status === 'omitted' && entry.newSections.length > 0)
          contradictions.push(`${act} ${section}`)
      }
    }
    expect(contradictions).toEqual([])
  })

  it('says which parts of a partly-repealed section were dropped', () => {
    const entry = lookupOldSection(index, 'IEA', '65B')
    expect(entry?.status).toBe('mapped')
    expect(entry?.newSections).toContain('63')
    expect(entry?.note?.en).toContain('65B(3)(a)')
    expect(entry?.note?.hi).toContain('65B(3)(a)')
    // ...and the dropped sub-clause is resolvable in its own right.
    const clause = lookupOldSection(index, 'IEA', '65B(3)(a)')
    expect(clause?.status).toBe('omitted')
    expect(resolveOldSection(index, 'IEA', '65B(3)(a)')).toBeNull()
  })

  it.each(OMITTED)('resolves the repealed %s %s to null, with a note saying why', (act, oldSection) => {
    expect(resolveOldSection(index, act, oldSection)).toBeNull()

    const entry = lookupOldSection(index, act, oldSection)
    expect(entry?.status).toBe('omitted')
    expect(entry?.newSections).toEqual([])
    expect(entry?.note?.en.length).toBeGreaterThan(20)
    expect(entry?.note?.hi.length).toBeGreaterThan(20)
    expect(entry?.warnings?.length).toBeGreaterThan(0)
  })

  it('reaches the section record from the old number in one step', () => {
    const [section] = forwardSections(index, bns, 'IPC', '302')
    expect(section?.section).toBe('103')
    expect(section?.heading.en).toContain('murder')
    expect(section?.classification.some((entry) => entry.cognizable === 'cognizable')).toBe(true)
  })

  it('agrees with the forward datasets on every mapped section', () => {
    // The index is generated from the same rows as the datasets; this is what
    // catches a future parser change that updates one and not the other.
    const datasets: Record<string, LawDataset> = { IPC: bns, CrPC: bnss, IEA: bsa }
    const disagreements: string[] = []

    for (const [act, bucket] of Object.entries(index.acts)) {
      const dataset = datasets[act]
      if (!dataset) continue
      for (const [oldSection, entry] of Object.entries(bucket.entries)) {
        if (entry.status !== 'mapped') continue
        for (const ref of entry.newSections) {
          const record = getSection(dataset, ref)
          if (!record) disagreements.push(`${act} ${oldSection} -> ${ref}`)
        }
      }
    }

    expect(disagreements).toEqual([])
  })
})

describe('number-swap warnings', () => {
  // The failure mode this module exists to prevent: the reader remembers a
  // number, the number still exists in the new Act, and it means something else.
  it.each([
    ['CrPC', '438', 'BNSS 482'],
    ['CrPC', '482', 'BNSS 528'],
    ['IPC', '420', 'BNS 318(4)'],
    ['IPC', '124A', 'BNS 152'],
  ] as const)('warns on %s %s (now %s)', (act, oldSection, _becomes) => {
    const entry = lookupOldSection(index, act, oldSection)
    const warnings = entry?.warnings ?? []
    expect(warnings.length).toBeGreaterThan(0)
    for (const warning of warnings) {
      expect(warning.title.hi.length).toBeGreaterThan(0)
      expect(warning.body.hi.length).toBeGreaterThan(0)
    }
  })

  it('carries the transitional rule on BNSS 531', () => {
    const section = getSection(bnss, '531')
    const transitional = section?.notes.find((note) => note.kind === 'transitional')
    expect(transitional?.body.en).toContain('531(2)(a)')
    expect(transitional?.body.hi).toContain('531(2)')
    expect(transitional?.source?.url).toMatch(/^https:\/\//)
  })
})

describe('classification and punishment', () => {
  it('classifies the most-cited offences from the BNSS First Schedule', () => {
    const murder = getSection(bns, '103')?.classification.find((entry) => entry.clause === '103(1)')
    expect(murder).toMatchObject({
      cognizable: 'cognizable',
      bailable: 'non-bailable',
      compoundable: 'non-compoundable',
    })
    expect(murder?.triableBy.en).toContain('Court of Session')

    const cheating = getSection(bns, '318')?.classification.find((entry) => entry.clause === '318(2)')
    expect(cheating).toMatchObject({ cognizable: 'non-cognizable', bailable: 'bailable' })
    expect(cheating?.compoundable).not.toBe('non-compoundable')
  })

  it('covers at least 80 BNS sections', () => {
    const classified = Object.values(bns.sections).filter((section) => section.classification.length > 0)
    expect(classified.length).toBeGreaterThanOrEqual(80)
  })

  it('gives at least 80 BNS sections a Hindi heading and flags them as curated', () => {
    const curated = Object.values(bns.sections).filter((section) => section.heading.hi.trim().length > 0)
    expect(curated.length).toBeGreaterThanOrEqual(80)
    // The Hindi is a curated translation, not the statutory text. Every section
    // it touches must say so, or the UI has no way to warn the reader.
    for (const section of curated) expect(section.verify).toBe(true)
  })

  it('gives every classified-and-curated section a Hindi punishment', () => {
    const missing = Object.values(bns.sections)
      .filter((section) => section.heading.hi.trim() && section.classification.length > 0)
      .filter((section) => !section.punishment.hi.trim())
      .map((section) => section.section)
    expect(missing).toEqual([])
  })

  it('leaves a BNS section unclassified only when it punishes nothing', () => {
    /*
      70 of the 358 BNS sections carry no First Schedule classification, and
      that is correct rather than missing: the Schedule classifies sections
      that CREATE an offence, and those 70 are definitions, general
      exceptions and the repeal. Section 63 defines rape and 64 punishes it;
      101 defines murder and 103 punishes it — the definition has nothing to
      be bailable about.

      Asserting the number 70 would only restate today's data. What is worth
      holding is the reason: a section with no classification must also carry
      no punishment, or the Schedule row for a real offence has been dropped.
      Verified once against the source too — the committed
      `ScheduleBNSS.html` names 288 distinct BNS sections, the dataset
      classifies exactly those 288, and none of the 70 appears in it.
    */
    const unclassifiedButPunishing = Object.values(bns.sections)
      .filter((section) => section.classification.length === 0)
      .filter((section) => section.punishment.en.trim().length > 0)
      .map((section) => section.section)
    expect(unclassifiedButPunishing).toEqual([])
  })

  it('gives every classified BNS section a punishment to show', () => {
    // The other direction. A classification row with no punishment renders a
    // card with a blank column — BNS 264 did exactly that until the Schedule's
    // continuation rows were read.
    const classifiedButBlank = Object.values(bns.sections)
      .filter((section) => section.classification.length > 0)
      .filter((section) => !section.punishment.en.trim())
      .map((section) => section.section)
    expect(classifiedButBlank).toEqual([])
  })

  it('grades a second conviction separately from the first', () => {
    /*
      The BNSS First Schedule puts an aggravated limb on its own row, with the
      section column left empty because it continues the row above. Voyeurism
      and stalking are each BAILABLE on a first conviction and NOT on a
      second, so a parser that reads only the numbered rows answers "is this
      bailable" with the wrong half of the Schedule.
    */
    for (const ref of ['77', '78']) {
      const rows = getSection(bns, ref)?.classification ?? []
      expect(rows.length).toBeGreaterThanOrEqual(2)
      const repeat = rows.find((row) => /second or subsequent/i.test(row.offence.en))
      expect(repeat, `BNS ${ref} has no second-conviction row`).toBeDefined()
      expect(repeat?.bailable).toBe('non-bailable')
      expect(rows.some((row) => row.bailable === 'bailable')).toBe(true)
    }
  })

  it('never leaves a classification column unanswered', () => {
    // "unspecified" is what the parser emits when a cell was empty. One row
    // (BNS 264) carried it, because the values were on the two rows beneath.
    const unspecified = Object.values(bns.sections).flatMap((section) =>
      section.classification
        .filter((row) => row.cognizable === 'unspecified' || row.bailable === 'unspecified')
        .map((row) => `${section.section}/${row.clause}`),
    )
    expect(unspecified).toEqual([])
  })

  it('leaves the procedural codes unclassified', () => {
    // Cognizable/bailable/triable are properties of offences under the BNS. A
    // classification on a BNSS or BSA section would mean the schedule parser
    // has attached rows to the wrong dataset.
    for (const dataset of [bnss, bsa]) {
      const classified = Object.values(dataset.sections).filter((s) => s.classification.length > 0)
      expect(classified).toEqual([])
    }
  })
})

describe('dataset versions', () => {
  const versions = JSON.parse(readFromRoot('data/_meta/versions.json')) as {
    datasets: Record<
      string,
      { version: string; rows?: number; sha256?: string; label: Record<string, string> }
    >
  }

  it.each(['law-bns', 'law-bnss', 'law-bsa', 'law-index'])('records %s', (key) => {
    const entry = versions.datasets[key]
    expect(entry).toBeDefined()
    expect(entry?.label.en).toBeTruthy()
    expect(entry?.label.hi).toBeTruthy()
    expect(entry?.sha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('records the row count each dataset actually has', () => {
    expect(versions.datasets['law-bns']?.rows).toBe(Object.keys(bns.sections).length)
    expect(versions.datasets['law-bnss']?.rows).toBe(Object.keys(bnss.sections).length)
    expect(versions.datasets['law-bsa']?.rows).toBe(Object.keys(bsa.sections).length)
  })

  it('keeps the shell entry the earlier session wrote', () => {
    expect(versions.datasets.app).toBeDefined()
  })
})
