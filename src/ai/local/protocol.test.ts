import { describe, expect, it } from 'vitest'

import {
  LOCAL_MAX_TOOL_STEPS,
  firstJsonObject,
  flattenSystem,
  parseLocalTurn,
  stripFences,
  stripThinking,
  toContent,
  toPromptMessages,
  toolProtocolInstruction,
  toolStepsUsed,
} from './protocol'
import { ANSWER_FIXTURES, TOOL_CALL_FIXTURES } from '../fixtures/local-turns'
import type { Message, ToolSpec } from '../types'

const TOOLS: ToolSpec[] = [
  {
    name: 'get_section',
    description: 'Read one section of a Sanhita.',
    inputSchema: { type: 'object', properties: { act: { type: 'string' }, section: { type: 'string' } } },
  },
  {
    name: 'search_sections',
    description: 'Search the statute.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
  },
]

describe('parseLocalTurn — the tool-call fixtures', () => {
  for (const fixture of TOOL_CALL_FIXTURES) {
    it(fixture.name, () => {
      const turn = parseLocalTurn(fixture.raw, 'tools')
      expect(turn.kind).toBe(fixture.expect.kind)
      if (fixture.expect.kind === 'tool' && turn.kind === 'tool') {
        expect(turn.name).toBe(fixture.expect.toolName)
        expect(turn.input).toEqual(fixture.expect.input)
      }
    })
  }
})

describe('parseLocalTurn — the answer fixtures', () => {
  for (const fixture of ANSWER_FIXTURES) {
    it(fixture.name, () => {
      const turn = parseLocalTurn(fixture.raw, 'tools')
      expect(turn.kind).toBe(fixture.expect.kind)
      if (fixture.expect.kind === 'text' && turn.kind === 'text') {
        expect(turn.text).toBe(fixture.expect.text)
      }
    })
  }
})

describe('parseLocalTurn — the modes', () => {
  it('refuses a tool call once the lookups are spent, rather than showing the JSON', () => {
    // The alternative — handing the envelope on as prose — puts
    // `{"tool":"get_section",…}` on screen under a heading that says "Answer".
    // `empty` is what actually happened: the model did not answer.
    const turn = parseLocalTurn('{"tool":"get_section","input":{"act":"bns","section":"103"}}', 'answer')
    expect(turn.kind).toBe('empty')
  })

  it('still reads an answer envelope in answer mode', () => {
    const turn = parseLocalTurn('{"answer":"Rule 3 applies. [T1]"}', 'answer')
    expect(turn).toEqual({ kind: 'text', text: 'Rule 3 applies. [T1]' })
  })

  it('never unwraps `answer` in raw mode, because the schema owns that field', () => {
    // src/ai/agents/law.ts's own answer schema is
    // `{ answer: {en, hi}, citations: [...] }`. Unwrapping here would hand
    // runAgent the bilingual object instead of the document it asked for, and
    // JSON.parse would then fail on something that was perfectly valid.
    const raw = '{"answer":{"en":"Murder.","hi":"हत्या।"},"citations":[]}'
    const turn = parseLocalTurn(raw, 'raw')
    expect(turn).toEqual({ kind: 'text', text: raw })
  })

  it('still strips a fence in raw mode — the fence is not part of the JSON', () => {
    const turn = parseLocalTurn('```json\n{"answer":{"en":"x","hi":"य"}}\n```', 'raw')
    expect(turn).toEqual({ kind: 'text', text: '{"answer":{"en":"x","hi":"य"}}' })
  })
})

describe('firstJsonObject', () => {
  it('takes the first complete object and ignores what follows', () => {
    expect(firstJsonObject('{"a":1} {"b":2}')).toBe('{"a":1}')
  })

  it('counts braces inside a string as text, not as structure', () => {
    expect(firstJsonObject('{"q":"a } b","z":1}')).toBe('{"q":"a } b","z":1}')
  })

  it('is not fooled by an escaped quote', () => {
    expect(firstJsonObject('{"q":"say \\"}\\" now","z":1}')).toBe('{"q":"say \\"}\\" now","z":1}')
  })

  it('returns nothing when the object never closes', () => {
    expect(firstJsonObject('{"tool":"get_section","input":{"act":')).toBeUndefined()
    expect(firstJsonObject('no braces here')).toBeUndefined()
  })
})

describe('stripThinking and stripFences', () => {
  it('removes a closed thinking block and keeps what follows', () => {
    expect(stripThinking('<think>hmm</think>answer')).toBe('answer')
    expect(stripThinking('<reasoning>a</reasoning> b')).toBe('b')
  })

  it('removes an unterminated one along with everything after it', () => {
    // The alternative leaves the model's private reasoning in the answer.
    expect(stripThinking('answer <think>and I am not sure because')).toBe('answer')
  })

  it('leaves ordinary text alone', () => {
    expect(stripThinking('Section 103. [T1]')).toBe('Section 103. [T1]')
    expect(stripFences('Section 103. [T1]')).toBe('Section 103. [T1]')
  })

  it('strips a fence with and without a language tag, opened or closed', () => {
    expect(stripFences('```json\n{"a":1}\n```')).toBe('{"a":1}')
    expect(stripFences('```\n{"a":1}\n```')).toBe('{"a":1}')
    expect(stripFences('```json\n{"a":1}')).toBe('{"a":1}')
  })
})

describe('the two-step cap', () => {
  const toolTurn = (name: string): Message => ({
    role: 'assistant',
    content: [{ type: 'tool_use', id: 'x', name, input: {} }],
  })

  it('counts the calls already in the transcript', () => {
    expect(toolStepsUsed([])).toBe(0)
    expect(toolStepsUsed([toolTurn('a')])).toBe(1)
    expect(toolStepsUsed([toolTurn('a'), toolTurn('b')])).toBe(2)
  })

  it('offers the tool envelope while steps remain', () => {
    const text = toolProtocolInstruction(TOOLS, { stepsLeft: LOCAL_MAX_TOOL_STEPS })
    expect(text).toContain('"tool"')
    expect(text).toContain('get_section')
    expect(text).toContain('search_sections')
    expect(text).toContain('at most 2 more times')
  })

  it('says "ONE more time" rather than "1 more times"', () => {
    expect(toolProtocolInstruction(TOOLS, { stepsLeft: 1 })).toContain('ONE more time')
  })

  it('drops the tool envelope entirely once the steps are spent', () => {
    const text = toolProtocolInstruction(TOOLS, { stepsLeft: 0 })
    expect(text).not.toContain('"tool"')
    expect(text).not.toContain('get_section')
    expect(text).toContain('{"answer"')
  })

  it('drops it when there are no tools, whatever the step count says', () => {
    expect(toolProtocolInstruction([], { stepsLeft: 2 })).not.toContain('"tool"')
  })

  it('demands a [T…] citation whenever tool results can exist', () => {
    // runAgent discards an answer that cites no tool result, so an instruction
    // that forgot to ask for one would turn every tool-using Tier 0 run into a
    // refusal.
    for (const stepsLeft of [0, 1, 2]) {
      expect(toolProtocolInstruction(TOOLS, { stepsLeft })).toContain('[T1]')
    }
  })

  it('never names a [T…] handle when the run has no tools at all', () => {
    /*
      The regression that matters, and it is about somebody else's agents.

      `src/ai/agents/{pay,tutor}.ts` fetch in code and pass `tools: []`, so
      their model sees numbered PLATFORM CONTEXT (`[1]`, `[2]`) and no tool
      results whatsoever. `context.ts#CITATION_PATTERN` does not match `[T1]`,
      so an instruction demanding one produces an answer that cites NOTHING —
      and `validateCitations` then reports every provision number in it as
      unsupported, which it does regardless of `requireCitation`. A tutor
      "Explain" saying "Rule 3 of the CCS (Conduct) Rules" died with
      `invalid_citation` on Tier 0 and nowhere else.

      This asserts the absence rather than the fix's wording, because what
      broke those agents was the handle being NAMED at all.
    */
    for (const stepsLeft of [0, 1, 2]) {
      const text = toolProtocolInstruction([], { stepsLeft })
      expect(text, `stepsLeft ${stepsLeft}`).not.toMatch(/\[T\d/)
      expect(text).not.toContain('lookup result')
      // It still has to insist on the envelope — that is the one thing this
      // block knows and the persona does not.
      expect(text).toContain('{"answer"')
    }
  })
})

describe('flattenSystem', () => {
  it('joins the blocks and drops the empty ones', () => {
    expect(flattenSystem([{ text: 'persona', cache: true }, { text: '   ' }, { text: 'context' }])).toBe(
      'persona\n\ncontext',
    )
  })
})

describe('toPromptMessages', () => {
  it("renders the assistant's own tool call back in the protocol it was taught", () => {
    const messages: Message[] = [
      { role: 'user', content: [{ type: 'text', text: 'Is BNS 103 bailable?' }] },
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 't1', name: 'get_classification', input: { section: '103' } }],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', toolUseId: 't1', content: '[T1] {"bailable":false}' }],
      },
    ]

    expect(toPromptMessages(messages)).toEqual([
      { role: 'user', content: 'Is BNS 103 bailable?' },
      { role: 'assistant', content: '{"tool":"get_classification","input":{"section":"103"}}' },
      { role: 'user', content: '[T1] {"bailable":false}' },
    ])
  })

  it('keeps the handle the citation instruction refers to', () => {
    const [, message] = toPromptMessages([
      { role: 'user', content: [{ type: 'text', text: 'q' }] },
      { role: 'user', content: [{ type: 'tool_result', toolUseId: 't1', content: '[T7] result' }] },
    ])
    expect(message?.content).toContain('[T7]')
  })

  it('labels a failed lookup as failed rather than as a result', () => {
    const [message] = toPromptMessages([
      {
        role: 'user',
        content: [{ type: 'tool_result', toolUseId: 't1', content: 'timed out', isError: true }],
      },
    ])
    expect(message?.content).toBe('Lookup failed: timed out')
  })

  it('drops a turn whose parts all render to nothing', () => {
    // An empty user turn is a chat template that will not apply, and every
    // model here alternates strictly.
    expect(toPromptMessages([{ role: 'assistant', content: [{ type: 'text', text: '  ' }] }])).toEqual([])
  })
})

describe('toContent', () => {
  it('produces the same shape a wire provider does', () => {
    expect(toContent({ kind: 'tool', name: 'get_section', input: { a: 1 } }, 'local_tool_1')).toEqual([
      { type: 'tool_use', id: 'local_tool_1', name: 'get_section', input: { a: 1 } },
    ])
    expect(toContent({ kind: 'text', text: 'hello' }, 'local_tool_1')).toEqual([
      { type: 'text', text: 'hello' },
    ])
    expect(toContent({ kind: 'empty' }, 'local_tool_1')).toEqual([])
  })
})
