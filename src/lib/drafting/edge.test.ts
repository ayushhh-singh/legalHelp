import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { replaceAll } from '@/modules/drafting/editor/commands'
import { bodyForLanguage, bodySlotForLanguage, yearOfDocument } from './docLang'
import { emptyMeta, newDoc, type BodyDoc, type OfficialDoc } from './model'
import { renderOfficialDoc } from './renderDoc'
import { docTemplateFileSchema } from '@/modules/drafting/schema'
import { prune, type DocVersion } from './versions'

/**
 * The edge-case pass over Session 29.
 *
 * Every test here was confirmed to FAIL against the committed code before its
 * fix was written — the discipline ADR-025, ADR-032, ADR-035, ADR-038 and
 * ADR-039 each record. The shape this pass found is the one ADR-039's second
 * addendum named and not the one ADR-032 did: the untrusted halves were
 * guarded, and what failed instead was a set of controls that were wired up,
 * labelled in both languages, and could never do anything.
 */

const body = (...paras: string[]): BodyDoc => ({
  type: 'doc',
  content: paras.map((text) => ({
    type: 'numberedPara',
    attrs: { level: 1 },
    content: [{ type: 'text', text }],
  })),
})

const doc = (over: Partial<OfficialDoc> = {}): OfficialDoc => ({
  ...newDoc({
    id: 'd1',
    templateId: 'office-memorandum',
    lang: 'en',
    at: '2026-09-01T00:00:00.000Z',
    meta: { ...emptyMeta(), date: '2026-09-01' },
    body: body('English body.'),
  }),
  ...over,
})

describe('1. `$2` in a replacement with a zero-group pattern', () => {
  it('is left alone, not expanded to the whole paragraph', () => {
    // `String.replace`'s callback receives (match, p1…pn, offset, string). With
    // NO capture groups there are no `pn`, so `args[2]` is the entire input —
    // and a naive `args[Number(digit)]` lookup expanded `$2` into the whole
    // paragraph. `$1` happened to be safe only because `args[1]` is the offset,
    // a number, which the `typeof` guard rejected by luck rather than by design.
    const result = replaceAll(body('alpha beta'), 'beta', 'gamma $2', { regex: true })
    if (result === 'bad-regex') throw new Error('unexpected')
    expect(JSON.stringify(result.body)).toContain('alpha gamma $2')
    expect(JSON.stringify(result.body)).not.toContain('gamma alpha beta')
  })

  it('still expands a group that really is there', () => {
    const result = replaceAll(body('Rule 12'), 'Rule (\\d+)', 'Rule $1A', { regex: true })
    if (result === 'bad-regex') throw new Error('unexpected')
    expect(JSON.stringify(result.body)).toContain('Rule 12A')
  })

  it('leaves a group number past the end of the pattern alone', () => {
    const result = replaceAll(body('Rule 12'), 'Rule (\\d+)', '$1 then $7', { regex: true })
    if (result === 'bad-regex') throw new Error('unexpected')
    expect(JSON.stringify(result.body)).toContain('12 then $7')
  })
})

describe('2. which body slot a language edits', () => {
  it('reads and writes the SAME slot for a bilingual document with no Hindi body', () => {
    // The read said `bodyHi ? bodyHi : body` and the write said
    // `lang === 'bilingual' ? bodyHi : body`. For a bilingual document whose
    // `bodyHi` had gone missing the two disagreed: the officer saw the English
    // text, typed one character, and the English disappeared — because the
    // keystroke went into `bodyHi`, which then became the slot the read
    // preferred. One function decides now, and both callers ask it.
    const bilingual = doc({ lang: 'bilingual' })
    delete bilingual.bodyHi
    expect(bodySlotForLanguage(bilingual, 'hi')).toBe('body')
    expect(bodyForLanguage(bilingual, 'hi')).toEqual(bilingual.body)
  })

  it('uses the Hindi body once there is one', () => {
    const bilingual = doc({ lang: 'bilingual', bodyHi: body('हिंदी मुख्य भाग।') })
    expect(bodySlotForLanguage(bilingual, 'hi')).toBe('bodyHi')
    expect(bodyForLanguage(bilingual, 'hi')).toEqual(bilingual.bodyHi)
  })

  it('never touches the Hindi body of a single-language document', () => {
    const english = doc()
    expect(bodySlotForLanguage(english, 'hi')).toBe('body')
    expect(bodySlotForLanguage(english, 'en')).toBe('body')
  })

  it('reads the English body in English even when a Hindi one exists', () => {
    const bilingual = doc({ lang: 'bilingual', bodyHi: body('हिंदी।') })
    expect(bodySlotForLanguage(bilingual, 'en')).toBe('body')
  })
})

describe('3. the year a reference number is issued under', () => {
  it('reads a dd.mm.yyyy date, not just an ISO one', () => {
    // `Number(date.slice(0, 4))` reads "28.0" out of "28.09.2026" — `NaN`, so
    // the `||` fell through to the CURRENT year. Every migrated document holds
    // a dd.mm.yyyy date, so issuing a number on one silently used the wrong
    // year and, on a yearly-reset pattern, the wrong series.
    expect(yearOfDocument(doc({ meta: { ...emptyMeta(), date: '28.09.2026' } }), 2030)).toBe(2026)
    expect(yearOfDocument(doc({ meta: { ...emptyMeta(), date: '2026-09-28' } }), 2030)).toBe(2026)
    expect(yearOfDocument(doc({ meta: { ...emptyMeta(), date: '28/09/2026' } }), 2030)).toBe(2026)
  })

  it('falls back to the year it was given when there is no usable date', () => {
    expect(yearOfDocument(doc({ meta: { ...emptyMeta(), date: '' } }), 2030)).toBe(2030)
    expect(yearOfDocument(doc({ meta: { ...emptyMeta(), date: 'not a date' } }), 2030)).toBe(2030)
  })
})

describe('4. `prune` decides which versions are DELETED', () => {
  it('orders by code unit, not by ICU collation', () => {
    // CLAUDE.md: never `localeCompare` in anything that decides bytes. ICU
    // collation is a property of the runtime — the locale and the ICU build —
    // and `prune` does not merely display a list, it slices it and the caller
    // deletes everything that fell off. `src/lib/srs/types.ts#compareStrings`
    // states the same rule for the Trainer's export, and
    // `src/lib/drafting/purity.test.ts` now enforces it here.
    const at = (n: number) => `2026-09-${String(n).padStart(2, '0')}T00:00:00.000Z`
    const versions: DocVersion[] = Array.from({ length: 35 }, (_, index) => ({
      id: `v${index}`,
      docId: 'd1',
      at: at(index + 1),
      reason: 'auto',
      label: '',
      doc: doc(),
    }))
    const kept = prune(versions).map((entry) => entry.id)
    expect(kept[0]).toBe('v34')
    expect(kept).toHaveLength(30)
    // Deterministic: the same input twice gives the same bytes, on any runtime.
    expect(prune(versions).map((entry) => entry.id)).toEqual(kept)
  })
})

describe('6. three stored fields the renderer was ignoring', () => {
  const om = docTemplateFileSchema.parse(
    JSON.parse(
      readFileSync(
        join(
          import.meta.dirname,
          '..',
          '..',
          '..',
          'data',
          'drafting',
          'templates',
          'office-memorandum.json',
        ),
        'utf8',
      ),
    ),
  ).template

  const withStationery = (over: Partial<OfficialDoc['meta']>): OfficialDoc => {
    const base = doc()
    return { ...base, meta: { ...base.meta, ...over } }
  }

  const linesFor = (document: OfficialDoc, role: string): string[] =>
    renderOfficialDoc(document, om, 'en')
      .document.blocks.filter((block) => block.role === role)
      .flatMap((block) => block.lines)

  it('prints the letterhead above the Government of India block', () => {
    // Four bilingual inputs in the profile, copied into every new document, and
    // printed nowhere.
    const withLetterhead = withStationery({
      from: {
        ...emptyMeta().from,
        letterhead: [
          { en: 'ESTABLISHMENT SECTION', hi: 'स्थापना अनुभाग' },
          { en: '', hi: '' },
        ],
      },
    })
    expect(linesFor(withLetterhead, 'header')[0]).toBe('ESTABLISHMENT SECTION')
    // A blank line is dropped rather than printing an empty line on A4.
    expect(linesFor(withLetterhead, 'header')).not.toContain('')
    // And a document with no letterhead is untouched.
    expect(linesFor(doc(), 'header')[0]).toBe('Government of India')
  })

  it('takes the -Sd/- mark off when the officer unticks it', () => {
    const signed = withStationery({ signature: { ...emptyMeta().signature, showSd: true } })
    const unsigned = withStationery({ signature: { ...emptyMeta().signature, showSd: false } })
    expect(linesFor(signed, 'signature')).toContain('-Sd/-')
    expect(linesFor(unsigned, 'signature')).not.toContain('-Sd/-')
  })

  it('takes the Hindi mark off too', () => {
    const unsigned = withStationery({ signature: { ...emptyMeta().signature, showSd: false } })
    const hindi = renderOfficialDoc(unsigned, om, 'hi')
      .document.blocks.filter((block) => block.role === 'signature')
      .flatMap((block) => block.lines)
    expect(hindi).not.toContain('-हस्ताक्षरित/-')
    // The name is still there — only the mark went.
    expect(hindi.length).toBeGreaterThan(0)
  })

  it('moves the signature block where the profile put it', () => {
    const left = withStationery({ signature: { ...emptyMeta().signature, layout: 'left' } })
    const centre = withStationery({ signature: { ...emptyMeta().signature, layout: 'centre' } })
    const align = (document: OfficialDoc) =>
      renderOfficialDoc(document, om, 'en').document.blocks.find((block) => block.role === 'signature')?.align
    expect(align(left)).toBe('left')
    expect(align(centre)).toBe('center')
    expect(align(doc())).toBe('right')
  })

  it('does not touch the body block, so `nodes` is unaffected', () => {
    // Session 30 builds print and .docx on `nodes`; this post-process is
    // confined to chrome and must stay that way.
    const before = renderOfficialDoc(doc(), om, 'en')
    const after = renderOfficialDoc(
      withStationery({ signature: { ...emptyMeta().signature, showSd: false, layout: 'left' } }),
      om,
      'en',
    )
    const bodyOf = (result: typeof before) => result.document.blocks.find((block) => block.role === 'body')
    expect(bodyOf(after)?.nodes).toEqual(bodyOf(before)?.nodes)
    expect(bodyOf(after)?.lines).toEqual(bodyOf(before)?.lines)
  })
})

describe('5. the ADR describes enforcement that exists', () => {
  const adr = readFileSync(join(import.meta.dirname, '..', '..', '..', 'docs', 'DECISIONS.md'), 'utf8')

  it('the purity test ADR-041 names is a real file', () => {
    // ADR-041 §2 says "`src/lib/drafting/purity.test.ts` asserts it by reading
    // the files". It did not exist. An invariant described rather than
    // implemented is the kind of claim ADR-037's addendum says to distrust on
    // sight — and an ADR is where the next session goes to find out what is
    // guaranteed.
    expect(adr).toContain('src/lib/drafting/purity.test.ts')
    const files = readdirSync(join(import.meta.dirname))
    expect(files).toContain('purity.test.ts')
  })
})
