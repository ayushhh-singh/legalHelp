import { z } from 'zod'

import { registerTool, registeredToolNames } from './registry'

import { LAW_CODES, loadCorpus, OLD_ACT_FOR } from '@/modules/law/data'
import { citationFor, correspondingRefs } from '@/modules/law/citation'
import { summariseChanges } from '@/modules/law/changes'
import { lookupOldSection, normaliseSectionRef, sectionBase } from '@/modules/law/resolve'
import { buildEngine, searchLaw, type LawSearchEngine } from '@/modules/law/search'
import type { LawCode, LawCorpus, LawSection } from '@/modules/law/types'
import { LANGUAGES } from '@/i18n'

/**
 * The Law Converter's agent tools.
 *
 * Every one of these is a pure function over `data/law/*.json`, which reaches
 * the device as a lazily-imported chunk and never as a network request (see
 * `src/modules/law/data.ts`). That is the registry's first rule, and it is what
 * lets an agent answer a question about the BNS while the app keeps its
 * promise that nothing a reader types goes anywhere.
 *
 * Their second job is grounding. `runAgent` discards any answer that states a
 * section number no cited tool result contains (ADR-011), so these results are
 * written to carry the numbers, the headings and the source URL explicitly —
 * a result that omitted the section number would make a correct answer
 * unciteable.
 */

const codeEnum = z.enum(LAW_CODES as unknown as [LawCode, ...LawCode[]])
const oldActEnum = z.enum(['IPC', 'CrPC', 'IEA'])
const sectionRef = z
  .string()
  .min(1)
  .max(16)
  .describe('Section number, with an optional sub-section: "103", "103(1)", "376AB".')

/**
 * One Fuse index over 1,059 records, built at most once per tab. Rebuilding it
 * per tool call would cost a second on a phone and would be paid on every step
 * of every agent run.
 */
let enginePromise: Promise<LawSearchEngine> | null = null

async function engine(): Promise<LawSearchEngine> {
  // A failed load must not be remembered: caching the rejected promise would
  // make one interrupted download poison every later tool call in the tab.
  enginePromise ??= loadCorpus()
    .then(buildEngine)
    .catch((error: unknown) => {
      enginePromise = null
      throw error
    })
  return enginePromise
}

const corpus = (): Promise<LawCorpus> => loadCorpus()

/** The shape every result shares, so a citation can be built from any of them. */
function describe(code: LawCode, record: LawSection, actName: { en: string; hi: string }) {
  return {
    code,
    act: record.act,
    section: record.section,
    actName: actName.en,
    heading: record.heading,
    status: record.status,
    correspondsTo: correspondingRefs(record).map((ref) => `${ref.act} ${ref.section}`),
    /** True where the Hindi is hand-authored rather than statutory. */
    hindiIsCurated: record.verify,
  }
}

export function registerLawTools(): void {
  if (registeredToolNames().includes('search_sections')) return

  registerTool({
    name: 'search_sections',
    scope: 'law',
    description: {
      en:
        'Search the Bharatiya Nyaya Sanhita, Bharatiya Nagarik Suraksha Sanhita and Bharatiya Sakshya ' +
        'Adhiniyam by section number, by English or Hindi words, or by roman-Hindi ("hatya"). Accepts a ' +
        'repealed-Act number ("IPC 302", "crpc 154") and returns the section of the new Act it maps to. ' +
        'Use this first: never state a section number that a result here has not returned.',
      hi:
        'भारतीय न्याय संहिता, भारतीय नागरिक सुरक्षा संहिता तथा भारतीय साक्ष्य अधिनियम में धारा संख्या से, ' +
        'अंग्रेजी या हिंदी शब्दों से, अथवा रोमन-हिंदी ("hatya") से खोज। निरसित अधिनियम की संख्या ' +
        '("IPC 302", "crpc 154") भी स्वीकार्य है और उसका तत्संगत नया उपबंध लौटाया जाता है। पहले इसी को ' +
        'चलाएँ: कोई भी धारा संख्या तब तक न बताएँ जब तक वह यहाँ के परिणाम में न आई हो।',
    },
    inputSchema: z.object({
      query: z.string().min(1).max(200),
      code: codeEnum.optional().describe('Restrict to one code pair. Omit to search all three.'),
      direction: z
        .enum(['old-new', 'new-old'])
        .optional()
        .describe('Whether a bare number means a repealed-Act section (default) or a new-Act one.'),
      limit: z.number().int().min(1).max(25).optional(),
    }),
    handler: async ({ query, code, direction, limit }) => {
      const active = await engine()
      const result = searchLaw(active, {
        query,
        code,
        direction: direction ?? 'old-new',
      })

      return {
        query,
        direction: result.direction,
        interpretedAs: {
          sectionRef: result.parsed.sectionRef,
          act: result.parsed.act,
          text: result.parsed.text,
        },
        results: result.hits.slice(0, limit ?? 10).map((hit) => ({
          ...describe(
            hit.doc.ref.code,
            hit.doc.ref.record,
            active.corpus.datasets[hit.doc.ref.code].newAct.name,
          ),
          why: hit.reason,
        })),
        /**
         * A repealed provision the new Act dropped is a real answer. Returning
         * it separately stops an agent reading an empty result list as "I could
         * not find it" and guessing a section number instead.
         */
        droppedProvisions: result.dropped.map((provision) => ({
          act: provision.oldAct,
          section: provision.section,
          note: provision.entry.note,
          heading: provision.entry.heading,
        })),
      }
    },
  })

  registerTool({
    name: 'get_section',
    scope: 'law',
    description: {
      en:
        'The full record of one section of the BNS, BNSS or BSA: heading, the section text as published, ' +
        'the repealed provisions it replaced, curated warnings, and the source it came from. Call this ' +
        'before quoting or paraphrasing what a section says.',
      hi:
        'बीएनएस, बीएनएसएस या भा.सा.अ. की किसी एक धारा का पूरा अभिलेख: शीर्षक, प्रकाशित पाठ, वह निरसित ' +
        'उपबंध जिसका यह स्थान लेती है, संकलित चेतावनियाँ तथा स्रोत। किसी धारा का पाठ उद्धृत या ' +
        'व्याख्यायित करने से पहले इसे चलाएँ।',
    },
    inputSchema: z.object({ code: codeEnum, section: sectionRef }),
    handler: async ({ code, section }) => {
      const data = await corpus()
      const dataset = data.datasets[code]
      const record = dataset.sections[normaliseSectionRef(section)] ?? dataset.sections[sectionBase(section)]
      if (!record) {
        return { code, section, found: false, actName: dataset.newAct.name.en }
      }

      const source = dataset.sources.find((entry) => record.sources.includes(entry.id))
      return {
        found: true,
        ...describe(code, record, dataset.newAct.name),
        chapter: record.chapter,
        text: record.text,
        punishment: record.punishment,
        notes: record.notes.map((note) => ({ kind: note.kind, title: note.title, body: note.body })),
        source: source ? { name: source.name.en, url: source.url } : null,
        disclaimer: dataset.disclaimer.en,
      }
    },
  })

  registerTool({
    name: 'compare_old_new',
    scope: 'law',
    description: {
      en:
        'Given a section of a REPEALED Act (IPC, CrPC or the Indian Evidence Act, 1872), return the ' +
        'section of the new Act it corresponds to, what changed, and any number-swap warning. Returns an ' +
        'explicit "dropped" answer where the new Act has no counterpart — IPC 124A, 309, 377 and 497 ' +
        'among them. Do not assume a provision carried over.',
      hi:
        'किसी निरसित अधिनियम (भादंसं, दंप्रसं या भारतीय साक्ष्य अधिनियम, 1872) की धारा देने पर उसका ' +
        'तत्संगत नया उपबंध, क्या बदला, तथा संख्या-अदला-बदली संबंधी चेतावनी लौटाता है। जहाँ नए अधिनियम ' +
        'में कोई तत्संगत उपबंध नहीं है — भादंसं 124क, 309, 377, 497 आदि — वहाँ स्पष्ट "dropped" उत्तर ' +
        'मिलता है। यह न मानें कि हर उपबंध आगे चला आया है।',
    },
    inputSchema: z.object({ oldAct: oldActEnum, oldSection: sectionRef }),
    handler: async ({ oldAct, oldSection }) => {
      const data = await corpus()
      const entry = lookupOldSection(data.index, oldAct, oldSection)
      if (!entry) {
        return { oldAct, oldSection, found: false }
      }

      const code = Object.entries(OLD_ACT_FOR).find(([, act]) => act === oldAct)?.[0] as LawCode
      const dataset = data.datasets[code]

      if (entry.newSections.length === 0) {
        return {
          found: true,
          status: 'dropped' as const,
          oldAct,
          oldSection: normaliseSectionRef(oldSection),
          heading: entry.heading,
          note: entry.note,
          warnings: entry.warnings ?? [],
        }
      }

      return {
        found: true,
        status: 'mapped' as const,
        oldAct,
        oldSection: normaliseSectionRef(oldSection),
        oldHeading: entry.heading,
        newAct: dataset.newAct.name.en,
        corresponds: entry.newSections.map((ref) => {
          const record = dataset.sections[sectionBase(ref)]
          if (!record) return { section: ref }
          const change = summariseChanges(record, data.index)
          return {
            section: ref,
            heading: record.heading,
            sectionStatus: record.status,
            numberOnly: change.numberOnly,
            newSubSections: change.newClauses,
            changedSubSections: change.changedClauses,
          }
        }),
        warnings: entry.warnings ?? [],
      }
    },
  })

  registerTool({
    name: 'get_classification',
    scope: 'law',
    description: {
      en:
        'Whether an offence is cognizable, bailable and compoundable, the court that tries it and the ' +
        'punishment — from the BNSS First Schedule and BNSS section 359. BNS offences only: the BNSS and ' +
        'the BSA are procedural and carry no classification. Never state cognizability or bailability ' +
        'without calling this; they differ between sub-sections of the same section.',
      hi:
        'कोई अपराध संज्ञेय, जमानतीय एवं शमनीय है या नहीं, उसका विचारण कौन-सा न्यायालय करेगा तथा दंड — ' +
        'बीएनएसएस की पहली अनुसूची एवं धारा 359 से। केवल बीएनएस के अपराधों के लिए: बीएनएसएस तथा ' +
        'भा.सा.अ. प्रक्रियात्मक हैं और उनमें वर्गीकरण नहीं होता। संज्ञेयता या जमानत के बारे में इसे ' +
        'चलाए बिना कुछ न बताएँ; एक ही धारा की उपधाराओं में ये भिन्न होते हैं।',
    },
    inputSchema: z.object({ code: codeEnum, section: sectionRef }),
    handler: async ({ code, section }) => {
      const data = await corpus()
      const dataset = data.datasets[code]
      const record = dataset.sections[normaliseSectionRef(section)] ?? dataset.sections[sectionBase(section)]

      if (!record) return { code, section, found: false }
      if (record.classification.length === 0) {
        return {
          found: true,
          code,
          section: record.section,
          classified: false,
          reason:
            code === 'bns'
              ? 'The BNSS First Schedule lists no entry for this section.'
              : 'This Act is procedural; cognizability and bailability are properties of offences under the BNS.',
        }
      }

      const source = dataset.sources.find((entry) => entry.id === record.classification[0]?.source)
      return {
        found: true,
        classified: true,
        code,
        section: record.section,
        actName: dataset.newAct.name.en,
        heading: record.heading,
        classification: record.classification.map((entry) => ({
          clause: entry.clause,
          offence: entry.offence,
          punishment: entry.punishment,
          cognizable: entry.cognizable,
          bailable: entry.bailable,
          compoundable: entry.compoundable,
          compoundableBy: entry.compoundableBy,
          triableBy: entry.triableBy,
        })),
        source: source ? { name: source.name.en, url: source.url } : null,
      }
    },
  })

  registerTool({
    name: 'format_citation',
    scope: 'law',
    description: {
      en:
        'The citation for a section, written the way it goes into a file: "Section 103(1) of the ' +
        'Bharatiya Nyaya Sanhita, 2023 (corresponding to Section 302 IPC)", or the Hindi equivalent. ' +
        'Use this rather than composing a citation yourself — the Act name, the order of the words and ' +
        'the abbreviation of the repealed Act all differ between the two languages.',
      hi:
        'किसी धारा का उद्धरण, ठीक उसी रूप में जैसे वह फाइल में लिखा जाता है: "भारतीय न्याय संहिता, 2023 ' +
        'की धारा 103(1) (भा.दं.सं. की धारा 302 के तत्स्थानी)", अथवा उसका अंग्रेजी रूप। उद्धरण स्वयं न ' +
        'बनाएँ — अधिनियम का नाम, शब्दों का क्रम तथा निरसित अधिनियम का संक्षेप, तीनों दोनों भाषाओं में ' +
        'भिन्न हैं।',
    },
    inputSchema: z.object({
      code: codeEnum,
      section: sectionRef,
      lang: z.enum(LANGUAGES as unknown as ['en', 'hi']),
    }),
    handler: async ({ code, section, lang }) => {
      const data = await corpus()
      const dataset = data.datasets[code]
      const record = dataset.sections[normaliseSectionRef(section)] ?? dataset.sections[sectionBase(section)]
      if (!record) return { code, section, found: false }

      const clause = normaliseSectionRef(section)
      return {
        found: true,
        code,
        section: record.section,
        // A sub-section reference is cited as itself; a bare section number
        // cites the section. Which one the reader asked for is the input.
        citation: citationFor(
          record,
          dataset.newAct.name,
          lang,
          clause === record.section ? undefined : clause,
        ),
        heading: record.heading[lang] || record.heading.en,
        disclaimer: dataset.disclaimer[lang],
      }
    },
  })
}

/** Test seam: the memoised Fuse index, dropped. */
export function resetLawToolCache(): void {
  enginePromise = null
}
