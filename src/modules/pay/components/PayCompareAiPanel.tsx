import { Sparkles } from 'lucide-react'

import { isCustomisedScenario } from '../aiOverrides'
import { usePayAi } from '../usePayAi'
import { PayAiResult } from './PayAiResult'

import type { UseAi } from '@/ai/useAi'
import { AiBanner } from '@/components/ai/AiBanner'
import { SectionCard } from '@/components/ui-x'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'
import type { PayScenario } from '@/lib/pay/scenario'
import type { PayTables } from '@/lib/pay/tables'

/**
 * "Compare these two posts for me" — a neutral summary, grounded in the same
 * `compare_jobs` figures the table on screen already shows
 * (`src/ai/agents/pay.ts#compareJobsForReader`, which discards any answer that
 * recommends one post over the other). Renders nothing unless
 * `useAi().enabled`, and nothing without a post on both sides.
 *
 * Only the Dearness Allowance rate is passed as an override, because
 * `compare_jobs` applies its ONE `overrides` object to BOTH posts — the same
 * "shared DA, everything else the post's own" rule `ComparePanel.tsx` itself
 * applies. Forwarding side A's level/cell/city would silently force post B
 * onto post A's level, which is not what the table on screen shows. So
 * `compare_jobs` is left to fall back to each post's own standard entry Level
 * and cell 1, at whichever city the reader has NOT customised away from that.
 *
 * That fallback is honest, but silent about it would not be: a reader who has
 * moved either side to a different Level, cell or city is looking at a table
 * this panel's own explanation will not match. `usesCustomScenario` catches
 * exactly that divergence and the caveat below it says so, rather than
 * quietly explaining a different comparison than the one on screen.
 */
export function PayCompareAiPanel({
  ai,
  a,
  b,
  tables,
}: {
  ai: UseAi
  a: PayScenario
  b: PayScenario
  tables: PayTables
}) {
  const { t, language } = useT()
  const ask = usePayAi({
    language,
    provider: ai.provider,
    tier: ai.tier,
    budgetLimit: ai.settings.monthlyTokenBudget,
    onSpent: () => void ai.refreshBudget(),
  })

  if (!ai.enabled || !a.jobId || !b.jobId) return null

  const customised = isCustomisedScenario(a, tables) || isCustomisedScenario(b, tables)

  return (
    <SectionCard className="flex flex-col gap-3 p-5">
      <h2 className="text-sm font-semibold">{t('pay.ai.compare.title')}</h2>
      <AiBanner />
      {!ai.ready ? (
        <p className="text-sm text-muted-foreground">{t('pay.ai.notReady')}</p>
      ) : (
        <>
          {customised ? <p className="text-xs text-muted-foreground">{t('pay.ai.compare.customisedNote')}</p> : null}
          {ask.state.kind === 'idle' ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => ask.compareJobs({ jobA: a.jobId!, jobB: b.jobId!, overrides: { daRate: a.daRate } })}
            >
              <Sparkles aria-hidden="true" className="h-4 w-4" />
              {t('pay.ai.compare.button')}
            </Button>
          ) : (
            <PayAiResult state={ask.state} onDismiss={ask.reset} />
          )}
        </>
      )}
    </SectionCard>
  )
}
