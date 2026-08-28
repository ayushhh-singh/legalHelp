import { z } from 'zod'

import { registerTool, registeredToolNames } from './registry'

import { evaluateChecklist } from '@/lib/drafting/checklist'
import { render, renderDocument, sampleValues, serialise, serialiseBilingual } from '@/lib/drafting/engine'
import type { DraftValues } from '@/lib/drafting/types'
import {
  loadDraftingIndex,
  loadPhrases,
  loadStructureTerms,
  loadTemplate,
  TEMPLATE_IDS,
} from '@/modules/drafting/data'
import type { DocTemplate } from '@/modules/drafting/schema'

/**
 * The Drafting Studio's agent tools.
 *
 * Every one is a pure function over `data/drafting/*.json`, which reaches the
 * device as a lazily-imported chunk and never as a network request
 * (`src/modules/drafting/data.ts`, ADR-013/018/020). That is the registry's
 * first rule and it is what lets an agent answer "what goes in an Office
 * Memorandum?" while the app keeps its promise that nothing a reader types
 * goes anywhere.
 *
 * ### What is deliberately NOT here
 *
 * **No tool reads the reader's drafts.** The `drafts` table is the most
 * sensitive thing this app holds — a draft may name a case, a colleague or a
 * grievance — and no tool registered here can reach it. `renderDraft` takes
 * values as an ARGUMENT, so the only way a draft's text reaches an agent is if
 * a future surface passes it deliberately, with the reader's consent, through
 * a path a reviewer can see. Adding a `list_my_drafts` tool would quietly
 * convert every agent in the app into one that can read them; the seam for
 * doing it properly, once, is `src/modules/drafting/ai-seam.ts` (ADR-021).
 *
 * ### Grounding
 *
 * `runAgent` discards an answer that states a rule number no cited snippet
 * contains (ADR-011), so every result here carries the CSMOP paragraph behind
 * each claim at the top level, and `check_draft` returns the `why` text
 * verbatim from the template. A tool that returned only "this fails" would
 * make a correct explanation of it uncitable.
 *
 * ### `verify`
 *
 * Seven of the fourteen forms are documents CSMOP prescribes **no format for**.
 * Those carry `verify: true` and a `chassis` naming the form whose format they
 * borrow, and every result that rests on one says so in the same words the card
 * on screen uses — the same treatment `verify` gets in the pay tools, for the
 * same reason.
 */

const VERIFY_NOTE = {
  en:
    'CSMOP 2022 prescribes no format for this document. What is shown borrows the format of another ' +
    'form, named in `chassis`. Verify against your own Department’s practice before relying on it.',
  hi:
    'इस दस्तावेज़ के लिए सीएसएमओपी 2022 कोई प्रारूप निर्धारित नहीं करता। जो दिखाया गया है वह अन्य ' +
    'प्रपत्र का प्रारूप लेता है, जिसका नाम `chassis` में है। इस पर निर्भर होने से पूर्व अपने विभाग की ' +
    'प्रथा से सत्यापित करें।',
}

const templateRef = z
  .string()
  .regex(/^[a-z0-9-]+$/)
  .describe(
    'Template id from data/drafting/index.json — "office-memorandum", "letter", "id-note", "noting", ' +
      '"demi-official", "notification", "endorsement", "circular", "rti-reply", "leave-application", ' +
      '"representation", "show-cause-reply", "tour-programme", "ta-bill-cover".',
  )

const langRef = z.enum(['en', 'hi']).describe('Which issue of the document: English or Hindi.')

/**
 * Values, as loose JSON, validated into `DraftValues` here rather than trusted.
 *
 * A model will hand back whatever shape it likes, and the engine's contract is
 * a string, a list of strings, or an `{ en, hi }` pair. Anything else is
 * dropped rather than passed through — a number where a string belongs renders
 * as `[object Object]` in a signed document.
 */
const valuesRef = z
  .record(
    z.string(),
    z.union([
      z.string(),
      z.array(z.string()),
      z.object({
        en: z.union([z.string(), z.array(z.string())]).optional(),
        hi: z.union([z.string(), z.array(z.string())]).optional(),
      }),
    ]),
  )
  .describe(
    'Field values by field id, from `get_draft_template`. A string, a list of strings for a `paras` ' +
      'or `list` field (one entry per paragraph), or {en, hi} where the two issues differ. Omit a ' +
      'field to leave it blank — it will be reported as missing rather than filled in with a specimen.',
  )

const caches = new Map<string, Promise<unknown>>()

function once<T>(key: string, load: () => Promise<T>): Promise<T> {
  const existing = caches.get(key) as Promise<T> | undefined
  if (existing) return existing
  // A failed load is never remembered: one interrupted import must not poison
  // every later tool call in the tab.
  const pending = load().catch((error: unknown) => {
    caches.delete(key)
    throw error
  })
  caches.set(key, pending)
  return pending
}

const templateOnce = (id: string) => once(`template:${id}`, () => loadTemplate(id))

const verifyFields = (template: DocTemplate) =>
  template.verify
    ? { verify: true, chassis: template.csmopRef.chassis ?? null, verifyNote: VERIFY_NOTE.en }
    : { verify: false }

export function registerDraftingTools(): void {
  if (registeredToolNames().includes('list_draft_templates')) return

  registerTool({
    name: 'list_draft_templates',
    scope: 'draft',
    description: {
      en:
        'List every Central Secretariat document type this app can draft, with the one-line "use when" ' +
        'for each, the CSMOP paragraphs its format comes from, whether it is written in the first or ' +
        'third person, and whether CSMOP prescribes a format for it at all. Call this before naming a ' +
        'form — seven of the fourteen are documents the manual prescribes NO format for, and saying ' +
        'otherwise is the error this tool exists to prevent.',
      hi:
        'इस ऐप द्वारा तैयार किए जा सकने वाले प्रत्येक केंद्रीय सचिवालय दस्तावेज़ प्रकार की सूची — ' +
        'प्रत्येक के लिए एक पंक्ति का "कब प्रयोग करें", प्रारूप जिन सीएसएमओपी पैराग्राफों से आया है, ' +
        'वह उत्तम पुरुष में लिखा जाता है या अन्य पुरुष में, तथा सीएसएमओपी उसके लिए कोई प्रारूप ' +
        'निर्धारित करता भी है या नहीं। किसी प्रपत्र का नाम लेने से पहले इसे चलाएँ — चौदह में से सात ' +
        'ऐसे दस्तावेज़ हैं जिनके लिए नियमावली कोई प्रारूप निर्धारित नहीं करती।',
    },
    inputSchema: z.object({}).strict(),
    handler: async () => {
      const index = await once('index', loadDraftingIndex)
      return {
        edition: 'CSMOP 2022, sixteenth edition',
        templates: index.templates.map((entry) => ({
          id: entry.id,
          name: entry.name.en,
          nameHi: entry.name.hi,
          useWhen: entry.useWhen.en,
          useWhenHi: entry.useWhen.hi,
          group: entry.group,
          person: entry.person,
          csmopParas: entry.csmopParas,
          formatPrescribedByCsmop: !entry.verify,
        })),
        disclaimer: index.disclaimer.en,
      }
    },
  })

  registerTool({
    name: 'get_draft_template',
    scope: 'draft',
    description: {
      en:
        'The full specification of one document type: every field an officer fills (with its type, ' +
        'whether it is required, and a worked example), the checklist CSMOP imposes on it with the ' +
        'paragraph behind each item, and the notes on how the form differs from its neighbours. Call ' +
        'this before `render_draft` — the field ids it returns are the keys `values` takes.',
      hi:
        'किसी एक दस्तावेज़ प्रकार का पूर्ण विनिर्देश: अधिकारी द्वारा भरा जाने वाला प्रत्येक फ़ील्ड ' +
        '(उसका प्रकार, वह आवश्यक है या नहीं, तथा एक नमूना), सीएसएमओपी द्वारा उस पर लगाई गई जाँच-सूची ' +
        'जिसमें प्रत्येक मद के पीछे का पैराग्राफ है, तथा यह प्रपत्र अपने समकक्षों से किस प्रकार भिन्न ' +
        'है उस पर टिप्पणियाँ। `render_draft` से पहले इसे चलाएँ — इससे मिले फ़ील्ड आईडी ही `values` की ' +
        'कुंजियाँ हैं।',
    },
    inputSchema: z.object({ templateId: templateRef }),
    handler: async ({ templateId }) => {
      if (!TEMPLATE_IDS.includes(templateId)) {
        return { templateId, found: false, available: TEMPLATE_IDS }
      }
      const template = await templateOnce(templateId)
      return {
        found: true,
        id: template.id,
        name: template.name.en,
        nameHi: template.name.hi,
        person: template.person,
        usedBy: template.usedBy.en,
        whenToUse: template.whenToUse.en,
        salutation: template.salutation?.en ?? null,
        subscription: template.subscription?.en ?? null,
        csmop: {
          edition: template.csmopRef.edition,
          paras: template.csmopRef.paras,
          pages: template.csmopRef.pages ?? null,
          chassis: template.csmopRef.chassis ?? null,
          note: template.csmopRef.note?.en ?? null,
        },
        fields: template.fields.map((field) => ({
          id: field.id,
          label: field.label.en,
          labelHi: field.label.hi,
          type: field.type,
          required: field.required,
          hint: field.hint?.en ?? null,
          options: field.options?.map((option) => ({ value: option.value, label: option.label.en })) ?? null,
          maxWords: field.maxWords ?? null,
          example: field.sample.en,
        })),
        checklist: template.checklist.map((item) => ({
          id: item.id,
          label: item.label.en,
          why: item.why.en,
          severity: item.severity,
          csmopRef: item.csmopRef ?? null,
        })),
        notes:
          template.notes?.map((note) => ({
            title: note.title.en,
            body: note.body.en,
            csmopRef: note.csmopRef ?? null,
          })) ?? [],
        source: { name: template.source.name, url: template.source.url },
        ...verifyFields(template),
      }
    },
  })

  registerTool({
    name: 'render_draft',
    scope: 'draft',
    description: {
      en:
        'Lay a set of field values out as the finished document, in English, Hindi, or both. Returns ' +
        'the page as plain text plus each part separately — the subject, the numbered paragraphs, the ' +
        'signature block, the enclosures and the copy-to list. Use this rather than composing a ' +
        'document yourself: where the addressee goes, which paragraph carries a number, and whether ' +
        'the first one does, differ per form and are the errors officers are marked down on. ' +
        'A field you omit stays BLANK and is reported in `issues` — nothing is filled in from a ' +
        'specimen.',
      hi:
        'फ़ील्ड मानों के समुच्चय को तैयार दस्तावेज़ के रूप में सज्जित करें — अंग्रेज़ी में, हिंदी में, ' +
        'अथवा दोनों में। पृष्ठ सादे पाठ के रूप में तथा प्रत्येक अंग अलग से लौटाता है: विषय, ' +
        'क्रमांकित पैराग्राफ, हस्ताक्षर खंड, संलग्नक और प्रतिलिपि सूची। दस्तावेज़ स्वयं रचने के बजाय ' +
        'इसका प्रयोग करें: संबोधित पक्ष कहाँ जाता है, किस पैराग्राफ पर संख्या होती है, और पहले पर ' +
        'होती है या नहीं — ये प्रपत्र-दर-प्रपत्र भिन्न हैं। छोड़ा गया फ़ील्ड रिक्त रहता है और ' +
        '`issues` में बताया जाता है।',
    },
    inputSchema: z.object({
      templateId: templateRef,
      values: valuesRef,
      lang: z.union([langRef, z.literal('bilingual')]).describe('"bilingual" returns both issues.'),
      devanagariDigits: z
        .boolean()
        .optional()
        .describe('Render Hindi dates and paragraph numbers in Devanagari digits. Default false.'),
    }),
    handler: async ({ templateId, values, lang, devanagariDigits }) => {
      if (!TEMPLATE_IDS.includes(templateId)) {
        return { templateId, found: false, available: TEMPLATE_IDS }
      }
      const template = await templateOnce(templateId)
      const options = { devanagariDigits: devanagariDigits ?? false }
      const draftValues = values as DraftValues

      if (lang === 'bilingual') {
        const result = render(template, draftValues, 'bilingual', options)
        return {
          found: true,
          templateId,
          lang,
          text: serialiseBilingual(result, options),
          en: describe(result.en.document),
          hi: describe(result.hi.document),
          issues: result.issues.map((issue) => ({
            field: issue.field ?? null,
            lang: issue.lang,
            code: issue.code,
            message: issue.message.en,
          })),
          ...verifyFields(template),
        }
      }

      const result = renderDocument(template, draftValues, lang, options)
      return {
        found: true,
        templateId,
        lang,
        text: serialise(result.document, options),
        ...describe(result.document),
        issues: result.issues.map((issue) => ({
          field: issue.field ?? null,
          code: issue.code,
          message: issue.message.en,
        })),
        ...verifyFields(template),
      }
    },
  })

  registerTool({
    name: 'check_draft',
    scope: 'draft',
    description: {
      en:
        'Run CSMOP’s own checklist over a set of values and report each item as passed or failed, with ' +
        'the paragraph behind it and why it matters. `must` items are the ones that make a document ' +
        'the wrong document — third person on an Office Memorandum, paragraph numbering against the ' +
        'specimen, an unfilled placeholder. `should` items are what a careful officer fixes. Say which ' +
        'ones failed and quote the `why`; never assert that a draft is correct without running this.',
      hi:
        'सीएसएमओपी की अपनी जाँच-सूची को मानों के समुच्चय पर चलाकर प्रत्येक मद को उत्तीर्ण या अनुत्तीर्ण ' +
        'बताता है, साथ में उसके पीछे का पैराग्राफ और वह क्यों महत्वपूर्ण है। `must` मद वे हैं जो ' +
        'दस्तावेज़ को गलत दस्तावेज़ बना देते हैं; `should` मद वे हैं जिन्हें सावधान अधिकारी ठीक करता ' +
        'है। कौन-से अनुत्तीर्ण हुए यह बताएँ और `why` उद्धृत करें; इसे चलाए बिना कभी न कहें कि मसौदा ' +
        'सही है।',
    },
    inputSchema: z.object({ templateId: templateRef, values: valuesRef, lang: langRef }),
    handler: async ({ templateId, values, lang }) => {
      if (!TEMPLATE_IDS.includes(templateId)) {
        return { templateId, found: false, available: TEMPLATE_IDS }
      }
      const template = await templateOnce(templateId)
      const result = renderDocument(template, values, lang)
      const checklist = evaluateChecklist(template, result)
      const failed = checklist.filter((item) => !item.passed)

      return {
        found: true,
        templateId,
        lang,
        passed: failed.length === 0,
        mustFailing: failed.filter((item) => item.severity === 'must').length,
        shouldFailing: failed.filter((item) => item.severity === 'should').length,
        items: checklist.map((item) => ({
          id: item.id,
          label: item.label,
          why: item.why,
          severity: item.severity,
          csmopRef: item.csmopRef ?? null,
          passed: item.passed,
        })),
        missingFields: result.issues
          .filter((issue) => issue.code === 'required')
          .map((issue) => issue.field ?? ''),
        ...verifyFields(template),
      }
    },
  })

  registerTool({
    name: 'list_draft_phrases',
    scope: 'draft',
    description: {
      en:
        'The openings, transitions and closings CSMOP prints for a given form, in both languages, each ' +
        'with the paragraph it comes from. Use these rather than inventing a form of words: ' +
        '"The undersigned is directed to…" is what makes an Office Memorandum express the orders of ' +
        'Government (9.2(iii)), and an approximation of it does not.',
      hi:
        'किसी दिए गए प्रपत्र के लिए सीएसएमओपी में छपे आरंभ, संक्रमण और समापन वाक्यांश, दोनों भाषाओं ' +
        'में, प्रत्येक के साथ वह पैराग्राफ जिससे वह आया है। अपनी ओर से शब्द गढ़ने के बजाय इनका प्रयोग ' +
        'करें: "अधोहस्ताक्षरी को निदेश हुआ है…" ही कार्यालय ज्ञापन को सरकार के आदेश की अभिव्यक्ति ' +
        'बनाता है (9.2(iii)), उसका सन्निकटन नहीं।',
    },
    inputSchema: z.object({
      templateId: templateRef.optional().describe('Omit for the phrases that fit any form.'),
      kind: z.enum(['opening', 'transition', 'closing', 'noting', 'endorsement', 'courtesy']).optional(),
    }),
    handler: async ({ templateId, kind }) => {
      const library = await once('phrases', loadPhrases)
      const phrases = library.phrases.filter(
        (phrase) =>
          (!templateId || phrase.appliesTo.includes(templateId) || phrase.appliesTo.includes('*')) &&
          (!kind || phrase.kind === kind),
      )
      return {
        templateId: templateId ?? null,
        count: phrases.length,
        phrases: phrases.map((phrase) => ({
          id: phrase.id,
          kind: phrase.kind,
          en: phrase.text.en,
          hi: phrase.text.hi,
          appliesTo: phrase.appliesTo,
          tags: phrase.tags ?? [],
          csmopRef: phrase.csmopRef ?? null,
          note: phrase.note?.en ?? null,
          source: { name: phrase.source.name, url: phrase.source.url },
        })),
      }
    },
  })

  registerTool({
    name: 'lookup_admin_term',
    scope: 'draft',
    description: {
      en:
        'The manual’s own Hindi for a part of a document, a form of communication, an urgency grading ' +
        'or a designation — searched in either language. This matters because CSMOP 2022’s Hindi is ' +
        'NOT the rendering most people expect: it prints परम अग्रता for Top Priority, not सर्वोच्च ' +
        'अग्रता, and अर्ध-सरकारी पत्र for a demi-official letter, not अर्ध-शासकीय पत्र. The expected ' +
        'forms are returned in `alsoWritten` so a search finds the term, but `hi` is what the manual ' +
        'prints and is what to use.',
      hi:
        'दस्तावेज़ के किसी अंग, पत्राचार के रूप, तात्कालिकता ग्रेडिंग अथवा पदनाम के लिए नियमावली की ' +
        'अपनी हिंदी — किसी भी भाषा में खोजी जा सकती है। यह इसलिए महत्वपूर्ण है कि सीएसएमओपी 2022 की ' +
        'हिंदी वह नहीं है जिसकी अधिकांश लोग अपेक्षा करते हैं: वह Top Priority के लिए परम अग्रता छापती ' +
        'है, सर्वोच्च अग्रता नहीं। अपेक्षित रूप `alsoWritten` में लौटाए जाते हैं, किंतु `hi` ही वह है ' +
        'जो नियमावली छापती है और जिसका प्रयोग करना है।',
    },
    inputSchema: z.object({
      query: z.string().min(1).max(120).describe('A word or phrase, in English or Hindi.'),
      limit: z.number().int().min(1).max(25).optional(),
    }),
    handler: async ({ query, limit }) => {
      const { terms } = await once('terms', loadStructureTerms)
      const needle = query.trim().toLowerCase()
      const matches = terms
        .filter((term) =>
          `${term.en} ${term.hi} ${(term.alsoHi ?? []).join(' ')}`.toLowerCase().includes(needle),
        )
        .slice(0, limit ?? 10)

      return {
        query,
        count: matches.length,
        terms: matches.map((term) => ({
          id: term.id,
          category: term.category,
          en: term.en,
          hi: term.hi,
          alsoWritten: term.alsoHi ?? [],
          note: term.note?.en ?? null,
          csmopRef: term.csmopRef ?? null,
          source: { name: term.source.name, url: term.source.url },
          verify: term.verify,
        })),
      }
    },
  })
}

/** Every named part of a document, at the top level, so an answer can cite one. */
function describe(document: ReturnType<typeof renderDocument>['document']) {
  return {
    urgency: document.urgency,
    header: document.header,
    title: document.title,
    subject: document.subject,
    refLine: document.refLine,
    paragraphs: document.paras,
    closing: document.closing,
    signature: document.signature,
    enclosures: document.enclosures,
    copyTo: document.copyTo,
  }
}

/** The worked example CSMOP prints, for a caller that wants a complete document. */
export function exampleValues(template: DocTemplate): DraftValues {
  return sampleValues(template)
}
