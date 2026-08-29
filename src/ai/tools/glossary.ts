import { z } from 'zod'

import { registerTool, registeredToolNames } from './registry'

import { loadGlossary } from '@/modules/utils/glossary/data'
import { buildGlossaryIndex, searchGlossary, type GlossaryIndex } from '@/modules/utils/glossary/search'
import { GLOSSARY_CATEGORIES, type GlossaryTerm } from '@/modules/utils/glossary/schema'

/**
 * One tool over `data/glossary.json` — the 1,891-term Hindi administrative
 * glossary Session 10 compiled.
 *
 * It is a separate file from `tools/drafting.ts`, and a separate SCOPE, on
 * purpose. `lookup_admin_term` (scope `draft`) answers "what does CSMOP call
 * this part of a document?" over 78 structural terms the manual itself prints;
 * this answers "what is the standard Rajbhasha rendering of this ordinary
 * administrative word?" over a general vocabulary that no single fetched page
 * backs. Two datasets, two questions, and `glossary_seed.py` actively excludes
 * any term the two would otherwise answer twice (ADR-024). An agent that wants
 * both asks for both scopes.
 *
 * ### Every entry says `verify: true`, and the tool repeats it
 *
 * Unlike `structure-terms.json`, nothing here was read off a specific page of a
 * specific fetched document: the source PDF exceeded `WebFetch`'s 10 MB ceiling
 * and the vocabulary was compiled instead (`docs/DATA-GAPS.md` #48). So the
 * result carries the same sentence the term row on screen carries, rather than
 * letting an agent present compiled vocabulary as a citation. A drafting agent
 * that renders `अवर सचिव` on a signed document owes the officer that caveat.
 *
 * Like every tool in this app it is a pure function over a bundled `?raw`
 * chunk. The dataset is ~970 KB and is loaded only when the tool is actually
 * called, which for a drafting run means only when the officer is drafting in
 * Hindi.
 */

const VERIFY_NOTE = {
  en:
    'Every entry in this glossary is compiled standard Rajbhasha usage, not a transcription of one ' +
    'fetched page, so all of them carry `verify: true`. Offer the Hindi rendering as a suggestion and ' +
    'tell the reader to check it against the Department of Official Language’s own term list.',
  hi:
    'इस शब्दावली की प्रत्येक प्रविष्टि संकलित मानक राजभाषा प्रयोग है, किसी एक अभिगृहीत पृष्ठ का ' +
    'प्रतिलेखन नहीं — इसलिए सभी `verify: true` रखती हैं। हिंदी रूप सुझाव के रूप में दें और पाठक से ' +
    'कहें कि वह राजभाषा विभाग की अपनी शब्द-सूची से उसकी जाँच कर ले।',
}

/**
 * The Fuse index, built once per tab. Building it is the expensive half —
 * 1,891 entries, each folded through `romanKey()` — and a drafting run looks up
 * several terms in a row.
 */
let index: Promise<GlossaryIndex> | null = null

/**
 * Shared with `src/ai/agents/drafting.ts`, which builds glossary CONTEXT
 * snippets from the same index rather than a second one — a second Fuse index
 * over 1,891 entries is measurable work, and two indexes that could disagree
 * about a term is worse than the work.
 */
export function glossaryIndex(): Promise<GlossaryIndex> {
  if (index) return index
  // A failed load is never remembered: one interrupted import must not poison
  // every later lookup in the tab.
  const pending = loadGlossary()
    .then(buildGlossaryIndex)
    .catch((error: unknown) => {
      index = null
      throw error
    })
  index = pending
  return pending
}

/** Test seam, and the counterpart of `resetGlossaryCache()`. */
export function resetGlossaryToolCache(): void {
  index = null
}

const describe = (term: GlossaryTerm) => ({
  id: term.id,
  category: term.category,
  en: term.en,
  hi: term.hi,
  alsoWritten: term.alsoHi ?? [],
  note: term.note?.en ?? null,
  source: { name: term.source.name, url: term.source.url },
  verify: term.verify,
})

export function registerGlossaryTools(): void {
  if (registeredToolNames().includes('lookup_glossary_term')) return

  registerTool({
    name: 'lookup_glossary_term',
    scope: 'utils',
    description: {
      en:
        'The standard Hindi administrative rendering of an English word, or the English behind a Hindi ' +
        'one — designations, office vocabulary, file and noting vocabulary, finance, establishment, ' +
        'legal and IT terms. Search in either script, or in roman Hindi ("avar sachiv" finds अवर सचिव). ' +
        'Use this before writing Hindi administrative prose: the register is not everyday Hindi, and a ' +
        'plausible translation of "Under Secretary" is not what a Ministry file calls one. Every entry ' +
        'is compiled vocabulary rather than a transcription of one published page, so pass the caveat ' +
        'in `verifyNote` on to the reader.',
      hi:
        'किसी अंग्रेज़ी शब्द का मानक हिंदी प्रशासनिक रूप, अथवा किसी हिंदी शब्द के पीछे की अंग्रेज़ी — ' +
        'पदनाम, कार्यालय शब्दावली, फाइल एवं टिप्पणी शब्दावली, वित्त, स्थापना, विधि तथा सूचना-प्रौद्योगिकी ' +
        'शब्द। किसी भी लिपि में, अथवा रोमन हिंदी में खोजें ("avar sachiv" से अवर सचिव मिलता है)। हिंदी ' +
        'प्रशासनिक गद्य लिखने से पूर्व इसका प्रयोग करें: यह रजिस्टर रोज़मर्रा की हिंदी नहीं है। प्रत्येक ' +
        'प्रविष्टि संकलित शब्दावली है, अतः `verifyNote` की चेतावनी पाठक तक पहुँचाएँ।',
    },
    inputSchema: z.object({
      query: z.string().min(1).max(120).describe('A word or short phrase, in English, Hindi or roman Hindi.'),
      category: z
        .enum(GLOSSARY_CATEGORIES as unknown as [string, ...string[]])
        .optional()
        .describe('Narrow to one category. Omit to search all seven.'),
      limit: z.number().int().min(1).max(15).optional().describe('Default 8.'),
    }),
    handler: async ({ query, category, limit }) => {
      const built = await glossaryIndex()
      const matches = searchGlossary(
        built,
        query,
        (category as Parameters<typeof searchGlossary>[2]) ?? 'all',
      ).slice(0, limit ?? 8)

      return {
        query,
        category: category ?? 'all',
        count: matches.length,
        terms: matches.map(describe),
        verifyNote: VERIFY_NOTE.en,
      }
    },
  })
}
