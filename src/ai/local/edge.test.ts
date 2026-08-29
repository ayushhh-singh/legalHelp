import { describe, expect, it } from 'vitest'

import { parseLocalTurn } from './protocol'
import { LocalProvider } from '../providers/local'
import type { LocalGenerateRequest, LocalGenerateResult } from './engine'
import { EMPTY_USAGE, type AiEvent, type ChatParams } from '../types'

/**
 * An edge-case pass over Tier 0, after ADR-037 shipped.
 *
 * Every test here was confirmed to FAIL against the committed code before its
 * fix, which is the rule `src/lib/srs/edge.test.ts` and
 * `src/ai/agents/drafting.edge.test.ts` already follow in this project. The
 * common thread in what it found is the one ADR-037's addendum names: the
 * provider is the layer furthest from the agents, and an assumption made here
 * about what a caller wants is an assumption four agents cannot see.
 */

function stub(result: Partial<LocalGenerateResult> & { text: string }) {
  const seen: LocalGenerateRequest[] = []
  return {
    seen,
    generate: (request: LocalGenerateRequest) => {
      seen.push(request)
      // Stream the text the way the real engine does, one piece at a time.
      for (const piece of result.text.match(/.{1,8}/gs) ?? []) request.onToken?.(piece)
      return Promise.resolve({
        usage: { ...EMPTY_USAGE },
        stopReason: 'end_turn' as const,
        ...result,
      })
    },
  }
}

const params = (over: Partial<ChatParams> = {}): ChatParams => ({
  system: [{ text: 'persona' }],
  messages: [{ role: 'user', content: [{ type: 'text', text: 'q' }] }],
  ...over,
})

describe('an envelope whose answer is empty or is not a string', () => {
  /*
    `firstString` required a non-empty trimmed string, so `{"answer": ""}` found
    no answer, found no tool name, and fell through to "this is the model's
    prose" — which handed the READER the literal characters `{"answer": ""}`
    under a heading that says Answer. Every non-string shape did the same.

    A model constrained to emit `{"answer": …}` and having nothing to say
    produces exactly this, and on a 1.5B model it is not rare.
  */
  const cases: ReadonlyArray<readonly [string, string]> = [
    ['an empty string', '{"answer": ""}'],
    ['whitespace only', '{"answer": "   "}'],
    ['null', '{"answer": null}'],
    ['a number', '{"answer": 42}'],
    ['an array', '{"answer": []}'],
  ]

  for (const [name, raw] of cases) {
    it(`reports nothing rather than showing the reader the envelope — ${name}`, () => {
      for (const mode of ['tools', 'answer'] as const) {
        const turn = parseLocalTurn(raw, mode)
        expect(turn.kind, `${name} in ${mode} mode`).toBe('empty')
      }
    })
  }

  it('still treats a genuinely absent answer key as prose', () => {
    // The fall-through is right when there is no `answer` key at all: the model
    // ignored the envelope and simply answered, and runAgent's grounding rules
    // are what decide whether that may be shown.
    expect(parseLocalTurn('Section 103 punishes murder. [1]', 'answer')).toEqual({
      kind: 'text',
      text: 'Section 103 punishes murder. [1]',
    })
    expect(parseLocalTurn('{"thoughts":"unsure"}', 'answer')).toMatchObject({ kind: 'text' })
  })
})

describe('token events on a structured turn', () => {
  /*
    `wire.ts` — Tiers 1 and 2 — emits a `token` event for every text delta,
    including on a turn that asked for a JSON schema. LocalProvider suppressed
    them there, which made it the ONLY provider in the app that behaves
    differently on the same call.

    The one consumer of token events is `src/ai/agents/law.ts`'s answering
    pass, which passes a jsonSchema and reads the half-arrived JSON with
    `partialAnswerText()` — a function that exists precisely to render a
    structured answer as it streams. So the suppression protected nobody and
    silenced the only surface that streams, on the slowest tier, where a run
    takes half a minute rather than three seconds.
  */
  it('streams tokens for a schema turn, exactly as the wire providers do', async () => {
    const script = stub({ text: '{"answer":{"en":"Murder.","hi":"हत्या।"}}' })
    const events: AiEvent[] = []

    await new LocalProvider({ generate: script.generate }).chat(
      params({
        jsonSchema: { name: 'answer', schema: { type: 'object' } },
        onEvent: (event) => events.push(event),
      }),
    )

    expect(script.seen[0]?.onToken).toBeDefined()
    const streamed = events.filter((event) => event.type === 'token')
    expect(streamed.length).toBeGreaterThan(1)
    expect(streamed.map((event) => (event.type === 'token' ? event.text : '')).join('')).toBe(
      '{"answer":{"en":"Murder.","hi":"हत्या।"}}',
    )
  })

  it('still streams tokens for a prose turn', async () => {
    const script = stub({ text: '{"answer":"Not bailable. [1]"}' })
    const events: AiEvent[] = []
    await new LocalProvider({ generate: script.generate }).chat(
      params({ onEvent: (event) => events.push(event) }),
    )
    expect(events.filter((event) => event.type === 'token').length).toBeGreaterThan(1)
  })
})
