import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { PayExplainPanel } from './PayExplainPanel'

import { CONSENT_VERSION, DEFAULT_AI_SETTINGS } from '@/ai/flags'
import { MockProvider } from '@/ai/providers/mock'
import { clearRegistry } from '@/ai/tools/registry'
import type { UseAi } from '@/ai/useAi'
import type { PayScenario } from '@/lib/pay/scenario'

/**
 * Driven end to end against `MockProvider`, exactly as
 * `src/modules/drafting/components/AiDraftPanel.test.tsx` and
 * `src/modules/trainer/components/CardAiActions.test.tsx` are: the provider
 * goes in through `ai.provider`, so pressing "Explain my payslip" runs the
 * REAL agent — `src/ai/agents/pay.ts`'s own `compute_pay_for_job` pre-fetch and
 * its figure-grounding check — against a scripted turn.
 */

const SCENARIO: PayScenario = {
  jobId: 'ib-acio-ii-executive',
  level: '7',
  cellIndex: 0,
  basic: null,
  cityId: null,
  daRate: 60,
  daProjected: false,
  quarters: false,
  pensionScheme: 'nps',
  gpfRate: 6,
  group: 'B',
  regime: 'auto',
  children: 0,
  hostellers: 0,
  npa: false,
  runningStaff: false,
  otherDeductions: 0,
  allowances: [],
  oldRegime: {},
}

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

beforeEach(() => {
  clearRegistry()
})

describe('with AI off, or with no post picked', () => {
  it('renders nothing', () => {
    const { container: withAiOff } = render(
      <PayExplainPanel ai={aiState({ enabled: false, ready: false, tier: 'off' })} scenario={SCENARIO} />,
    )
    expect(withAiOff).toBeEmptyDOMElement()

    const { container: withNoPost } = render(
      <PayExplainPanel ai={aiState()} scenario={{ ...SCENARIO, jobId: null }} />,
    )
    expect(withNoPost).toBeEmptyDOMElement()
  })
})

describe('with AI on and a post picked', () => {
  it('runs the real agent and shows its explanation', async () => {
    const user = userEvent.setup()
    const provider = new MockProvider({
      id: 'explain-ok',
      turns: [
        {
          stopReason: 'end_turn',
          content: [{ type: 'text', text: 'Your basic pay is what the matrix sets [1].' }],
        },
      ],
    })

    render(<PayExplainPanel ai={aiState({ provider })} scenario={SCENARIO} />)

    await user.click(screen.getByRole('button', { name: 'Explain my payslip' }))
    await waitFor(
      () => expect(screen.getByText(/Your basic pay is what the matrix sets/)).toBeInTheDocument(),
      {
        timeout: 10_000,
      },
    )
  })

  it('shows a refusal rather than an invented figure', async () => {
    const user = userEvent.setup()
    const provider = new MockProvider({
      id: 'explain-invented',
      turns: [
        {
          stopReason: 'end_turn',
          content: [
            { type: 'text', text: 'A special unadvertised bonus of 91% is also credited this month.' },
          ],
        },
      ],
    })

    render(<PayExplainPanel ai={aiState({ provider })} scenario={SCENARIO} />)

    await user.click(screen.getByRole('button', { name: 'Explain my payslip' }))
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument(), { timeout: 10_000 })
    expect(screen.queryByText(/91%/)).not.toBeInTheDocument()
  })
})
