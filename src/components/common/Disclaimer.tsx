import { Info } from 'lucide-react'

import { useT } from '@/i18n/useT'
import { cn } from '@/lib/utils'

/**
 * The standing disclaimer required on data surfaces by the master context.
 * Wording is translated, never abbreviated.
 */
export function Disclaimer({ className }: { className?: string }) {
  const { t } = useT()

  return (
    <aside
      className={cn(
        'flex items-start gap-2 rounded-sm border-l-2 border-thread/40 bg-thread/5 px-3 py-2 text-sm text-ink',
        className,
      )}
    >
      <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-thread" />
      <p>{t('common.disclaimer')}</p>
    </aside>
  )
}
