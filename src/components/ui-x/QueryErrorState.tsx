import { AlertTriangle } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'
import { cn } from '@/lib/utils'

interface QueryErrorStateProps {
  title?: string
  body?: string
  onRetry?: () => void
  className?: string
}

/**
 * Failure state for a lookup or a load. Deliberately reports nothing anywhere —
 * no analytics, no network (master context, hard rule).
 *
 * `--coral` is the low band, so the tint is coral/15 with --coral-foreground on
 * it; the raw coral is never used as text or as the icon colour.
 */
export function QueryErrorState({ title, body, onRetry, className }: QueryErrorStateProps) {
  const { t } = useT()

  return (
    <div
      role="alert"
      className={cn('flex flex-col gap-2 rounded-lg border border-coral/30 bg-coral/15 p-4', className)}
    >
      <div className="flex items-center gap-2 text-coral-foreground">
        <AlertTriangle aria-hidden="true" className="h-4 w-4 shrink-0" />
        <h2 className="text-sm font-semibold">{title ?? t('errors.title')}</h2>
      </div>
      <p className="text-sm text-coral-foreground">{body ?? t('errors.body')}</p>
      {onRetry ? (
        <div>
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            {t('common.retry')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
