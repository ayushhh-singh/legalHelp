import { Loader2, Sparkles } from 'lucide-react'

import { useTutorAi } from '../useTutorAi'

import type { UseAi } from '@/ai/useAi'
import { AiBanner } from '@/components/ai/AiBanner'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'

/**
 * The weekly focus plan — "Get a focus plan" on the Trainer home screen,
 * grounded in the reader's own `get_user_weak_areas` and nothing else
 * (`src/ai/agents/tutor.ts#weeklyFocusPlan`). Renders nothing unless
 * `useAi().enabled`.
 */
export function FocusPlanCard({ ai }: { ai: UseAi }) {
  const { t, language } = useT()
  const tutor = useTutorAi({
    language,
    provider: ai.provider,
    tier: ai.tier,
    budgetLimit: ai.settings.monthlyTokenBudget,
    onSpent: () => void ai.refreshBudget(),
  })

  if (!ai.enabled) return null

  return (
    <div className="mt-3 flex flex-col gap-3 border-t border-border pt-3">
      <AiBanner />
      {!ai.ready ? (
        <p className="text-xs text-muted-foreground">{t('trainer.ai.notReady')}</p>
      ) : tutor.state.kind === 'focusPlan' ? (
        <div className="rounded-md border border-border bg-muted p-3 text-sm">
          <p className="whitespace-pre-wrap">{tutor.state.text}</p>
          <Button type="button" size="sm" variant="outline" className="mt-2" onClick={tutor.reset}>
            {t('trainer.ai.dismiss')}
          </Button>
        </div>
      ) : tutor.state.kind === 'error' ? (
        <div role="alert" className="rounded-md border border-border bg-muted px-3 py-2 text-sm">
          <p className="text-muted-foreground">{tutor.state.message}</p>
          <Button type="button" size="sm" variant="outline" className="mt-2" onClick={tutor.reset}>
            {t('trainer.ai.dismiss')}
          </Button>
        </div>
      ) : tutor.state.kind === 'running' ? (
        <p aria-live="polite" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" />
          {t('trainer.ai.thinking')}
        </p>
      ) : (
        <Button type="button" size="sm" variant="outline" onClick={() => tutor.focusPlan()}>
          <Sparkles aria-hidden="true" className="h-4 w-4" />
          {t('trainer.ai.focusPlan.button')}
        </Button>
      )}
    </div>
  )
}
