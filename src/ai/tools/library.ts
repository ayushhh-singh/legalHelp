import { z } from 'zod'

import { registerTool, registeredToolNames } from './registry'

import { db } from '@/db'
import {
  buildCorpus,
  isWorkId,
  loadCorpus,
  loadDefinitions,
  loadStudyAids,
  loadWork,
  paragraphs,
  unitLabel,
  type LibraryCorpus,
} from '@/lib/library'
import {
  buildRetrievalIndex,
  retrieve as retrieveFrom,
  type RetrievalDoc,
  type RetrievalIndex,
} from '@/lib/retrieval'
import { chaptersOf } from '@/lib/study'
import { docsFromAids, docsFromCorpus, docsFromDefinitions } from '@/modules/library/retrievalDocs'
import { loadCardsForAct } from '@/modules/trainer/data'
import type { Card } from '@/modules/trainer/schema'
import { effectiveCatalogue } from '@/modules/trainer/reviewQueue'
import { isAidServed } from '@/schemas/library'

/**
 * The Library's agent tools — Session 28's study agent.
 *
 * Six tools, all within the registry's stated contract: a pure function over
 * bundled JSON in `/data` or the reader's own IndexedDB rows, never the
 * network. Three things about them are decisions rather than plumbing:
 *
 * 1. **`get_my_notes` marks everything it returns `personal: true`, and every
 *    consumer reads that flag.** A note is the reader's own opinion of a rule
 *    and a section is the law; `src/ai/agents/study.ts` labels the two with
 *    different `SnippetType`s and the prompt file forbids presenting one as the
 *    other. It is the only tool in this app that returns the reader's own
 *    writing to a model, which is exactly why it says so on every row.
 *
 * 2. **`retrieve` is the SAME engine the plain search box uses.** Not a
 *    parallel implementation for the agent — `src/lib/retrieval.ts` powers
 *    both, so a reader with AI off exercises the identical ranking. A retrieval
 *    layer whose only consumer is an agent is one nobody can check.
 *
 * 3. **`get_related_cards` returns only APPROVED cards**, through the same
 *    `effectiveCatalogue` fold every Trainer surface uses. An agent that
 *    quoted an unreviewed card would be quoting a question no critic pass had
 *    read.
 */

const workRef = z.string().min(1).describe('A Library work id — "ccs-conduct", "rti", "bns". Fifteen exist.')

/** Cached per work for the tab's life. The datasets are large and immutable. */
const cache = new Map<string, Promise<unknown>>()
function once<T>(key: string, load: () => Promise<T>): Promise<T> {
  const existing = cache.get(key) as Promise<T> | undefined
  if (existing) return existing
  const pending = load().catch((error: unknown) => {
    cache.delete(key)
    throw error
  })
  cache.set(key, pending)
  return pending
}

const corpusOnce = (workId: string): Promise<LibraryCorpus> =>
  once(`corpus:${workId}`, async () => loadCorpus(await loadWork(workId)))

/**
 * A retrieval index over ONE work: its units, its aids and its defined terms.
 *
 * Scoped to a work rather than built over the whole library because the whole
 * library is 5.5 MB of statute and an agent answering a question about the CCS
 * (Conduct) Rules has no business downloading the BNSS. The reader's notes are
 * NOT in this index — they are a separate tool, so that a caller who wants a
 * shareable answer can simply not call it.
 */
const indexOnce = (workId: string): Promise<RetrievalIndex> =>
  once(`index:${workId}`, async () => {
    const [work, corpus, aids, definitions] = await Promise.all([
      loadWork(workId),
      corpusOnce(workId),
      loadStudyAids(workId),
      loadDefinitions(workId),
    ])
    const docs: RetrievalDoc[] = [
      ...docsFromCorpus(corpus, 'en', work.corpus.kind === 'law' ? 'section' : 'rule', work.source.url),
      ...docsFromAids(aids.aids.filter(isAidServed), corpus, 'en'),
      ...docsFromDefinitions(definitions.terms, work, definitions.unitId, 'en'),
    ]
    return buildRetrievalIndex(docs)
  })

/** Test seam. Production never needs to drop what it has parsed. */
export function resetLibraryToolCache(): void {
  cache.clear()
}

export function registerLibraryTools(): void {
  if (registeredToolNames().includes('get_unit')) return

  registerTool({
    name: 'get_unit',
    scope: 'library',
    description: {
      en:
        'The full text of one unit of one work — a rule, a section or a numbered paragraph — with its ' +
        'heading, its citation and the sub-rules the corpus records. Call this before explaining what a ' +
        'provision says; a citation names it, it does not quote it.',
      hi:
        'किसी कृति की एक इकाई — नियम, धारा अथवा क्रमांकित पैरा — का पूर्ण पाठ, शीर्षक, उद्धरण तथा ' +
        'कोष में अभिलिखित उप-नियमों सहित। कोई उपबंध क्या कहता है यह बताने से पूर्व इसे चलाएँ; उद्धरण ' +
        'उसका नाम लेता है, उसे उद्धृत नहीं करता।',
    },
    inputSchema: z.object({
      work: workRef,
      unit: z.string().min(1).describe('A unit id — "ccs-conduct-18", "103".'),
    }),
    handler: async ({ work, unit }) => {
      if (!isWorkId(work)) return { work, found: false, error: 'unknown work' }
      const corpus = await corpusOnce(work)
      const found = corpus.units.get(unit)
      if (!found) {
        return { work, unit, found: false, available: [...corpus.order].slice(0, 40) }
      }
      const label = unitLabel(found.heading, found.excerpt, 'en')
      return {
        work,
        unit,
        found: true,
        number: found.number,
        heading: label.text,
        headingIsExcerpt: label.isExcerpt,
        citation: found.citation.en,
        text: found.body.en.join('\n\n'),
        // The Hindi body is empty for all fifteen works (ADR-023) and the flag
        // says so rather than returning an empty string a model might quote.
        hindiTextAvailable: found.body.hi.length > 0,
        subRules: found.parts.map((part) => ({ number: part.number, text: part.text.en })),
      }
    },
  })

  registerTool({
    name: 'get_study_aid',
    scope: 'library',
    description: {
      en:
        'The precomputed study aid for one unit, if one has been written: a plain-language explanation, ' +
        'a worked example, the misconception it invites, why an examiner asks about it, and a memory ' +
        'hook. It is Sahayak’s own writing, reviewed but NOT published by any Ministry — say so if you ' +
        'quote it, and never present it as the text of the provision.',
      hi:
        'किसी इकाई हेतु पूर्वगणित अध्ययन सहायिका, यदि लिखी गई हो: सरल भाषा में व्याख्या, उदाहरण, वह ' +
        'भ्रांति जो यह उपबंध उत्पन्न करता है, परीक्षक इस पर क्यों पूछता है, तथा स्मृति-सूत्र। यह सहायक ' +
        'का अपना लेखन है, समीक्षित किंतु किसी मंत्रालय द्वारा प्रकाशित नहीं — उद्धृत करें तो यह कहें, ' +
        'और इसे उपबंध का पाठ कभी न बताएँ।',
    },
    inputSchema: z.object({ work: workRef, unit: z.string().min(1) }),
    handler: async ({ work, unit }) => {
      if (!isWorkId(work)) return { work, found: false, error: 'unknown work' }
      const aids = await once(`aids:${work}`, () => loadStudyAids(work))
      const aid = aids.aids.filter(isAidServed).find((entry) => entry.unitId === unit)
      if (!aid) return { work, unit, found: false }
      return {
        work,
        unit,
        found: true,
        explanation: aid.explanation.en,
        example: aid.example.en,
        misconception: aid.misconception?.en ?? null,
        examRelevance: aid.examRelevance?.en ?? null,
        mnemonic: aid.mnemonic?.en ?? null,
        connects: aid.connects,
        // Every aid carries this, without exception. A surface that renders one
        // owes the reader the same marigold treatment a curated Hindi heading
        // gets in the Law Converter.
        verify: aid.verify,
        source: { name: aid.source.name, url: aid.source.url },
      }
    },
  })

  registerTool({
    name: 'get_definitions',
    scope: 'library',
    description: {
      en:
        'The terms one work defines, from its own definitions clause. Every row carries a confidence; ' +
        'anything below "high" was extracted rather than read and is marked for verification. Use this ' +
        'when a provision turns on a defined term rather than on an ordinary word.',
      hi:
        'कोई कृति अपने परिभाषा-खंड में जिन पदों को परिभाषित करती है। प्रत्येक पंक्ति विश्वास-स्तर रखती ' +
        'है; "उच्च" से नीचे की पंक्ति पढ़ी नहीं, निकाली गई है और सत्यापन हेतु चिह्नित है। जब कोई उपबंध ' +
        'किसी सामान्य शब्द पर नहीं, परिभाषित पद पर टिका हो तब इसका प्रयोग करें।',
    },
    inputSchema: z.object({
      work: workRef,
      term: z.string().min(1).optional().describe('One term. Omit for every term the work defines.'),
    }),
    handler: async ({ work, term }) => {
      if (!isWorkId(work)) return { work, found: false, error: 'unknown work' }
      const definitions = await once(`definitions:${work}`, () => loadDefinitions(work))
      const needle = term?.trim().toLowerCase()
      const rows = needle
        ? definitions.terms.filter((entry) => entry.term.toLowerCase().includes(needle))
        : definitions.terms
      return {
        work,
        unitId: definitions.unitId,
        unitNumber: definitions.unitNumber,
        count: rows.length,
        terms: rows.slice(0, 40).map((entry) => ({
          term: entry.term,
          definition: entry.definition,
          confidence: entry.confidence,
          verify: entry.verify,
        })),
      }
    },
  })

  registerTool({
    name: 'retrieve',
    scope: 'library',
    description: {
      en:
        'Search one work — its provisions, its study aids and its defined terms — and return the best ' +
        'matches with their citations. Number-aware: "Rule 18(2)" and "18" both reach the rule. Use it ' +
        'when the reader names something you cannot address by unit id, or to find the OTHER provision a ' +
        'comparison needs.',
      hi:
        'किसी एक कृति में खोजें — उसके उपबंध, अध्ययन सहायिकाएँ तथा परिभाषित पद — और सर्वोत्तम मिलान ' +
        'उनके उद्धरणों सहित लौटाएँ। संख्या-सजग: "नियम 18(2)" और "18" दोनों उसी नियम तक पहुँचते हैं। जब ' +
        'पाठक किसी ऐसी बात का नाम ले जिसे आप इकाई-आईडी से नहीं पा सकते, अथवा तुलना हेतु दूसरा उपबंध ' +
        'खोजना हो, तब इसका प्रयोग करें।',
    },
    inputSchema: z.object({
      work: workRef,
      query: z.string().min(1).max(200),
      k: z.number().int().min(1).max(10).optional(),
    }),
    handler: async ({ work, query, k }) => {
      if (!isWorkId(work)) return { work, count: 0, error: 'unknown work' }
      const index = await indexOnce(work)
      const hits = retrieveFrom(index, query, { k: k ?? 5 })
      return {
        work,
        query,
        count: hits.length,
        results: hits.map((hit) => ({
          kind: hit.kind,
          citation: hit.citation,
          heading: hit.heading,
          text: hit.text,
          matchedOn: hit.reason,
          // Always present, always false here: this index holds no notes. It is
          // returned anyway so a consumer never has to know which tool a
          // snippet came from to know whether it is the reader's own.
          personal: hit.personal,
        })),
      }
    },
  })

  registerTool({
    name: 'get_related_cards',
    scope: 'library',
    description: {
      en:
        'The approved practice questions that cite one unit, from the Rules Trainer’s own catalogue. Use ' +
        'this to tell a reader what they will be asked about a provision, or to ground "quiz me" in ' +
        'questions that already exist rather than inventing one.',
      hi:
        'नियम प्रशिक्षक की अपनी सूची से वे अनुमोदित अभ्यास-प्रश्न जो किसी इकाई का उद्धरण देते हैं। पाठक ' +
        'को यह बताने हेतु कि किसी उपबंध पर उससे क्या पूछा जाएगा, अथवा "मुझसे पूछो" को नया प्रश्न गढ़ने ' +
        'के बजाय पहले से विद्यमान प्रश्नों में आधारित करने हेतु इसका प्रयोग करें।',
    },
    inputSchema: z.object({
      work: workRef,
      unit: z.string().min(1).optional().describe('One unit. Omit for the whole chapter named by `node`.'),
      node: z.string().min(1).optional().describe('A table-of-contents node id, for a whole chapter.'),
      limit: z.number().int().min(1).max(20).optional(),
    }),
    handler: async ({ work, unit, node, limit }) => {
      if (!isWorkId(work)) return { work, count: 0, error: 'unknown work' }

      let units: string[] = unit ? [unit] : []
      if (!unit && node) {
        const chapter = chaptersOf(await loadWork(work)).find((entry) => entry.nodeId === node)
        units = [...(chapter?.unitIds ?? [])]
      }
      if (units.length === 0) return { work, count: 0, cards: [] }

      /*
        ONE act, not the Trainer's whole catalogue.

        This used to call `loadAllCards`, which is 1.1 MB across twelve rule
        books, to answer a question about one of them — the same waste the
        Library's coverage heat-map had, and the reason `practiseCounts` is in
        the dataset at all (ADR-038 §2). Every one of the twelve rule-book work
        ids IS its act id, asserted in `src/ai/tools/library.edge.test.ts`; the
        three Sanhitas have no cards and resolve to nothing rather than to an
        error.
      */
      const [raw, overrides, proposed] = await Promise.all([
        once(`cards:${work}`, () =>
          loadCardsForAct(work)
            .then((file) => file.cards)
            .catch(() => [] as Card[]),
        ),
        db.cardOverrides.toArray(),
        db.proposedCards.toArray(),
      ])
      const wanted = new Set(units)
      const cards = effectiveCatalogue(raw, overrides, proposed).filter((card) =>
        wanted.has(card.ruleRef.textId),
      )

      return {
        work,
        count: cards.length,
        cards: cards.slice(0, limit ?? 10).map((card) => ({
          id: card.id,
          kind: card.kind,
          question: card.front.en,
          answer: card.back.en,
          citation: card.ruleRef.citation.en,
          unit: card.ruleRef.textId,
        })),
      }
    },
  })

  registerTool({
    name: 'get_my_notes',
    scope: 'library',
    description: {
      en:
        'The reader’s OWN margin notes and highlighted passages on a unit or a work. EVERY ROW IS THE ' +
        'READER’S OWN WRITING, not the law and not this app’s: `personal` is true on all of them. If you ' +
        'use one, say it is what the reader wrote, and never present it as what a provision says.',
      hi:
        'किसी इकाई अथवा कृति पर पाठक की अपनी हाशिया-टिप्पणियाँ तथा रेखांकित अंश। प्रत्येक पंक्ति पाठक ' +
        'का अपना लेखन है, न विधि का न इस ऐप का: उन सब पर `personal` सत्य है। यदि आप किसी का उपयोग करें ' +
        'तो कहें कि यह पाठक ने लिखा है, और उसे कभी किसी उपबंध का कथन न बताएँ।',
    },
    inputSchema: z.object({
      work: workRef,
      unit: z.string().min(1).optional().describe('One unit. Omit for every note in the work.'),
    }),
    handler: async ({ work, unit }) => {
      // The same guard the other five carry. It was missing here — on the one
      // tool that reads what the officer wrote — so an unknown work id returned
      // an empty, confident `{ personal: true, notes: [], highlights: [] }`
      // instead of saying it did not recognise the work.
      if (!isWorkId(work)) return { work, personal: true, error: 'unknown work', notes: [], highlights: [] }
      const [notes, highlights] = await Promise.all([
        unit
          ? db.libraryNotes.where('[workId+unitId]').equals([work, unit]).toArray()
          : db.libraryNotes.where('workId').equals(work).toArray(),
        unit
          ? db.libraryHighlights.where('[workId+unitId]').equals([work, unit]).toArray()
          : db.libraryHighlights.where('workId').equals(work).toArray(),
      ])
      return {
        work,
        ...(unit ? { unit } : {}),
        personal: true,
        notes: notes.slice(0, 20).map((row) => ({ unit: row.unitId, body: row.body, personal: true })),
        highlights: highlights
          .slice(0, 20)
          .map((row) => ({ unit: row.unitId, quote: row.quote, colour: row.colour, personal: true })),
      }
    },
  })
}

/**
 * Building a corpus from a work and a raw dataset, re-exported so a caller that
 * already holds both does not have to import two modules. Nothing in this file
 * uses it; it exists because `src/lib/library` is the pure layer and this is
 * the AI layer's door onto it.
 */
export { buildCorpus, paragraphs }
