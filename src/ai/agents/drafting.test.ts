import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

import {
  BLANK,
  explainChecklistFailure,
  improveWording,
  parseFieldValues,
  runDraftingAgent,
  screenBrief,
  type DraftingStep,
} from './drafting'
import {
  LEAVE_CALLS,
  LEAVE_RATIONALE,
  OM_CALLS,
  OM_RATIONALE,
  REVISION_CALLS,
  finalTurn,
  planScript,
  toolTurn,
} from '../fixtures/drafting-scripts'
import { MockProvider } from '../providers/mock'
import { clearRegistry, listTools } from '../tools/registry'
import { registerBuiltinTools } from '../tools/index'

import { sampleValues } from '@/lib/drafting/engine'
import type { DraftValues } from '@/lib/drafting/types'
import { loadTemplate } from '@/modules/drafting/data'
import type { DocTemplate } from '@/modules/drafting/schema'

/**
 * The drafting agent, against scripted turns and the REAL committed templates.
 *
 * The values every fixture uses are built from `sampleValues(template)` — the
 * worked example CSMOP itself prints — rather than from strings written here.
 * A test that asserts "the checklist passes" against values a test author
 * invented is a test of the test author, and the checklist is the whole point
 * of the agent: it is the difference between a document that looks right and a
 * document that is the right document.
 */

let om: DocTemplate
let leave: DocTemplate

beforeAll(async () => {
  om = await loadTemplate('office-memorandum')
  leave = await loadTemplate('leave-application')
})

beforeEach(() => {
  clearRegistry()
  registerBuiltinTools()
})

const tools = () => listTools(['draft', 'utils'])

/** The specimen, with the facts an officer's brief would not have supplied. */
function withBlanks(template: DocTemplate, blanks: readonly string[]): DraftValues {
  const values: DraftValues = { ...sampleValues(template) }
  for (const id of blanks) values[id] = BLANK
  return values
}

function record(): { steps: DraftingStep[]; onProgress: (step: DraftingStep) => void } {
  const steps: DraftingStep[] = []
  return { steps, onProgress: (step) => steps.push(step) }
}

const toolsUsed = (steps: readonly DraftingStep[]): string[] =>
  steps.flatMap((step) => (step.tool ? [step.tool] : []))

describe('screenBrief — the refusal path, before anything is sent', () => {
  it.each([
    ['a classified brief', 'Draft an OM about the classified annexure to the tender'],
    ['top secret', 'Prepare a note on the Top Secret file movement register'],
    ['a Hindi classified brief', 'गोपनीय टिप्पणी का मसौदा तैयार करें'],
    ['a confidential brief', 'Draft a reply regarding the confidential report of the officer'],
  ])('refuses %s', (_label, brief) => {
    const refusal = screenBrief(brief)
    expect(refusal?.reason).toBe('classified')
    expect(refusal?.message.en).toContain('nothing has been sent')
    expect(refusal?.message.hi.length).toBeGreaterThan(0)
  })

  it('does not refuse an ordinary brief that names a Secretary or a Secretariat', () => {
    expect(screenBrief('Draft an OM from the Under Secretary to all Central Secretariat offices')).toBeNull()
    expect(screenBrief('Section Officer requests earned leave for thirty days')).toBeNull()
  })

  it('refuses departmental record material as well as classification markings', () => {
    expect(screenBrief('Draft a note summarising the case diary')?.reason).toBe('departmental')
  })

  it('sends nothing to the provider when a brief is refused', async () => {
    const provider = new MockProvider(
      planScript('unused', { templateId: 'office-memorandum', rationale: OM_RATIONALE }, []),
    )
    const result = await runDraftingAgent({
      provider,
      brief: 'Draft an OM about the classified annexure',
      lang: 'en',
      language: 'en',
      tools: tools(),
    })

    expect(result.status).toBe('refused')
    expect(provider.calls).toHaveLength(0)
  })

  it('screens the answers to its own questions, not only the first brief', async () => {
    const provider = new MockProvider(
      planScript('unused', { templateId: 'office-memorandum', rationale: OM_RATIONALE }, []),
    )
    const result = await runDraftingAgent({
      provider,
      brief: 'Draft an OM on the education allowance clarification',
      answers: [{ field: 'subject', answer: 'the confidential annexure' }],
      lang: 'en',
      language: 'en',
      tools: tools(),
    })

    expect(result.status).toBe('refused')
    expect(provider.calls).toHaveLength(0)
  })
})

describe('runDraftingAgent — the Office Memorandum brief', () => {
  it('runs the brief’s own sequence and returns a passing checklist', async () => {
    const values = withBlanks(om, ['fileNumber'])
    const provider = new MockProvider(
      planScript(
        'om-plan',
        {
          templateId: 'office-memorandum',
          rationale: OM_RATIONALE,
          fieldValues: values,
          suggestedPhraseIds: [],
        },
        OM_CALLS,
      ),
    )
    const { steps, onProgress } = record()

    const result = await runDraftingAgent({
      provider,
      brief: 'Clarify to all Ministries that Children Education Allowance is admissible for a child at NIOS.',
      templateId: 'office-memorandum',
      lang: 'en',
      language: 'en',
      tools: tools(),
      onProgress,
    })

    expect(result.status).toBe('draft')
    if (result.status !== 'draft') return

    // The model's three calls, then the two this file makes itself. The last
    // two are the point: the checklist the officer is shown is an evaluation of
    // the values being returned, not a claim the model made about them.
    expect(toolsUsed(steps)).toEqual([
      'list_draft_templates',
      'get_draft_template',
      'list_draft_phrases',
      'render_draft',
      'check_draft',
    ])
    expect(steps.map((step) => step.phase)).toContain('done')
    expect(steps.some((step) => step.phase === 'revising')).toBe(false)

    expect(result.templateId).toBe('office-memorandum')
    expect(result.checklist.passed).toBe(true)
    expect(result.checklist.mustFailing).toBe(0)
    expect(result.revised).toBe(false)
    expect(result.problems).toEqual([])
    expect(result.text).toContain('OFFICE MEMORANDUM')
  })

  it('preserves a blank the model left rather than filling it in', async () => {
    const values = withBlanks(om, ['fileNumber', 'phone'])
    const provider = new MockProvider(
      planScript(
        'om-blanks',
        { templateId: 'office-memorandum', rationale: OM_RATIONALE, fieldValues: values },
        OM_CALLS,
      ),
    )

    const result = await runDraftingAgent({
      provider,
      brief: 'Clarify the education allowance position to all Ministries.',
      templateId: 'office-memorandum',
      lang: 'en',
      language: 'en',
      tools: tools(),
    })

    expect(result.status).toBe('draft')
    if (result.status !== 'draft') return

    expect(result.fieldValues.fileNumber).toBe(BLANK)
    expect(result.blanks).toEqual(['fileNumber', 'phone'])
    // A blank is not a `{{placeholder}}`: CSMOP's own no-placeholders item
    // fails a brace, which would push the model towards inventing a number.
    expect(result.text).toContain(BLANK)
    expect(result.checklist.items.find((item) => item.id === 'no-placeholders')?.passed).toBe(true)
  })

  it('returns the questions instead of a draft, capped at three', async () => {
    const provider = new MockProvider(
      planScript(
        'om-questions',
        {
          templateId: 'office-memorandum',
          rationale: OM_RATIONALE,
          questions: [
            { field: 'fileNumber', en: 'What is the file number?', hi: 'फाइल संख्या क्या है?' },
            { field: 'date', en: 'What date should it bear?', hi: 'उस पर कौन-सा दिनांक हो?' },
            { field: 'addressee', en: 'Who is it addressed to?', hi: 'यह किसे संबोधित है?' },
            { field: 'phone', en: 'What is the telephone number?', hi: 'दूरभाष संख्या क्या है?' },
          ],
          fieldValues: {},
        },
        OM_CALLS,
      ),
    )

    const result = await runDraftingAgent({
      provider,
      brief: 'An OM about the education allowance.',
      templateId: 'office-memorandum',
      lang: 'en',
      language: 'en',
      tools: tools(),
    })

    expect(result.status).toBe('questions')
    if (result.status !== 'questions') return
    expect(result.questions).toHaveLength(3)
    expect(result.questions[0]?.hi).toBe('फाइल संख्या क्या है?')
    expect(result.rationale.hi.length).toBeGreaterThan(0)
  })

  it('drafts rather than asking again once the officer has answered', async () => {
    const values = withBlanks(om, [])
    const provider = new MockProvider(
      planScript(
        'om-answered',
        {
          templateId: 'office-memorandum',
          rationale: OM_RATIONALE,
          questions: [{ field: 'fileNumber', en: 'File number?', hi: 'फाइल संख्या?' }],
          fieldValues: values,
        },
        OM_CALLS,
      ),
    )

    const result = await runDraftingAgent({
      provider,
      brief: 'An OM about the education allowance.',
      answers: [{ field: 'fileNumber', answer: 'A-11011/2/2026-Estt.' }],
      templateId: 'office-memorandum',
      lang: 'en',
      language: 'en',
      tools: tools(),
    })

    expect(result.status).toBe('draft')
  })
})

describe('runDraftingAgent — the leave application brief', () => {
  it('drafts the Hindi issue, reaching the glossary registry', async () => {
    const values = withBlanks(leave, [])
    const provider = new MockProvider(
      planScript(
        'leave-plan',
        {
          templateId: 'leave-application',
          rationale: LEAVE_RATIONALE,
          fieldValues: values,
          suggestedPhraseIds: [],
        },
        LEAVE_CALLS,
      ),
    )
    const { steps, onProgress } = record()

    const result = await runDraftingAgent({
      provider,
      brief: 'तीस दिन के अर्जित अवकाश के लिए आवेदन',
      templateId: 'leave-application',
      lang: 'hi',
      language: 'hi',
      tools: tools(),
      onProgress,
    })

    expect(result.status).toBe('draft')
    if (result.status !== 'draft') return

    expect(toolsUsed(steps)).toEqual([
      'list_draft_templates',
      'get_draft_template',
      'lookup_glossary_term',
      'lookup_admin_term',
      'render_draft',
      'check_draft',
    ])
    expect(result.checklist.passed).toBe(true)
    // The leave application is one of the seven forms CSMOP prescribes no
    // format for, and the agent must not hide that.
    expect(leave.verify).toBe(true)
  })

  it('checks BOTH issues of a bilingual draft', async () => {
    const values = withBlanks(leave, [])
    const provider = new MockProvider(
      planScript(
        'leave-bilingual',
        { templateId: 'leave-application', rationale: LEAVE_RATIONALE, fieldValues: values },
        LEAVE_CALLS,
      ),
    )
    const { steps, onProgress } = record()

    const result = await runDraftingAgent({
      provider,
      brief: 'अर्जित अवकाश आवेदन, दोनों भाषाओं में',
      templateId: 'leave-application',
      lang: 'bilingual',
      language: 'hi',
      tools: tools(),
      onProgress,
    })

    expect(result.status).toBe('draft')
    if (result.status !== 'draft') return

    expect(toolsUsed(steps).filter((name) => name === 'check_draft')).toHaveLength(2)
    expect(new Set(result.checklist.items.map((item) => item.lang))).toEqual(new Set(['en', 'hi']))
    expect(result.checklist.passed).toBe(true)
  })
})

describe('runDraftingAgent — the revision pass', () => {
  /** The specimen with its body emptied: several `must` items then fail. */
  const broken = (template: DocTemplate): DraftValues => ({
    ...sampleValues(template),
    paras: [],
    subject: '',
  })

  it('revises once when the checklist fails, and keeps the repair', async () => {
    const fixed = withBlanks(om, [])
    const provider = new MockProvider({
      id: 'om-revise',
      turns: [
        ...OM_CALLS.map((turn, index) => toolTurn(turn, index)),
        finalTurn({
          templateId: 'office-memorandum',
          rationale: OM_RATIONALE,
          fieldValues: broken(om),
        }),
        ...REVISION_CALLS.map((turn) => toolTurn(turn, 10)),
        finalTurn({
          templateId: 'office-memorandum',
          rationale: OM_RATIONALE,
          fieldValues: fixed,
        }),
      ],
    })
    const { steps, onProgress } = record()

    const result = await runDraftingAgent({
      provider,
      brief: 'Clarify the education allowance position to all Ministries.',
      templateId: 'office-memorandum',
      lang: 'en',
      language: 'en',
      tools: tools(),
      onProgress,
    })

    expect(result.status).toBe('draft')
    if (result.status !== 'draft') return

    expect(steps.some((step) => step.phase === 'revising')).toBe(true)
    expect(toolsUsed(steps)).toEqual([
      'list_draft_templates',
      'get_draft_template',
      'list_draft_phrases',
      'render_draft',
      'check_draft',
      'check_draft',
      'render_draft',
      'check_draft',
    ])
    expect(result.revised).toBe(true)
    expect(result.checklist.passed).toBe(true)
  })

  it('keeps the first draft when the revision is worse, and says so', async () => {
    const provider = new MockProvider({
      id: 'om-worse',
      turns: [
        ...OM_CALLS.map((turn, index) => toolTurn(turn, index)),
        finalTurn({
          templateId: 'office-memorandum',
          rationale: OM_RATIONALE,
          fieldValues: { ...sampleValues(om), subject: '' },
        }),
        ...REVISION_CALLS.map((turn) => toolTurn(turn, 10)),
        finalTurn({
          templateId: 'office-memorandum',
          rationale: OM_RATIONALE,
          fieldValues: broken(om),
        }),
      ],
    })

    const result = await runDraftingAgent({
      provider,
      brief: 'Clarify the education allowance position to all Ministries.',
      templateId: 'office-memorandum',
      lang: 'en',
      language: 'en',
      tools: tools(),
    })

    expect(result.status).toBe('draft')
    if (result.status !== 'draft') return

    expect(result.revised).toBe(false)
    expect(result.problems.join(' ')).toMatch(/required checklist items/)
    // The subject is still missing — the agent reports the truth about the
    // draft it is handing back rather than the better one it failed to get.
    expect(result.checklist.items.find((item) => item.id === 'subject')?.passed).toBe(false)
  })

  it('revises at most once', async () => {
    const provider = new MockProvider({
      id: 'om-still-broken',
      turns: [
        ...OM_CALLS.map((turn, index) => toolTurn(turn, index)),
        finalTurn({
          templateId: 'office-memorandum',
          rationale: OM_RATIONALE,
          fieldValues: broken(om),
        }),
        ...REVISION_CALLS.map((turn) => toolTurn(turn, 10)),
        finalTurn({
          templateId: 'office-memorandum',
          rationale: OM_RATIONALE,
          fieldValues: broken(om),
        }),
      ],
    })

    const result = await runDraftingAgent({
      provider,
      brief: 'Clarify the education allowance position to all Ministries.',
      templateId: 'office-memorandum',
      lang: 'en',
      language: 'en',
      tools: tools(),
    })

    expect(result.status).toBe('draft')
    // Two model passes and no more, even though the second did not fix it.
    expect(provider.turnsTaken).toBe(6)
  })
})

describe('runDraftingAgent — what it refuses to pass on', () => {
  it('drops a field the template does not have, and reports it', async () => {
    const provider = new MockProvider(
      planScript(
        'om-stray',
        {
          templateId: 'office-memorandum',
          rationale: OM_RATIONALE,
          fieldValues: { ...sampleValues(om), salutation: 'Dear Sir' },
        },
        OM_CALLS,
      ),
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
    expect(result.fieldValues.salutation).toBeUndefined()
    expect(result.problems.join(' ')).toContain('salutation')
  })

  it('drops a phrase id the library does not have', async () => {
    const provider = new MockProvider(
      planScript(
        'om-phrases',
        {
          templateId: 'office-memorandum',
          rationale: OM_RATIONALE,
          fieldValues: sampleValues(om),
          suggestedPhraseIds: ['om-undersigned-directed', 'not-a-real-phrase'],
        },
        OM_CALLS,
      ),
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
    expect(result.suggestedPhrases.every((phrase) => phrase.id !== 'not-a-real-phrase')).toBe(true)
    expect(result.problems.join(' ')).toContain('not-a-real-phrase')
  })

  it('fails rather than drafting when the model names a form this app does not have', async () => {
    const provider = new MockProvider(
      planScript(
        'om-unknown',
        // Not `office-order`: that WAS an unknown form until Session 29 built
        // it, and a test whose premise the library can satisfy silently stops
        // testing anything. `press-communique` is Appendix 8.1's remaining
        // specimen and is deliberately not built (docs/DATA-GAPS.md #37).
        { templateId: 'press-communique', rationale: OM_RATIONALE, fieldValues: {} },
        OM_CALLS,
      ),
    )

    const result = await runDraftingAgent({
      provider,
      brief: 'Issue an office order.',
      lang: 'en',
      language: 'en',
      tools: tools(),
    })

    expect(result.status).toBe('error')
    if (result.status !== 'error') return
    expect(result.message).toContain('press-communique')
  })

  it('fails closed on an ungrounded plan', async () => {
    const provider = new MockProvider({
      id: 'om-ungrounded',
      turns: [
        finalTurn({
          templateId: 'office-memorandum',
          rationale: {
            en: 'Because an O.M. is the usual form.',
            hi: 'क्योंकि कार्यालय ज्ञापन सामान्य प्रपत्र है।',
          },
          fieldValues: sampleValues(om),
        }),
      ],
    })

    const result = await runDraftingAgent({
      provider,
      brief: 'Clarify the education allowance position.',
      templateId: 'office-memorandum',
      lang: 'en',
      language: 'en',
      tools: tools(),
    })

    expect(result.status).toBe('error')
    if (result.status !== 'error') return
    expect(result.code).toBe('ungrounded')
  })
})

describe('parseFieldValues', () => {
  it('accepts the three shapes the engine reads, and rejects the rest', () => {
    const parsed = parseFieldValues(om, {
      subject: 'Grant of Children Education Allowance — clarification regarding.',
      paras: ['One.', 'Two.'],
      addressee: { en: 'All Ministries', hi: 'सभी मंत्रालय' },
      copyTo: 'The Pay and Accounts Officer\nGuard file',
      date: 42,
      nonsense: true,
    })

    expect(parsed.values.paras).toEqual(['One.', 'Two.'])
    expect(parsed.values.addressee).toEqual({ en: 'All Ministries', hi: 'सभी मंत्रालय' })
    // A list handed over as one newline-joined string is split rather than
    // refused: the engine's contract is a list, and the caller can fix it.
    expect(parsed.values.copyTo).toEqual(['The Pay and Accounts Officer', 'Guard file'])
    expect(parsed.rejectedFields).toEqual(['date'])
    expect(parsed.unknownFields).toEqual(['nonsense'])
  })

  it('refuses a select value that is not one of the options', () => {
    expect(parseFieldValues(om, { urgency: 'extremely urgent' }).rejectedFields).toEqual(['urgency'])
    expect(parseFieldValues(om, { urgency: 'immediate' }).values.urgency).toBe('immediate')
  })

  it('finds a blank wherever it sits', () => {
    expect(parseFieldValues(om, { fileNumber: BLANK, paras: ['Dated ____.'] }).blanks).toEqual([
      'fileNumber',
      'paras',
    ])
  })
})

describe('improveWording', () => {
  it('returns a rewrite and its note, sending only the one field', async () => {
    const provider = new MockProvider({
      id: 'improve',
      turns: [
        toolTurn([{ name: 'list_draft_phrases', input: { templateId: 'office-memorandum' } }]),
        finalTurn({
          text: 'The undersigned is directed to say that the matter has been considered.',
          note: {
            en: 'Removed the circumlocution [1] and used the manual’s opening [T1].',
            hi: 'घुमाव हटाया [1]।',
          },
          csmopRef: '9.2(i)',
        }),
      ],
    })

    const field = om.fields.find((entry) => entry.id === 'paras')
    expect(field).toBeDefined()
    if (!field) return

    const result = await improveWording({
      provider,
      template: om,
      field,
      text: 'It is most respectfully and humbly submitted that the matter has been under consideration.',
      lang: 'en',
      language: 'en',
      tools: tools(),
    })

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.text).toContain('undersigned is directed')
    expect(result.csmopRef).toBe('9.2(i)')

    // The prompt carries the field's text and nothing from any other field.
    const sent = JSON.stringify(provider.calls[0])
    expect(sent).toContain('most respectfully and humbly')
    expect(sent).not.toContain('us-estt@nic.in')
  })

  it('refuses to send a field that names classified material', async () => {
    const provider = new MockProvider({ id: 'unused', turns: [] })
    const field = om.fields.find((entry) => entry.id === 'paras')
    if (!field) return

    const result = await improveWording({
      provider,
      template: om,
      field,
      text: 'The classified annexure is enclosed.',
      lang: 'en',
      language: 'en',
      tools: tools(),
    })

    expect(result.status).toBe('refused')
    expect(provider.calls).toHaveLength(0)
  })
})

describe('explainChecklistFailure', () => {
  it('explains one item, grounded in a live check_draft', async () => {
    const provider = new MockProvider({
      id: 'explain',
      turns: [
        toolTurn([
          { name: 'check_draft', input: { templateId: 'office-memorandum', values: {}, lang: 'en' } },
        ]),
        {
          stopReason: 'end_turn',
          content: [
            {
              type: 'text',
              text: 'The subject line is empty, so the item fails [T1]; an O.M. addressed to anyone carries one [1].',
            },
          ],
        },
      ],
    })

    const result = await explainChecklistFailure({
      provider,
      template: om,
      itemId: 'subject',
      values: { ...sampleValues(om), subject: '' },
      lang: 'en',
      language: 'en',
      tools: tools(),
    })

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.text).toContain('subject line is empty')
  })

  it('refuses an item id the template does not have', async () => {
    const provider = new MockProvider({ id: 'unused', turns: [] })
    const result = await explainChecklistFailure({
      provider,
      template: om,
      itemId: 'not-an-item',
      values: {},
      lang: 'en',
      language: 'en',
      tools: tools(),
    })

    expect(result.status).toBe('error')
    expect(provider.calls).toHaveLength(0)
  })
})
