import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { getTool, listTools } from './registry'
import { registerRulesTools } from './rules'

import { clearAllData, db } from '@/db'

/**
 * The four Trainer tools, run for real against the committed dataset and a
 * real (fake-indexeddb) `db`. Called through the registry, as
 * `drafting.test.ts` does, so each tool's zod schema runs on the way in.
 */

const call = async (name: string, input: unknown): Promise<Record<string, unknown>> => {
  const tool = getTool(name)
  if (!tool) throw new Error(`tool not registered: ${name}`)
  const parsed = tool.def.inputSchema.parse(input)
  const result = await tool.def.handler(parsed, { language: 'en', signal: new AbortController().signal })
  return result as Record<string, unknown>
}

beforeAll(() => {
  registerRulesTools()
})

beforeEach(async () => {
  await clearAllData()
})

describe('registration', () => {
  it('registers all four under the learn scope', () => {
    const names = listTools('learn')
      .filter((tool) => tool.def.scope === 'learn')
      .map((tool) => tool.def.name)
      .sort()
    expect(names).toEqual(['get_card_history', 'get_rule_text', 'get_user_weak_areas', 'propose_card'])
  })

  it('is idempotent', () => {
    expect(() => {
      registerRulesTools()
      registerRulesTools()
    }).not.toThrow()
  })

  it('gives every one a Hindi description', () => {
    for (const tool of listTools('learn').filter((each) => each.def.scope === 'learn')) {
      expect(tool.def.description.hi.length, tool.def.name).toBeGreaterThan(20)
    }
  })
})

describe('get_rule_text', () => {
  it('finds a real rule in the committed dataset', async () => {
    const result = await call('get_rule_text', { act: 'ccs-conduct', rule: '1' })
    expect(result.found).toBe(true)
    expect(result.heading).toBe('Short title, commencement and application')
    const source = result.source as { name: string; url: string }
    expect(typeof source.name).toBe('string')
    expect(source.name.length).toBeGreaterThan(0)
  })

  it('reports not-found for a rule number the act does not have', async () => {
    const result = await call('get_rule_text', { act: 'ccs-conduct', rule: '999-does-not-exist' })
    expect(result.found).toBe(false)
    expect(Array.isArray(result.available)).toBe(true)
  })

  it('rejects an unknown act at the schema, before the handler runs', () => {
    const tool = getTool('get_rule_text')!
    expect(() => tool.def.inputSchema.parse({ act: 'not-a-real-act', rule: '1' })).toThrow()
  })
})

describe('get_card_history', () => {
  it('reports never-seen for a card with no rows at all', async () => {
    const result = await call('get_card_history', { qId: 'no-such-card' })
    expect(result).toMatchObject({ everSeen: false, currentState: null, history: [] })
  })

  it('reads back a seeded review log in order', async () => {
    await db.reviewLog.bulkPut([
      { id: 'q1#1#a', qId: 'q1', grade: 'Good', at: '2026-08-01T00:00:00.000Z', durationMs: 1000, stateBefore: 'new', elapsed: 0, retrievability: null },
      { id: 'q1#2#b', qId: 'q1', grade: 'Again', at: '2026-08-05T00:00:00.000Z', durationMs: 500, stateBefore: 'review', elapsed: 4, retrievability: 0.8 },
    ])
    const result = await call('get_card_history', { qId: 'q1' })
    expect(result.everSeen).toBe(false) // no srsCards row was written, only the log
    expect((result.history as unknown[]).map((h) => (h as { grade: string }).grade)).toEqual(['Good', 'Again'])
  })
})

describe('get_user_weak_areas', () => {
  it('returns nothing when there is no review history', async () => {
    const result = await call('get_user_weak_areas', {})
    expect(result.areas).toEqual([])
  })
})

describe('propose_card', () => {
  const validInput = {
    act: 'ccs-conduct',
    rule: '1',
    kind: 'mcq' as const,
    front: { en: 'What does Rule 1 cover?', hi: 'नियम 1 किसका उल्लेख करता है?' },
    back: { en: 'Its short title, commencement and application.', hi: 'इसका संक्षिप्त नाम, प्रारंभ और प्रयोज्यता।' },
    options: [
      { en: 'Its short title, commencement and application.', hi: 'इसका संक्षिप्त नाम, प्रारंभ और प्रयोज्यता।' },
      { en: 'Leave encashment.', hi: 'अवकाश नकदीकरण।' },
    ],
    answerIndex: 0,
    citation: { en: 'CCS (Conduct) Rules, R. 1', hi: 'सीसीएस (आचरण) नियम, नियम 1' },
  }

  it('stores a valid card as unreviewed, never scheduled', async () => {
    const result = await call('propose_card', validInput)
    expect(result.stored).toBe(true)

    const rows = await db.proposedCards.toArray()
    expect(rows).toHaveLength(1)
    const stored = rows[0]!.card as { reviewState: string; reviewed: boolean }
    expect(stored.reviewState).toBe('unreviewed')
    expect(stored.reviewed).toBe(false)
  })

  it('refuses a card the CARD schema cannot validate, and writes nothing', async () => {
    // A rule number containing "." passes the tool's own loose input schema
    // (any non-empty string) but produces an id/ruleRef.textId with a "." in
    // it, which `cardSchema`'s slug pattern rejects — the check the tool
    // schema alone cannot make.
    const result = await call('propose_card', { ...validInput, rule: '5.2' })
    expect(result.stored).toBe(false)
    expect(typeof result.error).toBe('string')
    expect(await db.proposedCards.count()).toBe(0)
  })

  it('rejects at the tool schema when a required field is missing entirely', () => {
    const tool = getTool('propose_card')!
    expect(() => tool.def.inputSchema.parse({ ...validInput, front: undefined })).toThrow()
  })
})
