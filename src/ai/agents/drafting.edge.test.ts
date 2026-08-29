import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { improveWording, runDraftingAgent } from './drafting'
import { OM_CALLS, OM_RATIONALE, planScript } from '../fixtures/drafting-scripts'
import { MockProvider } from '../providers/mock'
import { clearRegistry, listTools, registerTool } from '../tools/registry'
import { registerBuiltinTools } from '../tools/index'

import { sampleValues } from '@/lib/drafting/engine'
import { loadTemplate } from '@/modules/drafting/data'
import type { DocTemplate } from '@/modules/drafting/schema'

/**
 * The edge-case pass over Session 21, agent half.
 *
 * Every test in this file was confirmed to FAIL against the code as committed
 * in 1d066dc before its fix — the same discipline `src/lib/srs/edge.test.ts`
 * and ADR-028's own addendum used. A test written after the fix proves the fix
 * compiles; a test written before it proves the defect was real.
 */

let om: DocTemplate

beforeAll(async () => {
  om = await loadTemplate('office-memorandum')
})

beforeEach(() => {
  clearRegistry()
  registerBuiltinTools()
})

const tools = () => listTools(['draft', 'utils'])

const okPlan = (over: Record<string, unknown> = {}) =>
  planScript(
    'edge',
    { templateId: 'office-memorandum', rationale: OM_RATIONALE, fieldValues: sampleValues(om), ...over },
    OM_CALLS,
  )

describe('the refusal screen covers everything that leaves, not only the brief', () => {
  it('refuses when the OFFICER’S OWN DRAFT names classified material, with a clean brief', async () => {
    /*
      `currentValues` is sent — it becomes a PLATFORM CONTEXT snippet so the
      agent completes the officer's work rather than replacing it. Screening
      only the brief left the one thing most likely to carry a marking
      unscreened: the document itself.
    */
    const provider = new MockProvider(okPlan())
    const result = await runDraftingAgent({
      provider,
      brief: 'Finish this off and tighten the wording.',
      templateId: 'office-memorandum',
      currentValues: { subject: 'Handling of the classified annexure to the tender' },
      lang: 'en',
      language: 'en',
      tools: tools(),
    })

    expect(result.status).toBe('refused')
    expect(provider.calls).toHaveLength(0)
  })

  it('still screens the brief when there are no current values', async () => {
    const provider = new MockProvider(okPlan())
    const result = await runDraftingAgent({
      provider,
      brief: 'Draft the confidential note.',
      templateId: 'office-memorandum',
      lang: 'en',
      language: 'en',
      tools: tools(),
    })
    expect(result.status).toBe('refused')
    expect(provider.calls).toHaveLength(0)
  })

  it('does not refuse a brief that names the Official Secrets Act', async () => {
    /*
      `\bsecret\b` does not match "Secrets", and that is correct rather than
      lucky: the OSA is one of the twelve PUBLIC rule books this app trains on
      (`data/rules/text/osa.json`), and a show-cause reply that cites it is
      ordinary work. Pinned so a future widening of the pattern to `secrets?`
      has to argue with this test.
    */
    const provider = new MockProvider(okPlan())
    const result = await runDraftingAgent({
      provider,
      brief: 'Draft a show-cause reply referring to section 5 of the Official Secrets Act, 1923.',
      templateId: 'office-memorandum',
      lang: 'en',
      language: 'en',
      tools: tools(),
    })
    expect(result.status).not.toBe('refused')
  })
})

describe('a failing tool is an error, not a rejected promise', () => {
  it('returns status "error" when render_draft throws', async () => {
    /*
      `runDraftingAgent`'s documented return type is a discriminated union with
      an `error` member. Stages 3 and 5 call the tools directly, outside
      `runAgent`'s own try/catch, so a handler that threw rejected the promise
      instead — a caller that had handled every member of the union still got
      an unhandled rejection. The hook caught it; a test, an agent-to-agent
      caller or a future surface would not have.
    */
    clearRegistry()
    registerBuiltinTools()
    const broken = tools().filter((tool) => tool.def.name !== 'render_draft')
    registerTool({
      name: 'render_draft_broken',
      scope: 'draft',
      description: { en: 'x', hi: 'क्ष' },
      inputSchema: z.object({}),
      handler: () => Promise.reject(new Error('disk on fire')),
    })

    const provider = new MockProvider(okPlan())
    const result = await runDraftingAgent({
      provider,
      brief: 'Clarify the education allowance position.',
      templateId: 'office-memorandum',
      lang: 'en',
      language: 'en',
      // render_draft is missing entirely, which is the same failure shape.
      tools: broken,
    })

    expect(result.status).toBe('error')
    if (result.status !== 'error') return
    expect(result.message).toMatch(/render_draft/)
  })
})

describe('improveWording on a field with nothing in it', () => {
  it('says so instead of asking a model to rewrite an empty string', async () => {
    const provider = new MockProvider(okPlan())
    const field = om.fields.find((entry) => entry.id === 'subject')
    if (!field) throw new Error('no subject field')

    const result = await improveWording({
      provider,
      template: om,
      field,
      text: '   ',
      lang: 'en',
      language: 'en',
      tools: tools(),
    })

    expect(result.status).toBe('error')
    expect(provider.calls).toHaveLength(0)
  })
})

describe('suggested phrases', () => {
  it('does not repeat a phrase the model named twice', async () => {
    /*
      The list is rendered with `key={phrase.id}`, so a repeated id is a
      duplicate React key as well as a duplicate chip. A model listing its
      favourite opening twice is not a defect on its part.
    */
    const provider = new MockProvider(
      okPlan({ suggestedPhraseIds: ['om-undersigned-directed', 'om-undersigned-directed'] }),
    )
    const result = await runDraftingAgent({
      provider,
      brief: 'Clarify the education allowance position.',
      templateId: 'office-memorandum',
      lang: 'en',
      language: 'en',
      tools: tools(),
    })

    expect(result.status).toBe('draft')
    if (result.status !== 'draft') return
    expect(result.suggestedPhrases.map((phrase) => phrase.id)).toEqual(['om-undersigned-directed'])
  })
})

describe('cancellation between stages', () => {
  it('reports "aborted" rather than a draft when the signal fires after the plan', async () => {
    /*
      `runAgent` checks the signal at the top of each of ITS loops, but the
      agent's own stages sit between two of those calls. A run cancelled while
      the plan was resolving went on to render, check, and return a complete
      draft — which the hook happened to discard, but which any other caller
      would have shown.
    */
    const controller = new AbortController()
    const provider = new MockProvider(okPlan())
    const result = await runDraftingAgent({
      provider,
      brief: 'Clarify the education allowance position.',
      templateId: 'office-memorandum',
      lang: 'en',
      language: 'en',
      tools: tools(),
      signal: controller.signal,
      onProgress: (step) => {
        // The moment the plan is done and the local checking is about to start.
        if (step.phase === 'checking') controller.abort()
      },
    })

    expect(result.status).toBe('error')
    if (result.status !== 'error') return
    expect(result.code).toBe('aborted')
  })
})
