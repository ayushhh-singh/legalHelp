import { ExternalLink } from 'lucide-react'

import { useT } from '@/i18n/useT'
import { cn } from '@/lib/utils'

interface SourceChipProps {
  /** Human-readable name of the issuing body or document. */
  name: string
  url: string
  className?: string
}

/**
 * Master context: every data card shows its source. Renders the source name as
 * an outbound link, flagged for screen readers as opening in a new tab.
 */
export function SourceChip({ name, url, className }: SourceChipProps) {
  const { t } = useT()

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-input hover:text-foreground',
        className,
      )}
    >
      <span className="sr-only">{t('common.source')}: </span>
      <span>{name}</span>
      <ExternalLink aria-hidden="true" className="h-3 w-3 shrink-0" />
      <span className="sr-only"> ({t('common.opensInNewTab')})</span>
    </a>
  )
}
