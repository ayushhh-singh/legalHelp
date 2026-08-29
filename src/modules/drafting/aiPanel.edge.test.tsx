import { StrictMode } from 'react'
import { act, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { AiDraftPanel, type AiDraftPanelProps } from './components/AiDraftPanel'
import { useDraftingAi } from './useDraftingAi'

import { OM_CALLS, OM_RATIONALE, finalTurn, toolTurn } from '@/ai/fixtures/drafting-scripts'
import { CONSENT_VERSION, DEFAULT_AI_SETTINGS } from '@/ai/flags'
import { MockProvider } from '@/ai/providers/mock'
import { clearRegistry } from '@/ai/tools/registry'
import type { UseAi } from '@/ai/useAi'
import { evaluateChecklist } from '@/lib/drafting/checklist'
import { renderDocument, sampleValues } from '@/lib/drafting/engine'
import type { DraftValues } from '@/lib/drafting/types'
import { loadTemplate } from '@/modules/drafting/data'
import type { DocTemplate } from '@/modules/drafting/schema'

/**
 * The edge-case pass over Session 21, UI half.
 *
 * Every test here failed against 1d066dc before its fix.
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

/* ------------------------------------------------------------------ *
 * 1. The interview's second leg, under StrictMode
 * ------------------------------------------------------------------ */

describe('answering the agent’s questions', () => {
  it('starts exactly ONE run, including under StrictMode', async () => {
    /*
      `answer()` called `runDraft` from inside a `setState` updater, purely to
      read the pending brief out of the current state. React invokes an updater
      TWICE in StrictMode — and `src/main.tsx` renders the whole app inside one.
      So answering three clarifying questions fired two identical runs against
      the reader's own key and billed them twice, in development, where nobody
      would see it: Playwright runs a production build and StrictMode is inert
      there. This project has shipped exactly that class of defect twice before
      (`useDraft.ts`, ADR-021).
    */
    const questions = [{ field: 'fileNumber', en: 'File number?', hi: 'फाइल संख्या?' }]
    const provider = new MockProvider({
      id: 'answer-once',
      turns: [
        ...OM_CALLS.map((turn, index) => toolTurn(turn, index)),
        finalTurn({ templateId: 'office-memorandum', rationale: OM_RATIONALE, questions, fieldValues: {} }),
        ...OM_CALLS.map((turn, index) => toolTurn(turn, index + 10)),
        finalTurn({
          templateId: 'office-memorandum',
          rationale: OM_RATIONALE,
          fieldValues: sampleValues(om),
        }),
      ],
    })

    // `onSpent` fires in the `finally` of EVERY run, aborted ones included, so
    // it counts runs STARTED rather than runs that reached the wire. That is
    // the number under test: `start()` aborts whatever was in flight, and an
    // abort that lands before the first `await` masks a double start entirely
    // when you count provider calls.
    const spent = vi.fn()
    const { result } = renderHook(
      () =>
        useDraftingAi({
          template: om,
          values: {},
          lang: 'en',
          editing: 'en',
          language: 'en',
          devanagariDigits: false,
          provider,
          tier: 'byok',
          budgetLimit: 1_000_000,
          onSpent: spent,
        }),
      { wrapper: StrictMode },
    )

    act(() => result.current.draft('Clarify the education allowance position.'))
    await waitFor(() => expect(result.current.state.kind).toBe('questions'))
    const afterFirst = provider.calls.length

    await waitFor(() => expect(spent).toHaveBeenCalledTimes(1))

    act(() => result.current.answer([{ field: 'fileNumber', answer: 'A-11011/2/2026-Estt.' }]))
    await waitFor(() => expect(result.current.state.kind).toBe('draft'))

    // One further run: three tool turns and one final.
    expect(provider.calls.length - afterFirst).toBe(4)
    // And exactly one run STARTED for it.
    expect(spent).toHaveBeenCalledTimes(2)
  })
})

/* ------------------------------------------------------------------ *
 * 2. The result survives the draft row being created
 * ------------------------------------------------------------------ */

function setup(over: Partial<AiDraftPanelProps> = {}) {
  const values = over.values ?? { ...sampleValues(om), subject: 'Education allowance' }
  const onApplyValues = vi.fn()
  const props: AiDraftPanelProps = {
    template: om,
    values,
    lang: 'en',
    editing: 'en',
    devanagariDigits: false,
    ai: aiState(),
    checklist: evaluateChecklist(om, renderDocument(om, values, 'en')),
    onApplyValues,
    open: true,
    onOpenChange: vi.fn(),
    improveField: null,
    onImproveHandled: vi.fn(),
    ...over,
  }
  const view = render(<AiDraftPanel {...props} />)
  return { ...view, props, onApplyValues }
}

const draftProvider = () =>
  new MockProvider({
    id: 'panel-draft',
    turns: [
      ...OM_CALLS.map((turn, index) => toolTurn(turn, index)),
      finalTurn({
        templateId: 'office-memorandum',
        rationale: OM_RATIONALE,
        fieldValues: {
          subject: 'Grant of Children Education Allowance — clarification regarding.',
          place: 'New Delhi',
        },
      }),
    ],
  })

async function runToResult(over: Partial<AiDraftPanelProps> = {}) {
  const view = setup({ ai: aiState({ provider: draftProvider() }), ...over })
  await userEvent.click(screen.getByRole('button', { name: /continue/i }))
  await userEvent.type(screen.getByLabelText(/What is this document for/i), 'Clarify the position.')
  await userEvent.click(screen.getByRole('button', { name: 'Draft it' }))
  await screen.findByRole('region', { name: /suggested draft/i }, { timeout: 8_000 })
  return view
}

describe('a field that has been applied', () => {
  it('stays in the list, marked, instead of vanishing', async () => {
    /*
      `changed` was computed from the LIVE `values` prop, so the moment a field
      was applied its `after` equalled its `before` and the row was filtered
      out — taking the "Applied" badge with it, which no reader could therefore
      ever see. The list is a snapshot of what the model proposed; it should not
      rewrite itself while the officer is working down it.
    */
    const { rerender, props, onApplyValues } = await runToResult()

    const result = screen.getByRole('region', { name: /suggested draft/i })
    const subject = within(result)
      .getAllByRole('listitem')
      .find((item) => item.textContent?.includes('Subject'))
    if (!subject) throw new Error('no subject row')

    await userEvent.click(within(subject).getByRole('button', { name: 'Apply' }))
    const applied = onApplyValues.mock.calls[0]?.[0] as DraftValues

    // The editor writes the value back, exactly as `useDraft.setValues` does.
    rerender(<AiDraftPanel {...props} values={applied} />)

    const after = screen.getByRole('region', { name: /suggested draft/i })
    const stillThere = within(after)
      .getAllByRole('listitem')
      .find((item) => item.textContent?.includes('Subject'))
    expect(stillThere, 'the applied row disappeared from the suggestion list').toBeDefined()
    expect(within(after).getByText('Applied')).toBeInTheDocument()
  })
})
