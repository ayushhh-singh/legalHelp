import { Info } from 'lucide-react'

import { useT } from '@/i18n/useT'
import { cn } from '@/lib/utils'

/**
 * The standing disclaimer required on data surfaces by the master context.
 * Wording is translated, never abbreviated.
 *
 * Marigold is the app's single accent, so this is a marigold/15 tint with
 * --marigold-foreground for both the text and the icon — never raw marigold,
 * which measures 1.6:1 against a light page.
 */
export function Disclaimer({ className }: { className?: string }) {
  const { t } = useT()

  return (
    <aside
      className={cn(
        'flex items-start gap-2 rounded-md border-l-[3px] border-marigold bg-marigold/15 px-3 py-2 text-sm text-marigold-foreground',
        className,
      )}
    >
      <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
      <p>{t('common.disclaimer')}</p>
    </aside>
  )
}
