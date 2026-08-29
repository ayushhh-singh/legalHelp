import type { MockScript, MockTurn } from '../providers/mock'
import type { ContentPart } from '../types'

/**
 * Scripted provider turns for the drafting agent.
 *
 * These are BUILDERS rather than frozen literals, unlike `scripts.ts`. The
 * difference is deliberate: `scripts.ts` scripts the agent LOOP, where the
 * point of each fixture is a fixed sequence of turns, and a builder would hide
 * the thing under test. Here the point is the agent's POLICY — which tools it
 * makes the model call, what it does with the values that come back, whether
 * the checklist it reports is the one the engine actually produced — and the
 * values themselves have to come from the real committed templates, or a test
 * that "passes the checklist" is only testing a string somebody typed.
 *
 * So a test loads `data/drafting/templates/office-memorandum.json`, builds the
 * values it wants from the specimen the manual prints, and hands them here.
 */

const USAGE = {
  inputTokens: 2_400,
  outputTokens: 380,
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

/** The final turn: the structured plan, as the JSON text a provider returns. */
export function finalTurn(json: unknown): MockTurn {
  return {
    stopReason: 'end_turn',
    usage: USAGE,
    content: [{ type: 'text', text: JSON.stringify(json) }],
  }
}

export interface PlanShape {
  templateId: string
  rationale: { en: string; hi: string }
  questions?: ReadonlyArray<{ field: string; en: string; hi: string }>
  fieldValues?: Record<string, unknown>
  suggestedPhraseIds?: readonly string[]
}

/**
 * A whole pass: some turns that call tools, then the plan.
 *
 * `calls` is a list of TURNS, each a list of concurrent calls, because the
 * agent's tool-sequence assertion is about what the model asked for and in what
 * order — and Anthropic may return several `tool_use` blocks in one turn, which
 * `runAgent` deliberately answers in one user message.
 */
export function planScript(
  id: string,
  plan: PlanShape,
  calls: readonly (readonly ToolCallSpec[])[],
): MockScript {
  let issued = 0
  const turns = calls.map((turn) => {
    const built = toolTurn(turn, issued)
    issued += turn.length
    return built
  })
  return { id, turns: [...turns, finalTurn(plan)] }
}

/* ------------------------------------------------------------------ *
 * The two briefs the session's acceptance checks name
 * ------------------------------------------------------------------ */

/** What an officer drafting an O.M. would have the model do, in order. */
export const OM_CALLS: readonly (readonly ToolCallSpec[])[] = [
  [{ name: 'list_draft_templates' }],
  [{ name: 'get_draft_template', input: { templateId: 'office-memorandum' } }],
  [{ name: 'list_draft_phrases', input: { templateId: 'office-memorandum', kind: 'opening' } }],
]

/**
 * The leave application adds the glossary, because it is drafted in Hindi and
 * "Section Officer" is not a phrase anybody should translate from memory.
 */
export const LEAVE_CALLS: readonly (readonly ToolCallSpec[])[] = [
  [{ name: 'list_draft_templates' }],
  [{ name: 'get_draft_template', input: { templateId: 'leave-application' } }],
  [
    { name: 'lookup_glossary_term', input: { query: 'Section Officer' } },
    { name: 'lookup_admin_term', input: { query: 'leave' } },
  ],
]

/** The revision pass re-runs the checklist over its own correction. */
export const REVISION_CALLS: readonly (readonly ToolCallSpec[])[] = [
  [{ name: 'check_draft', input: { templateId: 'office-memorandum', values: {}, lang: 'en' } }],
]

export const OM_RATIONALE = {
  en: 'An Office Memorandum is the form for a clarification issued to all Ministries [1], and CSMOP prescribes its format [T1].',
  hi: 'सभी मंत्रालयों को जारी स्पष्टीकरण के लिए कार्यालय ज्ञापन ही उपयुक्त प्रपत्र है [1]; सीएसएमओपी उसका प्रारूप निर्धारित करता है [T1]।',
}

export const LEAVE_RATIONALE = {
  en: 'A leave application is written by the officer in the first person [1]; CSMOP prescribes no format for it, so this borrows the letter [T1].',
  hi: 'अवकाश आवेदन अधिकारी स्वयं उत्तम पुरुष में लिखता है [1]; सीएसएमओपी इसका कोई प्रारूप निर्धारित नहीं करता, अतः यह पत्र का प्रारूप लेता है [T1]।',
}
