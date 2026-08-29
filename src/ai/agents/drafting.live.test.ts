import { beforeAll, describe, expect, it } from 'vitest'

import { runDraftingAgent } from './drafting'
import { AnthropicDirectProvider } from '../providers/anthropic-direct'
import { clearRegistry, listTools } from '../tools/registry'
import { registerBuiltinTools } from '../tools/index'

/**
 * The one test in this repository that reaches the network, and it does not run.
 *
 * It is skipped unless BOTH `AI_LIVE=1` and `ANTHROPIC_API_KEY` are set, so
 * `pnpm check`, `pnpm test` and CI never make a request — the master context's
 * zero-outbound-request rule is not conditional, and a test that occasionally
 * called Anthropic depending on a developer's shell would make the rule
 * unprovable.
 *
 *     AI_LIVE=1 ANTHROPIC_API_KEY=sk-ant-… pnpm exec vitest run src/ai/agents/drafting.live.test.ts
 *
 * What it is for: MockProvider proves the agent's POLICY — the tool sequence,
 * the checklist being evaluated rather than claimed, the revision cap, the
 * refusal. It cannot prove that a real model, given this persona and these tool
 * descriptions, produces a plan that parses. Those are different failures, and
 * the second one only ever shows up against a real model: a JSON schema the
 * provider rejects, a rationale with no citation in it, a field id the model
 * infers from the label rather than reading from `get_draft_template`.
 *
 * So the assertions here are deliberately about SHAPE, not about wording. A
 * test that asserted the model's prose would fail on a model upgrade, and
 * everyone would learn to ignore it.
 *
 * The key is read from the environment through the provider's own `readKey`
 * seam rather than from the encrypted vault: there is no browser here, and the
 * vault is a browser thing.
 */

const KEY = process.env.ANTHROPIC_API_KEY
const LIVE = process.env.AI_LIVE === '1' && Boolean(KEY)

describe.skipIf(!LIVE)('the drafting agent against a real model', () => {
  beforeAll(() => {
    clearRegistry()
    registerBuiltinTools()
  })

  it('drafts an Office Memorandum whose checklist the engine agrees with', async () => {
    const provider = new AnthropicDirectProvider({
      model: 'claude-sonnet-4-6',
      readKey: () => Promise.resolve(KEY ?? null),
    })

    const result = await runDraftingAgent({
      provider,
      brief:
        'Clarify to all Ministries that Children Education Allowance is admissible for a child ' +
        'studying at the National Institute of Open Schooling, on production of a certificate of ' +
        'enrolment, subject to the two-child limit. I do not have the file number or the date.',
      templateId: 'office-memorandum',
      lang: 'en',
      language: 'en',
      tools: listTools(['draft', 'utils']),
      /*
          There is no IndexedDB in this runner, so the Dexie ledger must not be
          reached. `budgetLimit: null` is what stops `state` being called at
          all; the stub THROWS rather than returning a placeholder, so that if a
          later change starts consulting the budget here the test says so
          instead of quietly writing nowhere.
        */
      ledger: {
        state: () => Promise.reject(new Error('the live smoke test has no budget ledger')),
        record: () => Promise.resolve(),
      },
      budgetLimit: null,
    })

    expect(['draft', 'questions']).toContain(result.status)

    if (result.status === 'questions') {
      // A legitimate outcome for this brief: it withholds two required facts.
      expect(result.questions.length).toBeLessThanOrEqual(3)
      for (const question of result.questions) {
        expect(question.en.length).toBeGreaterThan(0)
        expect(question.hi.length).toBeGreaterThan(0)
      }
      return
    }

    expect(result.status).toBe('draft')
    if (result.status !== 'draft') return

    expect(result.templateId).toBe('office-memorandum')
    // Every key the model produced is a field this form actually has.
    expect(result.problems.filter((problem) => problem.startsWith('Dropped field'))).toEqual([])
    // The checklist is the ENGINE's, not the model's: one entry per item the
    // committed template declares, in the template's own order.
    const { loadTemplate } = await import('@/modules/drafting/data')
    const template = await loadTemplate('office-memorandum')
    expect(result.checklist.items.map((item) => item.id)).toEqual(template.checklist.map((item) => item.id))
    expect(result.text.length).toBeGreaterThan(0)
    // The brief withheld the file number, so the model must have left a blank
    // rather than inventing one. This is the assertion worth having.
    expect(result.fieldValues.fileNumber === undefined || result.blanks.includes('fileNumber')).toBe(true)
    expect(result.usage.inputTokens).toBeGreaterThan(0)
    expect(result.rationale.en.length).toBeGreaterThan(0)
    expect(result.rationale.hi.length).toBeGreaterThan(0)
  }, 120_000)
})
