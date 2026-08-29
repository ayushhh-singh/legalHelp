import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { LOCAL_MAX_OUTPUT_TOKENS, LocalProvider } from './local'
import { runAgent } from '../agent'
import { buildContext } from '../context'
import { DEFAULT_LOCAL_MODEL } from '../local/catalogue'
import type { LocalGenerateRequest, LocalGenerateResult } from '../local/engine'
import { LOCAL_MAX_TOOL_STEPS } from '../local/protocol'
import { getTool, registerTool, type RegisteredTool } from '../tools/registry'
import { AiError, EMPTY_USAGE, type AiEvent, type ChatParams, type ToolSpec } from '../types'
import type { BudgetState } from '../usage'

/**
 * The whole of Tier 0 above the GPU, driven against a scripted generator.
 *
 * `LocalProvider` takes its `generate` as an injected function for exactly
 * this: the prompt shape, the emulated tool protocol, the two-step cap,
 * cancellation and the usage accounting are all decisions this app makes, and
 * none of them should need a graphics card to test. The parts that DO need one
 * — loading weights, WebGPU — are behind `ensureLocalEngine`, and are the only
 * parts not covered here.
 *
 * The second half runs the provider through `runAgent` unchanged, which is the
 * claim the provider seam exists to support: the agent loop cannot tell which
 * tier produced a `tool_use`.
 */

interface Scripted {
  generate: (request: LocalGenerateRequest) => Promise<LocalGenerateResult>
  seen: LocalGenerateRequest[]
}

function scripted(turns: readonly (string | LocalGenerateResult)[]): Scripted {
  const seen: LocalGenerateRequest[] = []
  let index = 0
  return {
    seen,
    generate: (request) => {
      seen.push(request)
      const turn = turns[index++]
      if (turn === undefined) throw new AiError('provider', `script ran out after ${index - 1} turns`)
      if (typeof turn !== 'string') return Promise.resolve(turn)
      return Promise.resolve({
        text: turn,
        usage: { ...EMPTY_USAGE, inputTokens: 40, outputTokens: 12 },
        stopReason: 'end_turn' as const,
      })
    },
  }
}

const budget = (over: Partial<BudgetState> = {}): BudgetState => ({
  month: '2026-08',
  used: 0,
  limit: 1_000,
  remaining: 1_000,
  exhausted: false,
  ...over,
})

const TOOL_SPECS: ToolSpec[] = [
  {
    name: 'get_section',
    description: 'Read one section.',
    inputSchema: { type: 'object', properties: { section: { type: 'string' } } },
  },
]

const params = (over: Partial<ChatParams> = {}): ChatParams => ({
  system: [{ text: 'You are Sahayak.', cache: true }],
  messages: [{ role: 'user', content: [{ type: 'text', text: 'Is BNS 103 bailable?' }] }],
  ...over,
})

describe('capabilities', () => {
  it('is the only provider in the app that says nothing leaves the device', () => {
    // The consent modal and the permanent AI banner both branch on this flag,
    // so it decides what the reader is TOLD is happening to their words.
    expect(new LocalProvider().capabilities.localOnly).toBe(true)
  })

  it('reports tools as supported, because a tool_use part can come back', () => {
    expect(new LocalProvider().capabilities.tools).toBe(true)
  })

  it('takes its context window from the chosen model', () => {
    expect(new LocalProvider({ modelId: DEFAULT_LOCAL_MODEL }).capabilities.maxContext).toBe(4096)
  })
})

describe('the prompt it builds', () => {
  it('puts the tool protocol into the system turn, after the persona', () => {
    const script = scripted(['{"answer":"x [T1]"}'])
    const provider = new LocalProvider({ generate: script.generate })
    return provider.chat(params({ tools: TOOL_SPECS })).then(() => {
      const system = script.seen[0]?.messages[0]
      expect(system?.role).toBe('system')
      expect(system?.content).toContain('You are Sahayak.')
      expect(system?.content).toContain('get_section')
      expect(system?.content).toContain('TOOL PROTOCOL')
    })
  })

  it('asks for JSON-constrained decoding on a protocol turn and not on a schema turn', async () => {
    const script = scripted(['{"answer":"x"}', '{"en":"a","hi":"आ"}'])
    const provider = new LocalProvider({ generate: script.generate })

    await provider.chat(params({ tools: TOOL_SPECS }))
    expect(script.seen[0]?.jsonMode).toBe(true)
    expect(script.seen[0]?.jsonSchema).toBeUndefined()

    await provider.chat(params({ jsonSchema: { name: 'answer', schema: { type: 'object' } } }))
    // A schema turn hands the schema itself to the decoder, and the envelope
    // is not offered alongside it — asking for two different objects at once.
    expect(script.seen[1]?.jsonMode).toBe(false)
    expect(script.seen[1]?.jsonSchema).toBe('{"type":"object"}')
    expect(script.seen[1]?.messages[0]?.content).not.toContain('TOOL PROTOCOL')
  })

  it('never demands a [T…] handle from a toolless run, and a rule number survives the check', async () => {
    /*
      The end-to-end version of `protocol.test.ts`'s own regression, run through
      the REAL agent loop and the REAL citation validator against a context
      shaped like `src/ai/agents/tutor.ts`'s.

      Those agents fetch in code and pass `tools: []`, so the model has
      numbered PLATFORM CONTEXT and no tool results. Told to cite `[T1]` it
      cites nothing that `context.ts#CITATION_PATTERN` recognises, "Rule 3"
      lands in `unsupported`, and the run dies with `invalid_citation` — on
      Tier 0 and on no other tier. Asserting `run.ok` here is what makes that a
      test of the outcome rather than of the prompt's wording.
    */
    const context = buildContext([
      {
        type: 'rule',
        source: 'CCS Conduct Rule 3',
        text: 'Rule 3 — Every Government servant shall at all times maintain absolute integrity.',
      },
    ])
    const script = scripted(['{"answer":"Rule 3 requires absolute integrity. [1]"}'])

    const run = await runAgent({
      agentId: 'trainer-coach',
      provider: new LocalProvider({ generate: script.generate }),
      tools: [],
      system: [{ text: 'persona' }],
      userMessage: 'Why was I wrong about Rule 3?',
      tier: 'local',
      context,
      groundedRequired: false,
      budgetLimit: null,
      ledger: { state: () => Promise.resolve(budget()), record: () => Promise.resolve() },
    })

    expect(script.seen[0]?.messages[0]?.content).not.toMatch(/\[T\d/)
    expect(run.ok, run.error?.message).toBe(true)
    expect(run.grounding.citedContextIndices).toEqual([1])
  })

  it('clamps the output ceiling however much the caller asked for', async () => {
    const script = scripted(['{"answer":"x"}'])
    await new LocalProvider({ generate: script.generate }).chat(params({ maxTokens: 64_000 }))
    expect(script.seen[0]?.maxTokens).toBe(LOCAL_MAX_OUTPUT_TOKENS)
  })
})

describe('the emulated tool call', () => {
  it('comes back as the same tool_use part a wire provider produces', async () => {
    const script = scripted(['{"tool":"get_section","input":{"section":"103"}}'])
    const result = await new LocalProvider({ generate: script.generate }).chat(params({ tools: TOOL_SPECS }))

    expect(result.content).toEqual([
      { type: 'tool_use', id: 'local_tool_1', name: 'get_section', input: { section: '103' } },
    ])
    expect(result.stopReason).toBe('tool_use')
  })

  it('numbers each call from the transcript, not from a field on the provider', async () => {
    // A counter on the object would leak one run's numbering into the next,
    // because runAgent builds a fresh messages array per run and the provider
    // outlives it.
    const script = scripted([
      '{"tool":"get_section","input":{"section":"103"}}',
      '{"tool":"get_section","input":{"section":"318"}}',
    ])
    const provider = new LocalProvider({ generate: script.generate })

    const first = await provider.chat(params({ tools: TOOL_SPECS }))
    const second = await provider.chat(
      params({
        tools: TOOL_SPECS,
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'q' }] },
          { role: 'assistant', content: first.content },
          { role: 'user', content: [{ type: 'tool_result', toolUseId: 'local_tool_1', content: '[T1] {}' }] },
        ],
      }),
    )

    expect(first.content[0]).toMatchObject({ id: 'local_tool_1' })
    expect(second.content[0]).toMatchObject({ id: 'local_tool_2' })
  })

  it('stops offering tools after two calls, and forces an answer', async () => {
    const script = scripted(['{"answer":"Not bailable. [T1]"}'])
    const spent = Array.from({ length: LOCAL_MAX_TOOL_STEPS }, (_, i) => ({
      role: 'assistant' as const,
      content: [{ type: 'tool_use' as const, id: `t${i}`, name: 'get_section', input: {} }],
    }))

    const result = await new LocalProvider({ generate: script.generate }).chat(
      params({
        tools: TOOL_SPECS,
        messages: [{ role: 'user', content: [{ type: 'text', text: 'q' }] }, ...spent],
      }),
    )

    expect(script.seen[0]?.messages[0]?.content).not.toContain('TOOL PROTOCOL')
    expect(script.seen[0]?.messages[0]?.content).toContain('{"answer"')
    expect(result.content).toEqual([{ type: 'text', text: 'Not bailable. [T1]' }])
  })

  it('returns nothing rather than showing the reader an envelope it cannot honour', async () => {
    // The model tried a third lookup. Printing the JSON under a heading that
    // says "Answer" would be worse than reporting that it did not answer.
    const script = scripted(['{"tool":"get_section","input":{"section":"1"}}'])
    const spent = Array.from({ length: LOCAL_MAX_TOOL_STEPS }, (_, i) => ({
      role: 'assistant' as const,
      content: [{ type: 'tool_use' as const, id: `t${i}`, name: 'get_section', input: {} }],
    }))

    const result = await new LocalProvider({ generate: script.generate }).chat(
      params({
        tools: TOOL_SPECS,
        messages: [{ role: 'user', content: [{ type: 'text', text: 'q' }] }, ...spent],
      }),
    )
    expect(result.content).toEqual([])
  })
})

describe('events and usage', () => {
  it('streams prose tokens and reports usage against the local model id', async () => {
    const events: AiEvent[] = []
    const script: Scripted = {
      seen: [],
      generate: (request) => {
        script.seen.push(request)
        request.onToken?.('Not ')
        request.onToken?.('bailable. [T1]')
        return Promise.resolve({
          text: 'Not bailable. [T1]',
          usage: { ...EMPTY_USAGE, inputTokens: 900, outputTokens: 30 },
          stopReason: 'end_turn' as const,
        })
      },
    }

    const result = await new LocalProvider({
      modelId: DEFAULT_LOCAL_MODEL,
      generate: script.generate,
    }).chat(params({ onEvent: (event) => events.push(event) }))

    expect(events.filter((event) => event.type === 'token')).toHaveLength(2)
    expect(result.model).toBe(DEFAULT_LOCAL_MODEL)
    expect(events.at(-1)).toEqual({
      type: 'usage',
      usage: { ...EMPTY_USAGE, inputTokens: 900, outputTokens: 30 },
      model: DEFAULT_LOCAL_MODEL,
    })
  })

  it('does not stream a half-arrived JSON envelope to the caller', async () => {
    // Rendering `{"answer": "Sec` live is worse than rendering nothing; the
    // agents that stream structured answers do their own partial parsing.
    const events: AiEvent[] = []
    const script: Scripted = {
      seen: [],
      generate: (request) => {
        script.seen.push(request)
        return Promise.resolve({
          text: '{"en":"a","hi":"आ"}',
          usage: { ...EMPTY_USAGE },
          stopReason: 'end_turn' as const,
        })
      },
    }
    await new LocalProvider({ generate: script.generate }).chat(
      params({
        jsonSchema: { name: 'answer', schema: { type: 'object' } },
        onEvent: (event) => events.push(event),
      }),
    )
    expect(script.seen[0]?.onToken).toBeUndefined()
    expect(events.filter((event) => event.type === 'token')).toHaveLength(0)
  })

  it('passes the abort signal through to the generator', async () => {
    const controller = new AbortController()
    const script = scripted(['{"answer":"x"}'])
    await new LocalProvider({ generate: script.generate }).chat(params({ signal: controller.signal }))
    expect(script.seen[0]?.signal).toBe(controller.signal)
  })
})

/* ------------------------------------------------------------------ *
 * Through the agent loop
 * ------------------------------------------------------------------ */

registerTool({
  name: 'local_test_get_section',
  scope: 'law',
  description: { en: 'Read one section.', hi: 'एक धारा पढ़ें।' },
  inputSchema: z.object({ section: z.string().min(1) }).strict(),
  handler: (input: { section: string }) =>
    Promise.resolve({ section: input.section, bailable: false, heading: 'Punishment for murder' }),
})

const sectionTool = getTool('local_test_get_section') as RegisteredTool

describe('through runAgent, unchanged', () => {
  const run = (provider: LocalProvider) =>
    runAgent({
      agentId: 'law-explain',
      provider,
      tools: [sectionTool],
      system: [{ text: 'persona' }],
      userMessage: 'Is BNS 103 bailable?',
      tier: 'local',
      budgetLimit: null,
      ledger: { state: () => Promise.resolve(budget()), record: () => Promise.resolve() },
    })

  it('completes a grounded run: emulated call, real tool, cited answer', async () => {
    const provider = new LocalProvider({
      generate: scripted([
        '{"tool":"local_test_get_section","input":{"section":"103"}}',
        '{"answer":"BNS 103 is not bailable. [T1]"}',
      ]).generate,
    })

    const result = await run(provider)
    expect(result.ok).toBe(true)
    expect(result.text).toBe('BNS 103 is not bailable. [T1]')
    expect(result.grounding.citedToolResultIds).toEqual(['T1'])
    expect(result.toolResults[0]?.ok).toBe(true)
  })

  it('discards an uncited answer, exactly as it would on a paid tier', async () => {
    // Tier 0 fails this check more often than the others. That is the tier
    // working, not the tier being broken — an ungrounded answer from a 1.5B
    // model is the failure the grounding rule was written for.
    const provider = new LocalProvider({
      generate: scripted([
        '{"tool":"local_test_get_section","input":{"section":"103"}}',
        '{"answer":"It is not bailable."}',
      ]).generate,
    })

    const result = await run(provider)
    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe('ungrounded')
  })

  it('recovers once from bad arguments, through the agent’s own path', async () => {
    // The parser deliberately does NOT validate arguments — runAgent does,
    // with one feedback round. This is what that split buys.
    const provider = new LocalProvider({
      generate: scripted([
        '{"tool":"local_test_get_section","input":{"wrong":"103"}}',
        '{"tool":"local_test_get_section","input":{"section":"103"}}',
        '{"answer":"BNS 103 is not bailable. [T1]"}',
      ]).generate,
    })

    const result = await run(provider)
    expect(result.ok).toBe(true)
    expect(result.toolResults).toHaveLength(1)
  })

  it('costs nothing, and is stamped as a local run', async () => {
    const provider = new LocalProvider({
      modelId: DEFAULT_LOCAL_MODEL,
      generate: scripted([
        '{"tool":"local_test_get_section","input":{"section":"103"}}',
        '{"answer":"BNS 103 is not bailable. [T1]"}',
      ]).generate,
    })

    const result = await run(provider)
    // The tokens are real and are still counted; the money is not, and must
    // not be invented from the default model's price list.
    expect(result.usage.inputTokens).toBeGreaterThan(0)
    expect(result.meta.cost).toBe(0)
    expect(result.meta.tier).toBe('local')
    expect(result.meta.model).toBe(DEFAULT_LOCAL_MODEL)
  })

  it('is not stopped by the monthly TOKEN budget, because it spends no money', async () => {
    const ledger = {
      state: vi.fn(() => Promise.resolve(budget({ used: 10, limit: 10, remaining: 0, exhausted: true }))),
      record: () => Promise.resolve(),
    }
    const provider = new LocalProvider({
      generate: scripted([
        '{"tool":"local_test_get_section","input":{"section":"103"}}',
        '{"answer":"BNS 103 is not bailable. [T1]"}',
      ]).generate,
    })

    const result = await runAgent({
      agentId: 'law-explain',
      provider,
      tools: [sectionTool],
      system: [{ text: 'persona' }],
      userMessage: 'Is BNS 103 bailable?',
      tier: 'local',
      budgetLimit: 10,
      ledger,
    })

    expect(result.ok).toBe(true)
    expect(ledger.state).not.toHaveBeenCalled()
  })

  it('still stops a PAID tier at the same exhausted budget', async () => {
    // The negative side of the exemption above. Without this, "budget skipped
    // for local" and "budget never enforced" are the same passing test.
    const provider = new LocalProvider({ generate: scripted(['{"answer":"x [T1]"}']).generate })
    const result = await runAgent({
      agentId: 'law-explain',
      provider,
      tools: [sectionTool],
      system: [{ text: 'persona' }],
      userMessage: 'q',
      tier: 'byok',
      budgetLimit: 10,
      ledger: {
        state: () => Promise.resolve(budget({ used: 10, limit: 10, remaining: 0, exhausted: true })),
        record: () => Promise.resolve(),
      },
    })
    expect(result.error?.code).toBe('budget_exhausted')
  })
})
