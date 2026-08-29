import type { MockScript, MockTurn } from '../providers/mock'
import type { ContentPart } from '../types'

/**
 * Scripted provider turns for the law research agent.
 *
 * Builders, like `drafting-scripts.ts` and for the same reason: what is under
 * test here is the agent's POLICY — which tools it makes the model call, what
 * it does with the results, whether the citations the reader can click are the
 * ones the tool results actually support — and the values have to come from
 * the REAL committed `data/law/*.json`, or a test that "returns a correct
 * citation" is only testing a string somebody typed.
 *
 * One script drives BOTH model passes, because `runLawAgent` hands the same
 * provider to both: the research turns, then the closing "Gathered [T1]…" line
 * that pass is instructed to end with, then the answer pass's structured JSON.
 * A test that forgets the middle turn runs out of script, which is the failure
 * it should get.
 */

const USAGE = {
  inputTokens: 1_800,
  outputTokens: 260,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
}

export interface ToolCallSpec {
  name: string
  input?: unknown
}

/** One assistant turn that calls every tool in `calls` at once. */
export function toolTurn(calls: readonly ToolCallSpec[], from = 0): MockTurn {
  const content: ContentPart[] = calls.map((call, index) => ({
    type: 'tool_use',
    id: `toolu_${String(from + index + 1).padStart(2, '0')}`,
    name: call.name,
    input: call.input ?? {},
  }))
  return { stopReason: 'tool_use', usage: USAGE, content }
}

export function textTurn(text: string): MockTurn {
  return { stopReason: 'end_turn', usage: USAGE, content: [{ type: 'text', text }] }
}

/** The answer pass's final turn: the structured answer, as JSON text. */
export function finalTurn(json: unknown): MockTurn {
  return { stopReason: 'end_turn', usage: USAGE, content: [{ type: 'text', text: JSON.stringify(json) }] }
}

export interface AnswerShape {
  answer: { en: string; hi: string }
  citations: ReadonlyArray<{ act: string; section: string; toolResultId: string }>
  caveats?: ReadonlyArray<{ en: string; hi: string }>
}

export interface LawScriptSpec {
  /** One entry per TURN; each turn may call several tools at once. */
  calls: readonly (readonly ToolCallSpec[])[]
  answer: AnswerShape
  /**
   * The research pass's closing line. It defaults to exactly what the agent
   * asks for — the handles and nothing else — because a line naming a section
   * number is what `validateCitations` is there to reject, and a fixture that
   * quietly wrote one would make every test a test of the tolerated path.
   */
  gathered?: string
}

export function lawScript(id: string, spec: LawScriptSpec): MockScript {
  let issued = 0
  const research = spec.calls.map((turn) => {
    const built = toolTurn(turn, issued)
    issued += turn.length
    return built
  })

  const handles =
    spec.gathered ??
    `Gathered ${Array.from({ length: issued }, (_, index) => `[T${index + 1}]`).join(' ')}`.trim()

  return { id, turns: [...research, textTurn(handles), finalTurn(spec.answer)] }
}

/* ------------------------------------------------------------------ *
 * The four questions the session's acceptance checks name
 * ------------------------------------------------------------------ */

/** "What is the BNS equivalent of 420, and is it bailable?" */
export const CHEATING_CALLS: readonly (readonly ToolCallSpec[])[] = [
  [{ name: 'compare_old_new', input: { oldAct: 'IPC', oldSection: '420' } }],
  [{ name: 'get_classification', input: { code: 'bns', section: '318' } }],
]

export const CHEATING_ANSWER: AnswerShape = {
  answer: {
    en:
      'Section 420 IPC now falls under Section 318(4) of the BNS, which is cheating and dishonestly ' +
      'inducing delivery of property [2]. Under the First Schedule that sub-section is cognizable and ' +
      'non-bailable, punishable with imprisonment for 7 years and fine [3].',
    hi:
      'भा.दं.सं. की धारा 420 अब भा.न्या.सं. की धारा 318(4) के अंतर्गत आती है — छल करके संपत्ति ' +
      'प्रदान करवाना [2]। पहली अनुसूची के अनुसार यह उपधारा संज्ञेय तथा अजमानतीय है, और इसमें 7 वर्ष ' +
      'का कारावास तथा जुर्माना है [3]।',
  },
  citations: [
    { act: 'IPC', section: '420', toolResultId: 'T1' },
    { act: 'BNS', section: '318(4)', toolResultId: 'T2' },
  ],
}

/** "What changed in sedition?" */
export const SEDITION_CALLS: readonly (readonly ToolCallSpec[])[] = [
  [{ name: 'compare_old_new', input: { oldAct: 'IPC', oldSection: '124A' } }],
]

export const SEDITION_ANSWER: AnswerShape = {
  answer: {
    en:
      'Section 124A IPC — sedition — is not carried over as such. The tables map it to Section 152 of ' +
      'the BNS, which is a differently worded offence of acts endangering the sovereignty, unity and ' +
      'integrity of India [2].',
    hi:
      'भा.दं.सं. की धारा 124A — राजद्रोह — उसी रूप में आगे नहीं चली। तालिकाएँ इसे भा.न्या.सं. की ' +
      'धारा 152 से जोड़ती हैं, जो भारत की प्रभुता, एकता तथा अखंडता को संकट में डालने वाले कृत्यों का ' +
      'भिन्न शब्दों में गढ़ा गया अपराध है [2]।',
  },
  citations: [
    { act: 'IPC', section: '124A', toolResultId: 'T1' },
    { act: 'BNS', section: '152', toolResultId: 'T1' },
  ],
}

/** "Cite the section for stalking, in Hindi." */
export const STALKING_CALLS: readonly (readonly ToolCallSpec[])[] = [
  [{ name: 'search_sections', input: { query: 'stalking', code: 'bns', direction: 'new-old' } }],
  [{ name: 'get_section', input: { code: 'bns', section: '78' } }],
]

export const STALKING_ANSWER: AnswerShape = {
  answer: {
    en: 'Stalking is Section 78 of the BNS [3]; it replaced Section 354D IPC [2].',
    hi: 'पीछा करना भा.न्या.सं. की धारा 78 है [3]; इसने भा.दं.सं. की धारा 354D का स्थान लिया [2]।',
  },
  citations: [
    { act: 'IPC', section: '354D', toolResultId: 'T1' },
    { act: 'BNS', section: '78', toolResultId: 'T2' },
  ],
}

/** "An FIR was filed on 20 June 2024 — which code applies?" */
export const DATE_CALLS: readonly (readonly ToolCallSpec[])[] = [
  [{ name: 'compare_old_new', input: { oldAct: 'CrPC', oldSection: '154' } }],
]

export const DATE_ANSWER: AnswerShape = {
  answer: {
    en:
      'The provision for recording first information is Section 154 CrPC, which the tables map to ' +
      'Section 173 of the BNSS [2].',
    hi:
      'प्रथम सूचना अभिलिखित करने का उपबंध दं.प्र.सं. की धारा 154 है, जिसे तालिकाएँ भा.ना.सु.सं. की ' +
      'धारा 173 से जोड़ती हैं [2]।',
  },
  citations: [
    { act: 'CrPC', section: '154', toolResultId: 'T1' },
    { act: 'BNSS', section: '173', toolResultId: 'T1' },
  ],
}
