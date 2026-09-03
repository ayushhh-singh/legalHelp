import { Sparkles } from 'lucide-react'

import { overridesFromScenario } from '../aiOverrides'
import { usePayAi } from '../usePayAi'
import { PayAiResult } from './PayAiResult'

import type { UseAi } from '@/ai/useAi'
import { AiBanner } from '@/components/ai/AiBanner'
import { SectionCard } from '@/components/ui-x'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'
import type { PayScenario } from '@/lib/pay/scenario'

/**
 * "Explain my payslip" — grounded entirely in what
 * `src/ai/agents/pay.ts#explainPayslip` itself computes for this exact
 * scenario (`overridesFromScenario`), never in a rate the model invents.
 * Renders nothing unless `useAi().enabled`, and nothing at all without a post
 * picked — there is no `jobId` to explain otherwise.
 */
export function PayExplainPanel({ ai, scenario }: { ai: UseAi; scenario: PayScenario }) {
  const { t, language } = useT()
  const ask = usePayAi({
    language,
    provider: ai.provider,
    tier: ai.tier,
    budgetLimit: ai.settings.monthlyTokenBudget,
    onSpent: () => void ai.refreshBudget(),
  })

  if (!ai.enabled || !scenario.jobId) return null

  return (
    <SectionCard className="flex flex-col gap-3 p-5" data-print-hide>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{t('pay.ai.explain.title')}</h2>
      </div>
      <AiBanner />
      {!ai.ready ? (
        <p className="text-sm text-muted-foreground">{t('pay.ai.notReady')}</p>
      ) : ask.state.kind === 'idle' ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() =>
            ask.explainPayslip({ jobId: scenario.jobId!, overrides: overridesFromScenario(scenario) })
          }
        >
          <Sparkles aria-hidden="true" className="h-4 w-4" />
          {t('pay.ai.explain.button')}
        </Button>
      ) : (
        <PayAiResult state={ask.state} onDismiss={ask.reset} />
      )}
    </SectionCard>
  )
}
