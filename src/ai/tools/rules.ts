import { z } from 'zod'

import { registerTool, registeredToolNames } from './registry'

import { db } from '@/db'
import { weakAreasFor } from '@/lib/srs'
import { loadActText, loadAllCards, ACT_IDS } from '@/modules/trainer/data'
import { effectiveCatalogue } from '@/modules/trainer/reviewQueue'
import { cardSchema, type Card } from '@/modules/trainer/schema'

/**
 * The Rules Trainer's agent tools.
 *
 * Three are pure reads over `data/rules` (bundled, `src/modules/trainer/
 * data.ts`, ADR-013) and the reader's own `reviewLog`/`srsCards` rows — within
 * the registry's stated contract of "bundled JSON, or the reader's own
 * IndexedDB rows" (`src/ai/tools/registry.ts`). The fourth, `propose_card`, is
 * the one WRITE any tool in this app performs: it stores a candidate card in
 * `proposedCards`, `reviewState: 'unreviewed'`, where it sits until a reader
 * accepts it through `/learn/review-queue` — see
 * `src/modules/trainer/reviewQueue.ts#effectiveCatalogue`. Nothing proposed
 * here ever reaches the FSRS schedule on its own.
 */

const actRef = z
  .enum(ACT_IDS as [string, ...string[]])
  .describe(`One of the twelve rule books: ${ACT_IDS.join(', ')}.`)

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

const allCardsOnce = () => once('all-cards', loadAllCards)

export function registerRulesTools(): void {
  if (registeredToolNames().includes('get_rule_text')) return

  registerTool({
    name: 'get_rule_text',
    scope: 'learn',
    description: {
      en:
        'The full text of one rule (or section, or paragraph) from one of the twelve rule books this ' +
        'app trains on — Rule number, heading and body, in both languages where the Hindi has been ' +
        'authored. Call this before explaining what a rule requires; a card\'s citation names the rule, ' +
        'it does not quote it.',
      hi:
        'इस ऐप द्वारा प्रशिक्षित बारह नियमावलियों में से किसी एक नियम (अथवा धारा, अथवा पैराग्राफ) का ' +
        'पूर्ण पाठ — नियम संख्या, शीर्षक और पाठ, दोनों भाषाओं में जहाँ हिंदी लिखी जा चुकी है। कोई नियम ' +
        'क्या अपेक्षित करता है यह बताने से पहले इसे चलाएँ; कार्ड की उद्धरण-पंक्ति नियम का नाम लेती है, ' +
        'उसे उद्धृत नहीं करती।',
    },
    inputSchema: z.object({ act: actRef, rule: z.string().min(1).describe('The rule number, as printed — "11", "5.2".') }),
    handler: async ({ act, rule }) => {
      const text = await once(`text:${act}`, () => loadActText(act))
      const found = text.rules.find((entry) => entry.number === rule)
      if (!found) {
        return { act, rule, found: false, available: text.rules.map((entry) => entry.number) }
      }
      return {
        act,
        actName: text.act.name.en,
        found: true,
        number: found.number,
        heading: found.heading.en,
        headingHi: found.heading.hi || null,
        text: found.text.en,
        textHi: found.text.hi || null,
        subRules: (found.subRules ?? []).map((sub) => ({ number: sub.number, text: sub.text.en, textHi: sub.text.hi || null })),
        hindiTextExtractable: text.hindiTextExtractable,
        source: { name: text.source.name, url: text.source.url },
      }
    },
  })

  registerTool({
    name: 'get_user_weak_areas',
    scope: 'learn',
    description: {
      en:
        'The rules this reader is losing the most cards on, ranked worst first, from their own review ' +
        'history — lapse rate, lapses and total reviews per rule. Use this to decide what to ask about ' +
        'or revise next; never guess at what a reader struggles with when this is available.',
      hi:
        'इस उपयोगकर्ता के अपने पुनरीक्षण इतिहास से, वे नियम जिन पर वह सबसे अधिक कार्ड गँवा रहा है, ' +
        'सबसे खराब पहले क्रमित — प्रति नियम विस्मृति-दर, विस्मृतियाँ और कुल पुनरीक्षण। आगे क्या पूछना ' +
        'अथवा दोहराना है यह तय करने हेतु इसका प्रयोग करें; जब यह उपलब्ध हो तो अनुमान न लगाएँ।',
    },
    inputSchema: z.object({
      act: actRef.optional().describe('Restrict to one rule book. Omit for every act the reader studies.'),
      limit: z.number().int().min(1).max(50).optional(),
    }),
    handler: async ({ act, limit }) => {
      const cards = await allCardsOnce()
      const [overrides, proposed] = await Promise.all([db.cardOverrides.toArray(), db.proposedCards.toArray()])
      const catalogue = effectiveCatalogue(cards, overrides, proposed)
      const areas = await weakAreasFor(catalogue, {
        by: 'rule',
        minReviews: 2,
        ...(act ? { acts: [act] } : {}),
      })

      return {
        count: Math.min(areas.length, limit ?? 10),
        areas: areas.slice(0, limit ?? 10).map((area) => ({
          act: area.act,
          rule: area.rule,
          citation: area.citation?.en ?? null,
          reviews: area.reviews,
          lapses: area.lapses,
          lapseRate: Math.round(area.rate * 1000) / 1000,
        })),
      }
    },
  })

  registerTool({
    name: 'get_card_history',
    scope: 'learn',
    description: {
      en:
        'Every review this reader has given one card, oldest first: the grade pressed, when, and the ' +
        'card\'s predicted recall chance at that moment. Use this to explain WHY a card is scheduled ' +
        'where it is, or to notice a reader who keeps failing the same card despite passing others near it.',
      hi:
        'इस उपयोगकर्ता ने एक कार्ड पर दिए गए सभी पुनरीक्षण, सबसे पुराने पहले — दबाया गया ग्रेड, कब, और ' +
        'उस क्षण कार्ड की अनुमानित स्मरण-संभावना। यह बताने हेतु प्रयोग करें कि कोई कार्ड वहाँ क्यों ' +
        'निर्धारित है, अथवा यह देखने हेतु कि कोई उपयोगकर्ता पास के अन्य कार्ड उत्तीर्ण करते हुए भी एक ' +
        'ही कार्ड में बार-बार असफल हो रहा है।',
    },
    inputSchema: z.object({ qId: z.string().min(1).describe('Card.id, from a card shown to the reader.') }),
    handler: async ({ qId }) => {
      const [logs, srs] = await Promise.all([
        db.reviewLog.where('qId').equals(qId).sortBy('at'),
        db.srsCards.get(qId),
      ])
      return {
        qId,
        everSeen: srs !== undefined,
        currentState: srs?.state ?? null,
        due: srs?.due ?? null,
        reps: srs?.reps ?? 0,
        lapses: srs?.lapses ?? 0,
        history: logs.map((log) => ({
          at: log.at,
          grade: log.grade,
          stateBefore: log.stateBefore,
          predictedRecall: log.retrievability,
        })),
      }
    },
  })

  registerTool({
    name: 'propose_card',
    scope: 'learn',
    description: {
      en:
        'Draft a new practice card for a reader to review. It is stored locally, unreviewed, and NEVER ' +
        'enters the schedule on its own — a human opens `/learn/review-queue`, reads it beside the rule ' +
        'it cites, and accepts or rejects it. Every field this tool accepts is exactly what a card in ' +
        '`data/rules` carries; `ruleRef.citation` and `groundingRuleIds`-equivalent grounding are what ' +
        'let the reviewer check the card against the rule before it is ever shown to anyone.',
      hi:
        'उपयोगकर्ता के अभ्यास हेतु एक नया कार्ड प्रारूपित करें। यह स्थानीय रूप से, असमीक्षित, संचित ' +
        'होता है और अपने-आप कभी अनुसूची में प्रवेश नहीं करता — एक व्यक्ति `/learn/review-queue` खोलकर, ' +
        'उद्धृत नियम के साथ इसे पढ़कर, इसे स्वीकार या अस्वीकार करता है। यह उपकरण जो भी फ़ील्ड लेता है वे ' +
        'ठीक वही हैं जो `data/rules` में एक कार्ड रखता है।',
    },
    inputSchema: z.object({
      act: actRef,
      rule: z.string().min(1),
      kind: z.enum(['rule', 'cloze', 'mcq', 'trueFalse', 'scenario']),
      front: z.object({ en: z.string().min(1), hi: z.string().default('') }),
      back: z.object({ en: z.string().min(1), hi: z.string().default('') }),
      options: z.array(z.object({ en: z.string().min(1), hi: z.string().default('') })).min(2).max(5).optional(),
      answerIndex: z.number().int().min(0).optional(),
      explanation: z.object({ en: z.string().min(1), hi: z.string().default('') }).optional(),
      citation: z.object({ en: z.string().min(1), hi: z.string().default('') }),
    }),
    handler: async (input) => {
      const id = `ai-${input.act}-${input.rule}-${Date.now().toString(36)}`
      const draft: Card = {
        id,
        act: input.act,
        rule: input.rule,
        kind: input.kind,
        front: input.front,
        back: input.back,
        ...(input.options ? { options: input.options } : {}),
        ...(input.answerIndex !== undefined ? { answerIndex: input.answerIndex } : {}),
        ...(input.explanation ? { explanation: input.explanation } : {}),
        ruleRef: { textId: `${input.act}-rule-${input.rule.toLowerCase()}`, citation: input.citation },
        difficulty: 'medium',
        reviewed: false,
        reviewState: 'unreviewed',
        version: '1.0.0',
        source: { name: 'AI-proposed', url: 'https://example.gov.in/ai-proposed' },
      }

      const parsed = cardSchema.safeParse(draft)
      if (!parsed.success) {
        return { stored: false, id: null, error: parsed.error.issues.map((issue) => issue.message).join('; ') }
      }

      await db.proposedCards.put({ id, card: parsed.data, createdAt: new Date().toISOString() })
      return { stored: true, id, reviewQueueUrl: '/learn/review-queue' }
    },
  })
}
