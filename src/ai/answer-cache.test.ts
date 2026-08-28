import { describe, expect, it } from 'vitest'

import {
  MAX_CACHED_ANSWERS,
  cachedMeta,
  clearAnswerCache,
  lookupAnswer,
  pruneStaleAnswers,
  storeAnswer,
} from './answer-cache'
import type { AiOutputMeta } from './types'

import { db } from '@/db'
import { DATA_VERSION } from '@/lib/dataVersion'

const meta: AiOutputMeta = {
  agentId: 'law-explain',
  model: 'claude-sonnet-4-6',
  promptVersion: 1,
  tier: 'byok',
  contextIds: ['c1'],
  tokens: { inputTokens: 900, outputTokens: 90, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
  cost: 0.004,
  cached: false,
  at: '2026-08-28T00:00:00.000Z',
}

const seed = (question: string, answer = 'IPC 302 becomes BNS 103 [1].') =>
  storeAnswer({ agentId: 'law-explain', language: 'en', question, answer, meta })

describe('the answer cache', () => {
  it('serves the identical question back', async () => {
    await seed('Which BNS section replaces IPC 302?')

    const hit = await lookupAnswer({
      agentId: 'law-explain',
      language: 'en',
      question: 'which bns section replaces ipc 302?',
    })

    expect(hit?.exact).toBe(true)
    expect(hit?.similarity).toBe(1)
    expect(hit?.row.answer).toContain('BNS 103')
  })

  it('serves a question that differs only in word order or punctuation', async () => {
    await seed('Which BNS section replaces IPC 302?')

    const hit = await lookupAnswer({
      agentId: 'law-explain',
      language: 'en',
      question: 'Which BNS section replaces IPC 302',
    })

    expect(hit).not.toBeNull()
    expect(hit?.similarity).toBeGreaterThanOrEqual(0.92)
  })

  it('does not serve a different question', async () => {
    await seed('Which BNS section replaces IPC 302?')

    expect(
      await lookupAnswer({
        agentId: 'law-explain',
        language: 'en',
        question: 'What is the DA rate from January 2026?',
      }),
    ).toBeNull()
  })

  it('never stores or serves a personal question', async () => {
    await storeAnswer({
      agentId: 'pay-explain',
      language: 'en',
      question: 'What is my leave balance?',
      answer: 'You have 14 days.',
      meta,
    })

    expect(await db.aiAnswers.count()).toBe(0)
    expect(
      await lookupAnswer({
        agentId: 'pay-explain',
        language: 'en',
        question: 'What is my leave balance?',
      }),
    ).toBeNull()
  })

  it('keeps the two languages apart', async () => {
    await seed('Which BNS section replaces IPC 302?')

    expect(
      await lookupAnswer({
        agentId: 'law-explain',
        language: 'hi',
        question: 'Which BNS section replaces IPC 302?',
      }),
    ).toBeNull()
  })

  it('keeps the agents apart', async () => {
    await seed('Which BNS section replaces IPC 302?')

    expect(
      await lookupAnswer({
        agentId: 'trainer-coach',
        language: 'en',
        question: 'Which BNS section replaces IPC 302?',
      }),
    ).toBeNull()
  })

  it('stops serving answers grounded in a dataset version that has moved on', async () => {
    await seed('Which BNS section replaces IPC 302?')
    const row = (await db.aiAnswers.toArray())[0]
    expect(row?.dataVersion).toBe(DATA_VERSION)

    await db.aiAnswers.put({ ...row!, dataVersion: 'app@0.0.1' })

    expect(
      await lookupAnswer({
        agentId: 'law-explain',
        language: 'en',
        question: 'Which BNS section replaces IPC 302?',
      }),
    ).toBeNull()
    expect(await pruneStaleAnswers()).toBe(1)
    expect(await db.aiAnswers.count()).toBe(0)
  })

  it('stops serving answers written under an older prompt version', async () => {
    await seed('Which BNS section replaces IPC 302?')
    const row = (await db.aiAnswers.toArray())[0]
    await db.aiAnswers.put({ ...row!, promptVersion: 0 })

    expect(
      await lookupAnswer({
        agentId: 'law-explain',
        language: 'en',
        question: 'Which BNS section replaces IPC 302?',
      }),
    ).toBeNull()
  })

  it('marks a served answer as cached so the reader is told', async () => {
    await seed('Which BNS section replaces IPC 302?')
    const hit = await lookupAnswer({
      agentId: 'law-explain',
      language: 'en',
      question: 'Which BNS section replaces IPC 302?',
    })

    expect(cachedMeta(hit!.row)?.cached).toBe(true)
    expect(cachedMeta(hit!.row)?.model).toBe('claude-sonnet-4-6')
  })

  it('empties on request', async () => {
    await seed('Which BNS section replaces IPC 302?')
    await clearAnswerCache()
    expect(await db.aiAnswers.count()).toBe(0)
  })

  it('stores nothing for a question that normalises to nothing', async () => {
    // "???" and "।।।" are punctuation only. A row keyed on an empty string
    // would then be returned for every other empty-normalising question.
    await seed('???')
    expect(await db.aiAnswers.count()).toBe(0)
    expect(await lookupAnswer({ agentId: 'law-explain', language: 'en', question: '।।।' })).toBeNull()
  })

  it('evicts the oldest rows rather than growing without a bound', async () => {
    // Nothing else in the app caps this table. IndexedDB's failure mode when a
    // quota is reached is that some unrelated write starts throwing.
    for (let i = 0; i < MAX_CACHED_ANSWERS + 5; i += 1) {
      await storeAnswer({
        agentId: 'law-explain',
        language: 'en',
        question: `Which BNS section replaces IPC ${100 + i}?`,
        answer: `It is BNS ${i}.`,
        meta: { ...meta, at: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString() },
      })
    }

    expect(await db.aiAnswers.count()).toBe(MAX_CACHED_ANSWERS)
    // The five oldest went; the newest survived.
    const remaining = await db.aiAnswers.toArray()
    expect(remaining.some((row) => row.question.includes('IPC 100'))).toBe(false)
    expect(remaining.some((row) => row.question.includes(`IPC ${100 + MAX_CACHED_ANSWERS + 4}`))).toBe(true)
  })
})
