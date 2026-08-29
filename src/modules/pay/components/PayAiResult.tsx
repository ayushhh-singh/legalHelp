import { Loader2 } from 'lucide-react'

import type { PayAiState } from '../usePayAi'

import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'

/** The shared result renderer for both `PayExplainPanel` and `PayCompareAiPanel`. */
export function PayAiResult({ state, onDismiss }: { state: PayAiState; onDismiss: () => void }) {
  const { t, language } = useT()

  switch (state.kind) {
    case 'idle':
      return null

    case 'running':
      return (
        <p aria-live="polite" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" />
          {t('pay.ai.thinking')}
        </p>
      )

    case 'refused':
      return (
        <div
          role="alert"
          className="rounded-lg border-l-[3px] border-coral bg-coral/15 px-3 py-2 text-sm text-coral-foreground"
        >
          <p>{state.refusal.message[language]}</p>
          <Button type="button" size="sm" variant="outline" className="mt-2" onClick={onDismiss}>
            {t('pay.ai.dismiss')}
          </Button>
        </div>
      )

    case 'error':
      return (
        <div role="alert" className="rounded-md border border-border bg-muted px-3 py-2 text-sm">
          <p className="font-semibold">{t('pay.ai.error.title')}</p>
          <p className="text-muted-foreground">{state.message}</p>
          <Button type="button" size="sm" variant="outline" className="mt-2" onClick={onDismiss}>
            {t('pay.ai.dismiss')}
          </Button>
        </div>
      )

    case 'ok': {
      const total = state.usage.inputTokens + state.usage.outputTokens
      return (
        <div className="rounded-md border border-border bg-muted p-3 text-sm">
          <p className="whitespace-pre-wrap">{state.text}</p>
          {total > 0 ? (
            <p className="mt-2 text-xs text-muted-foreground tabular-nums">
              {t('pay.ai.spend', { tokens: total.toLocaleString(), cost: state.cost.toFixed(4) })}
            </p>
          ) : null}
          <Button type="button" size="sm" variant="outline" className="mt-2" onClick={onDismiss}>
            {t('pay.ai.dismiss')}
          </Button>
        </div>
      )
    }
  }
}
