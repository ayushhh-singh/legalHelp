import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { CardAiActions } from './CardAiActions'

import { CONSENT_VERSION, DEFAULT_AI_SETTINGS } from '@/ai/flags'
import { MockProvider } from '@/ai/providers/mock'
import { clearRegistry } from '@/ai/tools/registry'
import type { UseAi } from '@/ai/useAi'
import { clearAllData } from '@/db'
import type { Card } from '../schema'

/**
 * The panel driven end to end against `MockProvider`, exactly as
 * `src/modules/drafting/components/AiDraftPanel.test.tsx` does: the provider
 * goes in through `ai.provider`, so pressing a button runs the REAL agent —
 * `src/ai/agents/tutor.ts`'s own code-side rule/history fetch and its
 * propose_card verification — against a scripted turn.
 */

const CARD: Card = {
  id: 'ccs-conduct-rule-1',
  act: 'ccs-conduct',
  rule: '1',
  kind: 'rule',
  front: { en: 'Short title, commencement and application', hi: '' },
  back: { en: 'These rules may be called the CCS (Conduct) Rules, 1964.', hi: '' },
  ruleRef: { textId: 'ccs-conduct-1', citation: { en: 'CCS (Conduct) Rules, R. 1', hi: '' } },
  difficulty: 'easy',
  reviewed: true,
  reviewState: 'approved',
  version: '1.0.0',
  source: { name: 'DoPT', url: 'https://dopt.gov.in' },
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

beforeEach(async () => {
  clearRegistry()
  await clearAllData()
})

describe('with AI off', () => {
  it('renders nothing', () => {
    const { container } = render(
      <CardAiActions
        ai={aiState({ enabled: false, ready: false, tier: 'off' })}
        card={CARD}
        wrongAnswer={null}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})

describe('with AI on', () => {
  it('offers "Give me a scenario" always, and "Explain" only after a wrong answer', () => {
    const { rerender } = render(
      <CardAiActions
        ai={aiState({ provider: new MockProvider({ id: 'unused', turns: [] }) })}
        card={CARD}
        wrongAnswer={null}
      />,
    )
    expect(screen.getByRole('button', { name: 'Give me a scenario on this rule' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Explain' })).not.toBeInTheDocument()

    rerender(
      <CardAiActions
        ai={aiState({ provider: new MockProvider({ id: 'unused', turns: [] }) })}
        card={CARD}
        wrongAnswer={{
          picked: 'Leave encashment.',
          correctText: 'Short title, commencement and application.',
        }}
      />,
    )
    expect(screen.getByRole('button', { name: 'Explain' })).toBeInTheDocument()
  })

  it('runs the real agent and shows its explanation', async () => {
    const user = userEvent.setup()
    const provider = new MockProvider({
      id: 'explain',
      turns: [
        {
          stopReason: 'end_turn',
          content: [{ type: 'text', text: 'Rule 1 covers the short title and commencement [1].' }],
        },
      ],
    })

    render(
      <CardAiActions
        ai={aiState({ provider })}
        card={CARD}
        wrongAnswer={{
          picked: 'Leave encashment.',
          correctText: 'Short title, commencement and application.',
        }}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Explain' }))
    await waitFor(() => expect(screen.getByText(/Rule 1 covers the short title/)).toBeInTheDocument(), {
      timeout: 10_000,
    })
  })
})
