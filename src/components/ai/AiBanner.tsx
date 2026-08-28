import { ShieldAlert } from 'lucide-react'

import { useT } from '@/i18n/useT'
import { cn } from '@/lib/utils'

interface AiBannerProps {
  /** True on Tier 0, where nothing can leave the device. */
  localOnly?: boolean
  className?: string
}

/**
 * The standing AI notice. It appears on EVERY AI surface, permanently — not as
 * a dismissible toast, because the thing it says is true every time, not once.
 *
 * Coral rather than the marigold used by <Disclaimer/>: the ordinary
 * disclaimer says "verify this figure", which is routine; this one says "what
 * you type leaves the device", which is not. They must not read as the same
 * weight of warning.
 *
 * Coral is never used as a raw text colour — this is the /15 tint with
 * --coral-foreground on top, per the pairing rule in tokens.css.
 */
export function AiBanner({ localOnly = false, className }: AiBannerProps) {
  const { t } = useT()

  return (
    <aside
      aria-label={t('ai.banner.label')}
      className={cn(
        'flex items-start gap-2 rounded-md border-l-[3px] border-coral bg-coral/15 px-3 py-2 text-sm text-coral-foreground',
        className,
      )}
    >
      <ShieldAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="space-y-1">
        <p className="font-semibold">{t('ai.banner.title')}</p>
        <p>{t('ai.banner.classified')}</p>
        <p>
          {localOnly ? t('ai.banner.staysOnDevice') : t('ai.banner.leavesDevice')} {t('ai.banner.verify')}
        </p>
      </div>
    </aside>
  )
}
