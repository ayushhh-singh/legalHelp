import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { AiDraftPanel, type AiDraftPanelProps } from './AiDraftPanel'

import { OM_CALLS, OM_RATIONALE, planScript } from '@/ai/fixtures/drafting-scripts'
import { MockProvider } from '@/ai/providers/mock'
import { clearRegistry } from '@/ai/tools/registry'
import { CONSENT_VERSION, DEFAULT_AI_SETTINGS } from '@/ai/flags'
import type { UseAi } from '@/ai/useAi'
import { sampleValues } from '@/lib/drafting/engine'
import { evaluateChecklist } from '@/lib/drafting/checklist'
import { renderDocument } from '@/lib/drafting/engine'
import type { DraftValues } from '@/lib/drafting/types'
import { loadTemplate } from '@/modules/drafting/data'
import type { DocTemplate } from '@/modules/drafting/schema'

/**
 * The panel, driven end to end against `MockProvider`.
 *
 * The provider is handed in through `ai.provider` exactly as `useAi()` would
 * hand in a real one, so pressing "Draft it" runs the REAL agent — the tool
 * loop, the engine's checklist, the field diff — against scripted turns. A test
 * that stubbed `useDraftingAi` would assert that this component renders the
 * props it was given, which is not the thing that can be wrong.
 */

let om: DocTemplate

beforeAll(async () => {
  om = await loadTemplate('office-memorandum')
})

beforeEach(() => {
  clearRegistry()
})

const aiState = (over: Partial<UseAi> = {}): UseAi => ({
  enabled: true,
  ready: true,
  tier: 'byok',
  settings: { ...DEFAULT_AI_SETTINGS, tier: 'byok', consentVersion: CONSENT_VERSION, hasKey: true },
  provider: null,
  budget: null,
  error: null,
  refreshBudget: () => Promise.resolve(),
  ...over,
})

/** A draft with an unhelpful body, so the model's version really differs. */
const startingValues = (): DraftValues => ({
  ...sampleValues(om),
  subject: 'Education allowance',
  paras: ['It is submitted that the matter is under consideration.'],
})

function setup(over: Partial<AiDraftPanelProps> = {}) {
  const values = over.values ?? startingValues()
  const onApplyValues = vi.fn()
  const onOpenChange = vi.fn()
  const onImproveHandled = vi.fn()
  const checklist = evaluateChecklist(om, renderDocument(om, values, 'en'))

  const props: AiDraftPanelProps = {
    template: om,
    values,
    lang: 'en',
    editing: 'en',
    devanagariDigits: false,
    ai: aiState(),
    checklist,
    onApplyValues,
    open: true,
    onOpenChange,
    improveField: null,
    onImproveHandled,
    ...over,
  }

  const view = render(<AiDraftPanel {...props} />)
  return { ...view, props, onApplyValues, onOpenChange, onImproveHandled, values }
}

describe('with AI off', () => {
  it('renders nothing at all', () => {
    const { container } = setup({ ai: aiState({ enabled: false, ready: false, tier: 'off' }) })
    expect(container).toBeEmptyDOMElement()
  })
})

describe('the acknowledgement gate', () => {
  it('shows the standing AI notice and refuses the brief box until it is confirmed', async () => {
    setup()

    // The banner is permanent, not a toast, and says what leaves the device.
    expect(screen.getByRole('complementary', { name: /AI notice/i })).toBeInTheDocument()
    expect(screen.getByText(/This draft leaves the device/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/What is this document for/i)).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /continue/i }))
    expect(screen.getByLabelText(/What is this document for/i)).toBeInTheDocument()
  })
})

describe('a drafting run', () => {
  const provider = () =>
    new MockProvider(
      planScript(
        'panel-om',
        {
          templateId: 'office-memorandum',
          rationale: OM_RATIONALE,
          fieldValues: {
            subject: 'Grant of Children Education Allowance — clarification regarding.',
            paras: [
              'The undersigned is directed to say that reimbursement is admissible on production of a certificate of enrolment.',
            ],
          },
          suggestedPhraseIds: [],
        },
        OM_CALLS,
      ),
    )

  async function runDraft() {
    const view = setup({ ai: aiState({ provider: provider() }) })
    await userEvent.click(screen.getByRole('button', { name: /continue/i }))
    await userEvent.type(
      screen.getByLabelText(/What is this document for/i),
      'Clarify the education allowance position to all Ministries.',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Draft it' }))
    await screen.findByRole('region', { name: /suggested draft/i }, { timeout: 8_000 })
    return view
  }

  it('reports the engine’s checklist and the run’s cost', async () => {
    await runDraft()

    const result = screen.getByRole('region', { name: /suggested draft/i })
    expect(within(result).getByText(/checklist item/i)).toBeInTheDocument()
    // Token usage and cost are shown after every run: a BYOK reader pays for it.
    expect(within(result).getByText(/tokens · about \$/)).toBeInTheDocument()
  })

  it('shows one diff per changed field and applies only the one accepted', async () => {
    const { onApplyValues, values } = await runDraft()

    const result = screen.getByRole('region', { name: /suggested draft/i })
    const diffs = within(result).getAllByRole('region', { name: /suggested change/i })
    expect(diffs.length).toBeGreaterThanOrEqual(2)

    // Apply the subject only.
    const subject = within(result)
      .getAllByRole('listitem')
      .find((item) => item.textContent?.includes('Subject'))
    expect(subject).toBeDefined()
    if (!subject) return
    await userEvent.click(within(subject).getByRole('button', { name: 'Apply' }))

    expect(onApplyValues).toHaveBeenCalledTimes(1)
    const applied = onApplyValues.mock.calls[0]?.[0] as DraftValues
    expect(applied.subject).toBe('Grant of Children Education Allowance — clarification regarding.')
    // Nothing else moved: the body is still what the officer typed.
    expect(applied.paras).toEqual(values.paras)
  })

  it('lets a single word inside a change be rejected before applying', async () => {
    const { onApplyValues } = await runDraft()

    const result = screen.getByRole('region', { name: /suggested draft/i })
    const subject = within(result)
      .getAllByRole('listitem')
      .find((item) => item.textContent?.includes('Subject'))
    if (!subject) throw new Error('no subject diff')

    // Reject every proposed change, then apply: the field must come back
    // unchanged. This is the inversion `applyChanges` exists to get right —
    // rejecting a deletion means KEEPING the original words.
    await userEvent.click(within(subject).getByRole('button', { name: 'Reject all' }))
    await userEvent.click(within(subject).getByRole('button', { name: 'Apply' }))

    const applied = onApplyValues.mock.calls[0]?.[0] as DraftValues
    expect(applied.subject).toBe('Education allowance')
  })
})

describe('the improve-wording request', () => {
  it('offers the four rewrites rather than running one, and runs the chosen one', async () => {
    const provider = new MockProvider({
      id: 'panel-improve',
      turns: [
        {
          stopReason: 'tool_use',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_01',
              name: 'list_draft_phrases',
              input: { templateId: 'office-memorandum' },
            },
          ],
        },
        {
          stopReason: 'end_turn',
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                text: 'The undersigned is directed to say that the matter has been considered.',
                note: { en: 'Removed the circumlocution [1], [T1].', hi: 'घुमाव हटाया [1], [T1]।' },
                csmopRef: '9.2(i)',
              }),
            },
          ],
        },
      ],
    })

    const body = om.fields.find((field) => field.id === 'paras')
    if (!body) throw new Error('no body field')

    const { onImproveHandled } = setup({ ai: aiState({ provider }), improveField: body })
    await userEvent.click(screen.getByRole('button', { name: /continue/i }))

    const request = screen.getByRole('region', { name: /improve wording/i })
    expect(within(request).getByRole('button', { name: 'Fix the person' })).toBeInTheDocument()
    expect(provider.calls).toHaveLength(0)

    await userEvent.click(within(request).getByRole('button', { name: 'Tighten it' }))
    await waitFor(() => expect(onImproveHandled).toHaveBeenCalled())
    await screen.findByRole('region', { name: /suggested change/i }, { timeout: 8_000 })
    expect(screen.getByText(/Removed the circumlocution/)).toBeInTheDocument()
  })
})

describe('a refused brief', () => {
  it('says so and never reaches the provider', async () => {
    const provider = new MockProvider({ id: 'unused', turns: [] })
    setup({ ai: aiState({ provider }) })

    await userEvent.click(screen.getByRole('button', { name: /continue/i }))
    await userEvent.type(screen.getByLabelText(/What is this document for/i), 'Draft the classified annexure')
    await userEvent.click(screen.getByRole('button', { name: 'Draft it' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/nothing has been sent/i)
    expect(provider.calls).toHaveLength(0)
  })
})

describe('explaining a checklist failure', () => {
  it('lists the failing items with an Explain button, behind the same gate', async () => {
    const values: DraftValues = { ...sampleValues(om), subject: '' }
    setup({ values, checklist: evaluateChecklist(om, renderDocument(om, values, 'en')) })

    // Explaining a failure sends the draft's values, so it sits behind the
    // acknowledgement exactly as drafting does.
    expect(screen.queryByRole('button', { name: 'Explain' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /continue/i }))
    expect(screen.getByRole('button', { name: 'Explain' })).toBeInTheDocument()
  })
})
