import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  INSTRUCTION_FIELD_CAP,
  TRUNCATION_MARKER,
  buildInstruction,
  sanitiseField,
  structureOf,
} from '@/lib/drafting/instructions'
import { sampleValues } from '@/lib/drafting/engine'
import { docTemplateFileSchema, type DocTemplate } from '@/modules/drafting/schema'

/**
 * The instruction every one of the forty-three forms produces, committed.
 *
 * The snapshot is the point. `buildInstruction` derives its output from the
 * template's own `person`, `salutation`, `subscription`, `urgencyAllowed`,
 * layout order, CSMOP paragraphs and `must` checklist items, so a change to any
 * of those in `drafting_seed.py` changes what a model is told about that form —
 * silently, unless something commits the before and after. Forty-three
 * snapshots is what makes that a diff somebody reads.
 *
 * Read the diff before running `pnpm test -u`. A snapshot changing because a
 * form gained a checklist item is right; one changing because the derivation
 * dropped the third-person rule is the defect this file exists to catch.
 */

const root = join(import.meta.dirname, '..')
const TEMPLATE_DIR = join(root, 'data', 'drafting', 'templates')

const templates: DocTemplate[] = readdirSync(TEMPLATE_DIR)
  .filter((name) => name.endsWith('.json'))
  .sort()
  .map(
    (name) =>
      docTemplateFileSchema.parse(JSON.parse(readFileSync(join(TEMPLATE_DIR, name), 'utf8'))).template,
  )

describe('every form has an instruction', () => {
  it('covers the whole library', () => {
    expect(templates).toHaveLength(43)
  })

  it.each(templates.map((template) => [template.id, template] as const))('%s', (_id, template) => {
    /*
        Built over the form's OWN worked example rather than an empty form, so
        the snapshot shows what an instruction looks like with values in it —
        which is the shape a real run produces. `sampleValues` is the same
        worked example the editor's "Fill with the worked example" button uses,
        so the snapshot cannot drift from a form's own sample.
      */
    const built = buildInstruction(template, sampleValues(template), { lang: 'en' })
    expect(built.text).toMatchSnapshot()
  })
})

describe('what the derivation must never lose', () => {
  it.each(templates.map((template) => [template.id, template] as const))(
    '%s states its person rule, its salutation rule and its CSMOP paragraphs',
    (_id, template) => {
      const { text } = buildInstruction(template, {})

      expect(text).toMatch(template.person === 'third' ? /THIRD person/ : /FIRST person/)
      expect(text).toMatch(template.salutation ? /Open with the salutation/ : /carries NO salutation/)
      expect(text).toMatch(template.subscription ? /Close with the subscription/ : /carries NO subscription/)
      // The urgency grading is stated either way — a form that may not carry
      // one is a fact a model needs as much as a form that may.
      expect(text).toMatch(
        template.urgencyAllowed ? /urgency grading \(Immediate/ : /carries NO urgency grading/,
      )
      for (const para of template.csmopRef.paras) expect(text).toContain(para)
      // The Hindi register note is unconditional. Every form in this app is
      // written in both languages and the administrative register is not the
      // Hindi a general-purpose model reaches for by default.
      expect(text).toMatch(/Rajbhasha/)
      // And the rule that stops a model filling a blank with a plausible fact.
      expect(text).toMatch(/four underscores/)
    },
  )

  it.each(templates.map((template) => [template.id, template] as const))(
    '%s numbers the parts of its own layout, in the layout’s order',
    (_id, template) => {
      const structure = structureOf(template)
      expect(structure.length).toBeGreaterThan(2)
      // No duplicates: a demi-official letter places `header` and `closing`
      // twice and the instruction names each part once.
      expect(new Set(structure).size).toBe(structure.length)

      const { text } = buildInstruction(template, {})
      structure.forEach((part, index) => {
        expect(text).toContain(`${index + 1}. ${part}`)
      })
    },
  )

  it.each(templates.map((template) => [template.id, template] as const))(
    '%s names every one of its own must-pass checklist items',
    (_id, template) => {
      const { text } = buildInstruction(template, {})
      for (const item of template.checklist) {
        if (item.severity !== 'must') continue
        expect(text).toContain(item.label.en)
      }
    },
  )

  it('says so when CSMOP prescribes no format for the form', () => {
    // Seven of the original fourteen and several of the twenty-nine. A model
    // told the Manual specifies a format it does not specify will write
    // confidently about a format nobody prescribed.
    const unverified = templates.filter((template) => template.verify)
    expect(unverified.length).toBeGreaterThan(0)
    for (const template of unverified) {
      expect(buildInstruction(template, {}).text).toMatch(/CSMOP prescribes no format/)
    }
    const verified = templates.filter((template) => !template.verify)
    for (const template of verified) {
      expect(buildInstruction(template, {}).text).not.toMatch(/CSMOP prescribes no format/)
    }
  })
})

describe('values', () => {
  const om = templates.find((template) => template.id === 'office-memorandum') as DocTemplate

  it('reports a required field that is still empty', () => {
    const built = buildInstruction(om, {})
    expect(built.emptyFields).toContain('subject')
    expect(built.text).toMatch(/Still empty:/)
  })

  it('does not report a field the officer has filled', () => {
    const built = buildInstruction(om, { subject: 'Children Education Allowance' })
    expect(built.emptyFields).not.toContain('subject')
    expect(built.text).toContain('subject: Children Education Allowance')
  })

  it('reads the language the caller asked for out of a bilingual value', () => {
    const en = buildInstruction(om, { subject: { en: 'Allowance', hi: 'भत्ता' } }, { lang: 'en' })
    const hi = buildInstruction(om, { subject: { en: 'Allowance', hi: 'भत्ता' } }, { lang: 'hi' })
    expect(en.text).toContain('subject: Allowance')
    expect(hi.text).toContain('subject: भत्ता')
  })

  it('falls through to the other language rather than saying the field is empty', () => {
    // A file number and a telephone number are the same in either language and
    // are stored once. Reporting them as an empty Hindi field would make a
    // Hindi run ask the officer for something they have already given.
    const built = buildInstruction(om, { subject: { en: 'Allowance', hi: '' } }, { lang: 'hi' })
    expect(built.text).toContain('subject: Allowance')
    expect(built.emptyFields).not.toContain('subject')
  })

  it('joins a list value into lines', () => {
    const built = buildInstruction(om, { paras: ['First.', 'Second.'] })
    expect(built.text).toContain('paras: First.\nSecond.')
  })
})

describe('sanitisation', () => {
  it('caps a field and says it did', () => {
    const long = 'क'.repeat(INSTRUCTION_FIELD_CAP + 500)
    const { text, truncated } = sanitiseField(long)
    expect(truncated).toBe(true)
    expect(text).toHaveLength(INSTRUCTION_FIELD_CAP)
    expect(text.endsWith(TRUNCATION_MARKER)).toBe(true)
  })

  it('does not cap a field that fits', () => {
    const { text, truncated } = sanitiseField('short')
    expect(truncated).toBe(false)
    expect(text).toBe('short')
  })

  it('reports which field was cut, through the builder', () => {
    const om = templates.find((template) => template.id === 'office-memorandum') as DocTemplate
    const built = buildInstruction(om, { subject: 'x'.repeat(INSTRUCTION_FIELD_CAP + 1) })
    expect(built.truncatedFields).toEqual(['subject'])
  })

  it('removes the characters that make a line read differently from how it is stored', () => {
    // Bidi overrides and zero-width characters. A reviewer reading the
    // instruction on screen and a model reading the bytes must not disagree
    // about what it says.
    expect(sanitiseField('safe‮evil‬').text).toBe('safeevil')
    expect(sanitiseField('a​b').text).toBe('ab')
    expect(sanitiseField('a bc').text).toBe('abc')
  })

  it('keeps paragraph breaks and collapses runs of them', () => {
    expect(sanitiseField('one\n\ntwo').text).toBe('one\n\ntwo')
    expect(sanitiseField('one\n\n\n\n\ntwo').text).toBe('one\n\ntwo')
  })

  it('normalises to NFC so two spellings of one Devanagari word compare equal', () => {
    expect(sanitiseField('नि').text).toBe('नि')
  })
})

describe('context', () => {
  const om = templates.find((template) => template.id === 'office-memorandum') as DocTemplate

  it('states what the letter being answered asked for', () => {
    const built = buildInstruction(
      om,
      {},
      {
        answering: {
          subject: 'Children Education Allowance',
          reference: 'A-11011/4/2026-Estt. dated 12.08.2026',
          asks: ['The number of pending cases may kindly be furnished.'],
        },
      },
    )
    expect(built.text).toMatch(/answers a communication that has been received/)
    expect(built.text).toContain('The number of pending cases may kindly be furnished.')
  })

  it('puts the instruction to change last, so it is what the model acts on', () => {
    const built = buildInstruction(om, {}, { instruction: 'Make paragraph 3 firmer.' })
    expect(built.text.trimEnd().endsWith('What to change: Make paragraph 3 firmer.')).toBe(true)
  })

  it('sanitises the brief and the instruction as well as the values', () => {
    const built = buildInstruction(om, {}, { instruction: 'Make ‮it‬ firmer.' })
    expect(built.text).toContain('Make it firmer.')
    expect(built.text).not.toContain('‮')
  })

  it('says both issues are wanted when the document is bilingual', () => {
    expect(buildInstruction(om, {}, { lang: 'bilingual' }).text).toMatch(/Both issues/)
    expect(buildInstruction(om, {}, { lang: 'en' }).text).not.toMatch(/Both issues/)
  })
})
