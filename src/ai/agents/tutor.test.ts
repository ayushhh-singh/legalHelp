import { beforeEach, describe, expect, it } from 'vitest'

import { explainAnswer, proposeScenario, weeklyFocusPlan } from './tutor'
import { MockProvider } from '../providers/mock'
import { clearRegistry, listTools } from '../tools/registry'
import { registerBuiltinTools } from '../tools/index'

import { clearAllData, db } from '@/db'

/**
 * The Rules Trainer's coaching agent, against the REAL committed CCS (Conduct)
 * dataset and a real (fake-indexeddb) `db` — the same arrangement
 * `src/ai/tools/rules.test.ts` uses, and for the same reason: a test that
 * asserts "the explanation is grounded in the rule" against a rule string a
 * test author invented is a test of the test author.
 *
 * `explainAnswer` and `weeklyFocusPlan` read their tools directly, in code,
 * before the model runs — so their MockProvider scripts are a single
 * `end_turn` turn with no `tool_use` at all. `proposeScenario` is the one
 * WRITE, and its script looks like every other agent's tool loop: a
 * `tool_use` turn, then the final answer.
 */

const REAL_ACT = 'ccs-conduct'
const REAL_RULE = '1'
const REAL_QID = 'ccs-conduct-rule-1'

beforeEach(async () => {
  clearRegistry()
  registerBuiltinTools()
  await clearAllData()
})

const tools = () => listTools('learn')

describe('explainAnswer', () => {
  it('explains a wrong answer, grounded in the real rule text', async () => {
    const provider = new MockProvider({
      id: 'explain-ok',
      turns: [
        {
          stopReason: 'end_turn',
          content: [
            {
              type: 'text',
              text:
                'Rule 1 states that these rules may be called the Central Civil Services (Conduct) Rules, ' +
                '1964, and that they apply to persons appointed to a civil service or post [1]. The picked ' +
                'answer does not match this definition, but the correct one does.',
            },
          ],
        },
      ],
    })

    const result = await explainAnswer({
      provider,
      act: REAL_ACT,
      rule: REAL_RULE,
      qId: REAL_QID,
      pickedAnswer: 'Leave encashment.',
      correctAnswer: 'Its short title, commencement and application.',
      language: 'en',
      tools: tools(),
    })

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.text).toContain('Rule 1')
    // Nothing was fetched by the model itself — this file fetched both before
    // the provider ever ran, so the mock script needed no tool_use turn at all.
    expect(provider.calls).toHaveLength(1)
  })

  it('fails before the provider is touched when the rule does not exist', async () => {
    const provider = new MockProvider({ id: 'unused', turns: [] })
    const result = await explainAnswer({
      provider,
      act: REAL_ACT,
      rule: '999-does-not-exist',
      qId: REAL_QID,
      pickedAnswer: 'anything',
      correctAnswer: 'anything else',
      language: 'en',
      tools: tools(),
    })

    expect(result.status).toBe('error')
    expect(provider.calls).toHaveLength(0)
  })

  it("grounds the explanation in the reader's own card history when there is one", async () => {
    await db.reviewLog.bulkPut([
      {
        id: `${REAL_QID}#1#a`,
        qId: REAL_QID,
        grade: 'Again',
        at: '2026-08-01T00:00:00.000Z',
        durationMs: 1000,
        stateBefore: 'new',
        elapsed: 0,
        retrievability: null,
      },
      {
        id: `${REAL_QID}#2#b`,
        qId: REAL_QID,
        grade: 'Again',
        at: '2026-08-05T00:00:00.000Z',
        durationMs: 1000,
        stateBefore: 'review',
        elapsed: 4,
        retrievability: 0.6,
      },
    ])

    const provider = new MockProvider({
      id: 'explain-history',
      turns: [
        {
          stopReason: 'end_turn',
          content: [
            {
              type: 'text',
              text: 'Rule 1 covers this, and you have failed this card twice before [1][2].',
            },
          ],
        },
      ],
    })

    const result = await explainAnswer({
      provider,
      act: REAL_ACT,
      rule: REAL_RULE,
      qId: REAL_QID,
      pickedAnswer: 'Leave encashment.',
      correctAnswer: 'Its short title, commencement and application.',
      language: 'en',
      tools: tools(),
    })

    expect(result.status).toBe('ok')
  })
})

describe('proposeScenario', () => {
  it('stores a scenario card and reads the confirmation back from the tool, not the model', async () => {
    const provider = new MockProvider({
      id: 'scenario-ok',
      turns: [
        {
          stopReason: 'tool_use',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_01',
              name: 'propose_card',
              input: {
                act: REAL_ACT,
                rule: REAL_RULE,
                kind: 'scenario',
                front: {
                  en: 'A new recruit asks whether these rules cover a railway servant. What do you say?',
                  hi: 'एक नया भर्ती पूछता है कि क्या ये नियम रेल सेवक पर लागू होते हैं। आप क्या कहेंगे?',
                },
                back: {
                  en: 'No — Rule 1 excludes a railway servant as defined in the Indian Railways Act, 1890.',
                  hi: 'नहीं — नियम 1 भारतीय रेल अधिनियम, 1890 के अंतर्गत परिभाषित रेल सेवक को अपवर्जित करता है।',
                },
                options: [
                  { en: 'Yes, always.', hi: 'हाँ, सदैव।' },
                  { en: 'No — a railway servant is excluded.', hi: 'नहीं — रेल सेवक अपवर्जित है।' },
                ],
                answerIndex: 1,
                citation: { en: 'CCS (Conduct) Rules, R. 1', hi: 'सीसीएस (आचरण) नियम, नियम 1' },
              },
            },
          ],
        },
        {
          stopReason: 'end_turn',
          content: [
            {
              type: 'text',
              text: 'I have added a scenario question on Rule 1 for you to review [1][T1].',
            },
          ],
        },
      ],
    })

    const result = await proposeScenario({
      provider,
      act: REAL_ACT,
      rule: REAL_RULE,
      language: 'en',
      tools: tools(),
    })

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.cardId).toBeTruthy()
    expect(result.reviewQueueUrl).toBe('/learn/review-queue')

    const rows = await db.proposedCards.toArray()
    expect(rows).toHaveLength(1)
    const stored = rows[0]!.card as { reviewState: string; reviewed: boolean; kind: string }
    expect(stored.reviewState).toBe('unreviewed')
    expect(stored.reviewed).toBe(false)
    expect(stored.kind).toBe('scenario')
  })

  it('reports the tool’s own failure rather than the model’s claim of success', async () => {
    const provider = new MockProvider({
      id: 'scenario-bad-shape',
      turns: [
        {
          stopReason: 'tool_use',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_01',
              name: 'propose_card',
              // A rule number containing "." passes propose_card's own loose
              // input schema but fails cardSchema, the check the tool itself
              // performs — see src/ai/tools/rules.test.ts's identical case.
              input: {
                act: REAL_ACT,
                rule: '5.2',
                kind: 'scenario',
                front: { en: 'Question?', hi: 'प्रश्न?' },
                back: { en: 'Answer.', hi: 'उत्तर।' },
                options: [
                  { en: 'A', hi: 'क' },
                  { en: 'B', hi: 'ख' },
                ],
                answerIndex: 0,
                citation: { en: 'CCS (Conduct) Rules, R. 5.2', hi: 'सीसीएस (आचरण) नियम, नियम 5.2' },
              },
            },
          ],
        },
        {
          stopReason: 'end_turn',
          content: [{ type: 'text', text: 'I have added a scenario question for you [1][T1].' }],
        },
      ],
    })

    const result = await proposeScenario({
      provider,
      act: REAL_ACT,
      rule: REAL_RULE,
      language: 'en',
      tools: tools(),
    })

    expect(result.status).toBe('error')
    expect(await db.proposedCards.count()).toBe(0)
  })

  it('fails before the provider is touched when the rule does not exist', async () => {
    const provider = new MockProvider({ id: 'unused', turns: [] })
    const result = await proposeScenario({
      provider,
      act: REAL_ACT,
      rule: '999-does-not-exist',
      language: 'en',
      tools: tools(),
    })

    expect(result.status).toBe('error')
    expect(provider.calls).toHaveLength(0)
  })

  it('rejects a card that stored cleanly but for a different rule than the one asked about', async () => {
    // A valid card by the tool's own lights — kind, options, citation all
    // fine — just about Rule 2 ("Definitions") when Rule 1 was requested.
    // `stored: true` alone would call this success; the row's own act/rule
    // is what this function actually checks.
    const provider = new MockProvider({
      id: 'scenario-wrong-rule',
      turns: [
        {
          stopReason: 'tool_use',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_01',
              name: 'propose_card',
              input: {
                act: REAL_ACT,
                rule: '2',
                kind: 'scenario',
                front: { en: 'A scenario about definitions?', hi: 'परिभाषाओं पर एक परिदृश्य?' },
                back: { en: 'See Rule 2.', hi: 'नियम 2 देखें।' },
                options: [
                  { en: 'A', hi: 'क' },
                  { en: 'B', hi: 'ख' },
                ],
                answerIndex: 0,
                citation: { en: 'CCS (Conduct) Rules, R. 2', hi: 'सीसीएस (आचरण) नियम, नियम 2' },
              },
            },
          ],
        },
        {
          stopReason: 'end_turn',
          content: [{ type: 'text', text: 'I have added a scenario question for you [1][T1].' }],
        },
      ],
    })

    const result = await proposeScenario({
      provider,
      act: REAL_ACT,
      rule: REAL_RULE, // '1' — not the '2' the model actually stored
      language: 'en',
      tools: tools(),
    })

    expect(result.status).toBe('error')
    if (result.status !== 'error') return
    expect(result.message).toContain('Rule 2')
    expect(result.message).toContain('not ccs-conduct Rule 1')
    // The card is still sitting in proposedCards — this function refuses to
    // CONFIRM it to the reader as what they asked for, but it does not (and
    // cannot, without a second write) undo the tool's own storage.
    expect(await db.proposedCards.count()).toBe(1)
  })
})

describe('weeklyFocusPlan', () => {
  it('never spends a request when there are no weak areas yet', async () => {
    const provider = new MockProvider({ id: 'unused', turns: [] })
    const result = await weeklyFocusPlan({ provider, language: 'en', tools: tools() })

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.usage.inputTokens).toBe(0)
    expect(provider.calls).toHaveLength(0)
  })

  it("builds a plan from the reader's own weak areas, an AI-proposed card never counted among them", async () => {
    // Two lapses on the same real card — enough for get_user_weak_areas'
    // own minReviews floor of 2.
    await db.reviewLog.bulkPut([
      {
        id: `${REAL_QID}#1#a`,
        qId: REAL_QID,
        grade: 'Again',
        at: '2026-08-01T00:00:00.000Z',
        durationMs: 1000,
        stateBefore: 'new',
        elapsed: 0,
        retrievability: null,
      },
      {
        id: `${REAL_QID}#2#b`,
        qId: REAL_QID,
        grade: 'Again',
        at: '2026-08-05T00:00:00.000Z',
        durationMs: 1000,
        stateBefore: 'review',
        elapsed: 4,
        retrievability: 0.5,
      },
    ])

    // A card the tutor itself proposed, sitting unreviewed. It has no review
    // history at all, so it must not change the plan below.
    await db.proposedCards.put({
      id: 'ai-ccs-conduct-1-zzz',
      card: {
        id: 'ai-ccs-conduct-1-zzz',
        act: REAL_ACT,
        rule: REAL_RULE,
        kind: 'scenario',
        front: { en: 'x', hi: 'x' },
        back: { en: 'y', hi: 'y' },
        options: [
          { en: 'a', hi: 'a' },
          { en: 'b', hi: 'b' },
        ],
        answerIndex: 0,
        ruleRef: { textId: 'ccs-conduct-rule-1', citation: { en: 'CCS (Conduct) Rules, R. 1', hi: 'x' } },
        difficulty: 'medium',
        reviewed: false,
        reviewState: 'unreviewed',
        version: '1.0.0',
        source: { name: 'AI-proposed', url: 'https://example.gov.in/ai-proposed' },
      },
      createdAt: '2026-08-10T00:00:00.000Z',
    })

    const provider = new MockProvider({
      id: 'focus-plan',
      turns: [
        {
          stopReason: 'end_turn',
          content: [
            { type: 'text', text: 'Focus on CCS (Conduct) Rule 1 first — it has the most lapses [1].' },
          ],
        },
      ],
    })

    const result = await weeklyFocusPlan({ provider, language: 'en', tools: tools() })

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(provider.calls).toHaveLength(1)
    // The prompt sent to the model came from the two real reviews only.
    const sentContext = (provider.calls[0]?.system ?? []).map((block) => block.text).join('\n')
    expect(sentContext).toContain('"reviews":2')
    expect(sentContext).not.toContain('ai-ccs-conduct-1-zzz')
  })
})
