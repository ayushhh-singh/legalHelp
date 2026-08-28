import { createHash } from 'node:crypto'
import { readdirSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { evaluateChecklist, countFailures } from '@/lib/drafting/checklist'
import { render, renderDocument, serialise } from '@/lib/drafting/engine'
import {
  docTemplateFileSchema,
  draftingIndexSchema,
  phraseLibrarySchema,
  structureTermsSchema,
} from '@/modules/drafting/schema'
import { fromRoot, readFromRoot } from '@/test/paths'

import type { DocTemplate } from '@/modules/drafting/schema'

/**
 * The committed bytes of `data/drafting`, read off disk.
 *
 * Same arrangement as `tests/law-data.test.ts` and `tests/pay-data.test.ts`:
 * this suite reads the files rather than importing a fixture, because the
 * files are the artefact `scripts/ingest/drafting_seed.py` produces and the
 * thing the app will ship. A template that renders only in a test's own object
 * literal has been tested for nothing.
 */

const TEMPLATE_DIR = 'data/drafting/templates'

const templateFiles = readdirSync(fromRoot(TEMPLATE_DIR))
  .filter((name) => name.endsWith('.json'))
  .sort()

const readJson = (path: string): unknown => JSON.parse(readFromRoot(path)) as unknown

const templates: DocTemplate[] = templateFiles.map(
  (name) => docTemplateFileSchema.parse(readJson(`${TEMPLATE_DIR}/${name}`)).template,
)

const index = draftingIndexSchema.parse(readJson('data/drafting/index.json'))
const phrases = phraseLibrarySchema.parse(readJson('data/drafting/phrases.json'))
const terms = structureTermsSchema.parse(readJson('data/drafting/structure-terms.json'))

const LANGS = ['en', 'hi'] as const

describe('the drafting datasets', () => {
  it('carries the fourteen document types the Drafting Studio promises', () => {
    expect(templateFiles).toHaveLength(14)
    expect(templates.map((template) => template.id).sort()).toEqual([
      'circular',
      'demi-official',
      'endorsement',
      'id-note',
      'leave-application',
      'letter',
      'notification',
      'noting',
      'office-memorandum',
      'representation',
      'rti-reply',
      'show-cause-reply',
      'ta-bill-cover',
      'tour-programme',
    ])
  })

  it('names each template file after the template inside it', () => {
    for (const [position, name] of templateFiles.entries()) {
      expect(`${templates[position]?.id}.json`).toBe(name)
    }
  })

  it('lists every template in the index, and nothing that is not a template', () => {
    expect(index.templates.map((entry) => entry.id).sort()).toEqual(templates.map((t) => t.id).sort())
    for (const entry of index.templates) {
      const template = templates.find((candidate) => candidate.id === entry.id)
      expect(template?.name).toEqual(entry.name)
      expect(template?.person).toBe(entry.person)
      expect(template?.csmopRef.paras).toEqual(entry.csmopParas)
    }
  })

  it('cites CSMOP 2022 for every template, and a chassis where the manual prescribes no form', () => {
    for (const template of templates) {
      expect(template.csmopRef.edition, template.id).toBe('CSMOP 2022, sixteenth edition')
      expect(template.csmopRef.paras.length, template.id).toBeGreaterThan(0)
      expect(template.source.url, template.id).toMatch(/^https:\/\/www\.darpg\.gov\.in\//)

      // A form the manual does not prescribe must say whose format it borrows,
      // and must carry verify: true — the reader is owed the distinction
      // between "CSMOP says this" and "this is how it is done".
      if (template.verify) {
        expect(template.csmopRef.chassis, `${template.id} is unverified and names no chassis`).toBeTruthy()
        expect(template.csmopRef.note, `${template.id} is unverified and explains nothing`).toBeTruthy()
      }
      if (template.csmopRef.chassis) {
        expect(templates.map((candidate) => candidate.id)).toContain(template.csmopRef.chassis)
      }
    }
  })

  it('gives every template a bilingual layout that places the same blocks', () => {
    for (const template of templates) {
      const en = template.layout.en.map((block) => block.role)
      const hi = template.layout.hi.map((block) => block.role)
      expect(hi, template.id).toEqual(en)
    }
  })

  it('resolves every placeholder in every layout to a field of that template', () => {
    for (const template of templates) {
      const fields = new Set(template.fields.map((field) => field.id))
      for (const lang of LANGS) {
        for (const block of template.layout[lang]) {
          for (const line of [...(block.lines ?? []), block.lead ?? '']) {
            for (const [, id] of line.matchAll(/\{\{([a-zA-Z][a-zA-Z0-9]*)\}\}/g)) {
              expect(fields, `${template.id}/${lang}: {{${id}}}`).toContain(id)
            }
          }
          if (block.source) expect(fields, `${template.id}/${lang}: source`).toContain(block.source)
        }
      }
    }
  })

  it('gives every required field a sample in both languages', () => {
    for (const template of templates) {
      for (const field of template.fields.filter((candidate) => candidate.required)) {
        for (const lang of LANGS) {
          const sample = field.sample[lang]
          expect(sample.length, `${template.id}/${field.id}/${lang}`).toBeGreaterThan(0)
        }
      }
    }
  })

  it('states an Office Memorandum is third person and a demi-official letter is first', () => {
    // CSMOP 8.4(3) and 8.4(2). These two are the manual's own contrast and the
    // one an officer is most often marked down on.
    const om = templates.find((template) => template.id === 'office-memorandum')
    expect(om?.person).toBe('third')
    expect(om?.salutation ?? null).toBeNull()
    expect(om?.subscription ?? null).toBeNull()

    const doLetter = templates.find((template) => template.id === 'demi-official')
    expect(doLetter?.person).toBe('first')
    expect(doLetter?.subscription?.en).toBe('Yours sincerely,')
  })
})

describe('rendering every template from its samples', () => {
  for (const template of templates) {
    describe(template.id, () => {
      for (const lang of LANGS) {
        it(`renders in ${lang} with no unresolved placeholder and no issue`, () => {
          const result = renderDocument(template, {}, lang)
          const text = serialise(result.document)

          expect(text).not.toMatch(/\{\{/)
          expect(result.issues, `${template.id}/${lang}`).toEqual([])
          expect(result.document.blocks.length).toBeGreaterThan(2)
        })
      }

      it('renders bilingually, pairing every block', () => {
        const result = render(template, {}, 'bilingual')
        expect(result.issues).toEqual([])
        expect(result.pairs.length).toBeGreaterThan(0)
        for (const pair of result.pairs) {
          expect(pair.en.lines.length + pair.hi.lines.length, `${template.id}/${pair.role}`).toBeGreaterThan(
            0,
          )
        }
      })

      it('renders in Devanagari digits without breaking its own checklist', () => {
        const result = renderDocument(template, {}, 'hi', { devanagariDigits: true })
        expect(serialise(result.document)).not.toMatch(/\{\{/)
        expect(countFailures(evaluateChecklist(template, result)).must).toBe(0)
      })

      for (const lang of LANGS) {
        it(`passes its own checklist in ${lang}`, () => {
          const result = renderDocument(template, {}, lang)
          const checks = evaluateChecklist(template, result)

          expect(checks).toHaveLength(template.checklist.length)
          const failed = checks.filter((check) => !check.passed).map((check) => check.id)
          expect(failed, `${template.id}/${lang}`).toEqual([])
        })
      }

      it('fails its must-items when the document is emptied out', () => {
        // The other half of the checklist's claim: an evaluator that only ever
        // says "pass" is not checking anything. Blanking every field must move
        // at least one must-item to failing.
        const blanked = Object.fromEntries(template.fields.map((field) => [field.id, '']))
        const result = renderDocument(template, blanked, 'en')
        expect(countFailures(evaluateChecklist(template, result)).must).toBeGreaterThan(0)
      })
    })
  }
})

describe('data/_meta/versions.json', () => {
  const versions = JSON.parse(readFromRoot('data/_meta/versions.json')) as {
    datasets: Record<string, { version: string; updated: string; rows?: number; sha256?: string } | undefined>
  }

  it('counts what is actually on disk', () => {
    expect(versions.datasets['drafting-templates']?.rows).toBe(templates.length)
    expect(versions.datasets['drafting-terms']?.rows).toBe(terms.terms.length)
    expect(versions.datasets['drafting-phrases']?.rows).toBe(phrases.phrases.length)
  })

  it('digests the committed bytes, so an edited dataset cannot keep its version', () => {
    const digest = (paths: string[]) =>
      createHash('sha256')
        .update(Buffer.concat(paths.sort().map((path) => Buffer.from(readFromRoot(path), 'utf8'))))
        .digest('hex')

    expect(versions.datasets['drafting-templates']?.sha256).toBe(
      digest([...templateFiles.map((name) => `${TEMPLATE_DIR}/${name}`), 'data/drafting/index.json']),
    )
    expect(versions.datasets['drafting-terms']?.sha256).toBe(digest(['data/drafting/structure-terms.json']))
    expect(versions.datasets['drafting-phrases']?.sha256).toBe(digest(['data/drafting/phrases.json']))
  })

  it('carries no source URL for the drafting datasets', () => {
    // ADR-016: versions.json is bundled, so a URL in it reaches dist/ and needs
    // a line in tests/no-external-urls.test.ts. The citations the UI shows live
    // in each record's own `source` inside the dataset.
    for (const key of ['drafting-templates', 'drafting-terms', 'drafting-phrases']) {
      expect(JSON.stringify(versions.datasets[key])).not.toMatch(/https?:/)
    }
  })
})

describe('the phrase library', () => {
  it('applies every phrase to a real template, or to all of them', () => {
    const ids = new Set(templates.map((template) => template.id))
    for (const phrase of phrases.phrases) {
      for (const target of phrase.appliesTo) {
        if (target === '*') continue
        expect(ids, `phrase ${phrase.id}`).toContain(target)
      }
    }
  })

  it('offers at least one opening and one closing for every template', () => {
    for (const template of templates) {
      const applicable = phrases.phrases.filter(
        (phrase) => phrase.appliesTo.includes('*') || phrase.appliesTo.includes(template.id),
      )
      expect(applicable.length, template.id).toBeGreaterThan(0)
    }
  })

  it('keeps the Hindi a matched pair rather than a placeholder', () => {
    for (const phrase of phrases.phrases) {
      expect(phrase.text.hi, phrase.id).not.toBe(phrase.text.en)
      expect(phrase.text.hi, phrase.id).toMatch(/[ऀ-ॿ]/)
    }
  })

  it('keeps the {placeholder} slots identical in both languages', () => {
    // A phrase whose Hindi drops {date} would be inserted into a Hindi draft
    // with nowhere to put the date.
    const slots = (text: string) => [...text.matchAll(/\{([a-zA-Z]+)\}/g)].map(([, name]) => name).sort()
    for (const phrase of phrases.phrases) {
      expect(slots(phrase.text.hi), phrase.id).toEqual(slots(phrase.text.en))
    }
  })
})

describe('the Rajbhasha structure terms', () => {
  it('gives every term a Hindi equivalent in Devanagari', () => {
    for (const term of terms.terms) {
      expect(term.hi, term.id).toMatch(/[ऀ-ॿ]/)
      expect(term.en, term.id).not.toBe(term.hi)
    }
  })

  it('names the forms, the parts, the urgency labels and the designations', () => {
    const byId = new Map(terms.terms.map((term) => [term.id, term]))

    // What the manual's own Hindi issue prints, read off the rendered pages.
    expect(byId.get('office-memorandum')?.hi).toBe('कार्यालय ज्ञापन')
    expect(byId.get('demi-official-letter')?.hi).toBe('अर्ध-सरकारी पत्र')
    expect(byId.get('id-note')?.hi).toBe('अंतर-विभागीय टिप्पणी')
    expect(byId.get('notification')?.hi).toBe('अधिसूचना')
    expect(byId.get('endorsement')?.hi).toBe('पृष्ठांकन')
    expect(byId.get('subject')?.hi).toBe('विषय')
    expect(byId.get('copy-to')?.hi).toBe('प्रतिलिपि')
    expect(byId.get('under-secretary')?.hi).toBe('अवर सचिव, भारत सरकार')
    expect(byId.get('section-officer')?.hi).toBe('अनुभाग अधिकारी')

    // CSMOP 6.13 prints परम अग्रता for Top Priority. सर्वोच्च अग्रता is the
    // rendering everyone expects and is not the manual's; it is kept as an
    // alias so a search for it finds the term.
    expect(byId.get('immediate')?.hi).toBe('तत्काल')
    expect(byId.get('priority')?.hi).toBe('अग्रता')
    expect(byId.get('top-priority')?.hi).toBe('परम अग्रता')
    expect(byId.get('top-priority')?.alsoHi).toContain('सर्वोच्च अग्रता')
    expect(byId.get('demi-official-letter')?.alsoHi).toContain('अर्ध-शासकीय पत्र')
  })

  it('cites the manual where the manual says it, and the glossary where it does not', () => {
    for (const term of terms.terms) {
      if (term.verify) {
        expect(term.source.url, term.id).toBe(
          'https://rajbhasha.gov.in/sites/default/files/saralshabdavali.pdf',
        )
      } else {
        expect(term.source.url, term.id).toMatch(/^https:\/\/www\.darpg\.gov\.in\//)
        expect(term.csmopRef, `${term.id} claims CSMOP but cites no paragraph`).toBeTruthy()
      }
    }
  })

  it('covers every urgency label the templates offer as a choice', () => {
    const urgencies = new Set(
      terms.terms.filter((term) => term.category === 'urgency').map((term) => term.hi),
    )
    const offered = templates
      .flatMap((template) => template.fields)
      .filter((field) => field.id === 'urgency')
      .flatMap((field) => field.options ?? [])
      .filter((option) => option.value !== 'none')
      .map((option) => option.label.hi)

    expect(offered.length).toBeGreaterThan(0)
    for (const label of new Set(offered)) expect(urgencies).toContain(label)
  })
})
